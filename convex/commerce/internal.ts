// Sombrey commerce (Phase 6A) — TRUSTED state changes. Internal functions only:
// callable by other backend code (a verified payment-provider webhook, the
// App Store server-notification handler, an owner tool) — never by a client.
// Nothing calls them yet: the payment provider (6C/6E), StoreKit 2 (6B) and
// activation (6G) will. Each one enforces the domain's transition rules, so
// even trusted code can't mark an unpaid order delivered or re-price an order.

import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { COMMERCE_CONFIG } from "./config";
import { FULFILLMENT_TRANSITIONS, PAYMENT_TRANSITIONS, RETURN_TRANSITIONS, buildOrderDraft, canTransition, formatOrderNumber, orderTotal, returnEligibility } from "./orders";
import { transitionOwnership, type OwnershipStatus } from "./ownership";
import { applyVerifiedUpdate, validateVerifiedUpdate } from "./subscriptionState";
import { validateEvent, type CommerceEventName } from "./events";
import { toSubscriptionRecord } from "./records";
import { fulfillmentStatus, paymentStatus, returnStatus, shipment, shippingAddress, subscriptionStatus } from "./validators";

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

/** A priced order for a user, awaiting payment — the future checkout's first
 * step. Prices come from the config, never from the caller. */
export const createOrder = internalMutation({
  args: {
    userId: v.id("users"),
    items: v.array(v.object({ productId: v.string(), quantity: v.number() })),
    shippingAddress,
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    const r = buildOrderDraft(COMMERCE_CONFIG, { items: args.items, shippingAddress: args.shippingAddress });
    if (!r.ok) throw new ConvexError({ code: "INVALID", message: r.error });
    let orderNumber = formatOrderNumber(Math.random);
    for (let i = 0; i < 5 && (await ctx.db.query("commerceOrders").withIndex("by_order_number", (q) => q.eq("orderNumber", orderNumber)).first()); i++) {
      orderNumber = formatOrderNumber(Math.random);
    }
    const now = Date.now();
    const { returnStatus: _r, ...draft } = r.draft;
    const id = await ctx.db.insert("commerceOrders", {
      userId: user._id, orderNumber, ...draft, returnStatus: "none",
      returnPolicy: { windowDays: COMMERCE_CONFIG.returns.windowDays, eligibleConditions: [...COMMERCE_CONFIG.returns.eligibleConditions] },
      shipments: [], createdAt: now, updatedAt: now,
    });
    return { orderId: id, orderNumber };
  },
});

/** Shipping and tax as quoted by the provider — only before payment; the total follows. */
export const setQuote = internalMutation({
  args: { orderId: v.id("commerceOrders"), shippingCents: v.number(), taxCents: v.number() },
  handler: async (ctx, args) => {
    const o = await getOrder(ctx, args.orderId);
    if (o.paymentStatus !== "awaiting_payment") throw new ConvexError({ code: "INVALID", message: "An order's amounts can't change once payment has started" });
    const total = orderTotal(o.subtotalCents, args.shippingCents, args.taxCents);
    if (total === null) throw new ConvexError({ code: "INVALID", message: "Invalid amounts" });
    await ctx.db.patch(o._id, { shippingCents: args.shippingCents, taxCents: args.taxCents, totalCents: total, updatedAt: Date.now() });
  },
});

/** A VERIFIED payment-provider update (from its webhook, after signature checks). */
export const applyPaymentUpdate = internalMutation({
  args: {
    orderId: v.id("commerceOrders"),
    to: paymentStatus,
    provider: v.object({ name: v.string(), checkoutSessionId: v.optional(v.string()), paymentId: v.optional(v.string()) }),
  },
  handler: async (ctx, args) => {
    const o = await getOrder(ctx, args.orderId);
    if (o.paymentStatus === args.to) return { changed: false };
    if (!canTransition(PAYMENT_TRANSITIONS, o.paymentStatus, args.to)) throw new ConvexError({ code: "INVALID", message: `Payment can't go from ${o.paymentStatus} to ${args.to}` });
    if (args.to === "paid" && o.totalCents === null) throw new ConvexError({ code: "INVALID", message: "An order can't be paid before its total is known" });
    const now = Date.now();
    await ctx.db.patch(o._id, { paymentStatus: args.to, provider: args.provider, updatedAt: now, ...(args.to === "paid" ? { paidAt: now } : {}) });
    if (args.to === "paid") {
      // Paid → one ownership record per Band bought (purchased ≠ connected).
      for (const line of o.lines) for (let i = 0; i < line.quantity; i++) {
        await ctx.db.insert("bandOwnership", {
          userId: o.userId, source: "order", orderId: o._id, status: "purchased",
          history: [{ status: "purchased", at: now, by: "provider" }], createdAt: now, updatedAt: now,
        });
      }
      await serverEvent(ctx, "band_checkout_completed", o.userId, { productId: o.lines[0]?.productId, countryCode: o.shippingAddress.countryCode, amountCents: o.totalCents!, currency: o.currency, orderId: o._id });
    }
    return { changed: true };
  },
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

/** A VERIFIED App Store subscription update (Phase 6B: from the server-side
 * StoreKit 2 verification or an App Store Server Notification). */
export const applyVerifiedSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    update: v.object({
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
      verification: v.object({ method: v.string(), verifiedAt: v.number() }),
    }),
  },
  handler: async (ctx, args) => {
    const membership = COMMERCE_CONFIG.products.membership;
    const expected = membership.appStoreProductId ? [membership.appStoreProductId] : [];
    const problem = validateVerifiedUpdate(args.update, expected);
    if (problem) throw new ConvexError({ code: "INVALID", message: problem });
    const existing = await ctx.db.query("commerceSubscriptions").withIndex("by_original_transaction", (q) => q.eq("originalTransactionId", args.update.originalTransactionId)).unique();
    if (existing && existing.userId !== args.userId) throw new ConvexError({ code: "FORBIDDEN", message: "That subscription belongs to another account" });
    const { changed, record } = applyVerifiedUpdate(existing ? toSubscriptionRecord(existing) : null, args.update);
    if (!changed) return { changed: false };
    const now = Date.now();
    let id: Id<"commerceSubscriptions">;
    if (existing) {
      await ctx.db.patch(existing._id, { ...record, updatedAt: now });
      id = existing._id;
    } else {
      id = await ctx.db.insert("commerceSubscriptions", { userId: args.userId, productId: membership.id, ...record, createdAt: now, updatedAt: now });
    }
    await ctx.db.insert("commerceSubscriptionHistory", {
      subscriptionId: id, userId: args.userId, latestTransactionId: record.latestTransactionId, status: record.status,
      expiresDate: record.expiresDate, signedDate: record.signedDate, verificationMethod: record.verificationMethod, recordedAt: now,
    });
    const before = existing?.status;
    const name: CommerceEventName | null =
      !existing && record.status === "active" ? "subscription_activated"
        : existing && existing.latestTransactionId !== record.latestTransactionId && record.status === "active" ? "subscription_renewed"
          : before !== record.status && record.status === "expired" ? "subscription_expired"
            : existing && existing.autoRenewEnabled && !record.autoRenewEnabled ? "subscription_cancelled"
              : null;
    if (name) await serverEvent(ctx, name, args.userId, { productId: membership.id });
    return { changed: true };
  },
});
