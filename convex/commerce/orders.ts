// Sombrey commerce — Phase 6A: the physical-order domain (pure rules).
//
// An order SNAPSHOTS everything that could later change: the product's name
// and price, the currency and the config version it was created under. A
// Band that launches at $100 and later sells for $89 leaves every $100 order
// a $100 order. Shipping and tax are unknown until a provider quotes them
// (no rate is invented), so the total stays null until both are known.
//
// State is three independent machines — payment, fulfillment, return — each
// with an explicit transition table. Only trusted backend/provider flows
// move them (internal mutations and 6E's checkout store — never a client flag).
//
// Pure — tested in tests/commerce/orders.test.ts.

import { isSupportedCountry, physicalProduct, type CommerceConfig } from "./config.ts";

export type PaymentStatus = "awaiting_payment" | "authorized" | "paid" | "failed" | "cancelled" | "refunded" | "partially_refunded";
export type FulfillmentStatus = "unfulfilled" | "processing" | "shipped" | "delivered" | "delivery_failed" | "cancelled";
export type ReturnStatus = "none" | "requested" | "approved" | "rejected" | "received" | "refunded";

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  awaiting_payment: ["authorized", "paid", "failed", "cancelled"],
  authorized: ["paid", "failed", "cancelled"],
  paid: ["refunded", "partially_refunded"],
  partially_refunded: ["refunded"],
  // 6E: a provider may report a failed charge and later the same payment as
  // paid (a retry) — a VERIFIED "paid" after "failed" is recorded.
  failed: ["awaiting_payment", "paid", "cancelled"],
  cancelled: [],
  refunded: [],
};

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  unfulfilled: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "delivery_failed"],
  delivery_failed: ["shipped", "cancelled"],
  delivered: [],
  cancelled: [],
};

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  none: ["requested"],
  // 6F: "none" again = the customer cancelled a return before it was received
  // (the return record keeps that history); a received item that fails
  // inspection is rejected.
  requested: ["approved", "rejected", "none"],
  approved: ["received", "rejected", "none"],
  received: ["refunded", "rejected"],
  rejected: [],
  refunded: [],
};

export function canTransition<S extends string>(table: Record<S, S[]>, from: S, to: S): boolean {
  return (table[from] ?? []).includes(to);
}

export type OrderLine = {
  productId: string;
  productType: "physical";
  displayName: string;
  unitPriceCents: number;
  quantity: number;
  currency: string;
};

export type ShippingAddress = {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  phone?: string;
};

export type OrderDraft = {
  configVersion: string;
  currency: string;
  lines: OrderLine[];
  subtotalCents: number;
  /** Unknown until quoted by the chosen provider/carrier — never invented. */
  shippingCents: null;
  taxCents: null;
  totalCents: null;
  shippingAddress: ShippingAddress;
  paymentStatus: "awaiting_payment";
  fulfillmentStatus: "unfulfilled";
  returnStatus: "none";
};

const text = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max;

export function validateAddress(a: ShippingAddress, config: CommerceConfig): string | null {
  if (!text(a.fullName, 120) || !text(a.line1, 200) || !text(a.city, 100)) return "Incomplete shipping address";
  for (const [v, max] of [[a.line2, 200], [a.region, 100], [a.postalCode, 20], [a.phone, 30]] as const) {
    if (v !== undefined && (typeof v !== "string" || v.length > max)) return "Invalid shipping address";
  }
  if (!isSupportedCountry(config, a.countryCode)) return "We don't ship to that country yet";
  return null;
}

/** A priced snapshot of a would-be order, or the reason it can't be placed.
 * Prices come from the config — never from the client. */
export function buildOrderDraft(config: CommerceConfig, request: { items: Array<{ productId: string; quantity: number }>; shippingAddress: ShippingAddress }):
  { ok: true; draft: OrderDraft } | { ok: false; error: string } {
  if (!request.items.length) return { ok: false, error: "An order needs at least one item" };
  const lines: OrderLine[] = [];
  const seen = new Set<string>();
  for (const item of request.items) {
    if (seen.has(item.productId)) return { ok: false, error: "Duplicate product in order" };
    seen.add(item.productId);
    if (item.productId === config.products.membership.id) return { ok: false, error: "Subscriptions are purchased through the App Store, not in a physical order" };
    // 6I: any configured physical product (the Band today; future hardware is config).
    const p = physicalProduct(config, item.productId);
    if (!p) return { ok: false, error: "Unknown product" };
    if (!p.active) return { ok: false, error: "That product isn't available" };
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > p.maxQuantityPerOrder) return { ok: false, error: `Quantity must be 1–${p.maxQuantityPerOrder}` };
    if (p.currency !== config.currency) return { ok: false, error: "That product isn't sold in the store currency" };
    lines.push({ productId: p.id, productType: "physical", displayName: p.displayName, unitPriceCents: p.priceCents, quantity: item.quantity, currency: p.currency });
  }
  const addressProblem = validateAddress(request.shippingAddress, config);
  if (addressProblem) return { ok: false, error: addressProblem };
  return {
    ok: true,
    draft: {
      configVersion: config.version,
      currency: config.currency,
      lines,
      subtotalCents: lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0),
      shippingCents: null, taxCents: null, totalCents: null,
      shippingAddress: request.shippingAddress,
      paymentStatus: "awaiting_payment", fulfillmentStatus: "unfulfilled", returnStatus: "none",
    },
  };
}

/** The total once shipping and tax have been quoted; null while either is unknown. */
export function orderTotal(subtotalCents: number, shippingCents: number | null, taxCents: number | null): number | null {
  if (shippingCents === null || taxCents === null) return null;
  if (![subtotalCents, shippingCents, taxCents].every((x) => Number.isInteger(x) && x >= 0)) return null;
  return subtotalCents + shippingCents + taxCents;
}

/** Whether a delivered order may be returned now, under the config it was
 * SOLD under (the policy snapshot), and the stated condition. */
export function returnEligibility(order: { deliveredAt?: number; fulfillmentStatus: FulfillmentStatus; paymentStatus: PaymentStatus; returnStatus: ReturnStatus },
  policy: { windowDays: number; eligibleConditions: string[] }, condition: string, now: number): { ok: true } | { ok: false; reason: string } {
  if (order.paymentStatus !== "paid") return { ok: false, reason: "not_paid" };
  if (order.fulfillmentStatus !== "delivered" || order.deliveredAt === undefined) return { ok: false, reason: "not_delivered" };
  if (order.returnStatus !== "none") return { ok: false, reason: "return_already_started" };
  if (now - order.deliveredAt > policy.windowDays * 86_400_000) return { ok: false, reason: "outside_return_window" };
  if (!policy.eligibleConditions.includes(condition)) return { ok: false, reason: "condition_not_eligible" };
  return { ok: true };
}

/** Order numbers people can read out: "SB-" + 8 unambiguous characters. */
export function formatOrderNumber(random: () => number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "SB-";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return s;
}
