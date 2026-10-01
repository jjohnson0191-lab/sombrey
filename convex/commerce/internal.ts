// Sombrey commerce (Phase 6A) — TRUSTED state changes. Internal functions only:
// callable by other backend code (a verified payment-provider webhook, the
// App Store server-notification handler, an owner tool) — never by a client.
// Phase 6C calls the subscription ones from commerce/appStore.ts after Apple's
// signatures are verified; 6E's applyPaymentUpdate and 6F's applyShipmentEvent
// are called only after a provider verified its webhook (none is integrated
// yet). Staff fulfilment/return actions are role-checked in commerce/staff.ts. Each one enforces the domain's transition rules, so even
// trusted code can't mark an unpaid order delivered or re-price an order.

import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { COMMERCE_CONFIG } from "./config";
import { applyVerifiedPayment, createOrderRecord } from "./checkoutStore";
import { applyShipmentEvent as applyShipmentEventRecord } from "./fulfillmentStore";
import { OWNED_STATUSES, transitionOwnership } from "./ownership";
import { applyNotification, linkAccountToken, writeVerifiedSubscription, type StoreConfig } from "./subscriptionStore";
import { shippingAddress, subscriptionHistoryEvent as historyEvent, subscriptionStatus } from "./validators";

/** A priced order for a user, awaiting payment — for trusted flows (staff,
 * support). Customers use commerce/checkout:startBandCheckout. Both go through
 * the same writer (checkoutStore.ts); prices come from the config, never the caller. */
export const createOrder = internalMutation({
  args: {
    userId: v.id("users"),
    items: v.array(v.object({ productId: v.string(), quantity: v.number() })),
    shippingAddress,
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    const r = await createOrderRecord(ctx.db, { userId: user._id, items: args.items, shippingAddress: args.shippingAddress }, COMMERCE_CONFIG, Date.now(), Math.random);
    return { orderId: r.orderId, orderNumber: r.orderNumber };
  },
});

/** A VERIFIED payment-provider event (Phase 6E) — called only after the
 * provider's PaymentProvider.verifyWebhook accepted the signature. Applied once
 * per provider event id; the amount must equal the frozen quoted total; the 6A
 * payment transition table decides what may change. Paying does NOT create Band
 * ownership (Phase 6G — order ≠ ownership ≠ pairing). */
export const applyPaymentUpdate = internalMutation({
  args: {
    orderId: v.id("commerceOrders"),
    provider: v.string(),
    event: v.object({ eventId: v.string(), providerRef: v.string(), type: v.string(), amountCents: v.number(), currency: v.string() }),
  },
  handler: async (ctx, args) => applyVerifiedPayment(ctx.db, args, COMMERCE_CONFIG, Date.now()),
});

/** A VERIFIED carrier event (Phase 6F) — called only after the fulfilment
 * provider's verifyWebhook accepted the signature (or from its getTracking
 * during recovery). Applied once per (provider, event id), by the carrier's own
 * timestamps; stale and post-delivery events are recorded, never applied.
 * Shipping or delivering never creates Band ownership (Phase 6G). */
export const applyShipmentEvent = internalMutation({
  args: {
    provider: v.string(),
    event: v.object({
      eventId: v.string(), providerRef: v.string(), type: v.string(), providerStatus: v.string(), occurredAt: v.number(),
      trackingNumber: v.optional(v.string()), trackingUrl: v.optional(v.string()), estimatedDeliveryAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => applyShipmentEventRecord(ctx.db, args, COMMERCE_CONFIG, Date.now()),
});

/** An audited Band ownership grant (Phase 6D) — a replacement, a tester, or a
 * Band paired before commerce existed ("legacy_pairing"). Run by staff from the
 * Convex dashboard/CLI after checking the Band is genuinely the user's; never
 * reachable from the app (a Bluetooth pairing is not proof of ownership).
 * Idempotent: an existing owned grant of the same source is returned. */
export const grantBandOwnership = internalMutation({
  args: { userId: v.id("users"), source: v.union(v.literal("staff_grant"), v.literal("legacy_pairing")) },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    const existing = (await ctx.db.query("bandOwnership").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect())
      .find((r) => r.source === args.source && OWNED_STATUSES.includes(r.status));
    if (existing) return { ownershipId: existing._id, created: false };
    const now = Date.now();
    const ownershipId = await ctx.db.insert("bandOwnership", {
      userId: args.userId, source: args.source, status: "delivered",
      history: [{ status: "delivered", at: now, by: "staff" }], createdAt: now, updatedAt: now,
    });
    return { ownershipId, created: true };
  },
});

/** Ends a staff/legacy grant (e.g. a Band returned outside an order). History is kept. */
export const revokeBandOwnership = internalMutation({
  args: { ownershipId: v.id("bandOwnership") },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.ownershipId);
    if (!r) throw new ConvexError({ code: "NOT_FOUND", message: "Ownership record not found" });
    if (r.source === "order") throw new ConvexError({ code: "INVALID", message: "Order ownership changes through the order's return flow" });
    const t = transitionOwnership(r, "returned", Date.now(), "staff");
    if (!t.ok) throw new ConvexError({ code: "INVALID", message: t.error });
    await ctx.db.patch(r._id, { status: t.record.status, history: t.record.history, updatedAt: Date.now() });
    return { changed: true };
  },
});

const verifiedUpdate = v.object({
  provider: v.literal("app_store"),
  environment: v.union(v.literal("production"), v.literal("sandbox")),
  appStoreProductId: v.string(),
  originalTransactionId: v.string(),
  latestTransactionId: v.string(),
  status: subscriptionStatus,
  autoRenewEnabled: v.boolean(),
  purchaseDate: v.number(),
  expiresDate: v.union(v.number(), v.null()),
  signedDate: v.number(),
  revocationDate: v.optional(v.number()),
  gracePeriodExpiresDate: v.optional(v.number()),
  appAccountToken: v.optional(v.string()),
  verification: v.object({ method: v.string(), verifiedAt: v.number() }),
});

function storeConfig(): StoreConfig {
  const m = COMMERCE_CONFIG.products.membership;
  return { membershipProductId: m.id, appStoreProductIds: m.appStoreProductId ? [m.appStoreProductId] : [], configVersion: COMMERCE_CONFIG.version };
}

/** A VERIFIED App Store subscription update — Phase 6C: from an app submission
 * that commerce/appStore.ts verified with Apple (signature, bundle, product,
 * environment, account token, and current status from the App Store Server API). */
export const applyVerifiedSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    update: verifiedUpdate,
    event: v.optional(historyEvent),
  },
  handler: async (ctx, args) => {
    const w = await writeVerifiedSubscription(ctx.db, { userId: args.userId, update: args.update, event: args.event ?? "verified_with_apple", source: { kind: "app_submission" } }, storeConfig(), Date.now());
    return { changed: w.result === "created" || w.result === "updated", result: w.result };
  },
});

/** A VERIFIED App Store Server Notification (commerce/appStore.ts
 * processNotification): recorded once by notificationUUID and applied in the
 * same transaction — duplicate deliveries change nothing. */
export const applyAppStoreNotification = internalMutation({
  args: {
    notification: v.object({
      notificationUUID: v.string(),
      notificationType: v.string(),
      subtype: v.optional(v.string()),
      environment: v.union(v.literal("production"), v.literal("sandbox")),
      signedDate: v.number(),
    }),
    apply: v.optional(v.object({ update: verifiedUpdate, event: historyEvent })),
    skipped: v.optional(v.object({ outcome: v.union(v.literal("ignored"), v.literal("rejected")), reason: v.string(), originalTransactionId: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => applyNotification(ctx.db, args, storeConfig(), Date.now()),
});

/** Links the server-derived appAccountToken to its account and takes one
 * submission from the account's hourly budget (commerce/appStore.ts, after
 * authenticating the caller). */
export const reserveAppStoreSubmission = internalMutation({
  args: { userId: v.id("users"), appAccountToken: v.string() },
  handler: async (ctx, args) => linkAccountToken(ctx.db, args.userId, args.appAccountToken, Date.now(), { countSubmission: true }),
});
