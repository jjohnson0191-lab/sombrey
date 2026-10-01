// Sombrey commerce — Phase 6F: the ONE writer of returns.
//
// Customer: requestReturn, cancelReturn (own orders only; eligibility computed
// here, never sent by the app). Staff (role-checked in commerce/staff.ts):
// authorize, reject, receive with inspection, approve a refund. The refund
// AMOUNT is computed here from the order's snapshot prices and capped at what
// the provider captured minus what was already refunded; the return becomes
// "refunded" only when the payment provider's VERIFIED refund event arrives
// (checkoutStore.applyVerifiedPayment → completeRefund).
//
// "Unused" (the 30-day policy's condition) is the customer's statement at
// request time and a STAFF INSPECTION on receipt — there is no automatic usage
// detection. Phase 6G: the physical units named at receipt stop being owned —
// at receipt or at the verified refund (config); a request never ends ownership.
//
// Tested against an in-memory database in tests/commerce/fulfillment.test.ts.

import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { CommerceConfig } from "./config.ts";
import {
  ORDER_RETURN_STATUS, RETURN_REASONS, RETURN_RECORD_TRANSITIONS, refundAmountFor, returnEligibilityFor,
  type FulfillmentLine, type InspectionCondition, type ReturnRecordStatus,
} from "./fulfillment.ts";
import { RETURN_TRANSITIONS, canTransition } from "./orders.ts";
import { serverEvent, skuOf, KEY } from "./fulfillmentStore.ts";
import { endOwnershipForReturn, validateReturnedDevices } from "./deviceStore.ts";

type Db = MutationCtx["db"];
type Return = Doc<"commerceReturns">;
const fail = (code: string, message: string) => new ConvexError({ code, message });
const ACTIVE: readonly ReturnRecordStatus[] = ["requested", "authorized", "in_transit", "received", "refund_approved", "refunded", "rejected"];

/** Move a return AND the order's 6A returnStatus together, or neither. */
async function move(db: Db, r: Return, to: ReturnRecordStatus, by: "customer" | "staff" | "provider", now: number, extra: Partial<Return> = {}) {
  if (!RETURN_RECORD_TRANSITIONS[r.status].includes(to)) throw fail("INVALID", `A ${r.status} return can't become ${to}`);
  const order = await db.get(r.orderId);
  if (!order) throw fail("NOT_FOUND", "Order not found");
  const orderTo = ORDER_RETURN_STATUS[to];
  if (order.returnStatus !== orderTo) {
    if (!canTransition(RETURN_TRANSITIONS, order.returnStatus, orderTo)) throw fail("INVALID", `The order's return can't go from ${order.returnStatus} to ${orderTo}`);
    await db.patch(order._id, { returnStatus: orderTo, updatedAt: now });
  }
  await db.patch(r._id, { ...extra, status: to, history: [...r.history, { status: to, at: now, by }], updatedAt: now });
  return order;
}

async function returnOf(db: Db, id: Id<"commerceReturns">): Promise<Return> {
  const r = await db.get(id);
  if (!r) throw fail("NOT_FOUND", "Return not found");
  return r;
}

/** What the customer may do about returns for an order — computed, not claimed. */
export async function returnOptions(db: QueryCtx["db"], userId: Id<"users">, orderId: Id<"commerceOrders">, config: CommerceConfig, now: number) {
  const order = await db.get(orderId);
  if (!order || order.userId !== userId) throw fail("NOT_FOUND", "Order not found");
  const returns = (await db.query("commerceReturns").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()).filter((r) => ACTIVE.includes(r.status));
  return returnEligibilityFor(order, returns.length, config, now);
}

export async function requestReturn(db: Db, userId: Id<"users">, args: {
  orderId: Id<"commerceOrders">; requestKey: string; reason: string; attestUnused: boolean; lines?: FulfillmentLine[];
}, config: CommerceConfig, now: number): Promise<{ returnId: Id<"commerceReturns">; created: boolean }> {
  if (!KEY.test(args.requestKey)) throw fail("INVALID", "Invalid return request");
  const existing = await db.query("commerceReturns").withIndex("by_user_and_request_key", (q) => q.eq("userId", userId).eq("requestKey", args.requestKey)).first();
  if (existing) {
    // 6I: the same key must mean the same request.
    const sameLines = !args.lines || (args.lines.length === existing.lines.length && args.lines.every((l) => existing.lines.some((x) => x.productId === l.productId && x.quantity === l.quantity)));
    if (existing.orderId !== args.orderId || existing.reason !== args.reason || !sameLines) throw fail("CONFLICT", "That return request was already used for a different return");
    return { returnId: existing._id, created: false };
  }
  if (!(RETURN_REASONS as readonly string[]).includes(args.reason)) throw fail("INVALID", "Choose a reason");
  const e = await returnOptions(db, userId, args.orderId, config, now);
  if (!e.eligible) throw fail("NOT_ELIGIBLE", `Not eligible for return: ${e.reason}`);
  // The policy is for UNUSED Bands: the customer says so; staff inspect it on receipt.
  if (args.attestUnused !== true) throw fail("NOT_ELIGIBLE", "Not eligible for return: condition_not_eligible");
  const order = (await db.get(args.orderId))!;
  const lines = args.lines ?? order.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
  if (!lines.length || refundAmountFor(order, lines) === null) throw fail("INVALID", "Those items aren't on this order");
  if (!canTransition(RETURN_TRANSITIONS, order.returnStatus, "requested")) throw fail("INVALID", "A return is already in progress");
  const returnId = await db.insert("commerceReturns", {
    orderId: order._id, userId, requestKey: args.requestKey, status: "requested", lines,
    reason: args.reason as Return["reason"], customerAttestedUnused: true,
    history: [{ status: "requested", at: now, by: "customer" }], createdAt: now, updatedAt: now,
  });
  await db.patch(order._id, { returnStatus: "requested", updatedAt: now });
  await serverEvent(db, config, "return_requested", order, now, { productId: lines[0].productId });
  return { returnId, created: true };
}

/** The customer changes their mind — before anything is in the carrier's hands. */
export async function cancelReturn(db: Db, userId: Id<"users">, returnId: Id<"commerceReturns">, now: number) {
  const r = await returnOf(db, returnId);
  if (r.userId !== userId) throw fail("NOT_FOUND", "Return not found");
  if (r.status === "cancelled") return { changed: false };
  if (r.status !== "requested" && r.status !== "authorized") throw fail("INVALID", "This return can't be cancelled now");
  await move(db, r, "cancelled", "customer", now);
  return { changed: true };
}

export async function authorizeReturn(db: Db, returnId: Id<"commerceReturns">, now: number) {
  const r = await returnOf(db, returnId);
  if (r.status === "authorized") return { changed: false };
  await move(db, r, "authorized", "staff", now);
  return { changed: true };
}

export async function rejectReturn(db: Db, staffUserId: Id<"users">, returnId: Id<"commerceReturns">, reason: string, now: number) {
  const r = await returnOf(db, returnId);
  if (r.status === "rejected") return { changed: false };
  // 6J: once a unit has been taken back (its ownership ended at receipt), a
  // rejection would leave the customer with neither the Band nor a refund.
  for (const id of r.deviceIds ?? []) {
    if ((await db.get(id))?.status === "returned") throw fail("INVALID", "This return's Band has already been taken back — approve the refund instead");
  }
  await move(db, r, "rejected", "staff", now, { rejection: { reason: reason.slice(0, 60), at: now, byUserId: staffUserId } });
  return { changed: true };
}

/** Staff received the item and inspected it. 6G: `deviceIds` are the physical
 * units that came back; their ownership ends now or when the refund is verified
 * (config.devices.ownershipEndsOnReturnAt). A return REQUEST never ends ownership. */
export async function receiveReturn(db: Db, staffUserId: Id<"users">, returnId: Id<"commerceReturns">, condition: InspectionCondition, config: CommerceConfig, now: number,
  deviceIds: Id<"commerceDevices">[] = []) {
  const r = await returnOf(db, returnId);
  if (r.status === "received") return { changed: false };
  if (deviceIds.length) await validateReturnedDevices(db, r.orderId, r.lines, deviceIds);
  const order = await move(db, r, "received", "staff", now, { inspection: { condition, at: now, byUserId: staffUserId }, ...(deviceIds.length ? { deviceIds } : {}) });
  // 6J: a unit is taken back at receipt only when its condition is one the
  // return policy refunds; anything else stays the customer's while staff
  // decide (a rejected return goes back to its owner).
  // (A unit whose ownership already ended — replaced — is simply booked back in.)
  const refundable = order.returnPolicy.eligibleConditions.includes(condition);
  const takeBack: Id<"commerceDevices">[] = [];
  for (const id of deviceIds) if ((await db.get(id))?.status === "replaced" || (refundable && config.devices.ownershipEndsOnReturnAt === "received")) takeBack.push(id);
  if (takeBack.length) await endOwnershipForReturn(db, r.orderId, takeBack, config, now);
  await serverEvent(db, config, "return_received", order, now, { productId: r.lines[0]?.productId, source: condition });
  return { changed: true };
}

/** Owner/admin: approve the refund for an inspected return. The amount is the
 * server's: returned lines × snapshot unit price, never more than refundable. */
export async function approveRefund(db: Db, staffUserId: Id<"users">, returnId: Id<"commerceReturns">, now: number) {
  const r = await returnOf(db, returnId);
  if (r.refund) return { changed: false, amountCents: r.refund.amountCents };
  if (r.status !== "received" || !r.inspection) throw fail("INVALID", "Only an inspected return can be refunded");
  const order = await db.get(r.orderId);
  if (!order) throw fail("NOT_FOUND", "Order not found");
  if (!order.returnPolicy.eligibleConditions.includes(r.inspection.condition)) throw fail("NOT_ELIGIBLE", "The item's condition isn't covered by the return policy");
  const amount = refundAmountFor(order, r.lines);
  const captured = order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded" ? order.paymentAttempt?.amountCents ?? 0 : 0;
  const refundable = captured - (order.refundedCents ?? 0);
  if (amount === null || amount > refundable) throw fail("INVALID", "Refund exceeds what can be refunded");
  await move(db, r, "refund_approved", "staff", now, {
    refund: { amountCents: amount, currency: order.currency, approvedAt: now, approvedByUserId: staffUserId, idempotencyKey: `refund:${r._id}` },
  });
  return { changed: true, amountCents: amount };
}

/** The payment provider accepted the refund request (not yet confirmed). */
export async function markRefundRequested(db: Db, returnId: Id<"commerceReturns">, refundRef: string, now: number) {
  const r = await returnOf(db, returnId);
  if (!r.refund || r.status !== "refund_approved") throw fail("INVALID", "No approved refund");
  if (r.refund.providerRefundRef) return { changed: false };
  await db.patch(r._id, { refund: { ...r.refund, requestedAt: now, providerRefundRef: refundRef.slice(0, 120) }, updatedAt: now });
  return { changed: true };
}

/** Called after a VERIFIED refund event was applied to the order's payment:
 * the approved return for exactly that amount becomes refunded. */
export async function completeRefund(db: Db, orderId: Id<"commerceOrders">, amountCents: number, config: CommerceConfig, now: number) {
  const r = (await db.query("commerceReturns").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect())
    .find((x) => x.status === "refund_approved" && x.refund?.amountCents === amountCents);
  if (!r?.refund) return { linked: false };
  const order = await move(db, r, "refunded", "provider", now, { refund: { ...r.refund, completedAt: now } });
  if (r.deviceIds?.length && config.devices.ownershipEndsOnReturnAt === "refunded") await endOwnershipForReturn(db, orderId, r.deviceIds, config, now);
  await serverEvent(db, config, "refund_completed", order, now, { productId: r.lines[0]?.productId, amountCents, currency: r.refund.currency });
  return { linked: true };
}

// ─── 6J: what the provider-facing actions read (staff-checked by the caller) ──

/** What staff:createReturnLabel sends the provider. */
export async function returnLabelJob(db: QueryCtx["db"], returnId: Id<"commerceReturns">, config: CommerceConfig) {
  const r = await db.get(returnId);
  if (!r || r.status !== "authorized") throw fail("INVALID", "Return labels are for authorized returns");
  const o = (await db.get(r.orderId))!;
  return { orderNumber: o.orderNumber, address: o.shippingAddress, items: r.lines.map((l) => skuOf(config, l)) };
}

/** What staff:issueRefund asks the payment provider for. */
export async function refundJob(db: QueryCtx["db"], returnId: Id<"commerceReturns">) {
  const r = await db.get(returnId);
  if (!r?.refund || r.status !== "refund_approved") throw fail("INVALID", "No approved refund");
  const o = (await db.get(r.orderId))!;
  if (!o.paymentAttempt?.providerRef) throw fail("INVALID", "No captured payment to refund");
  return { providerRef: o.paymentAttempt.providerRef, amountCents: r.refund.amountCents, currency: r.refund.currency, idempotencyKey: r.refund.idempotencyKey };
}
