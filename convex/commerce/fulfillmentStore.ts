// Sombrey commerce — Phase 6F: the ONE writer of fulfilments and shipments.
//
// Called by staff functions (commerce/staff.ts, role-checked) and trusted
// internal functions (verified provider events). Each function runs inside one
// serializable Convex mutation, so check-then-write is atomic: a retried or
// concurrent request with the same idempotency key returns the same fulfilment
// or shipment, and the same carrier event is applied once.
//
// Never writes Band ownership, activation or pairing (Phase 6G), and never
// invents a tracking number, status or date.
//
// Tested against an in-memory database in tests/commerce/fulfillment.test.ts.

import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { knownProductIds, type CommerceConfig } from "./config.ts";
import { validateEvent, type CommerceEventName } from "./events.ts";
import {
  FULFILLMENT_RECORD_TRANSITIONS, RETURN_RECORD_TRANSITIONS, applyCarrierEvent, canFulfill, impliedOrderFulfillment,
  nextOrderFulfillment, rollUpFulfillment, safeTrackingUrl, unfulfilledLines, type FulfillmentLine, type FulfillmentRecordStatus, type ShipmentState,
} from "./fulfillment.ts";
import { FULFILLMENT_TRANSITIONS, canTransition } from "./orders.ts";
import type { CreatedShipment, ProviderShipmentEvent } from "./providers.ts";

type Db = MutationCtx["db"];
type Order = Doc<"commerceOrders">;
type Fulfillment = Doc<"commerceFulfillments">;

export const KEY = /^[A-Za-z0-9:_-]{8,120}$/;
const TRACKING = /^[A-Za-z0-9-]{4,64}$/;
const fail = (code: string, message: string) => new ConvexError({ code, message });

export async function serverEvent(db: Db, config: CommerceConfig, name: CommerceEventName, order: Order, now: number, extra: { productId?: string; source?: string; amountCents?: number; currency?: string } = {}) {
  const productId = extra.productId ?? order.lines[0]?.productId;
  const problem = validateEvent({ name, platform: "backend", countryCode: order.shippingAddress.countryCode, ...extra, productId }, "server", knownProductIds(config));
  if (problem) throw fail("INVALID", problem);
  await db.insert("commerceEvents", {
    name, userId: order.userId, at: now, origin: "server", platform: "backend", countryCode: order.shippingAddress.countryCode,
    ...(productId ? { productId } : {}), ...(extra.source ? { source: extra.source } : {}),
    ...(extra.amountCents !== undefined ? { amountCents: extra.amountCents, currency: extra.currency } : {}),
    orderId: order._id, configVersion: config.version,
  });
}

async function getOrder(db: Db, id: Id<"commerceOrders">): Promise<Order> {
  const o = await db.get(id);
  if (!o) throw fail("NOT_FOUND", "Order not found");
  return o;
}

const originalsOf = async (db: Db, orderId: Id<"commerceOrders">) =>
  (await db.query("commerceFulfillments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()).filter((f) => f.kind === "original");

/** A fulfilment for a PAID order (original) or for goods already sent (replacement). */
export async function createFulfillment(db: Db, args: {
  orderId: Id<"commerceOrders">;
  idempotencyKey: string;
  kind: "original" | "replacement";
  replacesFulfillmentId?: Id<"commerceFulfillments">;
  lines?: FulfillmentLine[];
}, config: CommerceConfig, now: number): Promise<{ fulfillmentId: Id<"commerceFulfillments">; created: boolean }> {
  if (!KEY.test(args.idempotencyKey)) throw fail("INVALID", "Invalid idempotency key");
  const existing = await db.query("commerceFulfillments").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).first();
  if (existing) {
    if (existing.orderId !== args.orderId) throw fail("CONFLICT", "That key belongs to another fulfilment");
    return { fulfillmentId: existing._id, created: false };
  }
  const order = await getOrder(db, args.orderId);
  let lines: FulfillmentLine[];
  if (args.kind === "original") {
    const ok = canFulfill(order);
    if (!ok.ok) throw fail("NOT_FULFILLABLE", `This order can't be fulfilled (${ok.reason})`);
    if (args.replacesFulfillmentId) throw fail("INVALID", "An original fulfilment doesn't replace anything");
    const remaining = unfulfilledLines(order, await originalsOf(db, order._id));
    lines = args.lines ?? remaining;
    if (!lines.length) throw fail("NOT_FULFILLABLE", "Nothing left to fulfil");
    for (const l of lines) {
      const left = remaining.find((r) => r.productId === l.productId)?.quantity ?? 0;
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > left) throw fail("INVALID", "More than the order has left to fulfil");
    }
  } else {
    // A replacement: separate from the original; never re-delivers the ORDER,
    // never changes payment, never creates ownership (6G decides that).
    if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") throw fail("NOT_FULFILLABLE", "Only paid orders get replacements");
    const original = args.replacesFulfillmentId ? await db.get(args.replacesFulfillmentId) : null;
    if (!original || original.orderId !== order._id || (original.status !== "delivered" && original.status !== "failed")) {
      throw fail("INVALID", "A replacement must name a delivered or failed fulfilment of this order");
    }
    lines = args.lines ?? original.lines;
    for (const l of lines) {
      const sent = original.lines.find((o) => o.productId === l.productId)?.quantity ?? 0;
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > sent) throw fail("INVALID", "A replacement can't exceed what was sent");
    }
  }
  const fulfillmentId = await db.insert("commerceFulfillments", {
    orderId: order._id, userId: order.userId, kind: args.kind, ...(args.replacesFulfillmentId ? { replacesFulfillmentId: args.replacesFulfillmentId } : {}),
    lines, status: "pending", idempotencyKey: args.idempotencyKey, createdAt: now, updatedAt: now,
  });
  if (args.kind === "original") {
    const next = nextOrderFulfillment(order.fulfillmentStatus, "processing");
    if (next !== order.fulfillmentStatus) await db.patch(order._id, { fulfillmentStatus: next, updatedAt: now });
  }
  await serverEvent(db, config, "fulfillment_created", order, now, { productId: lines[0].productId, source: args.kind });
  return { fulfillmentId, created: true };
}

function moveFulfillment(f: Fulfillment, to: FulfillmentRecordStatus): boolean {
  return f.status !== to && FULFILLMENT_RECORD_TRANSITIONS[f.status].includes(to);
}

/** The provider accepted the fulfilment (its reference and location). */
export async function recordSubmission(db: Db, fulfillmentId: Id<"commerceFulfillments">, sub: { provider: string; providerRef: string; location?: string }, now: number) {
  const f = await db.get(fulfillmentId);
  if (!f) throw fail("NOT_FOUND", "Fulfilment not found");
  if (f.providerRef !== undefined) {
    if (f.providerRef !== sub.providerRef || f.provider !== sub.provider) throw fail("CONFLICT", "Fulfilment already submitted elsewhere");
    return { changed: false };
  }
  if (!moveFulfillment(f, "submitted")) throw fail("INVALID", `A ${f.status} fulfilment can't be submitted`);
  await db.patch(f._id, { status: "submitted", provider: sub.provider, providerRef: sub.providerRef, ...(sub.location ? { location: sub.location.slice(0, 60) } : {}), submittedAt: now, updatedAt: now });
  return { changed: true };
}

/** A shipment the provider CREATED (outbound for a fulfilment, or a return
 * label for a return). The same idempotency key is the same shipment. */
export async function recordShipment(db: Db, args: {
  direction: "outbound" | "return";
  fulfillmentId?: Id<"commerceFulfillments">;
  returnId?: Id<"commerceReturns">;
  idempotencyKey: string;
  provider: string;
  created: CreatedShipment;
}, config: CommerceConfig, now: number): Promise<{ shipmentId: Id<"commerceShipments">; created: boolean }> {
  if (!KEY.test(args.idempotencyKey)) throw fail("INVALID", "Invalid idempotency key");
  const existing = await db.query("commerceShipments").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).first();
  if (existing) return { shipmentId: existing._id, created: false };
  const c = args.created;
  if (typeof c.providerRef !== "string" || !c.providerRef || c.providerRef.length > 120) throw fail("INVALID", "Provider reference missing");
  let order: Order;
  if (args.direction === "outbound") {
    const f = args.fulfillmentId ? await db.get(args.fulfillmentId) : null;
    if (!f || (f.status !== "submitted" && f.status !== "shipped")) throw fail("INVALID", "Shipments belong to a submitted fulfilment");
    order = await getOrder(db, f.orderId);
  } else {
    const r = args.returnId ? await db.get(args.returnId) : null;
    if (!r || r.status !== "authorized") throw fail("INVALID", "Return labels are for authorized returns");
    order = await getOrder(db, r.orderId);
  }
  const shipmentId = await db.insert("commerceShipments", {
    orderId: order._id, userId: order.userId, direction: args.direction,
    ...(args.fulfillmentId ? { fulfillmentId: args.fulfillmentId } : {}), ...(args.returnId ? { returnId: args.returnId } : {}),
    provider: args.provider, providerRef: c.providerRef, idempotencyKey: args.idempotencyKey,
    carrier: String(c.carrier).slice(0, 60), service: String(c.service).slice(0, 60),
    destinationCountry: order.shippingAddress.countryCode, status: "label_created",
    ...(c.trackingNumber && TRACKING.test(c.trackingNumber) ? { trackingNumber: c.trackingNumber } : {}),
    ...(safeTrackingUrl(c.trackingUrl) ? { trackingUrl: safeTrackingUrl(c.trackingUrl) } : {}),
    ...(typeof c.estimatedDeliveryAt === "number" && Number.isFinite(c.estimatedDeliveryAt) && c.estimatedDeliveryAt > 0 ? { estimatedDeliveryAt: c.estimatedDeliveryAt } : {}),
    createdAt: now, updatedAt: now,
  });
  await serverEvent(db, config, "shipment_created", order, now, { source: args.direction });
  return { shipmentId, created: true };
}

const stateOf = (s: Doc<"commerceShipments">): ShipmentState => ({
  status: s.status, lastEventAt: s.lastEventAt, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt,
  trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, estimatedDeliveryAt: s.estimatedDeliveryAt,
});

export type ShipmentEventOutcome = "applied" | "stale" | "after_terminal" | "unknown_status" | "invalid" | "unknown_shipment" | "duplicate";

/** A carrier event the provider VERIFIED. Recorded once per (provider, event id);
 * applied only if it's newer than what the shipment already shows. */
export async function applyShipmentEvent(db: Db, args: { provider: string; event: ProviderShipmentEvent }, config: CommerceConfig, now: number):
  Promise<{ outcome: ShipmentEventOutcome; reason?: string }> {
  const e = args.event;
  if (typeof e.eventId !== "string" || !e.eventId || e.eventId.length > 200) throw fail("INVALID", "Event id missing");
  const seen = await db.query("commerceShipmentEvents").withIndex("by_provider_event", (q) => q.eq("provider", args.provider).eq("eventId", e.eventId)).first();
  if (seen) return { outcome: "duplicate" };
  const shipment = await db.query("commerceShipments").withIndex("by_provider_ref", (q) => q.eq("provider", args.provider).eq("providerRef", e.providerRef)).first();
  const record = async (outcome: Exclude<ShipmentEventOutcome, "duplicate">, reason?: string) => {
    await db.insert("commerceShipmentEvents", {
      provider: args.provider, eventId: e.eventId, ...(shipment ? { shipmentId: shipment._id } : {}),
      type: String(e.type).slice(0, 40), providerStatus: String(e.providerStatus ?? "").slice(0, 120),
      occurredAt: Number.isFinite(e.occurredAt) ? e.occurredAt : 0, receivedAt: now, outcome, ...(reason ? { reason } : {}),
    });
    return { outcome, ...(reason ? { reason } : {}) };
  };
  if (!shipment) return record("unknown_shipment");
  const d = applyCarrierEvent(stateOf(shipment), e);
  if (d.outcome !== "applied") return record(d.outcome, d.reason);
  const before = shipment.status;
  const n = d.next;
  await db.patch(shipment._id, {
    status: n.status, lastEventAt: n.lastEventAt, lastProviderStatus: String(e.providerStatus ?? "").slice(0, 120), updatedAt: now,
    ...(n.shippedAt !== undefined ? { shippedAt: n.shippedAt } : {}), ...(n.deliveredAt !== undefined ? { deliveredAt: n.deliveredAt } : {}),
    ...(n.trackingNumber !== undefined ? { trackingNumber: n.trackingNumber } : {}), ...(n.trackingUrl !== undefined ? { trackingUrl: n.trackingUrl } : {}),
    ...(n.estimatedDeliveryAt !== undefined ? { estimatedDeliveryAt: n.estimatedDeliveryAt } : {}),
  });
  const order = await getOrder(db, shipment.orderId);
  if (shipment.direction === "outbound" && shipment.fulfillmentId) {
    await rollUp(db, shipment.fulfillmentId, now);
    if (n.status === "delivered" && before !== "delivered") await serverEvent(db, config, "shipment_delivered", order, now);
    if (n.status === "exception" && before !== "exception") await serverEvent(db, config, "delivery_exception", order, now);
  } else if (shipment.direction === "return" && shipment.returnId) {
    // A return in the carrier's hands is "in transit"; receipt is confirmed by staff inspection.
    // (The order's 6A returnStatus stays "approved" while the return is in transit.)
    const r = await db.get(shipment.returnId);
    if (r && RETURN_RECORD_TRANSITIONS[r.status].includes("in_transit") && ["picked_up", "in_transit", "out_for_delivery", "delivered"].includes(n.status)) {
      await db.patch(r._id, { status: "in_transit", history: [...r.history, { status: "in_transit", at: now, by: "provider" }], updatedAt: now });
    }
  }
  return record("applied");
}

/** Shipments → fulfilment → the order's 6A fulfillmentStatus (forward only). */
async function rollUp(db: Db, fulfillmentId: Id<"commerceFulfillments">, now: number) {
  const f = await db.get(fulfillmentId);
  if (!f) return;
  const shipments = (await db.query("commerceShipments").withIndex("by_fulfillment", (q) => q.eq("fulfillmentId", f._id)).collect()).filter((s) => s.direction === "outbound");
  const r = rollUpFulfillment(f.status, shipments.map(stateOf));
  const patch: Partial<Fulfillment> = {};
  // submitted → shipped → delivered, or → failed — one allowed step at a time.
  const path: FulfillmentRecordStatus[] = r.status === "delivered" ? ["shipped", "delivered"] : r.status === "shipped" || r.status === "failed" ? [r.status] : [];
  let status = f.status;
  for (const step of path) if (status !== step && FULFILLMENT_RECORD_TRANSITIONS[status].includes(step)) status = step;
  if (status !== f.status) patch.status = status;
  if (r.shippedAt !== undefined && f.shippedAt === undefined) patch.shippedAt = r.shippedAt;
  if (status === "delivered" && r.deliveredAt !== undefined) patch.deliveredAt = r.deliveredAt;
  if (status === "failed" && !f.failure) patch.failure = { reason: "returned_to_sender", at: now };
  if (Object.keys(patch).length) await db.patch(f._id, { ...patch, updatedAt: now });
  if (f.kind !== "original") return;
  const order = await getOrder(db, f.orderId);
  const originals = await originalsOf(db, order._id);
  const outbound = (await db.query("commerceShipments").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect())
    .filter((s) => s.direction === "outbound" && originals.some((o) => o._id === s.fulfillmentId));
  const implied = impliedOrderFulfillment(order, originals.map((o) => ({ status: o.status, lines: o.lines })), outbound.map(stateOf));
  const next = nextOrderFulfillment(order.fulfillmentStatus, implied);
  if (next === order.fulfillmentStatus) return;
  // The return clock starts at the CARRIER's delivery time of the last original package.
  const deliveredAt = next === "delivered" ? Math.max(...originals.filter((o) => o.status === "delivered").map((o) => o.deliveredAt ?? 0)) : undefined;
  await db.patch(order._id, { fulfillmentStatus: next, updatedAt: now, ...(deliveredAt ? { deliveredAt } : {}) });
}

/** Staff: stop a fulfilment the carrier doesn't have yet. */
export async function cancelFulfillment(db: Db, fulfillmentId: Id<"commerceFulfillments">, reason: string, now: number) {
  const f = await db.get(fulfillmentId);
  if (!f) throw fail("NOT_FOUND", "Fulfilment not found");
  if (f.status === "cancelled") return { changed: false };
  const moving = (await db.query("commerceShipments").withIndex("by_fulfillment", (q) => q.eq("fulfillmentId", f._id)).collect())
    .some((s) => s.shippedAt !== undefined || !["label_created", "cancelled"].includes(s.status));
  if (moving || !moveFulfillment(f, "cancelled")) throw fail("INVALID", "The carrier already has this shipment");
  await db.patch(f._id, { status: "cancelled", cancelledAt: now, failure: { reason: reason.slice(0, 60), at: now }, updatedAt: now });
  return { changed: true };
}

/** Staff: cancel a PAID order that hasn't shipped. Orders are never deleted; the
 * payment stays "paid" until the provider's verified refund arrives. */
export async function cancelPaidOrderBeforeShipment(db: Db, orderId: Id<"commerceOrders">, now: number) {
  const order = await getOrder(db, orderId);
  if (order.fulfillmentStatus === "cancelled") return { changed: false };
  if (!canTransition(FULFILLMENT_TRANSITIONS, order.fulfillmentStatus, "cancelled")) throw fail("INVALID", "This order has already shipped");
  for (const f of await originalsOf(db, order._id)) {
    if (f.status === "pending" || f.status === "submitted") await cancelFulfillment(db, f._id, "order_cancelled", now);
  }
  await db.patch(order._id, { fulfillmentStatus: "cancelled", updatedAt: now });
  return { changed: true };
}
