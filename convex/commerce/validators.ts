// Commerce (Phase 6A) row validators, shared by convex/schema.ts and the
// commerce functions so the stored and accepted shapes can't drift.
import { v } from "convex/values";

export const paymentStatus = v.union(
  v.literal("awaiting_payment"), v.literal("authorized"), v.literal("paid"), v.literal("failed"),
  v.literal("cancelled"), v.literal("refunded"), v.literal("partially_refunded"),
);
export const fulfillmentStatus = v.union(
  v.literal("unfulfilled"), v.literal("processing"), v.literal("shipped"), v.literal("delivered"),
  v.literal("delivery_failed"), v.literal("cancelled"),
);
export const returnStatus = v.union(
  v.literal("none"), v.literal("requested"), v.literal("approved"), v.literal("rejected"), v.literal("received"), v.literal("refunded"),
);
export const orderLine = v.object({
  productId: v.string(),
  productType: v.literal("physical"),
  displayName: v.string(),
  unitPriceCents: v.number(),   // snapshot at order time
  quantity: v.number(),
  currency: v.string(),
});
export const shippingAddress = v.object({
  fullName: v.string(),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  countryCode: v.string(),      // ISO 3166-1 alpha-2
  phone: v.optional(v.string()),
});
export const shipment = v.object({
  carrier: v.string(),
  trackingNumber: v.string(),
  trackingUrl: v.optional(v.string()),
  status: v.union(v.literal("label_created"), v.literal("in_transit"), v.literal("out_for_delivery"), v.literal("delivered"), v.literal("exception")),
  shippedAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  updatedAt: v.number(),
});
export const subscriptionStatus = v.union(
  v.literal("active"), v.literal("in_grace_period"), v.literal("in_billing_retry"),
  v.literal("expired"), v.literal("revoked"), v.literal("refunded"),
);
export const ownershipStatus = v.union(
  v.literal("purchased"), v.literal("processing"), v.literal("shipped"), v.literal("delivered"),
  v.literal("activated"), v.literal("connected"), v.literal("disconnected"), v.literal("returned"), v.literal("cancelled"),
);
export const commerceEventName = v.union(
  v.literal("product_viewed"), v.literal("band_purchase_initiated"), v.literal("band_checkout_abandoned"),
  v.literal("subscription_purchase_initiated"), v.literal("subscription_checkout_abandoned"), v.literal("feature_access_denied"), v.literal("band_checkout_completed"), v.literal("band_order_completed"),
  v.literal("band_returned"), v.literal("subscription_activated"), v.literal("subscription_renewed"),
  v.literal("subscription_cancelled"), v.literal("subscription_expired"),
  v.literal("band_quote_requested"), v.literal("band_payment_started"),
  v.literal("fulfillment_created"), v.literal("shipment_created"), v.literal("shipment_delivered"), v.literal("delivery_exception"),
  v.literal("return_requested"), v.literal("return_received"), v.literal("refund_completed"),
);
// Phase 6C: what a subscription history row records (appStoreRules.ts HISTORY_EVENTS).
export const subscriptionHistoryEvent = v.union(
  v.literal("purchased"), v.literal("resubscribed"), v.literal("renewed"), v.literal("billing_recovered"),
  v.literal("auto_renew_enabled"), v.literal("auto_renew_disabled"), v.literal("renewal_preference_changed"),
  v.literal("billing_retry"), v.literal("grace_period"), v.literal("grace_period_expired"), v.literal("expired"),
  v.literal("refunded"), v.literal("refund_reversed"), v.literal("revoked"), v.literal("renewal_extended"),
  v.literal("offer_redeemed"), v.literal("verified_with_apple"),
);

// Phase 6E: a shipping+tax quote, as stored on an order (providers never invent values).
const unavailableReason = v.union(
  v.literal("provider_not_configured"), v.literal("no_service_to_destination"), v.literal("provider_error"), v.literal("invalid_request"),
  v.literal("currency_mismatch"), v.literal("invalid_amount"), v.literal("awaiting_shipping_quote"),
);
const componentQuote = v.union(
  v.object({ status: v.literal("quoted"), amountCents: v.number(), provider: v.string(), reference: v.string(), detail: v.string() }),
  v.object({ status: v.literal("unavailable"), reason: unavailableReason }),
);
export const orderQuote = v.object({
  quoteId: v.string(),
  complete: v.boolean(),
  subtotalCents: v.number(),
  shipping: componentQuote,
  tax: componentQuote,
  totalCents: v.union(v.number(), v.null()),
  currency: v.string(),
  configVersion: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
});
// Phase 6E: the one payment attempt an order may have open (idempotent per quote).
export const paymentAttempt = v.object({
  provider: v.string(),
  idempotencyKey: v.string(),          // server-derived: order + quote
  quoteId: v.string(),
  amountCents: v.number(),             // the quote's total, frozen
  currency: v.string(),
  providerRef: v.optional(v.string()), // the provider's session/payment id
  startedAt: v.number(),
});

// Phase 6F: fulfilment, shipments, returns (fulfillment.ts holds the rules).
const lit = <T extends string>(xs: readonly T[]) => v.union(...(xs.map((x) => v.literal(x)) as [ReturnType<typeof v.literal<T>>, ReturnType<typeof v.literal<T>>, ...ReturnType<typeof v.literal<T>>[]]));
export const fulfillmentRecordStatus = lit(["pending", "submitted", "shipped", "delivered", "failed", "cancelled"] as const);
export const shipmentStatus = lit(["label_created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception", "returned_to_sender", "cancelled"] as const);
export const returnRecordStatus = lit(["requested", "authorized", "in_transit", "received", "refund_approved", "refunded", "rejected", "cancelled"] as const);
export const returnReason = lit(["changed_mind", "not_as_expected", "fit_or_comfort", "arrived_damaged", "other"] as const);
export const inspectionCondition = lit(["unused", "used", "damaged", "incomplete"] as const);
export const fulfillmentLine = v.object({ productId: v.string(), quantity: v.number() });
