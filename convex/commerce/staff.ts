// Sombrey commerce — Phase 6F: staff fulfilment & returns (backend for the future
// Owner Dashboard; no UI here).
//
// Existing staff pattern (storeOrders.ts / store.ts): the caller's ROLE is
// checked on the server for every call. Fulfilment and returns: owner, admin,
// store_manager. Money (cancelling a paid order, approving/issuing refunds):
// owner, admin. Customers can't reach any of this.
//
// Provider-backed actions (submit to a warehouse, refresh tracking, return
// labels, refunds) return an honest "…_unavailable" while no provider is
// integrated — nothing is shipped, tracked or refunded by pretending.
// Nothing here creates Band ownership, activation or pairing (Phase 6G).

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { staffMay, type StaffLevel } from "./staffAccess";
import { COMMERCE_CONFIG, physicalProduct } from "./config";
import { inspectionCondition } from "./validators";
import { shipmentAttention, TERMINAL_SHIPMENT } from "./fulfillment";
import { cancelFulfillment as cancelFulfillmentRecord, cancelPaidOrderBeforeShipment, createFulfillment as createFulfillmentRecord, recordShipment, recordSubmission } from "./fulfillmentStore";
import { approveRefund as approveRefundRecord, authorizeReturn as authorizeReturnRecord, markRefundRequested, receiveReturn as receiveReturnRecord, rejectReturn as rejectReturnRecord } from "./returnsStore";
import { providersFor } from "./providers";
import { orderStage } from "./quotes";

async function requireStaff(ctx: QueryCtx | MutationCtx, level: StaffLevel): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user || !staffMay(user, level)) throw new ConvexError({ code: "FORBIDDEN", message: level === "money" ? "Owner or Admin access required" : "Staff access required" });
  return user;
}

// ─── Views ───────────────────────────────────────────────────────────────────

/** What needs attention: paid orders not yet fulfilled, fulfilments waiting or
 * failed, shipments with an exception / past the provider's ETA / no carrier
 * update for too long, and returns waiting on staff. No addresses here. */
export const fulfillmentQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "fulfillment");
    const now = Date.now();
    const paid = await ctx.db.query("commerceOrders").withIndex("by_payment_status", (q) => q.eq("paymentStatus", "paid")).take(200);
    const summary = (o: Doc<"commerceOrders">) => ({ orderId: o._id, orderNumber: o.orderNumber, country: o.shippingAddress.countryCode, stage: orderStage(o, now), paidAt: o.paidAt ?? null });
    const fulfillments = async (status: Doc<"commerceFulfillments">["status"]) =>
      (await ctx.db.query("commerceFulfillments").withIndex("by_status", (q) => q.eq("status", status)).take(200))
        .map((f) => ({ fulfillmentId: f._id, orderId: f.orderId, kind: f.kind, status: f.status, provider: f.provider ?? null, createdAt: f.createdAt, failure: f.failure ?? null }));
    const attention = [];
    for (const status of ["label_created", "picked_up", "in_transit", "out_for_delivery", "exception"] as const) {
      for (const s of await ctx.db.query("commerceShipments").withIndex("by_status", (q) => q.eq("status", status)).take(200)) {
        const flag = shipmentAttention(s, now, COMMERCE_CONFIG.fulfillment.stalledTrackingAfterHours);
        if (flag) attention.push({ shipmentId: s._id, orderId: s.orderId, direction: s.direction, status: s.status, flag, carrier: s.carrier, lastEventAt: s.lastEventAt ?? null });
      }
    }
    const returns = [];
    for (const status of ["requested", "in_transit", "received", "refund_approved"] as const) {
      for (const r of await ctx.db.query("commerceReturns").withIndex("by_status", (q) => q.eq("status", status)).take(200)) {
        returns.push({ returnId: r._id, orderId: r.orderId, status: r.status, reason: r.reason, createdAt: r.createdAt });
      }
    }
    return {
      providers: { fulfillment: COMMERCE_CONFIG.fulfillment.provider, payment: COMMERCE_CONFIG.checkout.provider },
      awaitingFulfillment: paid.filter((o) => o.fulfillmentStatus === "unfulfilled").map(summary),
      pendingFulfillments: [...await fulfillments("pending"), ...await fulfillments("submitted")],
      failedFulfillments: await fulfillments("failed"),
      shipmentsNeedingAttention: attention,
      returnsAwaitingStaff: returns,
    };
  },
});

/** Everything about one order, for staff (includes the shipping address — an
 * operational need; never sent to analytics). */
export const orderOperations = query({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    const o = await ctx.db.get(args.orderId);
    if (!o) throw new ConvexError({ code: "NOT_FOUND", message: "Order not found" });
    const returns = await ctx.db.query("commerceReturns").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect();
    const active = returns.find((r) => !["cancelled", "rejected", "refunded"].includes(r.status));
    return {
      order: {
        orderId: o._id, orderNumber: o.orderNumber, stage: orderStage({ ...o, activeReturn: active?.status ?? null }, Date.now()),
        paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus, returnStatus: o.returnStatus,
        lines: o.lines, currency: o.currency, subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents, totalCents: o.totalCents,
        refundedCents: o.refundedCents ?? 0, paidAt: o.paidAt ?? null, deliveredAt: o.deliveredAt ?? null, shippingAddress: o.shippingAddress,
        returnPolicy: o.returnPolicy,
      },
      fulfillments: await ctx.db.query("commerceFulfillments").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect(),
      shipments: await ctx.db.query("commerceShipments").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect(),
      returns,
    };
  },
});

// ─── Fulfilment ──────────────────────────────────────────────────────────────

export const createFulfillment = mutation({
  args: { orderId: v.id("commerceOrders"), idempotencyKey: v.string(), replacesFulfillmentId: v.optional(v.id("commerceFulfillments")) },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    return await createFulfillmentRecord(ctx.db, {
      orderId: args.orderId, idempotencyKey: args.idempotencyKey,
      kind: args.replacesFulfillmentId ? "replacement" : "original",
      ...(args.replacesFulfillmentId ? { replacesFulfillmentId: args.replacesFulfillmentId } : {}),
    }, COMMERCE_CONFIG, Date.now());
  },
});

export const cancelFulfillment = mutation({
  args: { fulfillmentId: v.id("commerceFulfillments"), reason: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    return await cancelFulfillmentRecord(ctx.db, args.fulfillmentId, args.reason, Date.now());
  },
});

/** Cancel a PAID order that hasn't shipped (owner/admin). The refund then goes
 * through the payment provider; the order stays as a financial record. */
export const cancelPaidOrder = mutation({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "money");
    return await cancelPaidOrderBeforeShipment(ctx.db, args.orderId, Date.now());
  },
});

/** Send a fulfilment to the warehouse/carrier. */
export const submitFulfillment = action({
  args: { fulfillmentId: v.id("commerceFulfillments") },
  handler: async (ctx, args): Promise<{ status: "submitted" | "fulfillment_unavailable" | "provider_refused" }> => {
    const provider = providersFor(COMMERCE_CONFIG).fulfillment;
    await ctx.runQuery(internal.commerce.staff.checkStaff, { level: "fulfillment" });
    if (!provider) return { status: "fulfillment_unavailable" };
    const job = await ctx.runQuery(internal.commerce.staff.fulfillmentJob, { fulfillmentId: args.fulfillmentId });
    // The same key on every retry: the provider returns the same shipment, never a second one.
    const idempotencyKey = `ship:${args.fulfillmentId}:1`;
    const created = await provider.createShipment({ idempotencyKey, orderNumber: job.orderNumber, direction: "outbound", address: job.address, items: job.items })
      .catch(() => ({ ok: false as const, reason: "provider_error" as const }));
    if (!created.ok) return { status: "provider_refused" };
    await ctx.runMutation(internal.commerce.staff.recordProviderShipment, { fulfillmentId: args.fulfillmentId, idempotencyKey, provider: provider.name, created });
    return { status: "submitted" };
  },
});

/** Ask the provider for a shipment's latest events (recovery after missed webhooks). */
export const refreshTracking = action({
  args: { shipmentId: v.id("commerceShipments") },
  handler: async (ctx, args): Promise<{ status: "refreshed" | "tracking_unavailable" | "provider_refused"; applied?: number }> => {
    const provider = providersFor(COMMERCE_CONFIG).fulfillment;
    await ctx.runQuery(internal.commerce.staff.checkStaff, { level: "fulfillment" });
    if (!provider) return { status: "tracking_unavailable" };
    const ref = await ctx.runQuery(internal.commerce.staff.shipmentRef, { shipmentId: args.shipmentId });
    const events = await provider.getTracking(ref).catch(() => ({ ok: false as const, reason: "provider_error" as const }));
    if (!Array.isArray(events)) return { status: "provider_refused" };
    let applied = 0;
    for (const event of events) {
      const r = await ctx.runMutation(internal.commerce.internal.applyShipmentEvent, { provider: provider.name, event });
      if (r.outcome === "applied") applied++;
    }
    return { status: "refreshed", applied };
  },
});

// ─── Returns ─────────────────────────────────────────────────────────────────

export const authorizeReturn = mutation({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    return await authorizeReturnRecord(ctx.db, args.returnId, Date.now());
  },
});

export const rejectReturn = mutation({
  args: { returnId: v.id("commerceReturns"), reason: v.union(v.literal("outside_policy"), v.literal("not_unused"), v.literal("damaged"), v.literal("incomplete"), v.literal("other")) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "fulfillment");
    return await rejectReturnRecord(ctx.db, staff._id, args.returnId, args.reason, Date.now());
  },
});

/** The item arrived and was inspected ("unused" is decided here, by a person). */
export const receiveReturn = mutation({
  args: { returnId: v.id("commerceReturns"), condition: inspectionCondition },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "fulfillment");
    return await receiveReturnRecord(ctx.db, staff._id, args.returnId, args.condition, COMMERCE_CONFIG, Date.now());
  },
});

/** A prepaid return label from the provider, for an authorized return. */
export const createReturnLabel = action({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args): Promise<{ status: "created" | "returns_unavailable" | "provider_refused" }> => {
    const provider = providersFor(COMMERCE_CONFIG).fulfillment;
    await ctx.runQuery(internal.commerce.staff.checkStaff, { level: "fulfillment" });
    if (!provider) return { status: "returns_unavailable" };
    const job = await ctx.runQuery(internal.commerce.staff.returnJob, { returnId: args.returnId });
    const idempotencyKey = `return:${args.returnId}:1`;
    const created = await provider.createShipment({ idempotencyKey, orderNumber: job.orderNumber, direction: "return", address: job.address, items: job.items })
      .catch(() => ({ ok: false as const, reason: "provider_error" as const }));
    if (!created.ok) return { status: "provider_refused" };
    await ctx.runMutation(internal.commerce.staff.recordReturnShipment, { returnId: args.returnId, idempotencyKey, provider: provider.name, created });
    return { status: "created" };
  },
});

/** Owner/admin: approve the refund for an inspected return (amount computed by the server). */
export const approveRefund = mutation({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "money");
    return await approveRefundRecord(ctx.db, staff._id, args.returnId, Date.now());
  },
});

/** Owner/admin: ask the payment provider to refund an approved return. The
 * return is refunded only when the provider's VERIFIED refund event arrives. */
export const issueRefund = action({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args): Promise<{ status: "requested" | "refund_unavailable" | "provider_refused" }> => {
    const payment = providersFor(COMMERCE_CONFIG).payment;
    await ctx.runQuery(internal.commerce.staff.checkStaff, { level: "money" });
    if (!payment) return { status: "refund_unavailable" };
    const job = await ctx.runQuery(internal.commerce.staff.refundJob, { returnId: args.returnId });
    const r = await payment.refund({ providerRef: job.providerRef, amountCents: job.amountCents, currency: job.currency, idempotencyKey: job.idempotencyKey })
      .catch(() => ({ ok: false as const, reason: "provider_error" as const }));
    if (!r.ok) return { status: "provider_refused" };
    await ctx.runMutation(internal.commerce.staff.recordRefundRequested, { returnId: args.returnId, refundRef: r.refundRef });
    return { status: "requested" };
  },
});

// ─── Internal steps of the actions above (the caller's identity carries through) ──

export const checkStaff = internalQuery({
  args: { level: v.union(v.literal("fulfillment"), v.literal("money")) },
  handler: async (ctx, args) => { await requireStaff(ctx, args.level); return null; },
});

export const fulfillmentJob = internalQuery({
  args: { fulfillmentId: v.id("commerceFulfillments") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    const f = await ctx.db.get(args.fulfillmentId);
    if (!f || f.status !== "pending") throw new ConvexError({ code: "INVALID", message: "Only a pending fulfilment can be submitted" });
    const o = (await ctx.db.get(f.orderId))!;
    if (o.paymentStatus !== "paid" && !(f.kind === "replacement" && o.paymentStatus === "partially_refunded")) throw new ConvexError({ code: "NOT_FULFILLABLE", message: "This order can't be shipped" });
    return { orderNumber: o.orderNumber, address: o.shippingAddress, items: f.lines.map((l) => ({ ...l, sku: physicalProduct(COMMERCE_CONFIG, l.productId)?.sku ?? l.productId })) };
  },
});

export const shipmentRef = internalQuery({
  args: { shipmentId: v.id("commerceShipments") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    const s = await ctx.db.get(args.shipmentId);
    if (!s || TERMINAL_SHIPMENT.includes(s.status)) throw new ConvexError({ code: "INVALID", message: "Nothing to refresh" });
    return s.providerRef;
  },
});

export const returnJob = internalQuery({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    const r = await ctx.db.get(args.returnId);
    if (!r || r.status !== "authorized") throw new ConvexError({ code: "INVALID", message: "Return labels are for authorized returns" });
    const o = (await ctx.db.get(r.orderId))!;
    return { orderNumber: o.orderNumber, address: o.shippingAddress, items: r.lines.map((l) => ({ ...l, sku: physicalProduct(COMMERCE_CONFIG, l.productId)?.sku ?? l.productId })) };
  },
});

export const refundJob = internalQuery({
  args: { returnId: v.id("commerceReturns") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "money");
    const r = await ctx.db.get(args.returnId);
    if (!r?.refund || r.status !== "refund_approved") throw new ConvexError({ code: "INVALID", message: "No approved refund" });
    const o = (await ctx.db.get(r.orderId))!;
    if (!o.paymentAttempt?.providerRef) throw new ConvexError({ code: "INVALID", message: "No captured payment to refund" });
    return { providerRef: o.paymentAttempt.providerRef, amountCents: r.refund.amountCents, currency: r.refund.currency, idempotencyKey: r.refund.idempotencyKey };
  },
});

const createdShipment = v.object({
  ok: v.literal(true), providerRef: v.string(), carrier: v.string(), service: v.string(),
  trackingNumber: v.optional(v.string()), trackingUrl: v.optional(v.string()), estimatedDeliveryAt: v.optional(v.number()), location: v.optional(v.string()),
});

export const recordProviderShipment = internalMutation({
  args: { fulfillmentId: v.id("commerceFulfillments"), idempotencyKey: v.string(), provider: v.string(), created: createdShipment },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    const now = Date.now();
    await recordSubmission(ctx.db, args.fulfillmentId, { provider: args.provider, providerRef: args.created.providerRef, ...(args.created.location ? { location: args.created.location } : {}) }, now);
    return await recordShipment(ctx.db, { direction: "outbound", fulfillmentId: args.fulfillmentId, idempotencyKey: args.idempotencyKey, provider: args.provider, created: args.created }, COMMERCE_CONFIG, now);
  },
});

export const recordReturnShipment = internalMutation({
  args: { returnId: v.id("commerceReturns"), idempotencyKey: v.string(), provider: v.string(), created: createdShipment },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    return await recordShipment(ctx.db, { direction: "return", returnId: args.returnId, idempotencyKey: args.idempotencyKey, provider: args.provider, created: args.created }, COMMERCE_CONFIG, Date.now());
  },
});

export const recordRefundRequested = internalMutation({
  args: { returnId: v.id("commerceReturns"), refundRef: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "money");
    return await markRefundRequested(ctx.db, args.returnId as Id<"commerceReturns">, args.refundRef, Date.now());
  },
});
