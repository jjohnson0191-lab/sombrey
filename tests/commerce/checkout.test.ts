// Sombrey commerce, Phase 6E — physical Band checkout (quotes.ts, checkoutStore.ts,
// checkout.ts, providers.ts). SYNTHETIC data only. The "providers" below are TEST
// DOUBLES that exist only in this file — the product has no provider configured.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { COMMERCE_CONFIG, publicCommerceConfig, validateCommerceConfig, type CommerceConfig } from "../../convex/commerce/config.ts";
import { providersFor, type PaymentProvider, type Providers, type ShippingQuoteProvider, type TaxQuoteProvider } from "../../convex/commerce/providers.ts";
import { computeQuote, draftStillCurrent, orderStage, quoteUsable, type OrderQuote } from "../../convex/commerce/quotes.ts";
import {
  applyVerifiedPayment, cancelCheckout, createOrderRecord, recordQuote, reservePaymentAttempt, updateAddress,
} from "../../convex/commerce/checkoutStore.ts";
import { validateEvent } from "../../convex/commerce/events.ts";
import type { ShippingAddress } from "../../convex/commerce/orders.ts";
import { MemoryDb } from "./memoryDb.ts";

const NOW = Date.UTC(2026, 9, 1, 12);
const MIN = 60_000;
const ALICE = "users:alice" as never, BOB = "users:bob" as never;
const C = COMMERCE_CONFIG;
const address = (over: Partial<ShippingAddress> = {}): ShippingAddress => ({ fullName: "A Customer", line1: "1 Test Street", city: "Colombo", countryCode: "LK", ...over });
const KEY = "checkout-key-000000000001";
const rnd = () => 0.42;

// ─── Test doubles (never part of the product) ───────────────────────────────
const shipping = (amountCents = 1500, over: Partial<{ currency: string; expiresAt: number; fail: boolean; throws: boolean }> = {}): ShippingQuoteProvider => ({
  name: "test-shipping",
  async quote() {
    if (over.throws) throw new Error("network");
    if (over.fail) return { ok: false, reason: "no_service_to_destination" };
    return { ok: true, amountCents, currency: over.currency ?? "USD", reference: "ship-ref", detail: "standard", ...(over.expiresAt ? { expiresAt: over.expiresAt } : {}) };
  },
});
const tax = (amountCents = 830): TaxQuoteProvider => ({
  name: "test-tax",
  async quote(req) { return { ok: true, amountCents: req.shippingCents >= 0 ? amountCents : -1, currency: "USD", reference: "tax-ref", detail: "LK" }; },
});
const none: Providers = { shipping: null, tax: null, payment: null, fulfillment: null };
const full: Providers = { shipping: shipping(), tax: tax(), payment: null, fulfillment: null };

async function draft(db: MemoryDb, user = ALICE, key = KEY, quantity = 2) {
  return db.serial(() => createOrderRecord(db as never, { userId: user, items: [{ productId: "sombrey_band", quantity }], shippingAddress: address(), checkoutRequestKey: key }, C, NOW, rnd));
}
async function quoted(db: MemoryDb, providers = full, user = ALICE, key = KEY) {
  const { orderId } = await draft(db, user, key);
  const o = db.get(orderId)!;
  const q = await computeQuote(o as never, providers, C, NOW, `q-${key}`, C.version);
  await recordQuote(db as never, user, orderId as never, q, C, NOW);
  return { orderId, quote: q };
}
const order = (db: MemoryDb, id: unknown): Record<string, unknown> => db.get(id as string)!;

// ─── Product model, configuration ────────────────────────────────────────────

test("the Band is one centralized product: SKU, category, price, currency, countries, returns — all from config.ts", () => {
  assert.deepEqual(validateCommerceConfig(C), []);
  const b = C.products.band;
  assert.deepEqual([b.id, b.sku, b.category, b.hardwareGeneration, b.priceCents, b.currency, b.channel], ["sombrey_band", "SOMBREY_BAND_V1", "physical_band", "V1", 10000, "USD", "physical_checkout"]);
  assert.deepEqual(C.shipping.countries, ["US", "GB", "AE", "CA", "AU", "LK"]);
  assert.deepEqual([C.returns.windowDays, C.returns.eligibleConditions], [30, ["unused"]]);
  const pub = publicCommerceConfig(C);
  assert.equal(pub.band.sku, "SOMBREY_BAND_V1");
  assert.equal(pub.band.checkoutAvailable, false, "no payment provider → the Band can't be bought yet, and the app is told so");
});

test("no inventory is invented: stock isn't tracked, and nothing reports it", () => {
  assert.deepEqual(C.inventory, { provider: null });
  const commerce = join(import.meta.dirname, "../../convex/commerce");
  for (const f of readdirSync(commerce).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(join(commerce, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/inStock|stockCount|quantityAvailable|unitsLeft|"in stock"|only \d+ left/i.test(src), `${f} mentions stock levels`);
  }
});

test("no provider is chosen: none is invented, and the boundary has no Apple In-App Purchase", () => {
  assert.deepEqual(providersFor(C), { shipping: null, tax: null, payment: null, fulfillment: null });
  const providers = readFileSync(join(import.meta.dirname, "../../convex/commerce/providers.ts"), "utf8");
  assert.ok(!/stripe|adyen|paddle|shopify|braintree|storekit/i.test(providers.replace(/\/\/.*$/gm, "")), "no vendor is hard-wired");
});

// ─── Quotes ──────────────────────────────────────────────────────────────────

const d = { lines: [{ productId: "sombrey_band", productType: "physical" as const, displayName: "Sombrey Band", unitPriceCents: 10000, quantity: 2, currency: "USD" }], currency: "USD", subtotalCents: 20000, shippingAddress: address() };

test("quote without providers: subtotal known, shipping/tax/total unavailable — never a guessed number", async () => {
  const q = await computeQuote(d, none, C, NOW, "q1", C.version);
  assert.equal(q.subtotalCents, 20000);
  assert.deepEqual(q.shipping, { status: "unavailable", reason: "provider_not_configured" });
  assert.deepEqual(q.tax, { status: "unavailable", reason: "provider_not_configured" });
  assert.equal(q.totalCents, null);
  assert.equal(q.complete, false);
  assert.equal(q.expiresAt, NOW + 15 * MIN);
  assert.equal(quoteUsable(q, NOW), false);
});

test("quote with providers: subtotal + shipping + tax, tax after shipping, expiring", async () => {
  const q = await computeQuote(d, full, C, NOW, "q2", C.version);
  assert.deepEqual([q.complete, q.totalCents], [true, 20000 + 1500 + 830]);
  assert.ok(quoteUsable(q, NOW + 14 * MIN));
  assert.ok(!quoteUsable(q, NOW + 15 * MIN), "quotes expire");
  const shorter = await computeQuote(d, { ...full, shipping: shipping(1500, { expiresAt: NOW + 5 * MIN }) }, C, NOW, "q3", C.version);
  assert.equal(shorter.expiresAt, NOW + 5 * MIN, "a provider's shorter validity wins");
  const noShip = await computeQuote(d, { ...full, shipping: shipping(0, { fail: true }) }, C, NOW, "q4", C.version);
  assert.deepEqual([noShip.shipping, noShip.tax], [{ status: "unavailable", reason: "no_service_to_destination" }, { status: "unavailable", reason: "awaiting_shipping_quote" }]);
});

test("quote refuses bad provider values: wrong currency, negative, fractional, huge, thrown errors", async () => {
  for (const [p, reason] of [
    [shipping(1500, { currency: "EUR" }), "currency_mismatch"],
    [shipping(-1), "invalid_amount"],
    [shipping(1.5), "invalid_amount"],
    [shipping(Number.MAX_SAFE_INTEGER), "invalid_amount"],
    [shipping(NaN), "invalid_amount"],
    [shipping(0, { throws: true }), "provider_error"],
  ] as const) {
    const q = await computeQuote(d, { ...full, shipping: p }, C, NOW, "q", C.version);
    assert.deepEqual(q.shipping, { status: "unavailable", reason }, reason);
    assert.equal(q.totalCents, null);
  }
});

test("a draft priced under an older Band price can't be quoted or paid (no silent re-pricing)", () => {
  assert.ok(draftStillCurrent(d, C));
  const cheaper: CommerceConfig = structuredClone(C); cheaper.products.band.priceCents = 8900;
  assert.ok(!draftStillCurrent(d, cheaper));
  const off: CommerceConfig = structuredClone(C); off.products.band.active = false;
  assert.ok(!draftStillCurrent(d, off));
  assert.ok(!draftStillCurrent({ ...d, subtotalCents: 1 }, C), "a tampered subtotal is caught");
});

// ─── Checkout lifecycle (in-memory Convex) ───────────────────────────────────

test("start checkout: priced from config, snapshotted; the same request key (double tap, retry, relaunch) returns the same order", async () => {
  const db = new MemoryDb();
  const a = await draft(db);
  const again = await Promise.all([draft(db), draft(db), draft(db)]);
  assert.ok(a.created && again.every((r) => !r.created && r.orderId === a.orderId));
  assert.equal(db.rows("commerceOrders").length, 1);
  const o = order(db, a.orderId);
  assert.deepEqual(o.lines, [{ productId: "sombrey_band", productType: "physical", displayName: "Sombrey Band", unitPriceCents: 10000, quantity: 2, currency: "USD" }]);
  assert.deepEqual([o.subtotalCents, o.shippingCents, o.taxCents, o.totalCents, o.currency, o.configVersion], [20000, null, null, null, "USD", C.version]);
  assert.deepEqual([o.paymentStatus, o.fulfillmentStatus, o.returnStatus], ["awaiting_payment", "unfulfilled", "none"]);
  assert.deepEqual(o.returnPolicy, { windowDays: 30, eligibleConditions: ["unused"] });
  assert.equal(orderStage(o as never, NOW), "draft");
});

test("quantity, product, destination and request-key bounds are enforced on the server", async () => {
  const db = new MemoryDb();
  for (const quantity of [0, -1, 6, 1.5, NaN, Infinity, 1e308, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_band", quantity }], shippingAddress: address(), checkoutRequestKey: `k-quantity-${String(quantity).replace(/\W/g, "")}-0000` }, C, NOW, rnd), /Quantity/, String(quantity));
  }
  await assert.rejects(createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address({ countryCode: "FR" }), checkoutRequestKey: "k-country-000000000" }, C, NOW, rnd), /don't ship/);
  await assert.rejects(createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_membership_monthly", quantity: 1 }], shippingAddress: address(), checkoutRequestKey: "k-membership-00000" }, C, NOW, rnd), /App Store/);
  for (const key of ["short", "has spaces in it 000", "x".repeat(65), "../../etc/passwd/0000"]) {
    await assert.rejects(createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address(), checkoutRequestKey: key }, C, NOW, rnd), /Invalid checkout request/);
  }
  assert.equal(db.rows("commerceOrders").length, 0);
});

test("open checkouts per account are capped (abuse), and cancelled ones free a slot", async () => {
  const db = new MemoryDb();
  const ids = [];
  for (let i = 0; i < C.checkout.maxOpenCheckoutsPerUser; i++) ids.push((await draft(db, ALICE, `checkout-key-cap-00000${i}`)).orderId);
  await assert.rejects(draft(db, ALICE, "checkout-key-cap-000009"), /open checkout/);
  await cancelCheckout(db as never, ALICE, ids[0] as never, NOW);
  assert.ok((await draft(db, ALICE, "checkout-key-cap-000009")).created);
  assert.ok((await draft(db, BOB, "checkout-key-cap-bob-01")).created, "another account isn't affected");
});

test("payment can start only against a complete, unexpired quote — one attempt, same key on retry", async () => {
  const db = new MemoryDb();
  const { orderId: noQuote } = await draft(db, ALICE, "checkout-key-noquote-01");
  assert.deepEqual(await reservePaymentAttempt(db as never, ALICE, noQuote as never, "test-pay", C, NOW), { kind: "refused", reason: "quote_missing" });
  const { orderId: incomplete } = await quoted(db, none, ALICE, "checkout-key-incomplete");
  assert.deepEqual(await reservePaymentAttempt(db as never, ALICE, incomplete as never, "test-pay", C, NOW), { kind: "refused", reason: "quote_incomplete" });

  const { orderId, quote } = await quoted(db);
  assert.equal(orderStage(order(db, orderId) as never, NOW), "quote_ready");
  assert.deepEqual(await reservePaymentAttempt(db as never, ALICE, orderId as never, "test-pay", C, NOW + 16 * MIN), { kind: "refused", reason: "quote_expired" });
  const first = await db.serial(() => reservePaymentAttempt(db as never, ALICE, orderId as never, "test-pay", C, NOW + MIN));
  const second = await db.serial(() => reservePaymentAttempt(db as never, ALICE, orderId as never, "test-pay", C, NOW + 2 * MIN));
  assert.ok(first.kind === "new" && second.kind === "existing");
  if (first.kind === "new" && second.kind === "existing") {
    assert.equal(first.attempt.idempotencyKey, second.attempt.idempotencyKey, "a retry asks the provider with the same key — no second charge");
    assert.equal(first.attempt.amountCents, quote.totalCents, "the quoted total is frozen for the attempt");
  }
  assert.equal(orderStage(order(db, orderId) as never, NOW), "payment_pending");
  // While a payment may be completing: no re-quote, no address change, no client cancel.
  await assert.rejects(recordQuote(db as never, ALICE, orderId as never, quote, C, NOW), /can't be re-quoted/);
  await assert.rejects(updateAddress(db as never, ALICE, orderId as never, address({ city: "Kandy" }), C, NOW), /can't be changed/);
  await assert.rejects(cancelCheckout(db as never, ALICE, orderId as never, NOW), /payment is in progress/);
});

test("changing the address drops the quote; cancelling before payment is final", async () => {
  const db = new MemoryDb();
  const { orderId } = await quoted(db);
  await updateAddress(db as never, ALICE, orderId as never, address({ countryCode: "AU", city: "Sydney" }), C, NOW);
  const o = order(db, orderId);
  assert.deepEqual([o.quote, o.shippingCents, o.taxCents, o.totalCents], [undefined, null, null, null]);
  assert.equal((await cancelCheckout(db as never, ALICE, orderId as never, NOW)).changed, true);
  assert.equal((await cancelCheckout(db as never, ALICE, orderId as never, NOW)).changed, false, "idempotent");
  assert.equal(order(db, orderId).paymentStatus, "cancelled");
  assert.equal(orderStage(order(db, orderId) as never, NOW), "cancelled");
  assert.deepEqual(await reservePaymentAttempt(db as never, ALICE, orderId as never, "test-pay", C, NOW), { kind: "refused", reason: "not_open" });
});

// ─── Verified payment events ─────────────────────────────────────────────────

async function readyToPay(db: MemoryDb) {
  const { orderId, quote } = await quoted(db);
  const r = await reservePaymentAttempt(db as never, ALICE, orderId as never, "test-pay", C, NOW + MIN);
  assert.ok(r.kind === "new");
  return { orderId, total: quote.totalCents! };
}
// A verified provider event echoes the attempt's idempotency key (6I: that is how
// it's bound to its attempt before the provider's reference is recorded).
const attemptKey = (db: MemoryDb, orderId: unknown) => (db.rows("commerceOrders").find((o) => o._id === orderId)?.paymentAttempt as { idempotencyKey?: string } | undefined)?.idempotencyKey;
const pay = (db: MemoryDb, orderId: unknown, over: Partial<{ eventId: string; type: string; amountCents: number; currency: string; providerRef: string; idempotencyKey: string }> = {}, provider = "test-pay") =>
  db.serial(() => applyVerifiedPayment(db as never, { orderId: orderId as never, provider, event: { eventId: "evt-1", providerRef: "pi_1", type: "paid", amountCents: 22330, currency: "USD", idempotencyKey: attemptKey(db, orderId), ...over } }, C, NOW + 2 * MIN));

test("a verified 'paid' for exactly the quoted total marks the order paid — once — and creates NO Band ownership", async () => {
  const db = new MemoryDb();
  const { orderId, total } = await readyToPay(db);
  assert.equal(total, 22330);
  assert.deepEqual(await pay(db, orderId), { outcome: "applied" });
  assert.deepEqual(await pay(db, orderId), { outcome: "duplicate" }, "the same webhook again changes nothing");
  assert.deepEqual(await pay(db, orderId, { eventId: "evt-2" }), { outcome: "unchanged" }, "a second 'paid' event is harmless");
  const o = order(db, orderId);
  assert.deepEqual([o.paymentStatus, o.paidAt, o.totalCents], ["paid", NOW + 2 * MIN, 22330]);
  assert.equal(orderStage(o as never, NOW), "paid");
  assert.equal(db.rows("bandOwnership").length, 0, "ORDER ≠ OWNERSHIP (Phase 6G)");
  const revenue = db.rows("commerceEvents").filter((e) => e.name === "band_checkout_completed");
  assert.equal(revenue.length, 1);
  assert.deepEqual([revenue[0].amountCents, revenue[0].currency, revenue[0].countryCode], [22330, "USD", "LK"]);
  assert.equal(db.rows("commercePaymentEvents").length, 2, "every distinct verified event recorded once");
});

test("payment events that don't match the frozen attempt are rejected and recorded", async () => {
  const db = new MemoryDb();
  const { orderId } = await readyToPay(db);
  const cases: Array<[Parameters<typeof pay>[2], string, string?]> = [
    [{ eventId: "e1", amountCents: 1 }, "amount_mismatch"],
    [{ eventId: "e2", amountCents: 22331 }, "amount_mismatch"],
    [{ eventId: "e3", currency: "LKR" }, "amount_mismatch"],
    [{ eventId: "e4", type: "teleported" }, "unknown_event_type"],
    [{ eventId: "e5" }, "not_this_payment", "other-provider"],
    // 6I: before the provider's reference is recorded, an event must carry this attempt's key.
    [{ eventId: "e5b", idempotencyKey: "someone-elses-attempt" }, "not_this_payment"],
  ];
  for (const [over, reason, provider] of cases) assert.deepEqual(await pay(db, orderId, over, provider), { outcome: "rejected", reason }, reason);
  assert.equal(order(db, orderId).paymentStatus, "awaiting_payment");
  // Once the provider ref is known, events for another payment are rejected.
  await pay(db, orderId, { eventId: "e6", type: "authorized" });
  assert.deepEqual(await pay(db, orderId, { eventId: "e7", providerRef: "pi_someone_else" }), { outcome: "rejected", reason: "not_this_payment" });
});

test("state integrity: paid never silently becomes unpaid; refunds are controlled; a verified retry after failure is recorded", async () => {
  const db = new MemoryDb();
  const { orderId } = await readyToPay(db);
  assert.equal((await pay(db, orderId, { eventId: "f1", type: "failed" })).outcome, "applied");
  assert.equal(orderStage(order(db, orderId) as never, NOW), "payment_failed");
  assert.equal((await pay(db, orderId, { eventId: "f2", type: "paid" })).outcome, "applied", "provider retried the same payment successfully");
  assert.deepEqual(await pay(db, orderId, { eventId: "f3", type: "failed" }), { outcome: "rejected", reason: "invalid_transition" }, "paid can't become failed");
  assert.deepEqual(await pay(db, orderId, { eventId: "f4", type: "cancelled" }), { outcome: "rejected", reason: "invalid_transition" }, "paid can't become cancelled");
  assert.deepEqual(await pay(db, orderId, { eventId: "f5", type: "refunded", amountCents: 100 }), { outcome: "rejected", reason: "amount_mismatch" }, "a full refund is the full amount");
  assert.equal((await pay(db, orderId, { eventId: "f6", type: "partially_refunded", amountCents: 1000 })).outcome, "applied");
  // 6F: refund events carry the amount refunded by THAT event; the total can't exceed what was captured.
  assert.deepEqual(await pay(db, orderId, { eventId: "f6b", type: "refunded", amountCents: 22330 }), { outcome: "rejected", reason: "amount_mismatch" }, "no over-refund");
  assert.equal((await pay(db, orderId, { eventId: "f7", type: "refunded", amountCents: 21330 })).outcome, "applied");
  assert.equal(order(db, orderId).refundedCents, 22330);
  assert.deepEqual(await pay(db, orderId, { eventId: "f8", type: "paid" }), { outcome: "rejected", reason: "invalid_transition" }, "refunded is final");
  assert.equal(orderStage(order(db, orderId) as never, NOW), "refunded");
});

test("order stage reads 6A's machines; fulfilment/returns are 6F's to move", () => {
  const base = { paymentStatus: "paid" as const, fulfillmentStatus: "unfulfilled" as const, returnStatus: "none" as const };
  assert.equal(orderStage(base, NOW), "paid");
  assert.equal(orderStage({ ...base, fulfillmentStatus: "processing" }, NOW), "fulfillment_pending");
  assert.equal(orderStage({ ...base, fulfillmentStatus: "shipped" }, NOW), "shipped");
  assert.equal(orderStage({ ...base, fulfillmentStatus: "delivered" }, NOW), "delivered");
  assert.equal(orderStage({ ...base, fulfillmentStatus: "delivered", returnStatus: "requested" }, NOW), "return_requested");
  assert.equal(orderStage({ ...base, fulfillmentStatus: "delivered", returnStatus: "received" }, NOW), "return_received");
  assert.equal(orderStage({ ...base, returnStatus: "refunded" }, NOW), "refunded");
});

// ─── Authorization & privacy ────────────────────────────────────────────────

test("another account can't read, change, quote, pay or cancel someone's order", async () => {
  const db = new MemoryDb();
  const { orderId, quote } = await quoted(db);
  await assert.rejects(updateAddress(db as never, BOB, orderId as never, address(), C, NOW), /not found/i);
  await assert.rejects(recordQuote(db as never, BOB, orderId as never, quote, C, NOW), /not found/i);
  await assert.rejects(reservePaymentAttempt(db as never, BOB, orderId as never, "test-pay", C, NOW), /not found/i);
  await assert.rejects(cancelCheckout(db as never, BOB, orderId as never, NOW), /not found/i);
  assert.equal(order(db, orderId).userId, ALICE);
});

test("a quote can't be swapped for a cheaper one: subtotal, currency and the Band's current price are checked", async () => {
  const db = new MemoryDb();
  const { orderId } = await draft(db);
  const fake: OrderQuote = { quoteId: "x", complete: true, subtotalCents: 1, shipping: { status: "quoted", amountCents: 0, provider: "p", reference: "r", detail: "d" }, tax: { status: "quoted", amountCents: 0, provider: "p", reference: "r", detail: "d" }, totalCents: 1, currency: "USD", configVersion: C.version, createdAt: NOW, expiresAt: NOW + MIN };
  await assert.rejects(recordQuote(db as never, ALICE, orderId as never, fake, C, NOW), /doesn't match/);
  await assert.rejects(recordQuote(db as never, ALICE, orderId as never, { ...fake, subtotalCents: 20000, currency: "LKR" }, C, NOW), /doesn't match/);
  const repriced: CommerceConfig = structuredClone(C); repriced.products.band.priceCents = 9000;
  await assert.rejects(recordQuote(db as never, ALICE, orderId as never, { ...fake, subtotalCents: 20000 }, repriced, NOW), /start again/);
});

test("analytics never carry an address or a name; checkout milestones are server events", async () => {
  const db = new MemoryDb();
  const { orderId } = await readyToPay(db);
  await pay(db, orderId);
  for (const e of db.rows("commerceEvents")) {
    const json = JSON.stringify(e);
    assert.ok(!/Test Street|Colombo|A Customer|line1|fullName|postalCode|phone/.test(json), `${e.name} leaks an address`);
  }
  assert.deepEqual(db.rows("commerceEvents").map((e) => e.name), ["band_quote_requested", "band_payment_started", "band_checkout_completed"]);
  const known = [C.products.band.id, C.products.membership.id];
  for (const name of ["band_quote_requested", "band_payment_started", "band_checkout_completed"]) {
    assert.match(validateEvent({ name, platform: "ios" }, "client", known)!, /only be recorded by Sombrey's servers/, `the app can't claim ${name}`);
  }
});

test("source boundaries: the customer API takes no price/total/status/owner, logs nothing, and only verified events pay", () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, "../../convex/commerce", f), "utf8");
  const api = read("checkout.ts");
  const publicFns = [...api.matchAll(/export const (\w+) = (mutation|action|query)\(/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(publicFns, ["beginPayment:action", "cancelCheckout:mutation", "requestQuote:action", "startBandCheckout:mutation", "updateShippingAddress:mutation"]);
  const argBlocks = [...api.matchAll(/export const \w+ = (?:mutation|action)\(\{\s*args: (\{[^}]*\})/g)].map((m) => m[1]).join(" ");
  assert.ok(!/price|total|amount|currency|shippingCents|taxCents|status|userId|paid|owner/i.test(argBlocks), `client args: ${argBlocks}`);
  for (const f of ["checkout.ts", "checkoutStore.ts", "quotes.ts", "providers.ts", "orders.ts"]) {
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(read(f)), `${f} logs (addresses must never be logged)`);
  }
  assert.ok(!/beginPayment[\s\S]*paymentStatus: "paid"/.test(api), "starting a payment never marks anything paid");
  const internal = read("internal.ts");
  assert.ok(!/insert\("bandOwnership"[\s\S]{0,80}source: "order"/.test(internal), "no ownership from orders in 6E");
  const access = read("access.ts");
  const my = access.slice(access.indexOf("export const myOrders"), access.indexOf("export const mySubscription"));
  assert.ok(!/providerRef|idempotencyKey|checkoutRequestKey|reference/.test(my), "myOrders exposes no provider or idempotency internals");
});
