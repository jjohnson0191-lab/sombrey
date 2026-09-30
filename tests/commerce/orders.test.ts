// Sombrey commerce, Phase 6A — physical orders (convex/commerce/orders.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMERCE_CONFIG, type CommerceConfig } from "../../convex/commerce/config.ts";
import {
  FULFILLMENT_TRANSITIONS, PAYMENT_TRANSITIONS, RETURN_TRANSITIONS, buildOrderDraft, canTransition, formatOrderNumber, orderTotal, returnEligibility,
  type ShippingAddress,
} from "../../convex/commerce/orders.ts";

const address = (over: Partial<ShippingAddress> = {}): ShippingAddress => ({ fullName: "A Customer", line1: "1 Test Street", city: "Colombo", countryCode: "LK", ...over });
const DAY = 86_400_000;

test("a draft is priced from the config, never from the caller", () => {
  const r = buildOrderDraft(COMMERCE_CONFIG, { items: [{ productId: "sombrey_band", quantity: 2 }], shippingAddress: address() });
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.draft.lines, [{ productId: "sombrey_band", productType: "physical", displayName: "Sombrey Band", unitPriceCents: 10000, quantity: 2, currency: "USD" }]);
    assert.equal(r.draft.subtotalCents, 20000);
    assert.deepEqual([r.draft.shippingCents, r.draft.taxCents, r.draft.totalCents], [null, null, null], "no invented shipping or tax");
    assert.equal(r.draft.configVersion, COMMERCE_CONFIG.version);
    assert.deepEqual([r.draft.paymentStatus, r.draft.fulfillmentStatus, r.draft.returnStatus], ["awaiting_payment", "unfulfilled", "none"]);
  }
  // A client-supplied price field is simply not part of the request type — and ignored if smuggled in.
  const smuggled = buildOrderDraft(COMMERCE_CONFIG, { items: [{ productId: "sombrey_band", quantity: 1, unitPriceCents: 1 } as never], shippingAddress: address() });
  assert.ok(smuggled.ok && smuggled.draft.lines[0].unitPriceCents === 10000);
});

test("historical orders keep their price when the Band's price changes ($100 → $89)", () => {
  const before = buildOrderDraft(COMMERCE_CONFIG, { items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address() });
  const later: CommerceConfig = structuredClone(COMMERCE_CONFIG);
  later.version = "2027-01-provisional.2";
  later.products.band.priceCents = 8900;
  const after = buildOrderDraft(later, { items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address() });
  assert.ok(before.ok && after.ok);
  if (before.ok && after.ok) {
    assert.equal(before.draft.lines[0].unitPriceCents, 10000, "the old order is still a $100 order");
    assert.equal(after.draft.lines[0].unitPriceCents, 8900);
    assert.notEqual(before.draft.configVersion, after.draft.configVersion);
  }
});

test("unsupported countries and bad requests are refused", () => {
  const bad: Array<[Parameters<typeof buildOrderDraft>[1], RegExp]> = [
    [{ items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address({ countryCode: "FR" }) }, /don't ship/],
    [{ items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address({ countryCode: "UK" }) }, /don't ship/],
    [{ items: [{ productId: "sombrey_membership_monthly", quantity: 1 }], shippingAddress: address() }, /App Store/],
    [{ items: [{ productId: "mystery", quantity: 1 }], shippingAddress: address() }, /Unknown product/],
    [{ items: [{ productId: "sombrey_band", quantity: 0 }], shippingAddress: address() }, /Quantity/],
    [{ items: [{ productId: "sombrey_band", quantity: 6 }], shippingAddress: address() }, /Quantity/],
    [{ items: [{ productId: "sombrey_band", quantity: 1.5 }], shippingAddress: address() }, /Quantity/],
    [{ items: [], shippingAddress: address() }, /at least one/],
    [{ items: [{ productId: "sombrey_band", quantity: 1 }, { productId: "sombrey_band", quantity: 1 }], shippingAddress: address() }, /Duplicate/],
    [{ items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address({ line1: "" }) }, /Incomplete/],
  ];
  for (const [req, why] of bad) {
    const r = buildOrderDraft(COMMERCE_CONFIG, req);
    assert.ok(!r.ok && why.test(r.error), `${JSON.stringify(req.items)} ${req.shippingAddress.countryCode} → ${JSON.stringify(r)}`);
  }
  const inactive = structuredClone(COMMERCE_CONFIG); inactive.products.band.active = false;
  assert.ok(!buildOrderDraft(inactive, { items: [{ productId: "sombrey_band", quantity: 1 }], shippingAddress: address() }).ok);
});

test("the total exists only once shipping and tax are both known", () => {
  assert.equal(orderTotal(10000, null, null), null);
  assert.equal(orderTotal(10000, 1500, null), null);
  assert.equal(orderTotal(10000, 1500, 830), 12330);
  assert.equal(orderTotal(10000, -1, 0), null);
  assert.equal(orderTotal(10000, 1.5, 0), null);
});

test("state machines: no skipping payment, no un-delivering, no un-refunding", () => {
  assert.ok(canTransition(PAYMENT_TRANSITIONS, "awaiting_payment", "paid"));
  assert.ok(!canTransition(PAYMENT_TRANSITIONS, "refunded", "paid"));
  assert.ok(!canTransition(PAYMENT_TRANSITIONS, "cancelled", "paid"));
  assert.ok(canTransition(FULFILLMENT_TRANSITIONS, "processing", "shipped"));
  assert.ok(!canTransition(FULFILLMENT_TRANSITIONS, "unfulfilled", "delivered"), "can't be delivered without shipping");
  assert.ok(!canTransition(FULFILLMENT_TRANSITIONS, "delivered", "processing"));
  assert.ok(canTransition(RETURN_TRANSITIONS, "none", "requested"));
  assert.ok(!canTransition(RETURN_TRANSITIONS, "none", "refunded"), "no refund without a received return");
});

test("returns: 30 days after delivery, unused only, under the policy the order was sold under", () => {
  const policy = { windowDays: 30, eligibleConditions: ["unused"] };
  const delivered = { deliveredAt: 0, fulfillmentStatus: "delivered" as const, paymentStatus: "paid" as const, returnStatus: "none" as const };
  assert.deepEqual(returnEligibility(delivered, policy, "unused", 29 * DAY), { ok: true });
  assert.deepEqual(returnEligibility(delivered, policy, "unused", 31 * DAY), { ok: false, reason: "outside_return_window" });
  assert.deepEqual(returnEligibility(delivered, policy, "used", DAY), { ok: false, reason: "condition_not_eligible" });
  assert.deepEqual(returnEligibility({ ...delivered, fulfillmentStatus: "shipped", deliveredAt: undefined }, policy, "unused", DAY), { ok: false, reason: "not_delivered" });
  assert.deepEqual(returnEligibility({ ...delivered, paymentStatus: "awaiting_payment" }, policy, "unused", DAY), { ok: false, reason: "not_paid" });
  assert.deepEqual(returnEligibility({ ...delivered, returnStatus: "requested" }, policy, "unused", DAY), { ok: false, reason: "return_already_started" });
  assert.deepEqual(returnEligibility(delivered, { windowDays: 45, eligibleConditions: ["unused"] }, "unused", 40 * DAY), { ok: true }, "a later policy change doesn't alter an old order's snapshot — and vice versa");
});

test("order numbers are readable and unambiguous", () => {
  let i = 0;
  const n = formatOrderNumber(() => (i++ % 10) / 10);
  assert.match(n, /^SB-[A-HJ-NP-Z2-9]{8}$/);
});
