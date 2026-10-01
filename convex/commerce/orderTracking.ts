// Sombrey commerce — Phase 6F: what a CUSTOMER can see and do after paying.
//
//   orderTracking   the order's progress from REAL provider state only
//                   (confirmed → preparing → shipped → in transit → out for
//                   delivery → delivered); "tracking unavailable" otherwise —
//                   no invented progress, no invented ETA
//   returnOptions   whether a return is possible now, and until when — computed
//   requestReturn   start a return (idempotent per requestKey); the customer
//                   states the Band is unused — staff inspect it on receipt
//   cancelReturn    before anything is in the carrier's hands
//
// The user always comes from the auth token; only their own orders. The app
// can't send an eligibility flag, a refund amount, a tracking number, a date
// or a status. Cancelling an order AFTER payment is a staff action
// (commerce/staff:cancelPaidOrder); before payment, commerce/checkout:cancelCheckout.

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { COMMERCE_CONFIG } from "./config";
import { fulfillmentLine, returnReason } from "./validators";
import { customerTracking } from "./fulfillment";
import { cancelReturn as cancelReturnRecord, requestReturn as requestReturnRecord, returnOptions as returnOptionsFor } from "./returnsStore";
import { orderStage } from "./quotes";

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  return user;
}

export const orderTracking = query({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const o = await ctx.db.get(args.orderId);
    if (!o || o.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Order not found" });
    const shipments = (await ctx.db.query("commerceShipments").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect()).filter((s) => s.direction === "outbound");
    const returns = await ctx.db.query("commerceReturns").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect();
    const active = returns.find((r) => !["cancelled", "rejected", "refunded"].includes(r.status));
    return {
      orderNumber: o.orderNumber,
      stage: orderStage({ ...o, quote: o.quote ?? null, paymentAttempt: o.paymentAttempt ?? null, activeReturn: active?.status ?? null }, Date.now()),
      ...customerTracking(o, shipments),
      returns: returns.map((r) => ({ returnId: r._id, status: r.status, createdAt: r.createdAt, refunded: r.refund?.completedAt !== undefined })),
    };
  },
});

export const returnOptions = query({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await returnOptionsFor(ctx.db, user._id, args.orderId, COMMERCE_CONFIG, Date.now());
  },
});

export const requestReturn = mutation({
  args: {
    orderId: v.id("commerceOrders"), requestKey: v.string(), reason: returnReason, attestUnused: v.boolean(),
    lines: v.optional(v.array(fulfillmentLine)),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await requestReturnRecord(ctx.db, user._id, args, COMMERCE_CONFIG, Date.now());
  },
});

export const cancelReturn = mutation({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await cancelReturnRecord(ctx.db, user._id, args.returnId, Date.now());
  },
});
