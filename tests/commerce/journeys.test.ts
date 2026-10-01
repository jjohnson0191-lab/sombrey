// Sombrey commerce, Phase 6J — end-to-end customer journeys across 6A–6I.
//
// Each journey moves one synthetic customer through real-world states using the
// PRODUCT's code: the stores (checkoutStore, fulfillmentStore, returnsStore,
// deviceStore, subscriptionStore), the action orchestration (flows.ts — the very
// functions the Convex actions call), the App Store verification flow (6C) and
// the entitlement computation (6D). Providers are the TEST-ONLY adapters in
// testProviders.ts; Apple is the 6C throwaway certificate chain. The database is
// the in-memory stand-in (memoryDb.ts) — nothing here touches a deployment.
// After every journey the 6I integrity report must come back clean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { COMMERCE_CONFIG, FEATURE_IDS, knownProductIds, publicCommerceConfig, validateCommerceConfig, type CommerceConfig, type FeatureId } from "../../convex/commerce/config.ts";
import { providersFor, type Providers, type VerifiedPaymentEvent } from "../../convex/commerce/providers.ts";
import {
  beginPaymentFlow, issueRefundFlow, orderIdFromAttemptKey, paymentWebhookFlow, refreshTrackingFlow, requestQuoteFlow, returnLabelFlow,
  shipmentWebhookFlow, submitFulfillmentFlow,
} from "../../convex/commerce/flows.ts";
import {
  applyVerifiedPayment, attachProviderRef, cancelCheckout, createOrderRecord, quoteDraft, recordQuote, reservePaymentAttempt, updateAddress,
} from "../../convex/commerce/checkoutStore.ts";
import { applyShipmentEvent, createFulfillment, recordProviderShipment, recordShipment, submissionJob, trackingRef } from "../../convex/commerce/fulfillmentStore.ts";
import { approveRefund, authorizeReturn, cancelReturn, receiveReturn, refundJob, rejectReturn, requestReturn, returnLabelJob, returnOptions, markRefundRequested } from "../../convex/commerce/returnsStore.ts";
import { activateWithCode, assignDevice, linkPairing, registerDevice, staffActivate } from "../../convex/commerce/deviceStore.ts";
import { generateActivationCode, hashActivationCode, normalizeActivationCode } from "../../convex/commerce/devices.ts";
import { customerTracking, visibleToCustomer } from "../../convex/commerce/fulfillment.ts";
import { orderStage, type OrderQuote } from "../../convex/commerce/quotes.ts";
import { computeEntitlements, type Entitlements } from "../../convex/commerce/entitlements.ts";
import { validateEvent } from "../../convex/commerce/events.ts";
import { staffMay } from "../../convex/commerce/staffAccess.ts";
import { auditCommerceIntegrity } from "../../convex/commerce/integrity.ts";
import { appAccountTokenFor } from "../../convex/commerce/accountToken.ts";
import { verifyAppSubmission, verifyNotification } from "../../convex/commerce/appStoreFlow.ts";
import { applyNotification, linkAccountToken, toSubscriptionRecord, writeVerifiedSubscription, type StoreConfig } from "../../convex/commerce/subscriptionStore.ts";
import { BUNDLE, DAY, MemoryDb, PRODUCT, T0, makeChain, notification, renewal, signJws, statusSource, transaction, verifierFor } from "./appStoreHarness.ts";
import { TestFulfillmentProvider, TestPaymentProvider, testShipping, testTax, type Mode } from "./testProviders.ts";

const C = COMMERCE_CONFIG;
const MIN = 60_000, H = 3_600_000;
const ALICE = "users:alice" as never, BOB = "users:bob" as never, CAROL = "users:carol" as never, STAFF = "users:staff" as never;
const ADDRESS = { fullName: "A Customer", line1: "1 Test Street", city: "Colombo", postalCode: "00100", countryCode: "LK" };
const FAST = 30; // ms — a "timeout" in these tests (production: PROVIDER_TIMEOUT_MS)
const ROOT = join(import.meta.dirname, "../..");

// ─── Apple (6C harness: a throwaway chain trusted only in this process) ─────

const apple = makeChain("Apple-6J-stand-in");
const verifier = verifierFor(apple);
const STORE: StoreConfig = { membershipProductId: "sombrey_membership_monthly", appStoreProductIds: [PRODUCT], configVersion: C.version };
const expected = { bundleId: BUNDLE, productIds: [PRODUCT], environments: ["Sandbox" as const] };

// ─── The world: one database, one clock, test-only providers ────────────────

class World {
  db = new MemoryDb();
  t = T0;
  cfg: CommerceConfig;
  readonly now = () => this.t;
  pay = new TestPaymentProvider(this.now);
  ful = new TestFulfillmentProvider(this.now);
  shipping = testShipping();
  tax = testTax();
  logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  private n = 0;
  constructor(cfg: CommerceConfig = C) { this.cfg = cfg; }
  providers(): Providers { return { shipping: this.shipping, tax: this.tax, payment: this.pay, fulfillment: this.ful }; }
  advance(ms: number) { this.t += ms; }
  m<T>(f: () => Promise<T>) { return this.db.serial(f); } // one Convex mutation
  log = (event: string, fields: Record<string, unknown>) => { this.logs.push({ event, fields }); };
  row(id: unknown): Record<string, unknown> { return this.db.get(id as string)!; }
  order(id: unknown) { return this.row(id) as Record<string, unknown> & { paymentStatus: string; fulfillmentStatus: string; returnStatus: string; totalCents: number; refundedCents?: number; paymentAttempt?: { idempotencyKey: string; providerRef?: string; amountCents: number } }; }
  /** The stage the customer sees (as commerce/access:myOrders and orderTracking derive it). */
  stage(id: unknown) {
    const o = this.order(id);
    const active = this.db.rows("commerceReturns").find((r) => r.orderId === id && !["cancelled", "rejected", "refunded"].includes(r.status as string));
    return orderStage({ ...(o as never), quote: (o.quote ?? null) as never, paymentAttempt: (o.paymentAttempt ?? null) as never, activeReturn: (active?.status ?? null) as never }, this.t);
  }

  // Customer: checkout (checkout:startBandCheckout → requestQuote → beginPayment)
  startCheckout(user: unknown, key = `ck-6j-${++this.n}-0000000000`, quantity = 1, productId = "sombrey_band") {
    return this.m(() => createOrderRecord(this.db as never, { userId: user as never, items: [{ productId, quantity }], shippingAddress: ADDRESS, checkoutRequestKey: key }, this.cfg, this.t, () => 0.37));
  }
  quote(user: unknown, orderId: unknown, timeoutMs?: number) {
    return requestQuoteFlow({
      draft: () => quoteDraft(this.db as never, user as never, orderId as never, this.cfg, this.t) as never,
      providers: this.providers(), config: this.cfg, now: this.t, quoteId: `q-${++this.n}`, timeoutMs,
      store: (q) => this.m(() => recordQuote(this.db as never, user as never, orderId as never, q, this.cfg, this.t)),
    });
  }
  beginPayment(user: unknown, orderId: unknown, timeoutMs?: number) {
    return beginPaymentFlow({
      payment: this.pay, methods: [...this.cfg.checkout.methods], timeoutMs,
      reserve: (provider) => this.m(() => reservePaymentAttempt(this.db as never, user as never, orderId as never, provider, this.cfg, this.t)) as never,
      attach: (key, ref) => this.m(() => attachProviderRef(this.db as never, orderId as never, key, ref, this.t)),
    });
  }
  /** The provider's signed webhook reaches Sombrey (the future HTTP route runs this flow). */
  paymentWebhook(delivery: { rawBody: string; headers: Record<string, string> }) {
    return paymentWebhookFlow({
      payment: this.pay, ...delivery, log: this.log,
      apply: (orderId, event) => this.m(() => applyVerifiedPayment(this.db as never, { orderId: orderId as never, provider: this.pay.name, event }, this.cfg, this.t)),
    });
  }
  /** Quote → pay → verified webhook, the happy path. */
  async purchase(user: unknown, quantity = 1, productId = "sombrey_band") {
    const { orderId } = await this.startCheckout(user, undefined, quantity, productId);
    const quote = await this.quote(user, orderId);
    assert.equal(quote.complete, true);
    assert.equal((await this.beginPayment(user, orderId)).status, "ready");
    const key = this.order(orderId).paymentAttempt!.idempotencyKey;
    assert.equal((await this.paymentWebhook(this.pay.customerPays(key))).status, "processed");
    assert.equal(this.order(orderId).paymentStatus, "paid");
    return { orderId, key, total: quote.totalCents! };
  }

  // Staff: fulfilment (staff:createFulfillment → submitFulfillment → refreshTracking)
  createFulfillment(orderId: unknown, key = `ful-6j-${++this.n}-0000`, kind: "original" | "replacement" = "original", replaces?: unknown) {
    return this.m(() => createFulfillment(this.db as never, { orderId: orderId as never, idempotencyKey: key, kind, ...(replaces ? { replacesFulfillmentId: replaces as never } : {}) }, this.cfg, this.t));
  }
  submit(fulfillmentId: unknown, timeoutMs?: number) {
    return submitFulfillmentFlow({
      provider: this.ful, fulfillmentId: fulfillmentId as string, log: this.log, timeoutMs,
      job: () => submissionJob(this.db as never, fulfillmentId as never, this.cfg),
      record: (key, created) => this.m(() => recordProviderShipment(this.db as never, { fulfillmentId: fulfillmentId as never, idempotencyKey: key, provider: this.ful.name, created }, this.cfg, this.t)),
    });
  }
  applyEvent = (event: Parameters<typeof applyShipmentEvent>[1]["event"]) => this.m(() => applyShipmentEvent(this.db as never, { provider: this.ful.name, event }, this.cfg, this.t));
  shipmentWebhook(events: unknown[]) {
    return shipmentWebhookFlow({ provider: this.ful, ...this.ful.webhook(events), apply: this.applyEvent });
  }
  refresh(shipmentId: unknown, timeoutMs?: number) {
    return refreshTrackingFlow({ provider: this.ful, shipmentId: shipmentId as string, log: this.log, timeoutMs, shipmentRef: () => trackingRef(this.db as never, shipmentId as never), apply: this.applyEvent });
  }
  shipmentOf(fulfillmentId: unknown) { return this.db.rows("commerceShipments").find((s) => s.fulfillmentId === fulfillmentId)!; }
  /** Fulfil and deliver through the provider: picked up → in transit → out for delivery → delivered (webhooks). */
  async deliver(orderId: unknown, opts: { kind?: "original" | "replacement"; replaces?: unknown } = {}) {
    const { fulfillmentId } = await this.createFulfillment(orderId, undefined, opts.kind ?? "original", opts.replaces);
    assert.equal((await this.submit(fulfillmentId)).status, "submitted");
    const ref = this.shipmentOf(fulfillmentId).providerRef as string;
    const at = this.t;
    for (const [i, type] of ["picked_up", "in_transit", "out_for_delivery", "delivered"].entries()) {
      const r = await this.shipmentWebhook([this.ful.scan(ref, type, at + (i + 1) * H)]);
      assert.deepEqual(r, { status: "processed", outcomes: ["applied"] }, type);
    }
    this.advance(DAY);
    return { fulfillmentId, ref };
  }

  // Staff + customer: physical units
  async unit(mac: string, productId = "sombrey_band") {
    const bytes = new Uint8Array(12); crypto.getRandomValues(bytes);
    const code = generateActivationCode(bytes);
    const { deviceId } = await this.m(async () => registerDevice(this.db as never, { productId, hardwareIdKind: "mac", hardwareId: mac, activationCodeHash: await hashActivationCode(normalizeActivationCode(code)!), staffUserId: STAFF }, this.cfg, this.t));
    return { deviceId, code };
  }
  /** myDevices:activateDevice — normalize, hash, then the server decides. */
  activate(user: unknown, code: string) {
    return this.m(async () => {
      const canonical = normalizeActivationCode(code);
      return activateWithCode(this.db as never, user as never, canonical ? await hashActivationCode(canonical) : "malformed", this.cfg, this.t);
    });
  }
  pairOnIphone(user: unknown, peripheralId: string) {
    return this.db.insert("wearableDevices", { userId: user, deviceId: peripheralId, name: "G69", createdAt: this.t });
  }

  // Staff: returns and refunds (staff:authorize/receive/approve → createReturnLabel → issueRefund)
  returnLabel(returnId: unknown) {
    return returnLabelFlow({
      provider: this.ful, returnId: returnId as string,
      job: () => returnLabelJob(this.db as never, returnId as never, this.cfg),
      record: (key, created) => this.m(() => recordShipment(this.db as never, { direction: "return", returnId: returnId as never, idempotencyKey: key, provider: this.ful.name, created }, this.cfg, this.t)),
    });
  }
  issueRefund(returnId: unknown, timeoutMs?: number) {
    return issueRefundFlow({
      payment: this.pay, timeoutMs,
      job: () => refundJob(this.db as never, returnId as never),
      markRequested: (refundRef) => this.m(() => markRefundRequested(this.db as never, returnId as never, refundRef, this.t)),
    });
  }

  // Apple (appStore:submitTransaction / processNotification, minus Convex)
  async appleSubmits(user: unknown, token: string, statusTx: object, statusRen: object = {}, clientTx: object = statusTx) {
    const statuses = statusSource(() => [{ status: 1, originalTransactionId: "2000000000000001", signedTransactionInfo: signJws(transaction({ appAccountToken: token, ...statusTx }), apple), signedRenewalInfo: signJws(renewal(statusRen), apple) }]);
    const v = await verifyAppSubmission({ verifier, statuses, now: this.t }, { signedTransaction: signJws(transaction({ appAccountToken: token, ...clientTx }), apple), expected: { ...expected, expectedAccountToken: token } });
    if (!v.ok) return v;
    // The server refuses (throws FORBIDDEN) a subscription bound to another account.
    return this.m(() => writeVerifiedSubscription(this.db as never, { userId: user as never, update: v.update, event: "verified_with_apple", source: { kind: "app_submission" } }, STORE, this.t))
      .catch((e: Error) => ({ ok: false as const, error: e.message }));
  }
  async appleNotifies(type: string, subtype: string | undefined, tx: object, ren: object, signedDate: number) {
    const v = await verifyNotification({ verifier, now: this.t }, { signedPayload: notification(apple, type, subtype, tx, ren, { signedDate }), expected });
    assert.ok(v.ok, JSON.stringify(v));
    return this.m(() => applyNotification(this.db as never, { notification: v.notification, ...(v.apply ? { apply: v.apply } : {}), ...(v.skipped ? { skipped: v.skipped } : {}) }, STORE, this.t));
  }

  /** commerce/gate:entitlementsFor over this world's records (sandbox allowed, as in dev). */
  entitlements(user: unknown, at = this.t): Entitlements {
    return computeEntitlements({
      ownership: this.db.rows("bandOwnership").filter((o) => o.userId === user).map((o) => ({ status: o.status, source: o.source, ...(o.productId ? { productId: o.productId } : {}) })) as never,
      subscriptions: this.db.rows("commerceSubscriptions").filter((s) => s.userId === user).map((s) => toSubscriptionRecord(s as never)),
      legacyPremium: false,
      pairedDevices: this.db.rows("wearableDevices").filter((d) => d.userId === user).length,
    }, this.cfg, at, { allowSandbox: true });
  }
  allowed(user: unknown, at = this.t) { const e = this.entitlements(user, at); return new Set(FEATURE_IDS.filter((f) => e.features[f].allowed)); }

  /** 6I integrity report + journey-level invariants. Never repairs. */
  assertConsistent() {
    const t = (n: string) => this.db.rows(n) as never;
    assert.deepEqual(auditCommerceIntegrity({ orders: t("commerceOrders"), fulfillments: t("commerceFulfillments"), shipments: t("commerceShipments"), returns: t("commerceReturns"), devices: t("commerceDevices"), ownerships: t("bandOwnership") }), []);
    const known = new Set(knownProductIds(this.cfg));
    for (const o of this.db.rows("commerceOrders")) for (const l of o.lines as Array<{ productId: string }>) assert.ok(known.has(l.productId), "impossible product reference");
    for (const d of this.db.rows("commerceDevices")) assert.ok(known.has(d.productId as string));
    // Refund bookkeeping: completed return refunds never exceed what the provider confirmed.
    for (const o of this.db.rows("commerceOrders")) {
      const completed = this.db.rows("commerceReturns").filter((r) => r.orderId === o._id && r.status === "refunded").reduce((s, r) => s + (r.refund as { amountCents: number }).amountCents, 0);
      assert.ok(completed <= ((o.refundedCents as number | undefined) ?? 0), "a return marked refunded without a verified provider refund");
    }
    // One logical revenue record per paid order.
    for (const o of this.db.rows("commerceOrders")) assert.ok(this.db.rows("commerceEvents").filter((e) => e.name === "band_checkout_completed" && e.orderId === o._id).length <= 1, "duplicate revenue record");
  }
}

const SURFACES: Record<string, FeatureId> = {
  "Home · Band information": "wearable_data", "Vitals": "vitals", "Readiness": "wearable_data", "Strain": "wearable_data", "Sleep": "wearable_data",
  "Activity (Band)": "wearable_data", "History (Band)": "wearable_data", "Sombrey Coach": "ai_coach", "AI Macro Calculator": "ai_meal_analysis",
  "Progress": "core_tracking", "Training & nutrition logging": "core_tracking", "Body Scan": "body_scan", "Band management / pairing": "band_pairing",
  "Membership management": "account", "Settings": "settings",
};
const FREE: FeatureId[] = ["account", "settings", "band_pairing", "core_tracking", "body_scan"];
const BAND: FeatureId[] = ["vitals", "wearable_data"];
const AI: FeatureId[] = ["ai_coach", "ai_meal_analysis"];
const surfacesAllowed = (w: World, user: unknown, at?: number) => { const a = w.allowed(user, at); return Object.entries(SURFACES).filter(([, f]) => a.has(f)).map(([s]) => s); };
const surfacesFor = (features: FeatureId[]) => Object.entries(SURFACES).filter(([, f]) => features.includes(f)).map(([s]) => s);

const aliceToken = (await appAccountTokenFor("user_alice"))!;
const bobToken = (await appAccountTokenFor("user_bob"))!;
const MAC = (n: number) => `02:00:5E:6A:00:${n.toString(16).toUpperCase().padStart(2, "0")}`;

// ═════════════════════════════════════════════════════════════════════════════
// Journeys A–H: entitlement states end to end
// ═════════════════════════════════════════════════════════════════════════════

test("Journey A — Membership: purchase → verified → AI unlocks; cancel keeps it until expiry; expiry locks; restore unlocks", async () => {
  const w = new World();
  await w.m(() => linkAccountToken(w.db as never, ALICE, aliceToken, w.t));
  assert.equal(w.entitlements(ALICE).state, "none");
  assert.equal(w.entitlements(ALICE).membership.status, "none", "Membership screen: not a member");
  assert.equal(w.entitlements(ALICE).features.ai_coach.unlockedBy, "membership");

  // StoreKit purchase (MembershipManager) → the app submits the signed transaction → the SERVER verifies with Apple.
  assert.equal(validateEvent({ name: "subscription_purchase_initiated", platform: "ios", productId: "sombrey_membership_monthly" }, "client", knownProductIds(C)), null);
  w.advance(2000);
  const bought = await w.appleSubmits(ALICE, aliceToken, {});
  assert.equal((bought as { result: string }).result, "created");
  let e = w.entitlements(ALICE);
  assert.deepEqual([e.state, e.subscriptionActive, e.membership.status, e.membership.autoRenew], ["subscriber", true, "active", true]);
  assert.deepEqual(surfacesAllowed(w, ALICE).sort(), surfacesFor([...FREE, ...AI]).sort(), "Coach + Macro Calculator unlock; Band surfaces stay locked");
  assert.equal(e.features.vitals.unlockedBy, "band");

  // A client can't make itself a member: a transaction for another account is refused by the server.
  const forged = await w.appleSubmits(ALICE, bobToken, {});
  assert.equal((forged as { ok?: boolean }).ok, false);

  // Cancellation: auto-renew off — still a member until the period ends.
  await w.appleNotifies("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", transaction({ appAccountToken: aliceToken }), renewal({ autoRenewStatus: 0 }), T0 + 7000);
  e = w.entitlements(ALICE);
  assert.deepEqual([e.membership.status, e.membership.autoRenew, e.features.ai_coach.allowed], ["active", false, true], "cancelled-but-active");
  const expiry = (w.db.rows("commerceSubscriptions")[0].expiresDate as number);
  assert.equal(w.allowed(ALICE, expiry - 1).has("ai_coach"), true, "Coach until the last moment");
  assert.equal(w.allowed(ALICE, expiry + 1).has("ai_coach"), false, "expiry locks Membership features (server clock, even before Apple's notice)");
  assert.equal((await w.appleNotifies("EXPIRED", "VOLUNTARY", transaction({ appAccountToken: aliceToken, purchaseDate: T0 - 30 * DAY, expiresDate: T0 - 1 }), renewal({ autoRenewStatus: 0 }), T0 + 8000)).outcome, "applied");
  e = w.entitlements(ALICE);
  assert.deepEqual([e.state, e.membership.status], ["none", "expired"]);
  assert.equal(w.db.rows("bandOwnership").length, 0, "Membership never touches Band ownership");

  // Restore: StoreKit restore → the app submits → Apple says it's active again → the server confirms.
  w.advance(1000);
  const restored = await w.appleSubmits(ALICE, aliceToken, { transactionId: "2000000000000003", purchaseDate: T0 + DAY, expiresDate: T0 + 60 * DAY, signedDate: T0 + 9000 }, { signedDate: T0 + 9000 });
  assert.equal((restored as { result: string }).result, "updated");
  assert.equal(w.entitlements(ALICE).state, "subscriber", "restore unlocks only once the server has verified it");
  assert.equal(w.db.rows("commerceSubscriptions").length, 1, "one membership record; the past is history");
  // No local membership flag can be the source of truth (6H source checks cover the Swift side too).
  const store = readFileSync(join(ROOT, "apps/ios/Sombrey/Commerce/EntitlementStore.swift"), "utf8");
  assert.match(store, /subscribe\(to: "commerce\/access:myEntitlements"/);
  assert.ok(!/UserDefaults|@AppStorage/.test(store.replace(/\/\/.*$/gm, "")));
  w.assertConsistent();
});

test("Journey B — Band purchase: config product + price → quote with expiry → payment → verified webhook → PAID ≠ OWNED", async () => {
  const w = new World();
  const band = publicCommerceConfig(C).band;
  assert.deepEqual([band.id, band.displayName, band.generation, band.priceCents, band.currency], ["sombrey_band", "Sombrey Band", "V1", 10000, "USD"], "the product and price come from the server's config");
  for (const name of ["product_viewed", "band_purchase_initiated"]) assert.equal(validateEvent({ name, platform: "ios", productId: "sombrey_band" }, "client", knownProductIds(C)), null);

  const { orderId, created } = await w.startCheckout(ALICE, "ck-journey-b-000001");
  assert.equal(created, true);
  assert.equal(w.stage(orderId), "draft");
  assert.equal((await w.beginPayment(ALICE, orderId)).status, "quote_missing", "no payment without a quote");

  const q = await w.quote(ALICE, orderId);
  assert.deepEqual([q.subtotalCents, q.shipping.status, q.tax.status, q.totalCents], [10000, "quoted", "quoted", 10000 + 1500 + 920]);
  assert.equal(q.expiresAt, w.t + C.checkout.quoteTtlMinutes * MIN, "the quote expires");
  assert.equal(w.stage(orderId), "quote_ready");

  const begun = await w.beginPayment(ALICE, orderId);
  assert.equal(begun.status, "ready");
  const o = w.order(orderId);
  assert.deepEqual([o.paymentAttempt!.amountCents, w.pay.sessions.size], [12420, 1], "the frozen quoted total is what the provider is asked for");
  assert.equal(w.stage(orderId), "payment_pending");

  const key = o.paymentAttempt!.idempotencyKey;
  assert.equal(orderIdFromAttemptKey(key), orderId, "the webhook finds its order from the echoed attempt key");
  assert.deepEqual(await w.paymentWebhook(w.pay.customerPays(key)), { status: "processed", outcome: "applied" });
  assert.deepEqual([w.order(orderId).paymentStatus, w.stage(orderId)], ["paid", "paid"]);
  assert.equal((await w.createFulfillment(orderId)).created, true, "fulfilment becomes available");

  // PAID ORDER ≠ BAND OWNERSHIP
  assert.equal(w.db.rows("bandOwnership").length, 0);
  assert.equal(w.entitlements(ALICE).ownsBand, false);
  assert.equal(w.entitlements(ALICE).state, "none");
  w.assertConsistent();
});

test("Journey C — Fulfilment & tracking: submitted → shipped → in transit → out for delivery → delivered; duplicates, out-of-order and stale events change nothing", async () => {
  const w = new World();
  const { orderId } = await w.purchase(ALICE);
  const { fulfillmentId } = await w.createFulfillment(orderId);
  assert.equal(w.stage(orderId), "fulfillment_pending");
  assert.equal((await w.submit(fulfillmentId)).status, "submitted");
  assert.equal(w.row(fulfillmentId).status, "submitted", "preparing (the provider has it)");
  const s = w.shipmentOf(fulfillmentId);
  assert.deepEqual([s.carrier, s.trackingNumber, s.estimatedDeliveryAt], ["TEST-Carrier", "TESTTRK000001", undefined], "carrier + tracking from the provider; no invented ETA");
  const ref = s.providerRef as string;
  const at = w.t;
  const step = async (type: string, h: number, extra = {}) => (await w.shipmentWebhook([w.ful.scan(ref, type, at + h * H, extra)])).outcomes;

  assert.deepEqual(await step("picked_up", 1), ["applied"]);
  assert.equal(w.stage(orderId), "shipped");
  assert.deepEqual(await step("in_transit", 5, { estimatedDeliveryAt: at + 48 * H }), ["applied"]);
  const tracking = () => customerTracking(w.order(orderId) as never, w.db.rows("commerceShipments").filter((x) => x.direction === "outbound") as never);
  assert.equal(tracking().shipments[0].estimatedDeliveryAt, at + 48 * H, "the ETA shown is exactly the provider's");
  // Duplicate webhook: the same signed delivery again.
  const dup = w.ful.shipments.get(`ship:${fulfillmentId}:1`)!.events.at(-1)!;
  assert.deepEqual((await w.shipmentWebhook([dup])).outcomes, ["duplicate"]);
  // Out of order: an older event arriving late can't move state backwards.
  assert.deepEqual((await w.shipmentWebhook([{ ...dup, eventId: "late-pickup", type: "picked_up", occurredAt: at + 2 * H }])).outcomes, ["stale"]);
  assert.equal(w.row(s._id).status, "in_transit");
  assert.deepEqual(await step("out_for_delivery", 30), ["applied"]);
  assert.deepEqual(await step("delivered", 40), ["applied"]);
  assert.deepEqual([w.row(s._id).status, w.row(fulfillmentId).status, w.order(orderId).fulfillmentStatus, w.stage(orderId)], ["delivered", "delivered", "delivered", "delivered"]);
  // Stale / after-terminal events can't corrupt the final state; a forged (unsigned) delivery is refused.
  assert.deepEqual((await w.shipmentWebhook([{ ...dup, eventId: "after", type: "in_transit", occurredAt: at + 50 * H }])).outcomes, ["after_terminal"]);
  assert.deepEqual(await shipmentWebhookFlow({ provider: w.ful, rawBody: JSON.stringify([{ ...dup, eventId: "forged", type: "exception" }]), headers: { "x-test-signature": "00", "x-test-timestamp": String(w.t) }, apply: w.applyEvent }), { status: "rejected_signature" });
  assert.equal(w.row(s._id).status, "delivered");
  // Recovery polling after missed webhooks agrees: nothing new to apply.
  assert.equal(w.order(orderId).deliveredAt, at + 40 * H, "the carrier's delivery time");
  const steps = tracking().steps.filter((x) => x.reached).map((x) => x.step);
  assert.ok(steps.includes("delivered") && steps.includes("shipped"));
  assert.equal(w.db.rows("bandOwnership").length, 0, "DELIVERY DOES NOT CREATE OWNERSHIP");
  w.assertConsistent();
});

test("Journey D — Activation: only the code on the delivered unit, by the buyer, creates ownership; payment, delivery and pairing never do", async () => {
  const w = new World();
  const { orderId } = await w.purchase(ALICE);
  assert.equal(w.entitlements(ALICE).ownsBand, false, "PAYMENT DOES NOT CREATE OWNERSHIP");
  const { deviceId: early, code: earlyCode } = await w.unit(MAC(1));
  const { fulfillmentId } = await w.createFulfillment(orderId);
  await assignDevice(w.db as never, { deviceId: early, fulfillmentId }, w.t);
  assert.deepEqual(await w.activate(ALICE, earlyCode), { ok: false, reason: "not_delivered" }, "not before delivery");
  await w.submit(fulfillmentId);
  const ref = w.shipmentOf(fulfillmentId).providerRef as string;
  for (const [i, type] of ["picked_up", "in_transit", "delivered"].entries()) await w.shipmentWebhook([w.ful.scan(ref, type, w.t + (i + 1) * H)]);
  w.advance(DAY);
  assert.equal(w.entitlements(ALICE).ownsBand, false, "DELIVERY DOES NOT CREATE OWNERSHIP");
  await w.pairOnIphone(ALICE, "PERIPHERAL-ALICE-1");
  assert.equal(w.entitlements(ALICE).ownsBand, false, "PAIRING DOES NOT CREATE OWNERSHIP");

  assert.deepEqual(await w.activate(ALICE, "ABCD-EFGH-JKMN"), { ok: false, reason: "invalid_code" });
  assert.deepEqual(await w.activate(BOB, earlyCode), { ok: false, reason: "not_eligible_for_account" }, "someone else's code is useless");
  const ok = await w.activate(ALICE, earlyCode);
  assert.equal(ok.ok, true, "ACTIVATION CREATES OWNERSHIP");
  const own = w.db.rows("bandOwnership");
  assert.deepEqual([own.length, own[0].source, own[0].status, own[0].deviceId, own[0].productId], [1, "activation", "activated", early, "sombrey_band"]);
  const e = w.entitlements(ALICE);
  assert.deepEqual([e.state, e.ownsBand, e.subscriptionActive], ["band_owner", true, false]);
  assert.deepEqual(surfacesAllowed(w, ALICE).sort(), surfacesFor([...FREE, ...BAND]).sort(), "vitals/readiness/sleep/activity/history unlock; AI stays locked");
  assert.deepEqual(await w.activate(ALICE, earlyCode), { ok: true, deviceId: early, ownershipId: own[0]._id, alreadyActive: true }, "retrying is safe");
  assert.equal(w.db.rows("bandOwnership").length, 1);
  // The pairing link (hardware-dependent, not wired in the app) only links what's already owned.
  assert.deepEqual(await linkPairing(w.db as never, ALICE, { peripheralId: "PERIPHERAL-ALICE-1", hardwareIdKind: "mac", hardwareId: MAC(1) }, w.cfg, w.t), { result: "linked" });
  assert.equal(w.db.rows("bandOwnership").length, 1, "linking never creates ownership");
  w.assertConsistent();
});

/** Alice with an activated Band (via the full purchase → delivery → activation path). */
async function bandOwner(w: World, user = ALICE, mac = MAC(1)) {
  const { orderId, total } = await w.purchase(user);
  const { fulfillmentId } = await w.deliver(orderId);
  const u = await w.unit(mac);
  await assignDevice(w.db as never, { deviceId: u.deviceId, fulfillmentId }, w.t);
  assert.equal((await w.activate(user, u.code)).ok, true);
  return { orderId, total, fulfillmentId, ...u };
}

test("Journeys E/F — Band + Membership unlocks every surface; Membership ending keeps the Band, its data and management", async () => {
  const w = new World();
  await w.m(() => linkAccountToken(w.db as never, ALICE, aliceToken, w.t));
  await bandOwner(w);
  await w.appleSubmits(ALICE, aliceToken, {}, {});
  const e = w.entitlements(ALICE);
  assert.deepEqual([e.state, e.ownsBand, e.subscriptionActive], ["band_owner_subscriber", true, true]);
  assert.deepEqual(surfacesAllowed(w, ALICE).sort(), Object.keys(SURFACES).sort(), "E: every gated surface per the 6D matrix");
  assert.ok(FEATURE_IDS.every((f) => e.features[f].allowed));

  // F: Membership expires; the Band stays.
  const ownershipBefore = structuredClone(w.db.rows("bandOwnership"));
  assert.equal((await w.appleNotifies("EXPIRED", "VOLUNTARY", transaction({ appAccountToken: aliceToken, purchaseDate: T0 - 30 * DAY, expiresDate: T0 - 1 }), renewal({ autoRenewStatus: 0 }), T0 + 8000)).outcome, "applied");
  const f = w.entitlements(ALICE);
  assert.deepEqual([f.state, f.ownsBand], ["band_owner", true]);
  assert.deepEqual(surfacesAllowed(w, ALICE).sort(), surfacesFor([...FREE, ...BAND]).sort(), "Band + history stay; Coach and Macro Calculator lock; management stays");
  assert.deepEqual(w.db.rows("bandOwnership"), ownershipBefore, "Membership ending never deletes or changes Band ownership");
  assert.equal(f.features.ai_coach.unlockedBy, "membership");
  w.assertConsistent();
});

test("Journeys G/H — Membership only, and the free baseline: nothing free is locked, nothing paid leaks", async () => {
  const w = new World();
  await w.m(() => linkAccountToken(w.db as never, BOB, bobToken, w.t));
  await w.appleSubmits(BOB, bobToken, {}, {});
  const g = w.entitlements(BOB);
  assert.deepEqual([g.state, g.ownsBand, g.offers.band], ["subscriber", false, true], "G: Band still offered");
  assert.deepEqual(surfacesAllowed(w, BOB).sort(), surfacesFor([...FREE, ...AI]).sort());
  assert.ok(BAND.every((x) => g.features[x].unlockedBy === "band"));
  assert.equal(w.db.rows("bandOwnership").length, 0);
  await w.pairOnIphone(BOB, "PERIPHERAL-BOB");
  assert.equal(w.entitlements(BOB).ownsBand, false, "a member pairing a Band still isn't an owner");

  const h = w.entitlements(CAROL);
  assert.deepEqual([h.state, h.ownsBand, h.subscriptionActive, h.offers.band, h.offers.membership], ["none", false, false, true, true]);
  assert.deepEqual(surfacesAllowed(w, CAROL).sort(), surfacesFor(FREE).sort(), "H: account, settings, pairing, logging, progress, Body Scan stay free");
  for (const f of [...BAND, ...AI]) assert.ok(["band", "membership"].includes(h.features[f].unlockedBy!), f);
  // The surface map above is the app's and the server's: these are the gates in the code.
  const swift = (f: string) => readFileSync(join(ROOT, "apps/ios/Sombrey", f), "utf8");
  assert.match(swift("Home/HomeScreen.swift"), /entitlements\.access\(\.wearableData\)/);
  assert.match(swift("Home/HomeScreen.swift"), /FeatureGate\(feature: \.vitals\)/);
  assert.match(swift("Progress/ProgressScreen.swift"), /FeatureGate\(feature: \.vitals\)/);
  assert.match(swift("AICoach/AICoachScreen.swift"), /FeatureGate\(feature: \.aiCoach\)/);
  assert.match(swift("Nutrition/NutritionScreen.swift"), /entitlements\.access\(\.aiMealAnalysis\)/);
  assert.match(readFileSync(join(ROOT, "convex/ai/sombreyCoach.ts"), "utf8"), /requireFeature, \{ feature: "ai_coach" \}/, "the server refuses AI too");
  assert.match(readFileSync(join(ROOT, "convex/mealPhotos.ts"), "utf8"), /assertFeature\(ctx, user, "ai_meal_analysis"\)/);
  const gate = readFileSync(join(ROOT, "convex/commerce/gate.ts"), "utf8");
  for (const table of ["bandOwnership", "commerceSubscriptions", "wearableDevices"]) assert.match(gate, new RegExp(`query\\("${table}"\\)\\.withIndex\\("by_user"`), "World.entitlements reads what gate.ts reads");
  w.assertConsistent();
});

// ═════════════════════════════════════════════════════════════════════════════
// Journeys I–J: interruption and recovery
// ═════════════════════════════════════════════════════════════════════════════

test("Journey I — order interruption: lost connection, believed failure, webhook first, duplicate and conflicting webhooks", async () => {
  // 1. Payment succeeds but the client loses its connection: the verified event makes it paid; reopening shows it.
  {
    const w = new World();
    const { orderId } = await w.startCheckout(ALICE);
    await w.quote(ALICE, orderId);
    assert.equal((await w.beginPayment(ALICE, orderId)).status, "ready");
    // …the app is gone. The provider still sends its signed event.
    await w.paymentWebhook(w.pay.customerPays(w.order(orderId).paymentAttempt!.idempotencyKey));
    assert.equal(w.stage(orderId), "paid", "reopening the order shows the truth");
    w.assertConsistent();
  }
  // 2. The client believes payment failed (lost response) but the provider succeeded: a retry is the same order and the same payment.
  {
    const w = new World();
    const first = await w.startCheckout(ALICE, "ck-interrupt-0000002");
    await w.quote(ALICE, first.orderId);
    w.pay.mode = "lost_response";
    assert.equal((await w.beginPayment(ALICE, first.orderId)).status, "payment_unavailable", "the app saw a failure");
    assert.equal(w.pay.sessions.size, 1, "…but the provider created a session");
    w.pay.mode = "ok";
    const again = await w.startCheckout(ALICE, "ck-interrupt-0000002");
    assert.deepEqual([again.orderId, again.created], [first.orderId, false], "retrying checkout → the same order");
    assert.equal((await w.beginPayment(ALICE, first.orderId)).status, "ready");
    assert.equal(w.pay.sessions.size, 1, "→ the same provider session (same idempotency key)");
    await w.paymentWebhook(w.pay.customerPays(w.order(first.orderId).paymentAttempt!.idempotencyKey));
    assert.deepEqual([w.pay.charges, w.db.rows("commerceOrders").length, w.stage(first.orderId)], [1, 1, "paid"]);
    w.assertConsistent();
  }
  // 3. The webhook arrives before the client gets its payment response (provider ref not yet stored).
  {
    const w = new World();
    const { orderId } = await w.startCheckout(ALICE);
    await w.quote(ALICE, orderId);
    w.pay.mode = "lost_response";
    await w.beginPayment(ALICE, orderId);
    assert.equal(w.order(orderId).paymentAttempt!.providerRef, undefined);
    const key = w.order(orderId).paymentAttempt!.idempotencyKey;
    assert.deepEqual(await w.paymentWebhook(w.pay.customerPays(key)), { status: "processed", outcome: "applied" });
    assert.equal(w.order(orderId).paymentAttempt!.providerRef, w.pay.sessions.get(key)!.providerRef, "bound by the attempt key, then by reference");
    w.pay.mode = "ok";
    assert.deepEqual(await w.beginPayment(ALICE, orderId), { status: "already_paid" }, "the late client retry is told it's paid — no second sheet");
    assert.deepEqual([w.stage(orderId), w.pay.charges], ["paid", 1]);
    w.assertConsistent();
  }
  // 4/5. Duplicate and conflicting webhooks.
  {
    const w = new World();
    const { orderId, key } = await w.purchase(ALICE);
    const paidAt = w.order(orderId).paidAt;
    const delivery = w.pay.customerPays(key);
    assert.deepEqual(await w.paymentWebhook(delivery), { status: "processed", outcome: "duplicate" });
    assert.deepEqual(await w.paymentWebhook(delivery), { status: "processed", outcome: "duplicate" });
    assert.equal(w.order(orderId).paidAt, paidAt);
    const s = w.pay.sessions.get(key)!;
    const conflicting = w.pay.webhook({ eventId: `TEST-evt_paid_${key}`, providerRef: s.providerRef, idempotencyKey: key, type: "refunded", amountCents: s.amountCents, currency: "USD" });
    assert.deepEqual(await w.paymentWebhook(conflicting), { status: "processed", outcome: "conflict", reason: "event_id_reused_with_different_contents" });
    assert.equal(w.order(orderId).paymentStatus, "paid", "not applied");
    assert.ok(w.logs.some((l) => l.event === "payment_event_not_applied" && l.fields.outcome === "conflict"), "the conflict is logged (redacted)");
    assert.equal(w.db.rows("commerceEvents").filter((e) => e.name === "band_checkout_completed").length, 1, "one financial record");
    // A stale replay outside the signature window is refused before anything is read.
    assert.deepEqual(await w.paymentWebhook(w.pay.webhook(JSON.parse(delivery.rawBody) as VerifiedPaymentEvent, w.t - 10 * MIN)), { status: "rejected_signature" });
    // An event that can't be matched to an attempt is never guessed onto an order.
    assert.deepEqual(await w.paymentWebhook(w.pay.webhook({ eventId: "orphan", providerRef: s.providerRef, type: "paid", amountCents: s.amountCents, currency: "USD" })), { status: "unmatched" });
    w.assertConsistent();
  }
});

test("Journey J — fulfilment interruption: lost responses never make a second fulfilment or shipment; duplicate tracking is one state", async () => {
  const w = new World();
  const { orderId } = await w.purchase(ALICE);
  const a = await w.createFulfillment(orderId, "ful-interrupt-0001");
  const b = await w.createFulfillment(orderId, "ful-interrupt-0001");
  assert.deepEqual([a.fulfillmentId === b.fulfillmentId, w.db.rows("commerceFulfillments").length], [true, 1], "retry after a lost response → one fulfilment");

  w.ful.mode = "lost_response";
  assert.equal((await w.submit(a.fulfillmentId)).status, "provider_refused", "the provider made the shipment; we never heard");
  assert.equal(w.row(a.fulfillmentId).status, "pending");
  w.ful.mode = "ok";
  assert.equal((await w.submit(a.fulfillmentId)).status, "submitted");
  assert.deepEqual([w.ful.shipments.size, w.db.rows("commerceShipments").length], [1, 1], "exactly one shipment, at the provider and here");
  // The record was written but staff lost the response: asking again changes nothing.
  assert.equal((await w.submit(a.fulfillmentId)).status, "submitted");
  assert.deepEqual([w.ful.shipments.size, w.db.rows("commerceShipments").length], [1, 1]);

  const s = w.shipmentOf(a.fulfillmentId);
  w.ful.scan(s.providerRef as string, "picked_up", w.t + H);
  w.ful.scan(s.providerRef as string, "in_transit", w.t + 2 * H);
  assert.deepEqual(await w.refresh(s._id), { status: "refreshed", applied: 2, skipped: 0 });
  assert.deepEqual(await w.refresh(s._id), { status: "refreshed", applied: 0, skipped: 0 }, "polling again: duplicates are no-ops");
  assert.deepEqual((await w.shipmentWebhook(w.ful.byRef(s.providerRef as string)!.events)).outcomes, ["duplicate", "duplicate"], "…and the same events by webhook");
  assert.equal(w.db.rows("commerceShipmentEvents").length, 2, "one record per carrier event");
  w.assertConsistent();
});

// ═════════════════════════════════════════════════════════════════════════════
// Journeys K–M: replacement, return, refund
// ═════════════════════════════════════════════════════════════════════════════

test("Journey K — replacement: Band B replaces A through staff flows; one active Band; A returns and can never reactivate", async () => {
  const w = new World();
  const a = await bandOwner(w);
  const rep = await w.deliver(a.orderId, { kind: "replacement", replaces: a.fulfillmentId });
  const b = await w.unit(MAC(2));
  await assignDevice(w.db as never, { deviceId: b.deviceId, fulfillmentId: rep.fulfillmentId, replacesDeviceId: a.deviceId }, w.t);
  assert.equal(w.entitlements(ALICE).ownsBand, true, "still owns A until B is activated");
  assert.equal((await w.activate(ALICE, b.code)).ok, true);
  assert.deepEqual([w.row(a.deviceId).status, w.row(b.deviceId).status], ["replaced", "activated"]);
  const active = w.db.rows("bandOwnership").filter((o) => o.status === "activated");
  assert.deepEqual(active.map((o) => o.deviceId), [b.deviceId], "exactly one active Band in the replacement chain");
  assert.equal(w.entitlements(ALICE).ownsBand, true);

  // A can't come back to life.
  assert.notEqual((await w.activate(ALICE, a.code)).ok, true);
  assert.equal((await staffActivate(w.db as never, a.deviceId, ALICE, w.cfg, w.t)).ok, false);
  // A goes back physically (6I: replaced → returned) — B is untouched.
  const { returnId } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: a.orderId as never, requestKey: "return-replaced-0001", reason: "arrived_damaged", attestUnused: true }, w.cfg, w.t));
  await w.m(() => authorizeReturn(w.db as never, returnId, w.t));
  await w.m(() => receiveReturn(w.db as never, STAFF, returnId, "damaged", w.cfg, w.t, [a.deviceId]));
  assert.deepEqual([w.row(a.deviceId).status, w.row(b.deviceId).status, w.entitlements(ALICE).ownsBand], ["returned", "activated", true]);
  assert.notEqual((await w.activate(ALICE, a.code)).ok, true);
  w.assertConsistent();
});

test("Journey L — return approved: label → in transit → received (unused) → refund approved → provider refund → refunded; ownership and code end", async () => {
  const w = new World();
  const a = await bandOwner(w);
  assert.equal((await returnOptions(w.db as never, ALICE, a.orderId as never, w.cfg, w.t)).eligible, true, "a delivered Band within the window is returnable");
  const { returnId } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: a.orderId as never, requestKey: "return-journey-l-01", reason: "changed_mind", attestUnused: true }, w.cfg, w.t));
  assert.equal(w.entitlements(ALICE).ownsBand, true, "a request never ends ownership");
  await assert.rejects(w.returnLabel(returnId), /authorized returns/, "no label before staff authorize it");
  await w.m(() => authorizeReturn(w.db as never, returnId, w.t));
  assert.equal((await w.returnLabel(returnId)).status, "created");
  assert.equal((await w.returnLabel(returnId)).status, "created", "retry → same label");
  const back = w.db.rows("commerceShipments").filter((s) => s.direction === "return");
  assert.equal(back.length, 1);
  await w.shipmentWebhook([w.ful.scan(back[0].providerRef as string, "picked_up", w.t + H)]);
  assert.deepEqual([w.row(returnId).status, w.stage(a.orderId)], ["in_transit", "return_in_transit"]);
  await w.shipmentWebhook([w.ful.scan(back[0].providerRef as string, "delivered", w.t + 30 * H)]);
  w.advance(2 * DAY);

  await w.m(() => receiveReturn(w.db as never, STAFF, returnId, "unused", w.cfg, w.t, [a.deviceId]));
  assert.deepEqual([w.row(a.deviceId).status, w.entitlements(ALICE).ownsBand], ["returned", false], "ownership ends at receipt (config: received)");
  const { amountCents } = await w.m(() => approveRefund(w.db as never, STAFF, returnId, w.t));
  assert.equal(amountCents, 10000, "the server's amount: returned lines × the price paid");
  assert.equal((await w.issueRefund(returnId)).status, "requested");
  assert.equal((await w.issueRefund(returnId)).status, "requested", "same key → the provider refunds once");
  assert.equal(w.pay.refunds.size, 1);
  assert.deepEqual([w.row(returnId).status, w.order(a.orderId).refundedCents ?? 0], ["refund_approved", 0], "approved + requested ≠ refunded");
  assert.equal(w.stage(a.orderId), "return_received");

  w.advance(DAY);
  const settled = w.pay.refundSettles(`refund:${returnId}`, false);
  assert.deepEqual(await w.paymentWebhook(settled), { status: "processed", outcome: "applied" });
  assert.deepEqual([w.row(returnId).status, w.order(a.orderId).paymentStatus, w.order(a.orderId).refundedCents], ["refunded", "partially_refunded", 10000]);
  assert.deepEqual(await w.paymentWebhook(settled), { status: "processed", outcome: "duplicate" });
  assert.equal(w.db.rows("commerceEvents").filter((e) => e.name === "refund_completed").length, 1);
  // The code can't be reused, by anyone.
  assert.deepEqual(await w.activate(ALICE, a.code), { ok: false, reason: "invalid_code" });
  assert.deepEqual(await w.activate(BOB, a.code), { ok: false, reason: "invalid_code" });
  w.assertConsistent();
});

test("Journey L — return rejected: a used Band is not refunded, and its owner keeps it", async () => {
  const w = new World();
  const a = await bandOwner(w);
  const { returnId } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: a.orderId as never, requestKey: "return-rejected-0001", reason: "not_as_expected", attestUnused: true }, w.cfg, w.t));
  await w.m(() => authorizeReturn(w.db as never, returnId, w.t));
  await w.m(() => receiveReturn(w.db as never, STAFF, returnId, "used", w.cfg, w.t, [a.deviceId]));
  await assert.rejects(w.m(() => approveRefund(w.db as never, STAFF, returnId, w.t)), /condition isn't covered/);
  assert.deepEqual([w.row(a.deviceId).status, w.entitlements(ALICE).ownsBand], ["activated", true], "an item outside the policy isn't taken back at receipt");
  await w.m(() => rejectReturn(w.db as never, STAFF, returnId, "used_item", w.t));
  assert.deepEqual([w.row(returnId).status, w.order(a.orderId).paymentStatus, w.order(a.orderId).refundedCents ?? 0, w.entitlements(ALICE).ownsBand], ["rejected", "paid", 0, true]);
  assert.equal(w.pay.refunds.size, 0, "nothing asked of the provider");
  w.assertConsistent();
});

test("Journey L — once an eligible Band is taken back at receipt, the return can't be rejected (no Band and no refund)", async () => {
  const w = new World();
  const a = await bandOwner(w);
  const { returnId } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: a.orderId as never, requestKey: "return-noreject-0001", reason: "changed_mind", attestUnused: true }, w.cfg, w.t));
  await w.m(() => authorizeReturn(w.db as never, returnId, w.t));
  await w.m(() => receiveReturn(w.db as never, STAFF, returnId, "unused", w.cfg, w.t, [a.deviceId]));
  await assert.rejects(w.m(() => rejectReturn(w.db as never, STAFF, returnId, "changed_our_mind", w.t)), /approve the refund/);
  assert.equal(w.row(returnId).status, "received");
  w.assertConsistent();
});

test("Journey M — refunds: full, partial, duplicate, conflicting, over-captured, unconfirmed and delayed confirmation", async () => {
  const w = new World();
  const { orderId, key, total } = await w.purchase(ALICE, 2);
  const s = w.pay.sessions.get(key)!;
  const ev = (eventId: string, type: VerifiedPaymentEvent["type"], amountCents: number) => w.paymentWebhook(w.pay.webhook({ eventId, providerRef: s.providerRef, idempotencyKey: key, type, amountCents, currency: "USD" }));
  assert.deepEqual(await ev("r-over", "partially_refunded", total + 1), { status: "processed", outcome: "rejected", reason: "amount_mismatch" }, "never above captured");
  assert.deepEqual(await ev("r-1", "partially_refunded", 5000), { status: "processed", outcome: "applied" });
  assert.deepEqual(await ev("r-1", "partially_refunded", 5000), { status: "processed", outcome: "duplicate" });
  assert.deepEqual(await ev("r-1", "partially_refunded", 6000), { status: "processed", outcome: "conflict", reason: "event_id_reused_with_different_contents" });
  assert.equal(w.order(orderId).refundedCents, 5000);
  assert.deepEqual(await ev("r-2", "refunded", total - 5000 + 1), { status: "processed", outcome: "rejected", reason: "amount_mismatch" });
  assert.deepEqual(await ev("r-2", "refunded", total - 5000), { status: "processed", outcome: "conflict", reason: "event_id_reused_with_different_contents" }, "a rejected event id is spent");
  assert.deepEqual(await ev("r-2b", "refunded", total - 5000), { status: "processed", outcome: "applied" }, "the rest: fully refunded");
  assert.deepEqual([w.order(orderId).paymentStatus, w.order(orderId).refundedCents], ["refunded", total]);
  assert.deepEqual(await ev("r-3", "partially_refunded", 1), { status: "processed", outcome: "rejected", reason: "amount_mismatch" }, "nothing left to refund");
  w.assertConsistent();

  // Approval without confirmation; provider timeout; delayed confirmation.
  const v = new World();
  const b = await bandOwner(v);
  const { returnId } = await v.m(() => requestReturn(v.db as never, ALICE, { orderId: b.orderId as never, requestKey: "return-journey-m-01", reason: "changed_mind", attestUnused: true }, v.cfg, v.t));
  await v.m(() => authorizeReturn(v.db as never, returnId, v.t));
  await v.m(() => receiveReturn(v.db as never, STAFF, returnId, "unused", v.cfg, v.t, [b.deviceId]));
  await v.m(() => approveRefund(v.db as never, STAFF, returnId, v.t));
  // A second return can't start while one is open — so a verified refund can only ever belong to one return.
  assert.equal((await returnOptions(v.db as never, ALICE, b.orderId as never, v.cfg, v.t)).eligible, false);
  v.pay.refundMode = "timeout";
  assert.equal((await v.issueRefund(returnId, FAST)).status, "provider_refused", "a hung provider is a refusal, not a refund");
  assert.equal(v.row(returnId).status, "refund_approved");
  assert.equal((v.row(returnId).refund as { providerRefundRef?: string }).providerRefundRef, undefined);
  v.pay.refundMode = "ok";
  assert.equal((await v.issueRefund(returnId)).status, "requested");
  v.advance(5 * DAY);
  assert.equal(v.row(returnId).status, "refund_approved", "days later, still not refunded without the provider's word");
  await v.paymentWebhook(v.pay.refundSettles(`refund:${returnId}`, false));
  assert.equal(v.row(returnId).status, "refunded", "…the verified event, whenever it comes, completes it");
  v.assertConsistent();
});

// ═════════════════════════════════════════════════════════════════════════════
// Product generations, cross-account, analytics, recovery, failures, isolation
// ═════════════════════════════════════════════════════════════════════════════

test("Product generation — a test-only SOMBREY_BAND_V2 runs the whole path with no production code change", async () => {
  const cfg = structuredClone(C) as CommerceConfig;
  (cfg.products as Record<string, unknown>).band_v2 = {
    ...structuredClone(C.products.band), id: "sombrey_band_v2", sku: "SOMBREY_BAND_V2", hardwareGeneration: "V2", displayName: "Sombrey Band (Test V2)", priceCents: 14900,
  };
  assert.deepEqual(validateCommerceConfig(cfg), []);
  const w = new World(cfg);
  const skus: string[] = [];
  const shipping = w.shipping;
  w.shipping = { ...shipping, name: shipping.name, calls: 0, quote: async (req) => { skus.push(...req.lines.map((l) => l.sku)); return shipping.quote(req); } } as typeof shipping;
  const { orderId, total } = await w.purchase(ALICE, 1, "sombrey_band_v2");
  assert.equal(total, 14900 + 1500 + Math.round(16400 * 0.08));
  assert.deepEqual(skus, ["SOMBREY_BAND_V2"], "the provider is quoted the V2 SKU");
  const { fulfillmentId } = await w.deliver(orderId);
  assert.deepEqual([...w.ful.shipments.values()].length, 1);
  const job = await submissionJob(w.db as never, fulfillmentId as never, cfg).catch(() => null);
  assert.equal(job && "items" in job ? job.items[0].sku : "already-submitted", "already-submitted");
  const u = await w.unit(MAC(9), "sombrey_band_v2");
  await assignDevice(w.db as never, { deviceId: u.deviceId, fulfillmentId }, w.t);
  assert.equal((await w.activate(ALICE, u.code)).ok, true);
  const own = w.db.rows("bandOwnership")[0];
  assert.equal(own.productId, "sombrey_band_v2");
  assert.equal(w.entitlements(ALICE).ownsBand, true, "a V2 Band entitles like a V1 Band (category physical_band)");
  const events = w.db.rows("commerceEvents");
  assert.ok(events.length > 5 && events.every((e) => e.productId === undefined || e.productId === "sombrey_band_v2"), "analytics carry V2");
  w.assertConsistent();
  // …and the production config doesn't know V2 at all.
  assert.ok(!knownProductIds(C).includes("sombrey_band_v2"));
});

test("Cross-account security — A and B can't see, change, pay, activate, return or refund each other's things (both ways); staff levels hold", async () => {
  const w = new World();
  await w.m(() => linkAccountToken(w.db as never, ALICE, aliceToken, w.t));
  await w.m(() => linkAccountToken(w.db as never, BOB, bobToken, w.t));
  const A = await bandOwner(w, ALICE, MAC(1));
  const B = await bandOwner(w, BOB, MAC(2));
  await w.pairOnIphone(ALICE, "PERIPHERAL-A");
  await w.pairOnIphone(BOB, "PERIPHERAL-B");
  const { returnId: returnB } = await w.m(() => requestReturn(w.db as never, BOB, { orderId: B.orderId as never, requestKey: "return-bob-000001", reason: "changed_mind", attestUnused: true }, w.cfg, w.t));
  const { returnId: returnA } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: A.orderId as never, requestKey: "return-alice-00001", reason: "changed_mind", attestUnused: true }, w.cfg, w.t));
  const { orderId: openB } = await w.startCheckout(BOB);
  const { orderId: openA } = await w.startCheckout(ALICE);
  await w.appleSubmits(BOB, bobToken, {}, {});

  for (const [me, other, mine, theirs, theirOpen, theirReturn, theirCode, theirMac] of [
    [ALICE, BOB, A, B, openB, returnB, B.code, MAC(2)], [BOB, ALICE, B, A, openA, returnA, A.code, MAC(1)],
  ] as const) {
    const before = structuredClone([...w.db.tables.entries()]);
    assert.equal(visibleToCustomer(w.order(theirs.orderId) as never, me), null, "view order");
    await assert.rejects(quoteDraft(w.db as never, me, theirOpen as never, w.cfg, w.t), /not found/i, "quote");
    await assert.rejects(w.m(() => updateAddress(w.db as never, me, theirOpen as never, ADDRESS, w.cfg, w.t)), /not found/i, "modify");
    await assert.rejects(w.m(() => reservePaymentAttempt(w.db as never, me, theirOpen as never, "TEST-ONLY-payments", w.cfg, w.t)), /not found/i, "pay");
    await assert.rejects(w.m(() => cancelCheckout(w.db as never, me, theirOpen as never, w.t)), /not found/i, "cancel");
    await assert.rejects(returnOptions(w.db as never, me, theirs.orderId as never, w.cfg, w.t), /not found/i, "see returns");
    await assert.rejects(w.m(() => requestReturn(w.db as never, me, { orderId: theirs.orderId as never, requestKey: "return-cross-00001", reason: "changed_mind", attestUnused: true }, w.cfg, w.t)), /not found/i, "return");
    await assert.rejects(w.m(() => cancelReturn(w.db as never, me, theirReturn as never, w.t)), /not found/i, "cancel return / refund");
    assert.notEqual((await w.activate(me, theirCode)).ok, true, "use their activation code");
    assert.deepEqual(await linkPairing(w.db as never, me, { peripheralId: me === ALICE ? "PERIPHERAL-A" : "PERIPHERAL-B", hardwareIdKind: "mac", hardwareId: theirMac }, w.cfg, w.t), { result: "owned_by_another_account" }, "claim their Band");
    // Their membership can't become mine.
    assert.equal(((await w.appleSubmits(me, me === ALICE ? bobToken : aliceToken, {})) as { ok?: boolean }).ok, false, "submit their Apple transaction");
    assert.equal(w.entitlements(me).subscriptionActive, me === BOB, "membership state is per account");
    assert.equal(w.entitlements(other).ownsBand, true);
    void mine;
    // Nothing of theirs changed (activation attempts are the only new rows: the rate-limit log).
    const after = new Map([...w.db.tables.entries()].filter(([t]) => t !== "commerceActivationAttempts" && t !== "commerceEvents"));
    assert.deepEqual(after, new Map(before.filter(([t]) => t !== "commerceActivationAttempts" && t !== "commerceEvents")), "no record changed");
  }
  // Customer vs staff vs owner/admin.
  assert.equal(staffMay(null, "fulfillment"), false, "signed out");
  for (const [role, fulfillment, money, deviceAdmin] of [
    ["client", false, false, false], ["coach", false, false, false], ["assistant_coach", false, false, false],
    ["store_manager", true, false, false], ["admin", true, true, true], ["owner", true, true, true],
  ] as const) {
    const user = { _id: `users:${role}`, role } as never;
    assert.deepEqual([staffMay(user, "fulfillment"), staffMay(user, "money"), staffMay(user, "device_admin")], [fulfillment, money, deviceAdmin], role);
  }
  // Every staff entry point checks its level first.
  for (const f of ["staff.ts", "staffDevices.ts", "staffIntegrity.ts"]) {
    const src = readFileSync(join(ROOT, "convex/commerce", f), "utf8");
    // One export at a time: each Convex function in these files must check the caller's staff level itself.
    const exports = src.split(/\nexport const /).slice(1).map((chunk) => ({ name: chunk.match(/^(\w+)/)![1], kind: chunk.match(/^\w+ = (\w+)\(/)?.[1], body: chunk }));
    const fns = exports.filter((e) => ["query", "mutation", "action", "internalQuery", "internalMutation"].includes(e.kind ?? ""));
    assert.ok(fns.length > 0, f);
    for (const e of fns) {
      // (internal helpers can take the level from the calling action — clients can't call them)
      const check = e.kind!.startsWith("internal") ? /requireStaff\(ctx, ("(fulfillment|money|device_admin)"|args\.level)\)/ : /requireStaff\(ctx, "(fulfillment|money|device_admin)"\)|checkStaff, \{ level: "(fulfillment|money|device_admin)" \}/;
      assert.match(e.body.slice(0, e.body.indexOf("\n});") + 4), check, `${f}:${e.name} checks staff`);
    }
  }
  w.assertConsistent();
});

test("Analytics — the lifecycle records only appropriate, server-authoritative, PII-free events; duplicates make no duplicate money", async () => {
  const w = new World();
  const a = await bandOwner(w);
  const { returnId } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: a.orderId as never, requestKey: "return-analytics-01", reason: "changed_mind", attestUnused: true }, w.cfg, w.t));
  await w.m(() => authorizeReturn(w.db as never, returnId, w.t));
  await w.m(() => receiveReturn(w.db as never, STAFF, returnId, "unused", w.cfg, w.t, [a.deviceId]));
  await w.m(() => approveRefund(w.db as never, STAFF, returnId, w.t));
  await w.issueRefund(returnId);
  const settled = w.pay.refundSettles(`refund:${returnId}`, false);
  await w.paymentWebhook(settled);
  await w.paymentWebhook(settled);
  await w.paymentWebhook(w.pay.customerPays(w.order(a.orderId).paymentAttempt!.idempotencyKey));

  const events = w.db.rows("commerceEvents");
  const names = events.map((e) => e.name);
  for (const n of ["band_quote_requested", "band_payment_started", "band_checkout_completed", "fulfillment_created", "shipment_created", "shipment_delivered", "device_activation_completed", "return_requested", "return_received", "refund_completed"]) {
    assert.ok(names.includes(n), `${n} recorded`);
  }
  assert.ok(events.every((e) => e.origin === "server"), "lifecycle milestones are the server's, never the client's");
  const money = events.filter((e) => e.amountCents !== undefined);
  assert.deepEqual(money.map((e) => [e.name, e.amountCents]), [["band_checkout_completed", a.total], ["refund_completed", 10000]], "one revenue record, one refund record — despite duplicate webhooks");
  const allowed = new Set(["_id", "_creationTime", "name", "userId", "at", "origin", "platform", "productId", "countryCode", "source", "amountCents", "currency", "orderId", "configVersion"]);
  const blob = JSON.stringify(events);
  for (const e of events) for (const k of Object.keys(e)) assert.ok(allowed.has(k), `unexpected analytics field ${k}`);
  for (const secret of [a.code, a.code.replace(/-/g, ""), MAC(1), "1 Test Street", "A Customer", "00100", "TEST-pay_", "TESTTRK", "x-test-signature"]) assert.ok(!blob.includes(secret), `analytics leak: ${secret}`);
  for (const e of events) assert.equal(validateEvent({ ...e, platform: "ios" } as never, "client", knownProductIds(C)) === null && ["band_checkout_completed", "refund_completed", "device_activation_completed"].includes(e.name as string), false, `${e.name} can't be forged by a client`);
  // Operational logs carry no secrets either.
  assert.ok(!JSON.stringify(w.logs).match(/Test Street|TEST-pay_|x-test/));
  w.assertConsistent();
});

test("Offline / recovery — nothing is invented while disconnected; nothing confirmed is lost; relaunch asks the server again", async () => {
  // Server side: a mutation whose response was lost is safe to repeat; state is always re-readable.
  const w = new World();
  const first = await w.startCheckout(ALICE, "ck-offline-00000001");
  const again = await w.startCheckout(ALICE, "ck-offline-00000001");
  assert.equal(first.orderId, again.orderId, "network loss after the mutation succeeded → the retry finds it");
  await w.quote(ALICE, first.orderId);
  const q1 = w.order(first.orderId).quote as OrderQuote;
  w.advance(2000);
  assert.equal((await w.quote(ALICE, first.orderId)).quoteId, q1.quoteId, "a reconnect storm doesn't re-ask the providers");
  assert.equal(w.shipping.calls, 1);
  w.advance(C.checkout.quoteTtlMinutes * MIN);
  assert.deepEqual(await w.beginPayment(ALICE, first.orderId), { status: "quote_expired" }, "a stale quote is never charged");

  // App side (Swift): live server subscriptions, nothing persisted, last-confirmed kept with a notice.
  const read = (f: string) => readFileSync(join(ROOT, "apps/ios/Sombrey", f), "utf8").replace(/\/\/.*$/gm, "");
  const store = read("Commerce/EntitlementStore.swift"), views = read("Commerce/CommerceViews.swift"), models = read("Commerce/CommerceModels.swift");
  assert.match(store, /self\.state = enforced \? \.checking : \.notEnforced/, "relaunch/sign-out: back to 'checking' — no cached answer");
  assert.match(store, /if self\.entitlements == nil \{ self\.state = \.unavailable \} else \{ self\.refreshFailed = true \}/, "offline: unavailable without an answer; last confirmed (flagged) with one");
  assert.ok(!/UserDefaults|@AppStorage|FileManager|write\(to:/.test(store + views + models), "nothing commerce-related is persisted on device");
  assert.match(views, /LoadPresentation\.of\(hasValue: orders\.value != nil/, "stale orders: kept, marked");
  assert.match(views, /LoadPresentation\.of\(hasValue: tracking\.value != nil/, "stale tracking: kept, marked");
  assert.match(views, /outcome = ActivationCopy\.outcome\(reply\.status\)/, "activation success only from the server's reply");
  assert.match(views, /CommerceUnavailable\.activation/, "network loss during activation → 'Activation unavailable', never success");
  assert.match(read("Core/Convex/ConvexQuery.swift"), /\.subscribe\(to: name/, "screens use live subscriptions (they refresh on reconnect)");
});

test("Provider failure matrix — every failure ends in a safe, deterministic state", async () => {
  const outcomes: Record<string, string> = {};
  const quoteWith = async (shipping: Mode, tax: Mode) => {
    const w = new World();
    w.shipping = testShipping({ mode: shipping }); w.tax = testTax({ mode: tax });
    const { orderId } = await w.startCheckout(ALICE);
    const q = await w.quote(ALICE, orderId, FAST);
    return { q, w, orderId, payment: await w.beginPayment(ALICE, orderId) };
  };
  for (const [label, s, t, reason] of [
    ["Shipping timeout", "timeout", "ok", "provider_error"], ["Shipping malformed quote", "malformed", "ok", "invalid_amount"], ["Shipping throws", "throw", "ok", "provider_error"],
    ["Tax timeout", "ok", "timeout", "provider_error"], ["Tax invalid response", "ok", "malformed", "invalid_amount"],
  ] as const) {
    const { q, payment, w, orderId } = await quoteWith(s, t);
    const part = s === "ok" ? q.tax : q.shipping;
    assert.deepEqual([q.complete, q.totalCents, part.status, (part as { reason?: string }).reason, payment.status], [false, null, "unavailable", reason, "quote_incomplete"], label);
    assert.equal(Number.isFinite(q.expiresAt), true, `${label}: expiry stays a real time`);
    assert.equal(w.order(orderId).paymentStatus, "awaiting_payment");
    outcomes[label] = "quote unavailable → no payment";
  }
  {
    const w = new World();
    w.shipping = testShipping({ mode: "malformed" });
    w.shipping.quote = async () => null as never;
    const { orderId } = await w.startCheckout(ALICE);
    assert.equal((await w.quote(ALICE, orderId)).shipping.status, "unavailable", "a null reply is an error, not a crash");
  }
  {
    const w = new World();
    w.shipping = testShipping({ expiresAt: "tomorrow" });
    const { orderId } = await w.startCheckout(ALICE);
    assert.equal((await w.quote(ALICE, orderId)).expiresAt, w.t + C.checkout.quoteTtlMinutes * MIN, "a nonsense provider expiry is ignored");
  }
  for (const [label, mode] of [["Payment timeout", "timeout"], ["Payment malformed response", "malformed"], ["Payment throws", "throw"]] as const) {
    const w = new World();
    const { orderId } = await w.startCheckout(ALICE);
    await w.quote(ALICE, orderId);
    w.pay.mode = mode;
    assert.equal((await w.beginPayment(ALICE, orderId, FAST)).status, "payment_unavailable", label);
    assert.deepEqual([w.order(orderId).paymentStatus, w.order(orderId).paymentAttempt?.providerRef], ["awaiting_payment", undefined]);
    w.pay.mode = "ok";
    assert.equal((await w.beginPayment(ALICE, orderId)).status, "ready", `${label}: retry recovers with the same attempt`);
    outcomes[label] = "payment_unavailable → retry same key";
  }
  {
    const w = new World();
    const { orderId, key } = await w.purchase(ALICE);
    const delivery = w.pay.customerPays(key);
    assert.equal((await w.paymentWebhook(delivery) as { outcome: string }).outcome, "duplicate", "Payment duplicate webhook");
    const ev = JSON.parse(delivery.rawBody);
    assert.equal((await w.paymentWebhook(w.pay.webhook({ ...ev, amountCents: 1 })) as { outcome: string }).outcome, "conflict", "Payment conflicting webhook");
    assert.equal(w.order(orderId).paymentStatus, "paid");
    outcomes["Payment duplicate webhook"] = "duplicate → no change";
    outcomes["Payment conflicting webhook"] = "conflict recorded → not applied";
  }
  for (const [label, mode] of [["Fulfillment timeout", "timeout"], ["Fulfillment malformed", "malformed"], ["Fulfillment lost response", "lost_response"]] as const) {
    const w = new World();
    const { orderId } = await w.purchase(ALICE);
    const { fulfillmentId } = await w.createFulfillment(orderId);
    w.ful.mode = mode;
    assert.equal((await w.submit(fulfillmentId, FAST)).status, "provider_refused", label);
    assert.deepEqual([w.row(fulfillmentId).status, w.db.rows("commerceShipments").length], ["pending", 0], `${label}: nothing half-recorded`);
    w.ful.mode = "ok";
    assert.equal((await w.submit(fulfillmentId)).status, "submitted");
    assert.equal(w.db.rows("commerceShipments").length, 1);
    assert.ok(w.logs.some((l) => l.event === "fulfillment_submit_refused"));
    outcomes[label] = "provider_refused → retry → one shipment";
  }
  {
    const w = new World();
    const { orderId } = await w.purchase(ALICE);
    const { fulfillmentId } = await w.createFulfillment(orderId);
    await w.submit(fulfillmentId);
    const s = w.shipmentOf(fulfillmentId);
    const ref = s.providerRef as string;
    w.ful.trackingMode = "timeout";
    assert.equal((await w.refresh(s._id, FAST)).status, "provider_refused", "Tracking timeout");
    w.ful.trackingMode = "ok";
    w.ful.scan(ref, "in_transit", w.t + 5 * H);
    w.ful.scan(ref, "picked_up", w.t + 1 * H); // reported out of order
    w.ful.byRef(ref)!.events.push({ eventId: "", providerRef: ref, type: "delivered", providerStatus: "", occurredAt: NaN });
    assert.deepEqual(await w.refresh(s._id), { status: "refreshed", applied: 1, skipped: 1 }, "Tracking out-of-order + malformed: newer kept, older stale, junk skipped");
    assert.equal(w.row(s._id).status, "in_transit");
    assert.deepEqual(await w.refresh(s._id), { status: "refreshed", applied: 0, skipped: 1 }, "Tracking duplicate");
    outcomes["Tracking timeout"] = "provider_refused";
    outcomes["Tracking duplicate event"] = "no-op";
    outcomes["Tracking out-of-order event"] = "stale → recorded, not applied";
  }
  {
    const w = new World();
    const a = await bandOwner(w);
    const { returnId } = await w.m(() => requestReturn(w.db as never, ALICE, { orderId: a.orderId as never, requestKey: "return-matrix-0001", reason: "changed_mind", attestUnused: true }, w.cfg, w.t));
    await w.m(() => authorizeReturn(w.db as never, returnId, w.t));
    await w.m(() => receiveReturn(w.db as never, STAFF, returnId, "unused", w.cfg, w.t, [a.deviceId]));
    await w.m(() => approveRefund(w.db as never, STAFF, returnId, w.t));
    w.pay.refundMode = "timeout";
    assert.equal((await w.issueRefund(returnId, FAST)).status, "provider_refused", "Refund timeout");
    w.pay.refundMode = "ok";
    await w.issueRefund(returnId);
    const settled = w.pay.refundSettles(`refund:${returnId}`, false);
    await w.paymentWebhook(settled);
    assert.equal((await w.paymentWebhook(settled) as { outcome: string }).outcome, "duplicate", "Refund duplicate event");
    const ev = JSON.parse(settled.rawBody);
    assert.equal((await w.paymentWebhook(w.pay.webhook({ ...ev, amountCents: ev.amountCents + 1 })) as { outcome: string }).outcome, "conflict", "Refund conflicting event");
    assert.equal(w.order(a.orderId).refundedCents, 10000);
    outcomes["Refund timeout"] = "provider_refused → not refunded";
    outcomes["Refund duplicate event"] = "duplicate → once";
    outcomes["Refund conflicting event"] = "conflict → not applied";
    w.assertConsistent();
  }
  for (const row of ["Payment timeout", "Payment duplicate webhook", "Payment conflicting webhook", "Payment malformed response", "Shipping timeout", "Shipping malformed quote", "Tax timeout", "Tax invalid response",
    "Fulfillment timeout", "Fulfillment lost response", "Tracking duplicate event", "Tracking out-of-order event", "Refund timeout", "Refund duplicate event", "Refund conflicting event"]) assert.ok(outcomes[row], `matrix row ${row}`);
});

test("Test fixture isolation — the adapters are test-only and can't reach production; production reports no providers", () => {
  assert.deepEqual(providersFor(C), { shipping: null, tax: null, payment: null, fulfillment: null }, "production: no provider of any kind");
  assert.deepEqual([C.checkout.provider, C.checkout.shippingQuoteProvider, C.checkout.taxQuoteProvider, C.fulfillment.provider], [null, null, null, null]);
  assert.equal(publicCommerceConfig(C).band.checkoutAvailable, false, "real checkout is not enabled");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === "_generated" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const f of [...walk(join(ROOT, "convex")), ...walk(join(ROOT, "apps/ios/Sombrey"))].filter((p) => /\.(ts|swift)$/.test(p))) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/tests\/commerce|testProviders|TEST-ONLY|memoryDb|appStoreHarness/.test(src.replace(/\/\/.*$/gm, "")), `${f} references test fixtures`);
  }
  const adapters = readFileSync(join(import.meta.dirname, "testProviders.ts"), "utf8");
  assert.match(adapters, /TEST-ONLY PROVIDER ADAPTERS/);
  for (const name of adapters.matchAll(/name = "([^"]+)"|name: "([^"]+)"/g)) assert.ok((name[1] ?? name[2]).startsWith("TEST-ONLY"), name[0]);
  // The tests run against the in-memory database only — never a deployment.
  for (const f of readdirSync(import.meta.dirname).filter((n) => n.endsWith(".ts") && n !== "journeys.test.ts")) {
    assert.ok(!/ConvexHttpClient|ConvexClient\(|CONVEX_URL|convex\.cloud|npx convex/.test(readFileSync(join(import.meta.dirname, f), "utf8")), `${f} talks to a deployment`);
  }
});
