// Sombrey commerce, Phase 6F — fulfilment, shipments, tracking, returns, refunds
// (fulfillment.ts, fulfillmentStore.ts, returnsStore.ts, staffAccess.ts, staff.ts,
// orderTracking.ts). SYNTHETIC data; provider responses are TEST DOUBLES that
// exist only in this file — no provider is configured in the product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMERCE_CONFIG, physicalProduct, validateCommerceConfig } from "../../convex/commerce/config.ts";
import { applyCarrierEvent, customerTracking, refundAmountFor, shipmentAttention } from "../../convex/commerce/fulfillment.ts";
import { applyShipmentEvent, cancelFulfillment, cancelPaidOrderBeforeShipment, createFulfillment, recordShipment, recordSubmission } from "../../convex/commerce/fulfillmentStore.ts";
import { approveRefund, authorizeReturn, cancelReturn, receiveReturn, rejectReturn, requestReturn, returnOptions } from "../../convex/commerce/returnsStore.ts";
import { applyVerifiedPayment, createOrderRecord } from "../../convex/commerce/checkoutStore.ts";
import { providersFor } from "../../convex/commerce/providers.ts";
import { orderStage } from "../../convex/commerce/quotes.ts";
import { staffMay } from "../../convex/commerce/staffAccess.ts";
import { MemoryDb } from "./memoryDb.ts";

const C = COMMERCE_CONFIG;
const T = Date.UTC(2026, 9, 1, 12);
const H = 3_600_000, DAY = 24 * H;
const ALICE = "users:alice" as never, BOB = "users:bob" as never, STAFF = "users:staff" as never;
const rnd = () => 0.3;
const row = (db: MemoryDb, id: unknown): Record<string, unknown> => db.get(id as string)!;

/** A paid order for `qty` Bands, through the real 6E path (quote + verified payment). */
async function paidOrder(db: MemoryDb, qty = 1, user = ALICE) {
  const { orderId } = await createOrderRecord(db as never, { userId: user, items: [{ productId: "sombrey_band", quantity: qty }], shippingAddress: { fullName: "A Customer", line1: "1 Test Street", city: "Colombo", postalCode: "00100", countryCode: "LK" }, checkoutRequestKey: `ck-${Math.random().toString(36).slice(2)}-0000` }, C, T, rnd);
  const total = 10000 * qty + 1500 + 800;
  await db.patch(orderId as string, {
    quote: { quoteId: "q", complete: true, subtotalCents: 10000 * qty, shipping: { status: "quoted", amountCents: 1500, provider: "p", reference: "r", detail: "d" }, tax: { status: "quoted", amountCents: 800, provider: "p", reference: "r", detail: "d" }, totalCents: total, currency: "USD", configVersion: C.version, createdAt: T, expiresAt: T + 10 * 60_000 },
    shippingCents: 1500, taxCents: 800, totalCents: total,
    paymentAttempt: { provider: "test-pay", idempotencyKey: "k", quoteId: "q", amountCents: total, currency: "USD", providerRef: "pi_1", startedAt: T },
  });
  const paid = await applyVerifiedPayment(db as never, { orderId: orderId as never, provider: "test-pay", event: { eventId: `paid-${orderId}`, providerRef: "pi_1", type: "paid", amountCents: total, currency: "USD" } }, C, T);
  assert.equal(paid.outcome, "applied");
  return { orderId, total };
}

/** A shipment the (test-double) provider created for a fulfilment. */
async function shipped(db: MemoryDb, orderId: unknown, key = "ful-key-000001", ref = "SHP-1") {
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: key, kind: "original" }, C, T);
  await recordSubmission(db as never, fulfillmentId, { provider: "test-ship", providerRef: `FUL-${ref}` }, T);
  const { shipmentId } = await recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: `ship-${ref}-0001`, provider: "test-ship", created: { ok: true, providerRef: ref, carrier: "TestCarrier", service: "standard" } }, C, T);
  return { fulfillmentId, shipmentId };
}
const ev = (db: MemoryDb, ref: string, eventId: string, type: string, at: number, extra: Record<string, unknown> = {}) =>
  db.serial(() => applyShipmentEvent(db as never, { provider: "test-ship", event: { eventId, providerRef: ref, type, providerStatus: `raw-${type}`, occurredAt: at, ...extra } as never }, C, T + 30 * DAY));

// ─── Configuration & extensibility ───────────────────────────────────────────

test("fulfilment config: no provider, return clock from delivery, product-level traits; nothing invented", () => {
  assert.deepEqual(validateCommerceConfig(C), []);
  assert.deepEqual(C.fulfillment, { provider: null, stalledTrackingAfterHours: 72 });
  assert.equal(providersFor(C).fulfillment, null);
  assert.deepEqual([C.returns.clockStartsAt, C.returns.windowDays, C.returns.eligibleConditions], ["delivery", 30, ["unused"]]);
  const band = physicalProduct(C, "sombrey_band")!;
  assert.deepEqual([band.sku, band.fulfillmentProfile, band.returnable, band.requiresActivation], ["SOMBREY_BAND_V1", "parcel", true, true]);
  assert.equal(physicalProduct(C, "sombrey_band_v2"), undefined, "no future product is invented");
  assert.deepEqual(C.shipping.countries, ["US", "GB", "AE", "CA", "AU", "LK"]);
});

test("fulfilment code is product-agnostic: no SKU, Band or 'one order = one shipment' assumption", () => {
  for (const f of ["fulfillment.ts", "fulfillmentStore.ts", "returnsStore.ts", "orderTracking.ts"]) {
    const src = readFileSync(join(import.meta.dirname, "../../convex/commerce", f), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/SOMBREY_BAND_V1|products\.band|"sombrey_band"/.test(src), `${f} hard-codes the Band`);
  }
});

// ─── Fulfilments ─────────────────────────────────────────────────────────────

test("only a paid order can be fulfilled — never unpaid, cancelled or refunded", async () => {
  const db = new MemoryDb();
  const { orderId: unpaid } = await createOrderRecord(db as never, { userId: ALICE, items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: { fullName: "A", line1: "1 St", city: "X", countryCode: "LK" }, checkoutRequestKey: "unpaid-key-0000000001" }, C, T, rnd);
  await assert.rejects(createFulfillment(db as never, { orderId: unpaid, idempotencyKey: "ful-unpaid-01", kind: "original" }, C, T), /can't be fulfilled \(not_paid\)/);
  const { orderId, total } = await paidOrder(db);
  await applyVerifiedPayment(db as never, { orderId: orderId as never, provider: "test-pay", event: { eventId: "refund-all", providerRef: "pi_1", type: "refunded", amountCents: total, currency: "USD" } }, C, T);
  await assert.rejects(createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-refunded-1", kind: "original" }, C, T), /refunded/);
  assert.equal(db.rows("commerceFulfillments").length, 0);
});

test("fulfilment creation is idempotent: same key → same fulfilment, even concurrently; never more than ordered", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db, 2);
  const results = await Promise.all(Array.from({ length: 5 }, () => db.serial(() => createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-same-key-1", kind: "original" }, C, T))));
  assert.equal(new Set(results.map((r) => r.fulfillmentId)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(db.rows("commerceFulfillments").length, 1);
  assert.deepEqual(row(db, results[0].fulfillmentId).lines, [{ productId: "sombrey_band", quantity: 2 }]);
  await assert.rejects(createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-other-key", kind: "original" }, C, T), /Nothing left/);
  assert.equal(row(db, orderId).fulfillmentStatus, "processing");
  assert.equal(orderStage(row(db, orderId) as never, T), "fulfillment_pending");
});

test("shipment records are idempotent and keep only provider-issued, valid tracking data", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-key-tracking", kind: "original" }, C, T);
  await recordSubmission(db as never, fulfillmentId, { provider: "test-ship", providerRef: "FUL-1" }, T);
  const created = { ok: true as const, providerRef: "SHP-9", carrier: "TestCarrier", service: "standard", trackingNumber: "<script>", trackingUrl: "http://insecure.example/track" };
  const a = await recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: "ship-key-0009", provider: "test-ship", created }, C, T);
  const b = await recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: "ship-key-0009", provider: "test-ship", created }, C, T);
  assert.ok(a.created && !b.created && a.shipmentId === b.shipmentId, "retry after a timeout → the same shipment");
  assert.equal(db.rows("commerceShipments").length, 1);
  const s = row(db, a.shipmentId);
  assert.equal(s.trackingNumber, undefined, "an invalid tracking number isn't stored");
  assert.equal(s.trackingUrl, undefined, "only https tracking links");
  assert.equal(s.estimatedDeliveryAt, undefined, "no ETA unless the provider gives one");
  assert.equal(s.status, "label_created");
});

// ─── Carrier events ──────────────────────────────────────────────────────────

test("carrier events move the shipment, the fulfilment and the order — by the carrier's own time", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { fulfillmentId, shipmentId } = await shipped(db, orderId);
  assert.equal((await ev(db, "SHP-1", "e1", "picked_up", T + 1 * H, { trackingNumber: "TRK12345", trackingUrl: "https://carrier.example/t/TRK12345", estimatedDeliveryAt: T + 5 * DAY })).outcome, "applied");
  assert.equal(row(db, orderId).fulfillmentStatus, "shipped");
  assert.equal(row(db, fulfillmentId).status, "shipped");
  await ev(db, "SHP-1", "e2", "arrived_at_facility", T + 20 * H);
  await ev(db, "SHP-1", "e3", "out_for_delivery", T + 40 * H);
  await ev(db, "SHP-1", "e4", "delivered", T + 44 * H);
  const s = row(db, shipmentId), o = row(db, orderId);
  assert.deepEqual([s.status, s.shippedAt, s.deliveredAt, s.trackingNumber], ["delivered", T + 1 * H, T + 44 * H, "TRK12345"]);
  assert.deepEqual([o.fulfillmentStatus, o.deliveredAt], ["delivered", T + 44 * H], "delivery = the carrier's time, not when we heard about it");
  assert.equal(row(db, fulfillmentId).status, "delivered");
  assert.equal(orderStage(o as never, T), "delivered");
  assert.equal(db.rows("bandOwnership").length, 0, "delivered ≠ owned (Phase 6G)");
});

test("duplicate events are harmless; out-of-order and post-delivery events never move state backwards", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { shipmentId } = await shipped(db, orderId);
  await ev(db, "SHP-1", "e1", "in_transit", T + 10 * H);
  assert.equal((await ev(db, "SHP-1", "e1", "in_transit", T + 10 * H)).outcome, "duplicate");
  assert.equal((await ev(db, "SHP-1", "e-del", "delivered", T + 48 * H)).outcome, "applied");
  assert.equal((await ev(db, "SHP-1", "e-del", "delivered", T + 48 * H)).outcome, "duplicate", "duplicate delivery webhook");
  assert.deepEqual(await ev(db, "SHP-1", "e-late", "out_for_delivery", T + 40 * H), { outcome: "after_terminal", reason: "delivered" }, "an older event after delivery");
  assert.deepEqual(await ev(db, "SHP-1", "e-late2", "exception", T + 60 * H), { outcome: "after_terminal", reason: "delivered" });
  assert.equal(row(db, shipmentId).status, "delivered");
  assert.equal(db.rows("commerceEvents").filter((e) => e.name === "shipment_delivered").length, 1, "one analytics event per real delivery");
  assert.equal(db.rows("commerceShipmentEvents").length, 4, "every distinct event recorded once, with its outcome");
});

test("stale events (older than what the shipment shows) are recorded, not applied", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { shipmentId } = await shipped(db, orderId);
  await ev(db, "SHP-1", "a", "out_for_delivery", T + 40 * H);
  assert.deepEqual(await ev(db, "SHP-1", "b", "in_transit", T + 20 * H), { outcome: "stale", reason: "older_than_current" });
  assert.equal(row(db, shipmentId).status, "out_for_delivery");
  // A genuinely newer re-routing event is applied (a failed attempt back to the depot).
  assert.equal((await ev(db, "SHP-1", "c", "in_transit", T + 45 * H)).outcome, "applied");
});

test("unknown statuses, unknown shipments and missing times are recorded and change nothing", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { shipmentId } = await shipped(db, orderId);
  assert.deepEqual(await ev(db, "SHP-1", "u1", "teleported", T + H), { outcome: "unknown_status", reason: "unmapped:teleported" });
  assert.equal((await ev(db, "SHP-404", "u2", "delivered", T + H)).outcome, "unknown_shipment");
  assert.equal((await ev(db, "SHP-1", "u3", "delivered", NaN)).outcome, "invalid");
  assert.deepEqual(await ev(db, "SHP-1", "u4", "in_transit", T + H).then(() => ev(db, "SHP-1", "u5", "cancelled", T + 2 * H)), { outcome: "invalid", reason: "cancel_after_pickup" });
  assert.equal(row(db, shipmentId).status, "in_transit");
});

test("a delivery exception shows as delivery_failed and recovers on a newer carrier event", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  await shipped(db, orderId);
  await ev(db, "SHP-1", "x1", "in_transit", T + H);
  await ev(db, "SHP-1", "x2", "exception", T + 30 * H);
  assert.equal(row(db, orderId).fulfillmentStatus, "delivery_failed");
  assert.equal(db.rows("commerceEvents").filter((e) => e.name === "delivery_exception").length, 1);
  await ev(db, "SHP-1", "x3", "out_for_delivery", T + 50 * H);
  assert.equal(row(db, orderId).fulfillmentStatus, "shipped");
});

test("one order, several packages: delivered only when every package is", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db, 2);
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-multi-pkg", kind: "original" }, C, T);
  await recordSubmission(db as never, fulfillmentId, { provider: "test-ship", providerRef: "FUL-M" }, T);
  for (const ref of ["PKG-A", "PKG-B"]) {
    await recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: `ship-${ref}-0001`, provider: "test-ship", created: { ok: true, providerRef: ref, carrier: "TestCarrier", service: "standard" } }, C, T);
  }
  await ev(db, "PKG-A", "a1", "delivered", T + 30 * H);
  assert.equal(row(db, orderId).fulfillmentStatus, "shipped", "one of two packages delivered");
  await ev(db, "PKG-B", "b1", "delivered", T + 50 * H);
  assert.deepEqual([row(db, orderId).fulfillmentStatus, row(db, orderId).deliveredAt], ["delivered", T + 50 * H]);
});

test("cancellation: a fulfilment only before the carrier has it; a paid order only before it ships", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "ful-cancel-01", kind: "original" }, C, T);
  assert.equal((await cancelPaidOrderBeforeShipment(db as never, orderId as never, T)).changed, true);
  assert.deepEqual([row(db, orderId).fulfillmentStatus, row(db, fulfillmentId).status, row(db, orderId).paymentStatus], ["cancelled", "cancelled", "paid"], "payment changes only through a verified refund");
  assert.ok(db.get(orderId as string), "orders are never deleted");
  const db2 = new MemoryDb();
  const { orderId: o2 } = await paidOrder(db2);
  const { fulfillmentId: f2 } = await shipped(db2, o2);
  await ev(db2, "SHP-1", "p1", "picked_up", T + H);
  await assert.rejects(cancelFulfillment(db2 as never, f2, "x", T), /carrier already has/);
  await assert.rejects(cancelPaidOrderBeforeShipment(db2 as never, o2 as never, T), /already shipped/);
});

test("replacements stand alone: they don't re-deliver the order, change payment, or create ownership", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const { fulfillmentId } = await shipped(db, orderId);
  await assert.rejects(createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "rep-too-early", kind: "replacement", replacesFulfillmentId: fulfillmentId }, C, T), /delivered or failed/);
  await ev(db, "SHP-1", "d", "delivered", T + 40 * H);
  const rep = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "rep-key-000001", kind: "replacement", replacesFulfillmentId: fulfillmentId }, C, T);
  assert.equal(row(db, rep.fulfillmentId).kind, "replacement");
  await assert.rejects(createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: "rep-key-000002", kind: "replacement", replacesFulfillmentId: fulfillmentId, lines: [{ productId: "sombrey_band", quantity: 2 }] }, C, T), /can't exceed/);
  assert.deepEqual([row(db, orderId).fulfillmentStatus, row(db, orderId).paymentStatus], ["delivered", "paid"]);
  assert.equal(db.rows("bandOwnership").length, 0);
});

// ─── Customer view & staff view ──────────────────────────────────────────────

test("customer tracking shows real state only: 'unavailable' without a tracking number, no invented ETA", () => {
  const paid = { paymentStatus: "paid" as const, fulfillmentStatus: "processing" as const };
  const none = customerTracking(paid, []);
  assert.deepEqual(none.steps.filter((s) => s.reached).map((s) => s.step), ["confirmed", "preparing"]);
  assert.deepEqual(none.shipments, []);
  const noNumber = customerTracking(paid, [{ status: "label_created", carrier: "C" }]);
  assert.deepEqual(noNumber.shipments, [{ tracking: "unavailable", status: "label_created" }]);
  const moving = customerTracking({ paymentStatus: "paid", fulfillmentStatus: "shipped" }, [{ status: "in_transit", carrier: "C", trackingNumber: "TRK1", shippedAt: T, lastEventAt: T }]);
  assert.deepEqual(moving.steps.filter((s) => s.reached).map((s) => s.step), ["confirmed", "preparing", "shipped", "in_transit"]);
  assert.equal((moving.shipments[0] as { estimatedDeliveryAt: number | null }).estimatedDeliveryAt, null, "no ETA unless the carrier gave one");
  const unpaid = customerTracking({ paymentStatus: "awaiting_payment", fulfillmentStatus: "unfulfilled" }, []);
  assert.ok(unpaid.steps.every((s) => !s.reached));
});

test("staff attention: exceptions, past the provider's ETA, and no carrier update for 72 hours", () => {
  const base = { status: "in_transit" as const, createdAt: T, lastEventAt: T };
  assert.equal(shipmentAttention(base, T + 10 * H, 72), null);
  assert.equal(shipmentAttention(base, T + 73 * H, 72), "stalled");
  assert.equal(shipmentAttention({ ...base, estimatedDeliveryAt: T + 5 * H }, T + 6 * H, 72), "overdue");
  assert.equal(shipmentAttention({ ...base, status: "exception" }, T, 72), "exception");
  assert.equal(shipmentAttention({ ...base, status: "delivered" }, T + 999 * H, 72), null);
});

test("staff roles follow the existing convention: fulfilment = owner/admin/store_manager, money = owner/admin", () => {
  const u = (roles: string[]) => ({ roles }) as never;
  assert.ok(staffMay(u(["owner"]), "money") && staffMay(u(["admin"]), "money"));
  assert.ok(staffMay(u(["store_manager"]), "fulfillment"));
  assert.ok(!staffMay(u(["store_manager"]), "money"), "a store manager can't approve refunds");
  for (const r of ["client", "coach", "assistant_coach"]) assert.ok(!staffMay(u([r]), "fulfillment"), r);
  assert.ok(!staffMay(null, "fulfillment") && !staffMay({ role: "client" } as never, "fulfillment"));
});

// ─── Returns & refunds ──────────────────────────────────────────────────────

async function delivered(db: MemoryDb, qty = 1) {
  const o = await paidOrder(db, qty);
  await shipped(db, o.orderId);
  await ev(db, "SHP-1", "dlv", "delivered", T + 2 * DAY);
  return o;
}
const ask = (db: MemoryDb, orderId: unknown, over: Record<string, unknown> = {}, user = ALICE, now = T + 5 * DAY) =>
  db.serial(() => requestReturn(db as never, user, { orderId: orderId as never, requestKey: "return-key-0001", reason: "changed_mind", attestUnused: true, ...over } as never, C, now));

test("return eligibility is computed on the server: delivered, within 30 days OF DELIVERY, unused, once", async () => {
  const db = new MemoryDb();
  const { orderId: notYet } = await paidOrder(db);
  assert.deepEqual(await returnOptions(db as never, ALICE, notYet as never, C, T), { eligible: false, reason: "not_delivered", windowEndsAt: null });
  const db2 = new MemoryDb();
  const { orderId } = await delivered(db2);
  const window = T + 2 * DAY + 30 * DAY;
  assert.deepEqual(await returnOptions(db2 as never, ALICE, orderId as never, C, T + 31 * DAY), { eligible: true, windowEndsAt: window }, "day 31 after purchase is still within 30 days of delivery");
  assert.deepEqual(await returnOptions(db2 as never, ALICE, orderId as never, C, window + 1), { eligible: false, reason: "outside_return_window", windowEndsAt: window });
  await assert.rejects(ask(db2, orderId, { attestUnused: false }), /condition_not_eligible/);
  await assert.rejects(ask(db2, orderId, { reason: "free_money" }), /Choose a reason/);
  const a = await ask(db2, orderId);
  const b = await ask(db2, orderId);
  assert.ok(a.created && !b.created && a.returnId === b.returnId, "double tap → the same return");
  await assert.rejects(ask(db2, orderId, { requestKey: "return-key-0002" }), /return_already_started/);
  await assert.rejects(ask(db2, orderId, {}, BOB), /not found/i, "nobody else can return my order");
  assert.equal(row(db2, orderId).returnStatus, "requested");
  assert.equal(orderStage(row(db2, orderId) as never, T), "return_requested");
});

test("the full return: authorize → in transit (carrier) → received + inspected → refund approved → verified refund", async () => {
  const db = new MemoryDb();
  const { orderId } = await delivered(db, 2);
  const { returnId } = await ask(db, orderId, { lines: [{ productId: "sombrey_band", quantity: 1 }] });
  await authorizeReturn(db as never, returnId, T);
  assert.equal(orderStage({ ...(row(db, orderId) as never), activeReturn: "authorized" }, T), "return_authorized");
  // A return label from the provider; the carrier picks it up.
  await recordShipment(db as never, { direction: "return", returnId, idempotencyKey: "ret-ship-0001", provider: "test-ship", created: { ok: true, providerRef: "RET-1", carrier: "TestCarrier", service: "return" } }, C, T);
  await ev(db, "RET-1", "r1", "picked_up", T + 6 * DAY);
  assert.equal(row(db, returnId).status, "in_transit");
  assert.equal(orderStage({ ...(row(db, orderId) as never), activeReturn: "in_transit" }, T), "return_in_transit");
  await assert.rejects(approveRefund(db as never, STAFF, returnId, T), /inspected/, "no refund before inspection");
  await receiveReturn(db as never, STAFF, returnId, "unused", C, T + 8 * DAY);
  const approved = await approveRefund(db as never, STAFF, returnId, T + 8 * DAY);
  assert.equal(approved.amountCents, 10000, "one Band at its snapshot price — shipping and tax refunds aren't decided (excluded)");
  assert.equal(row(db, orderId).paymentStatus, "paid", "approval isn't a refund");
  const refund = (eventId: string) => db.serial(() => applyVerifiedPayment(db as never, { orderId: orderId as never, provider: "test-pay", event: { eventId, providerRef: "pi_1", type: "partially_refunded", amountCents: 10000, currency: "USD" } }, C, T + 9 * DAY));
  assert.equal((await refund("rf-1")).outcome, "applied");
  assert.equal((await refund("rf-1")).outcome, "duplicate", "duplicate refund webhook");
  const o = row(db, orderId);
  assert.deepEqual([row(db, returnId).status, o.returnStatus, o.paymentStatus, o.refundedCents], ["refunded", "refunded", "partially_refunded", 10000]);
  assert.equal(db.rows("commerceEvents").filter((e) => e.name === "refund_completed").length, 1);
  assert.equal(db.rows("bandOwnership").length, 0);
});

test("refunds: server-computed, capped at what was captured, never for a used Band", async () => {
  assert.equal(refundAmountFor({ lines: [{ productId: "sombrey_band", productType: "physical", displayName: "B", unitPriceCents: 10000, quantity: 1, currency: "USD" }] }, [{ productId: "sombrey_band", quantity: 2 }]), null, "can't return more than was bought");
  const db = new MemoryDb();
  const { orderId } = await delivered(db);
  const { returnId } = await ask(db, orderId);
  await authorizeReturn(db as never, returnId, T);
  await receiveReturn(db as never, STAFF, returnId, "used", C, T + 8 * DAY);
  await assert.rejects(approveRefund(db as never, STAFF, returnId, T + 8 * DAY), /condition isn't covered/);
  await rejectReturn(db as never, STAFF, returnId, "not_unused", T + 8 * DAY);
  assert.deepEqual([row(db, returnId).status, row(db, orderId).returnStatus], ["rejected", "rejected"]);
  const db2 = new MemoryDb();
  const { orderId: o2, total } = await delivered(db2);
  const { returnId: r2 } = await ask(db2, o2);
  await authorizeReturn(db2 as never, r2, T);
  await receiveReturn(db2 as never, STAFF, r2, "unused", C, T + 8 * DAY);
  // The payment provider already refunded most of it some other way: the cap holds.
  await applyVerifiedPayment(db2 as never, { orderId: o2 as never, provider: "test-pay", event: { eventId: "other", providerRef: "pi_1", type: "partially_refunded", amountCents: total - 5000, currency: "USD" } }, C, T);
  await assert.rejects(approveRefund(db2 as never, STAFF, r2, T + 8 * DAY), /exceeds/);
});

test("a customer can cancel a return before the carrier has it — not someone else's, not after", async () => {
  const db = new MemoryDb();
  const { orderId } = await delivered(db);
  const { returnId } = await ask(db, orderId);
  await assert.rejects(cancelReturn(db as never, BOB, returnId, T), /not found/i);
  assert.equal((await cancelReturn(db as never, ALICE, returnId, T)).changed, true);
  assert.deepEqual([row(db, returnId).status, row(db, orderId).returnStatus], ["cancelled", "none"]);
  assert.equal((await returnOptions(db as never, ALICE, orderId as never, C, T + 5 * DAY)).eligible, true, "a cancelled return doesn't use up the option");
  const db2 = new MemoryDb();
  const { orderId: o2 } = await delivered(db2);
  const { returnId: r2 } = await ask(db2, o2);
  await authorizeReturn(db2 as never, r2, T);
  await receiveReturn(db2 as never, STAFF, r2, "unused", C, T);
  await assert.rejects(cancelReturn(db2 as never, ALICE, r2, T), /can't be cancelled/);
});

// ─── Security & privacy (source boundaries) ─────────────────────────────────

const src = (f: string) => readFileSync(join(import.meta.dirname, "../../convex/commerce", f), "utf8");

test("customers can't ship, deliver, authorize, refund or inject tracking: those inputs don't exist", () => {
  const api = src("orderTracking.ts");
  const fns = [...api.matchAll(/export const (\w+) = (mutation|query|action)\(/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(fns, ["cancelReturn:mutation", "orderTracking:query", "requestReturn:mutation", "returnOptions:query"]);
  const args = [...api.matchAll(/export const \w+ = (?:mutation|query)\(\{\s*args: \{([\s\S]*?)\},\n/g)].map((m) => m[1]).join(" ");
  assert.ok(!/eligible\b|amount|refund|tracking|deliveredAt|status|shipment|userId|condition\b/i.test(args), `customer args: ${args}`);
  for (const f of ["orderTracking.ts", "checkout.ts", "access.ts"]) {
    assert.ok(!/fulfillmentStore|createFulfillment|recordShipment|applyShipmentEvent|authorizeReturn|receiveReturn|approveRefund/.test(src(f)), `${f} reaches a staff/provider-only writer`);
  }
});

test("every staff function checks the caller's role first; money needs owner/admin", () => {
  const staff = src("staff.ts");
  const exported = [...staff.matchAll(/export const (\w+) = (query|mutation|action|internalQuery|internalMutation)\(\{[\s\S]*?handler: async \(ctx(?:, args)?\)(?:: [^=]+)? => \{?([\s\S]*?)(?=\n\}\);)/g)];
  assert.ok(exported.length >= 15, `found ${exported.length}`);
  for (const [, name, , body] of exported) {
    const check = name === "checkStaff" ? /requireStaff\(ctx, args\.level\)/ : /requireStaff\(ctx, "(fulfillment|money)"\)|checkStaff, \{ level: "(fulfillment|money)" \}/;
    assert.match(body, check, `${name} doesn't check staff`);
  }
  for (const name of ["cancelPaidOrder", "approveRefund", "issueRefund", "refundJob", "recordRefundRequested"]) {
    const body = staff.slice(staff.indexOf(`export const ${name} =`));
    assert.match(body.slice(0, 400), /"money"/, `${name} must need owner/admin`);
  }
});

test("no PII in analytics, nothing logged, no invented provider", async () => {
  const db = new MemoryDb();
  const { orderId } = await delivered(db);
  const { returnId } = await ask(db, orderId);
  await authorizeReturn(db as never, returnId, T);
  await receiveReturn(db as never, STAFF, returnId, "unused", C, T + 3 * DAY);
  await ev(db, "SHP-1", "late", "in_transit", T + 99 * DAY);
  const names = new Set(db.rows("commerceEvents").map((e) => e.name));
  for (const n of ["fulfillment_created", "shipment_created", "shipment_delivered", "return_requested", "return_received"]) assert.ok(names.has(n), n);
  for (const e of db.rows("commerceEvents")) {
    assert.ok(!/Test Street|Colombo|00100|A Customer|TRK|SHP-|carrier/i.test(JSON.stringify(e)), `${e.name} carries PII or tracking data`);
  }
  for (const f of ["fulfillment.ts", "fulfillmentStore.ts", "returnsStore.ts", "staff.ts", "orderTracking.ts", "staffAccess.ts"]) {
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src(f)), `${f} logs`);
  }
  assert.ok(!/dhl|fedex|ups\b|aramex|shippo|easyship|shipstation|sendcloud/i.test(src("providers.ts") + src("staff.ts")), "no carrier is hard-wired");
});
