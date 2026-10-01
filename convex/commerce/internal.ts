// Sombrey commerce (Phase 6A) — TRUSTED state changes. Internal functions only:
// callable by other backend code (a verified payment-provider webhook, the
// App Store server-notification handler, an owner tool) — never by a client.
// Phase 6C calls the subscription ones from commerce/appStore.ts after Apple's
// signatures are verified; 6E's applyPaymentUpdate is called only after a
// payment provider verified its webhook (no provider is integrated yet);
// fulfilment (6F) and activation (6G) will call the rest. Each one enforces the domain's transition rules, so even
// trusted code can't mark an unpaid order delivered or re-price an order.

import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { COMMERCE_CONFIG } from "./config";
import { FULFILLMENT_TRANSITIONS, RETURN_TRANSITIONS, canTransition, returnEligibility } from "./orders";
import { applyVerifiedPayment, createOrderRecord } from "./checkoutStore";
import { OWNED_STATUSES, transitionOwnership, type OwnershipStatus } from "./ownership";
import { validateEvent, type CommerceEventName } from "./events";
import { applyNotification, linkAccountToken, writeVerifiedSubscription, type StoreConfig } from "./subscriptionStore";
import { fulfillmentStatus, returnStatus, shipment, shippingAddress, subscriptionHistoryEvent as historyEvent, subscriptionStatus } from "./validators";

async function serverEvent(ctx: MutationCtx, name: CommerceEventName, userId: Id<"users">, extra: { productId?: string; countryCode?: string; amountCents?: number; currency?: string; orderId?: Id<"commerceOrders"> } = {}) {
  const { orderId, ...rest } = extra;
  const problem = validateEvent({ name, platform: "backend", ...rest }, "server", [COMMERCE_CONFIG.products.band.id, COMMERCE_CONFIG.products.membership.id]);
  if (problem) throw new ConvexError({ code: "INVALID", message: problem });
  await ctx.db.insert("commerceEvents", { name, userId, at: Date.now(), origin: "server", platform: "backend", ...rest, ...(orderId ? { orderId } : {}), configVersion: COMMERCE_CONFIG.version });
}

async function getOrder(ctx: MutationCtx, orderId: Id<"commerceOrders">): Promise<Doc<"commerceOrders">> {
  const o = await ctx.db.get(orderId);
  if (!o) throw new ConvexError({ code: "NOT_FOUND", message: "Order not found" });
  return o;
}

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

async function moveOwnershipForOrder(ctx: MutationCtx, orderId: Id<"commerceOrders">, to: OwnershipStatus, by: "system" | "provider" | "staff") {
  const now = Date.now();
  for (const r of await ctx.db.query("bandOwnership").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()) {
    const t = transitionOwnership(r, to, now, by);
    if (t.ok) await ctx.db.patch(r._id, { status: t.record.status, history: t.record.history, updatedAt: now });
  }
}

/** Fulfilment progress (from the fulfilment/carrier flow). */
export const updateFulfillment = internalMutation({
  args: { orderId: v.id("commerceOrders"), to: fulfillmentStatus, shipment: v.optional(shipment) },
  handler: async (ctx, args) => {
    const o = await getOrder(ctx, args.orderId);
    if (o.fulfillmentStatus === args.to && !args.shipment) return { changed: false };
    if (o.fulfillmentStatus !== args.to && !canTransition(FULFILLMENT_TRANSITIONS, o.fulfillmentStatus, args.to)) {
      throw new ConvexError({ code: "INVALID", message: `Fulfilment can't go from ${o.fulfillmentStatus} to ${args.to}` });
    }
    if (args.to !== "cancelled" && args.to !== "unfulfilled" && o.paymentStatus !== "paid") throw new ConvexError({ code: "INVALID", message: "Unpaid orders aren't fulfilled" });
    const now = Date.now();
    const shipments = args.shipment ? [...o.shipments.filter((s) => s.trackingNumber !== args.shipment!.trackingNumber), args.shipment] : o.shipments;
    await ctx.db.patch(o._id, { fulfillmentStatus: args.to, shipments, updatedAt: now, ...(args.to === "delivered" ? { deliveredAt: now } : {}) });
    const ownershipStep: Partial<Record<string, OwnershipStatus>> = { processing: "processing", shipped: "shipped", delivered: "delivered", cancelled: "cancelled" };
    const step = ownershipStep[args.to];
    if (step) await moveOwnershipForOrder(ctx, o._id, step, "provider");
    if (args.to === "delivered") await serverEvent(ctx, "band_order_completed", o.userId, { productId: o.lines[0]?.productId, countryCode: o.shippingAddress.countryCode, orderId: o._id });
    return { changed: true };
  },
});

/** Return progress. A request is checked against the policy the order was SOLD under. */
export const updateReturn = internalMutation({
  args: { orderId: v.id("commerceOrders"), to: returnStatus, condition: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const o = await getOrder(ctx, args.orderId);
    if (!canTransition(RETURN_TRANSITIONS, o.returnStatus, args.to)) throw new ConvexError({ code: "INVALID", message: `Return can't go from ${o.returnStatus} to ${args.to}` });
    if (args.to === "requested") {
      const e = returnEligibility(o, o.returnPolicy, args.condition ?? "", Date.now());
      if (!e.ok) throw new ConvexError({ code: "INVALID", message: `Not eligible for return: ${e.reason}` });
    }
    await ctx.db.patch(o._id, { returnStatus: args.to, ...(args.condition ? { returnCondition: args.condition } : {}), updatedAt: Date.now() });
    if (args.to === "received") {
      await moveOwnershipForOrder(ctx, o._id, "returned", "staff");
      await serverEvent(ctx, "band_returned", o.userId, { productId: o.lines[0]?.productId, countryCode: o.shippingAddress.countryCode, orderId: o._id });
    }
    return { changed: true };
  },
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
