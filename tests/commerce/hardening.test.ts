// Sombrey commerce, Phase 6I — security, edge cases & recovery across 6A–6H.
// Failure scenarios: idempotency conflicts and races, webhooks that beat the
// app, malformed provider data, lost responses, replacement returns, the
// entitlement matrix per surface, a future product, integrity reporting and
// redacted logs. SYNTHETIC data; provider data are TEST DOUBLES that exist only
// in this file — no provider is configured in the product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITIES, COMMERCE_CONFIG, FEATURE_IDS, knownProductIds, physicalProducts, validateCommerceConfig, type CommerceConfig } from "../../convex/commerce/config.ts";
import { applyVerifiedPayment, createOrderRecord } from "../../convex/commerce/checkoutStore.ts";
import { applyShipmentEvent, createFulfillment, recordShipment, recordSubmission } from "../../convex/commerce/fulfillmentStore.ts";
import { normalizeCreatedShipment, normalizeProviderShipmentEvent } from "../../convex/commerce/fulfillment.ts";
import { authorizeReturn, receiveReturn, requestReturn } from "../../convex/commerce/returnsStore.ts";
import { activateWithCode, assignDevice, registerDevice } from "../../convex/commerce/deviceStore.ts";
import { generateActivationCode, hashActivationCode, normalizeActivationCode } from "../../convex/commerce/devices.ts";
import { computeEntitlements } from "../../convex/commerce/entitlements.ts";
import { applyVerifiedUpdate } from "../../convex/commerce/subscriptionState.ts";
import { computeQuote, QUOTE_REUSE_MS, reusableQuote } from "../../convex/commerce/quotes.ts";
import { WEBHOOK_TOLERANCE_MS, webhookTimestampAcceptable, type Providers } from "../../convex/commerce/providers.ts";
import { auditCommerceIntegrity, type IntegrityInput } from "../../convex/commerce/integrity.ts";
import { redactLogFields } from "../../convex/commerce/observability.ts";
import { MemoryDb } from "./memoryDb.ts";

const C = COMMERCE_CONFIG;
const T = Date.UTC(2026, 9, 1, 12);
const MIN = 60_000, H = 3_600_000, DAY = 24 * H;
const ALICE = "users:alice" as never, STAFF = "users:staff" as never;
const row = (db: MemoryDb, id: unknown): Record<string, unknown> => db.get(id as string)!;
const src = (f: string) => readFileSync(join(import.meta.dirname, "../../convex/commerce", f), "utf8");
const addr = { fullName: "A Customer", line1: "1 Test Street", city: "Colombo", countryCode: "LK" };
let seq = 0;

/** An order for `qty` Bands with a frozen attempt (no provider ref yet). */
async function awaitingPayment(db: MemoryDb, qty = 1, cfg: CommerceConfig = C, productId = "sombrey_band") {
  const { orderId } = await createOrderRecord(db as never, { userId: ALICE, items: [{ productId, quantity: qty }], shippingAddress: addr, checkoutRequestKey: `ck-hard-${++seq}-000000` }, cfg, T, () => 0.5);
  const subtotal = row(db, orderId).subtotalCents as number;
  const total = subtotal + 2300;
  await db.patch(orderId as string, { shippingCents: 1500, taxCents: 800, totalCents: total, paymentAttempt: { provider: "test-pay", idempotencyKey: `${orderId}:q`, quoteId: "q", amountCents: total, currency: "USD", startedAt: T } });
  return { orderId, total, key: `${orderId}:q` };
}
const pay = (db: MemoryDb, orderId: unknown, event: Record<string, unknown>) =>
  db.serial(() => applyVerifiedPayment(db as never, { orderId: orderId as never, provider: "test-pay", event: event as never }, C, T));

async function paidOrder(db: MemoryDb, qty = 1) {
  const o = await awaitingPayment(db, qty);
  assert.equal((await pay(db, o.orderId, { eventId: `paid-${o.orderId}`, providerRef: `pi_${o.orderId}`, type: "paid", amountCents: o.total, currency: "USD", idempotencyKey: o.key })).outcome, "applied");
  return o;
}
async function fulfil(db: MemoryDb, orderId: unknown, opts: { kind?: "original" | "replacement"; replaces?: unknown } = {}) {
  const n = ++seq;
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: `ful-hard-${n}-0000`, kind: opts.kind ?? "original", ...(opts.replaces ? { replacesFulfillmentId: opts.replaces as never } : {}) }, C, T);
  await recordSubmission(db as never, fulfillmentId, { provider: "test-ship", providerRef: `FUL-${n}` }, T);
  await recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: `ship-hard-${n}-00`, provider: "test-ship", created: { ok: true, providerRef: `SHP-${n}`, carrier: "TestCarrier", service: "standard" } }, C, T);
  await applyShipmentEvent(db as never, { provider: "test-ship", event: { eventId: `dlv-${n}`, providerRef: `SHP-${n}`, type: "delivered", providerStatus: "DLV", occurredAt: T + DAY } }, C, T + DAY);
  return fulfillmentId;
}
async function unit(db: MemoryDb, mac: string) {
  const bytes = new Uint8Array(12); crypto.getRandomValues(bytes);
  const code = generateActivationCode(bytes);
  const { deviceId } = await registerDevice(db as never, { productId: "sombrey_band", hardwareIdKind: "mac", hardwareId: mac, activationCodeHash: await hashActivationCode(normalizeActivationCode(code)!), staffUserId: STAFF }, C, T);
  return { deviceId, code };
}
const activate = async (db: MemoryDb, code: string) =>
  db.serial(async () => activateWithCode(db as never, ALICE, await hashActivationCode(normalizeActivationCode(code)!), C, T + 2 * DAY));

// ─── Idempotency: same key + same request = same result; conflicting = rejected; races = one record ───

test("checkout request key: a retry is the same order; reusing the key for a different order is refused; a burst creates one order", async () => {
  const db = new MemoryDb();
  const req = (quantity: number, city = "Colombo") => db.serial(() => createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_band", quantity }], shippingAddress: { ...addr, city }, checkoutRequestKey: "same-key-0000000001" }, C, T, () => 0.5));
  const burst = await Promise.all([req(2), req(2), req(2), req(2), req(2)]);
  assert.equal(new Set(burst.map((r) => r.orderId)).size, 1, "five concurrent identical requests → one order");
  assert.deepEqual(burst.map((r) => r.created), [true, false, false, false, false]);
  await assert.rejects(req(3), /already used for a different order/, "different quantity under the same key");
  await assert.rejects(req(2, "Kandy"), /already used for a different order/, "different address under the same key");
  assert.equal(db.rows("commerceOrders").length, 1);
});

test("fulfilment and shipment keys: retries return the same record; a different request under the key is a conflict", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db, 2);
  const create = (kind: "original" | "replacement", lines?: Array<{ productId: string; quantity: number }>) =>
    db.serial(() => createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-key-race-01", kind, ...(lines ? { lines } : {}) }, C, T));
  const [a, b, c] = await Promise.all([create("original"), create("original"), create("original")]);
  assert.ok(a.fulfillmentId === b.fulfillmentId && b.fulfillmentId === c.fulfillmentId && a.created && !b.created && !c.created);
  await assert.rejects(create("replacement"), /different fulfilment/);
  await assert.rejects(create("original", [{ productId: "sombrey_band", quantity: 1 }]), /different fulfilment/);
  assert.equal(db.rows("commerceFulfillments").length, 1);
  await recordSubmission(db as never, a.fulfillmentId, { provider: "test-ship", providerRef: "FUL-race" }, T);

  const ship = (providerRef: string) => recordShipment(db as never, { direction: "outbound", fulfillmentId: a.fulfillmentId, idempotencyKey: "ship-key-race-01", provider: "test-ship", created: { ok: true, providerRef, carrier: "TestCarrier", service: "standard" } }, C, T);
  const s1 = await ship("SHP-A");
  assert.deepEqual(await ship("SHP-A"), { shipmentId: s1.shipmentId, created: false }, "lost response → same shipment");
  await assert.rejects(ship("SHP-B"), /different shipment/, "a different provider shipment under the same key");
  assert.equal(db.rows("commerceShipments").length, 1);
});

test("return request key: a retry is the same return; the key can't be reused for a different return", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  await fulfil(db, orderId);
  const ask = (reason: string) => db.serial(() => requestReturn(db as never, ALICE, { orderId: orderId as never, requestKey: "return-race-0001", reason, attestUnused: true }, C, T + 3 * DAY));
  const [r1, r2] = await Promise.all([ask("changed_mind"), ask("changed_mind")]);
  assert.equal(r1.returnId, r2.returnId);
  await assert.rejects(ask("not_as_expected"), /different return/);
  assert.equal(db.rows("commerceReturns").length, 1);
});

// ─── Payment webhooks ────────────────────────────────────────────────────────

test("a payment webhook that beats the app is bound by the attempt's key — never 'any reference from that provider'", async () => {
  const db = new MemoryDb();
  const { orderId, total, key } = await awaitingPayment(db);
  const paid = { eventId: "w1", providerRef: "pi_real", type: "paid", amountCents: total, currency: "USD" };
  assert.deepEqual(await pay(db, orderId, paid), { outcome: "rejected", reason: "not_this_payment" }, "no key → can't be tied to this attempt");
  assert.deepEqual(await pay(db, orderId, { ...paid, eventId: "w2", idempotencyKey: "another-orders-key" }), { outcome: "rejected", reason: "not_this_payment" });
  assert.equal(row(db, orderId).paymentStatus, "awaiting_payment");
  assert.deepEqual(await pay(db, orderId, { ...paid, eventId: "w3", idempotencyKey: key }), { outcome: "applied" });
  assert.equal((row(db, orderId).paymentAttempt as { providerRef?: string }).providerRef, "pi_real", "the provider's reference is bound on first verified event");
  assert.deepEqual(await pay(db, orderId, { eventId: "w4", providerRef: "pi_other", type: "partially_refunded", amountCents: 100, currency: "USD", idempotencyKey: key }), { outcome: "rejected", reason: "not_this_payment" }, "once bound, the reference must match");
});

test("payment event ids: a replay is a duplicate; the same id with different contents is a conflict and changes nothing", async () => {
  const db = new MemoryDb();
  const { orderId, total } = await paidOrder(db);
  const before = structuredClone(row(db, orderId));
  const id = `paid-${orderId}`;
  assert.deepEqual(await pay(db, orderId, { eventId: id, providerRef: `pi_${orderId}`, type: "paid", amountCents: total, currency: "USD" }), { outcome: "duplicate" });
  assert.deepEqual(await pay(db, orderId, { eventId: id, providerRef: `pi_${orderId}`, type: "refunded", amountCents: total, currency: "USD" }), { outcome: "conflict", reason: "event_id_reused_with_different_contents" });
  assert.deepEqual(row(db, orderId), before, "nothing applied");
  assert.equal(db.rows("commercePaymentEvents").length, 1, "nor recorded twice");
  for (const bad of [{ eventId: "" }, { eventId: "x".repeat(201) }, { providerRef: "" }, { eventId: 42 }]) {
    assert.deepEqual(await pay(db, orderId, { eventId: "ok-id", providerRef: "pi", type: "paid", amountCents: total, currency: "USD", ...bad }), { outcome: "rejected", reason: "malformed_event" }, JSON.stringify(bad));
  }
});

test("webhook replay window: adapters must refuse stale or untimestamped deliveries", () => {
  assert.equal(WEBHOOK_TOLERANCE_MS, 5 * MIN);
  assert.equal(webhookTimestampAcceptable(T - 4 * MIN, T), true);
  assert.equal(webhookTimestampAcceptable(T + 4 * MIN, T), true, "small clock skew is fine");
  for (const bad of [T - 6 * MIN, T + 6 * MIN, undefined, null, "1700000000", 0, Number.NaN]) assert.equal(webhookTimestampAcceptable(bad, T), false, String(bad));
});

// ─── Provider data is untrusted ──────────────────────────────────────────────

test("malformed provider shipment events are skipped one by one; unknown statuses pass through to be recorded, never applied", () => {
  const good = { eventId: "e1", providerRef: "SHP-1", type: "in_transit", providerStatus: "IT", occurredAt: T };
  assert.deepEqual(normalizeProviderShipmentEvent(good), good);
  assert.equal(normalizeProviderShipmentEvent({ ...good, type: "teleported" })?.type, "teleported");
  for (const bad of [null, "x", 42, {}, { ...good, eventId: "" }, { ...good, providerRef: undefined }, { ...good, occurredAt: "yesterday" }, { ...good, occurredAt: -1 }, { ...good, type: "x".repeat(41) }]) {
    assert.equal(normalizeProviderShipmentEvent(bad), null, JSON.stringify(bad));
  }
  const e = normalizeProviderShipmentEvent({ ...good, trackingNumber: "<script>", trackingUrl: "http://insecure.example", estimatedDeliveryAt: "soon", providerStatus: 7 })!;
  assert.deepEqual([e.trackingNumber, e.trackingUrl, e.estimatedDeliveryAt, e.providerStatus], [undefined, undefined, undefined, ""], "bad optional fields are dropped, not stored");
});

test("a malformed 'shipment created' response is a refusal — nothing half-filled is stored", async () => {
  const ok = { ok: true, providerRef: "SHP-9", carrier: "TestCarrier", service: "standard" };
  assert.deepEqual(normalizeCreatedShipment(ok), ok);
  for (const bad of [null, { ok: false, reason: "provider_error" }, { ...ok, ok: "true" }, { ...ok, carrier: "" }, { ...ok, service: "  " }, { ...ok, providerRef: undefined }, { ...ok, carrier: "x".repeat(61) }]) {
    assert.equal(normalizeCreatedShipment(bad), null, JSON.stringify(bad));
  }
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-malformed-01", kind: "original" }, C, T);
  await recordSubmission(db as never, fulfillmentId, { provider: "test-ship", providerRef: "FUL-malformed" }, T);
  await assert.rejects(recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: "ship-malformed-1", provider: "test-ship", created: { ...ok, carrier: "" } as never }, C, T), /Malformed provider response/);
  assert.equal(db.rows("commerceShipments").length, 0);
  // Wiring: the actions normalize before any mutation; a lost submit response is answered, not re-sent.
  // (6J: the actions' orchestration lives in flows.ts, exercised end to end in journeys.test.ts.)
  const flows = src("flows.ts"), staff = src("staff.ts");
  assert.match(flows, /const created = normalizeCreatedShipment\(raw\)/);
  assert.match(flows, /const event = normalizeProviderShipmentEvent\(raw\);\s*\n\s*if \(!event \|\| event\.providerRef !== ref\) \{ skipped\+\+; continue; \}/);
  assert.match(flows, /if \(job\.alreadySubmitted\) return \{ status: "submitted" \}/);
  for (const f of ["submitFulfillmentFlow", "refreshTrackingFlow", "returnLabelFlow", "issueRefundFlow"]) assert.match(staff, new RegExp(`return ${f}\\(`));
});

test("shipment event ids: a replay is a duplicate; the same id with different contents is a conflict", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  await fulfil(db, orderId);
  const shipment = db.rows("commerceShipments")[0];
  const again = (type: string, at: number) => applyShipmentEvent(db as never, { provider: "test-ship", event: { eventId: `dlv-${seq}`, providerRef: shipment.providerRef as string, type, providerStatus: "x", occurredAt: at } }, C, T + 2 * DAY);
  assert.deepEqual(await again("delivered", T + DAY), { outcome: "duplicate" });
  assert.deepEqual(await again("exception", T + DAY), { outcome: "conflict", reason: "event_id_reused_with_different_contents" });
  assert.equal(row(db, shipment._id).status, "delivered");
});

// ─── Devices: replacement returns ───────────────────────────────────────────

test("a replaced Band can still be physically returned — and that never touches the replacement's ownership", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const origFul = await fulfil(db, orderId);
  const orig = await unit(db, "02:00:5E:10:00:1A");
  await assignDevice(db as never, { deviceId: orig.deviceId, fulfillmentId: origFul }, T);
  assert.equal((await activate(db, orig.code)).ok, true);
  const repFul = await fulfil(db, orderId, { kind: "replacement", replaces: origFul });
  const rep = await unit(db, "02:00:5E:10:00:1B");
  await assignDevice(db as never, { deviceId: rep.deviceId, fulfillmentId: repFul, replacesDeviceId: orig.deviceId }, T);
  assert.equal((await activate(db, rep.code)).ok, true);
  assert.equal(row(db, orig.deviceId).status, "replaced");

  const { returnId } = await requestReturn(db as never, ALICE, { orderId: orderId as never, requestKey: "return-replaced-01", reason: "arrived_damaged", attestUnused: true }, C, T + 3 * DAY);
  await authorizeReturn(db as never, returnId, T + 3 * DAY);
  await receiveReturn(db as never, STAFF, returnId, "unused", C, T + 5 * DAY, [orig.deviceId]);
  assert.equal(row(db, orig.deviceId).status, "returned", "the old unit is accounted for");
  const live = db.rows("bandOwnership").filter((o) => o.status === "activated");
  assert.deepEqual(live.map((o) => o.deviceId), [rep.deviceId], "the replacement stays the one active Band");
  assert.deepEqual(auditCommerceIntegrity(await snapshot(db)), [], "and the records agree with each other");
});

// ─── Entitlements: the matrix, surface by surface ───────────────────────────

test("entitlement matrix: each of the four states, every surface, exactly as the config's matrix says", () => {
  const NOW = T;
  const sub = applyVerifiedUpdate(null, {
    provider: "app_store", environment: "production", appStoreProductId: "p", originalTransactionId: "1", latestTransactionId: "1", status: "active", autoRenewEnabled: true,
    purchaseDate: NOW - 1000, expiresDate: NOW + DAY, signedDate: NOW - 1000, verification: { method: "app_store_server_api", verifiedAt: NOW - 1000 },
  }).record;
  const band = { status: "activated", source: "activation", productId: "sombrey_band" };
  const states = {
    none: { ownership: [], subscriptions: [] },
    band_owner: { ownership: [band], subscriptions: [] },
    subscriber: { ownership: [], subscriptions: [sub] },
    band_owner_subscriber: { ownership: [band], subscriptions: [sub] },
  } as const;
  for (const [name, input] of Object.entries(states)) {
    const e = computeEntitlements({ ...input, legacyPremium: false, pairedDevices: 3 } as never, C, NOW);
    assert.equal(e.state, name, "pairings never change the state");
    const caps = new Set(CAPABILITIES.filter((c) => (name.includes("band") && ["band_experience", "vitals"].includes(c)) || (name.includes("subscriber") && ["ai_intelligence", "advanced_features"].includes(c))));
    for (const f of FEATURE_IDS) {
      const expected = C.featureMatrix[f].requires.every((c) => caps.has(c));
      assert.equal(e.features[f].allowed, expected, `${name} · ${f}`);
      if (!expected) assert.ok(["band", "membership", "band_and_membership"].includes(e.features[f].unlockedBy!), `${name} · ${f} says what unlocks it`);
    }
  }
});

// ─── Product generations ─────────────────────────────────────────────────────

test("a second Band generation is a config change: orders, quotes, events and checks work without touching code", async () => {
  const cfg = structuredClone(C) as CommerceConfig & { products: Record<string, unknown> };
  (cfg.products as Record<string, unknown>).band_v2 = { ...structuredClone(C.products.band), id: "sombrey_band_v2", sku: "SOMBREY_BAND_V2", hardwareGeneration: "V2", displayName: "Sombrey Band", priceCents: 12000 };
  assert.deepEqual(validateCommerceConfig(cfg), []);
  assert.deepEqual(physicalProducts(cfg).map((p) => p.id), ["sombrey_band", "sombrey_band_v2"]);
  assert.ok(knownProductIds(cfg).includes("sombrey_band_v2"));
  const db = new MemoryDb();
  const { orderId } = await createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_band_v2", quantity: 1 }], shippingAddress: addr, checkoutRequestKey: "ck-generation-v2-01" }, cfg, T, () => 0.5);
  const o = row(db, orderId) as { lines: Array<{ productId: string; unitPriceCents: number }>; subtotalCents: number };
  assert.deepEqual([o.lines[0].productId, o.lines[0].unitPriceCents, o.subtotalCents], ["sombrey_band_v2", 12000, 12000]);
  let sku = "";
  const providers: Providers = {
    shipping: { name: "s", async quote(r) { sku = r.lines[0].sku; return { ok: true, amountCents: 1500, currency: "USD", reference: "r", detail: "d" }; } },
    tax: { name: "t", async quote() { return { ok: true, amountCents: 0, currency: "USD", reference: "r", detail: "d" }; } },
    payment: null, fulfillment: null,
  };
  const q = await computeQuote(o as never, providers, cfg, T, "q", cfg.version);
  assert.equal(sku, "SOMBREY_BAND_V2", "the provider is told the right SKU");
  assert.equal(q.totalCents, 13500);
  assert.ok(db.rows("commerceEvents").every((e) => e.productId === undefined || e.productId === "sombrey_band_v2"));
  for (const f of ["orders.ts", "quotes.ts", "checkoutStore.ts", "deviceStore.ts", "access.ts", "fulfillmentStore.ts", "returnsStore.ts", "integrity.ts"]) {
    assert.ok(!/SOMBREY_BAND_V1|products\.band\b/.test(src(f).replace(/\/\/.*$/gm, "")), `${f} hard-codes the V1 Band`);
  }
});

// ─── Recovery & throttling ───────────────────────────────────────────────────

test("a quote made seconds ago is reused, not re-asked — never across a config change or past expiry", () => {
  const q = { quoteId: "q", complete: true, subtotalCents: 10000, shipping: { status: "quoted", amountCents: 1500, provider: "p", reference: "r", detail: "d" }, tax: { status: "quoted", amountCents: 0, provider: "p", reference: "r", detail: "d" }, totalCents: 11500, currency: "USD", configVersion: C.version, createdAt: T, expiresAt: T + 15 * MIN } as never;
  assert.equal(reusableQuote(q, T + 2000, C), q);
  assert.equal(reusableQuote(q, T + QUOTE_REUSE_MS, C), null);
  assert.equal(reusableQuote(q, T - 1, C), null, "clock went backwards");
  assert.equal(reusableQuote(null, T, C), null);
  assert.equal(reusableQuote({ ...(q as object), configVersion: "old" } as never, T + 1, C), null);
  assert.equal(reusableQuote({ ...(q as object), expiresAt: T + 1 } as never, T + 2, C), null);
  // (6J: the reuse runs in flows.ts:requestQuoteFlow, which the requestQuote action calls — behaviour tested in journeys.test.ts.)
  assert.match(src("flows.ts"), /if \(draft\.recentQuote\) return draft\.recentQuote;/);
  assert.match(readFileSync(join(import.meta.dirname, "../../convex/commerce/checkout.ts"), "utf8"), /publicQuote\(await requestQuoteFlow\(/);
});

test("the orders list reads an approved return's real stage, like the order detail does", () => {
  const access = src("access.ts");
  const myOrders = access.slice(access.indexOf("export const myOrders"), access.indexOf("export const mySubscription"));
  assert.match(myOrders, /activeReturn: activeReturn\.get\(o\._id\) \?\? null/);
});

// ─── Database integrity ──────────────────────────────────────────────────────

async function snapshot(db: MemoryDb): Promise<IntegrityInput> {
  return {
    orders: db.rows("commerceOrders") as never, fulfillments: db.rows("commerceFulfillments") as never, shipments: db.rows("commerceShipments") as never,
    returns: db.rows("commerceReturns") as never, devices: db.rows("commerceDevices") as never, ownerships: db.rows("bandOwnership") as never,
  };
}

test("integrity report: a healthy flow reports nothing; each kind of inconsistency is found by id", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const ful = await fulfil(db, orderId);
  const u = await unit(db, "02:00:5E:10:00:2A");
  await assignDevice(db as never, { deviceId: u.deviceId, fulfillmentId: ful }, T);
  await activate(db, u.code);
  assert.deepEqual(auditCommerceIntegrity(await snapshot(db)), []);

  const base = await snapshot(db);
  const o = base.orders[0];
  const broken: IntegrityInput = {
    orders: [
      { ...o, totalCents: o.totalCents! + 1 },
      { ...o, _id: "o2", subtotalCents: 1 },
      { ...o, _id: "o3", refundedCents: o.totalCents! + 1 },
      { ...o, _id: "o4", paymentAttempt: null },
    ],
    fulfillments: [...base.fulfillments, { _id: "f-orphan", orderId: "gone" }],
    shipments: [...base.shipments, { _id: "s-orphan", orderId: o._id, direction: "outbound", fulfillmentId: "gone" }],
    returns: [{ _id: "r-orphan", orderId: "gone" }],
    devices: [...base.devices, { _id: "d-active-unowned", status: "activated" }, { _id: "d-twice", status: "activated" }, { _id: "d-ended", status: "returned" }],
    ownerships: [...base.ownerships,
      { _id: "w1", userId: "u1", deviceId: "d-twice", status: "activated" }, { _id: "w2", userId: "u2", deviceId: "d-twice", status: "activated" },
      { _id: "w3", userId: "u3", deviceId: "d-ended", status: "activated" }],
  };
  const found = auditCommerceIntegrity(broken).map((i) => `${i.kind}:${i.ids[0]}`).sort();
  assert.deepEqual(found, [
    `device_activated_without_live_ownership:d-active-unowned`, `device_with_several_live_ownerships:d-twice`, `fulfillment_without_order:f-orphan`,
    `live_ownership_of_ended_device:d-ended`, `order_subtotal_mismatch:o2`, `order_total_mismatch:${o._id}`, `order_total_mismatch:o2`, `paid_without_payment_attempt:o4`,
    `refunded_more_than_captured:o3`, `return_without_order:r-orphan`, `shipment_without_parent:s-orphan`,
  ].sort());
});

test("integrity tooling is read-only and owner/admin-only; nothing deletes commerce history", () => {
  const report = readFileSync(join(import.meta.dirname, "../../convex/commerce/staffIntegrity.ts"), "utf8");
  assert.match(report, /export const integrityReport = query\(/, "a query — it can't write");
  assert.match(report, /await requireStaff\(ctx, "money"\)/, "owner/admin only");
  assert.ok(!/db\.(patch|insert|delete|replace)/.test(report + src("integrity.ts")));
  for (const f of ["checkoutStore.ts", "fulfillmentStore.ts", "returnsStore.ts", "deviceStore.ts", "staff.ts", "staffDevices.ts", "access.ts", "orderTracking.ts"]) {
    const deletes = src(f).split("\n").filter((l) => /db\.delete\(/.test(l));
    // The only delete: account deletion clears that user's activation-attempt rate-limit rows (no history).
    for (const l of deletes) assert.match(l, /commerceActivationAttempts/, `${f} deletes commerce records`);
  }
});

// ─── Observability ───────────────────────────────────────────────────────────

test("operational logs are structured and redacted: no codes, credentials, addresses, names, hardware ids or Apple tokens", () => {
  const out = redactLogFields({
    event_ok: "x", orderId: "commerceOrders:1", outcome: "rejected", reason: "amount_mismatch", applied: 2, ok: true,
    activationCode: "ABCD-EFGH-JKMN", cardNumber: "4242", shippingAddress: "1 Test Street", line1: "1 Test St", fullName: "A Customer", email: "a@example.com",
    hardwareId: "02:00:5E:10:00:0A", macAddress: "02:00:5E", signedTransaction: "eyJ", appAccountToken: "uuid", receipt: "MII", nested: { a: 1 }, fn: () => 1,
  });
  assert.deepEqual(Object.keys(out).sort(), ["applied", "event_ok", "ok", "orderId", "outcome", "reason"]);
  assert.equal(redactLogFields({ note: "x".repeat(500) }).note!.toString().length, 80);
  // The commerce backend logs only through this helper (or App Store outcome codes).
  for (const f of ["checkoutStore.ts", "fulfillmentStore.ts", "returnsStore.ts", "deviceStore.ts", "staff.ts", "staffDevices.ts", "myDevices.ts", "checkout.ts", "access.ts"]) {
    assert.ok(!/console\.(log|info|warn|error)/.test(src(f)), `${f} logs directly`);
  }
});
