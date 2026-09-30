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
  v.literal("subscription_purchase_initiated"), v.literal("subscription_checkout_abandoned"), v.literal("band_checkout_completed"), v.literal("band_order_completed"),
  v.literal("band_returned"), v.literal("subscription_activated"), v.literal("subscription_renewed"),
  v.literal("subscription_cancelled"), v.literal("subscription_expired"),
);
// Phase 6C: what a subscription history row records (appStoreRules.ts HISTORY_EVENTS).
export const subscriptionHistoryEvent = v.union(
  v.literal("purchased"), v.literal("resubscribed"), v.literal("renewed"), v.literal("billing_recovered"),
  v.literal("auto_renew_enabled"), v.literal("auto_renew_disabled"), v.literal("renewal_preference_changed"),
  v.literal("billing_retry"), v.literal("grace_period"), v.literal("grace_period_expired"), v.literal("expired"),
  v.literal("refunded"), v.literal("refund_reversed"), v.literal("revoked"), v.literal("renewal_extended"),
  v.literal("offer_redeemed"), v.literal("verified_with_apple"),
);
