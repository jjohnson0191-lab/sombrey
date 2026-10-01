// Sombrey commerce — Phase 6F: fulfilment, shipments, tracking and returns (pure rules).
//
// Domain separation: ORDER ≠ PAYMENT ≠ FULFILLMENT ≠ SHIPMENT ≠ DELIVERY ≠
// OWNERSHIP ≠ PAIRING. Nothing here creates, moves or ends Band ownership,
// activation or pairing (Phase 6G).
//
//   fulfilment  one unit of work to send goods for an order — the original
//               shipment-of-record, or a later replacement — listing which
//               ORDER LINES (product id + quantity) it covers. Product-agnostic.
//   shipment    one physical package with a carrier, outbound or return. An
//               order may have several; a fulfilment may have several.
//   events      provider-normalized carrier events, applied by provider time:
//               stale (older than the last applied) and post-terminal events
//               are recorded, never applied — nothing moves backwards.
//
// 6A's order-level machines (orders.ts) stay the single source of truth for
// the ORDER: shipments roll up into fulfilments, fulfilments into the order's
// fulfillmentStatus, moved only along FULFILLMENT_TRANSITIONS. Returns keep
// their own detailed record and roll up into the order's returnStatus.
//
// Nothing here invents a tracking number, a status, a date or an ETA: every
// value comes from a provider (or a staff decision, for return inspection).
//
// Pure — tested in tests/commerce/fulfillment.test.ts.

import { physicalProduct, type CommerceConfig } from "./config.ts";
import {
  FULFILLMENT_TRANSITIONS, RETURN_TRANSITIONS, canTransition, returnEligibility,
  type FulfillmentStatus, type OrderLine, type PaymentStatus, type ReturnStatus,
} from "./orders.ts";

// ─── Shipments ───────────────────────────────────────────────────────────────

export const SHIPMENT_STATUSES = ["label_created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception", "returned_to_sender", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
/** What a provider adapter may report (it maps its own codes onto these). */
export const SHIPMENT_EVENT_TYPES = [...SHIPMENT_STATUSES, "arrived_at_facility"] as const;
export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];
export const TERMINAL_SHIPMENT: readonly ShipmentStatus[] = ["delivered", "returned_to_sender", "cancelled"];
const MOVING: readonly ShipmentStatus[] = ["picked_up", "in_transit", "out_for_delivery", "delivered"];

export type ShipmentState = {
  status: ShipmentStatus;
  lastEventAt?: number;
  shippedAt?: number;
  deliveredAt?: number;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDeliveryAt?: number;
};

export type CarrierEvent = {
  eventId: string;
  type: string;
  /** The provider's own status code/text, kept for support (never shown as ours). */
  providerStatus: string;
  /** When the CARRIER says it happened (provider time, not receipt time). */
  occurredAt: number;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDeliveryAt?: number;
};

export type EventDecision =
  | { outcome: "applied"; next: ShipmentState }
  | { outcome: "stale" | "after_terminal" | "unknown_status" | "invalid"; reason: string };

const TRACKING = /^[A-Za-z0-9-]{4,64}$/;
const validTime = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function safeTrackingUrl(u: unknown): string | undefined {
  if (typeof u !== "string" || u.length > 500) return undefined;
  try { return new URL(u).protocol === "https:" ? u : undefined; } catch { return undefined; }
}

/** What a carrier event does to a shipment. Ordered by the carrier's own
 * timestamps; terminal states (delivered, returned to sender, cancelled) are final. */
export function applyCarrierEvent(s: ShipmentState, e: CarrierEvent): EventDecision {
  if (!(SHIPMENT_EVENT_TYPES as readonly string[]).includes(e.type)) return { outcome: "unknown_status", reason: `unmapped:${String(e.type).slice(0, 40)}` };
  if (!validTime(e.occurredAt)) return { outcome: "invalid", reason: "no_event_time" };
  if (TERMINAL_SHIPMENT.includes(s.status)) return { outcome: "after_terminal", reason: s.status };
  if (s.lastEventAt !== undefined && e.occurredAt <= s.lastEventAt) return { outcome: "stale", reason: "older_than_current" };
  const status: ShipmentStatus = e.type === "arrived_at_facility" ? "in_transit" : (e.type as ShipmentStatus);
  if (status === "cancelled" && s.status !== "label_created") return { outcome: "invalid", reason: "cancel_after_pickup" };
  const next: ShipmentState = { ...s, status, lastEventAt: e.occurredAt };
  if (MOVING.includes(status) && s.shippedAt === undefined) next.shippedAt = e.occurredAt;
  if (status === "delivered") next.deliveredAt = e.occurredAt;
  if (e.trackingNumber !== undefined && TRACKING.test(e.trackingNumber)) next.trackingNumber = e.trackingNumber;
  const url = safeTrackingUrl(e.trackingUrl);
  if (url) next.trackingUrl = url;
  if (validTime(e.estimatedDeliveryAt)) next.estimatedDeliveryAt = e.estimatedDeliveryAt;
  return { outcome: "applied", next };
}

// ─── Fulfilments ─────────────────────────────────────────────────────────────

export const FULFILLMENT_RECORD_STATUSES = ["pending", "submitted", "shipped", "delivered", "failed", "cancelled"] as const;
export type FulfillmentRecordStatus = (typeof FULFILLMENT_RECORD_STATUSES)[number];
export const FULFILLMENT_RECORD_TRANSITIONS: Record<FulfillmentRecordStatus, FulfillmentRecordStatus[]> = {
  pending: ["submitted", "cancelled", "failed"],
  submitted: ["shipped", "cancelled", "failed"],
  shipped: ["delivered", "failed"],
  delivered: [],
  failed: [],
  cancelled: [],
};

export type FulfillmentLine = { productId: string; quantity: number };

/** A fulfilment's state from its OUTBOUND shipments (none yet → unchanged). */
export function rollUpFulfillment(current: FulfillmentRecordStatus, shipments: ShipmentState[]):
  { status: FulfillmentRecordStatus; shippedAt?: number; deliveredAt?: number } {
  const live = shipments.filter((s) => s.status !== "cancelled");
  if (!live.length) return { status: current };
  const shippedAt = Math.min(...live.map((s) => s.shippedAt ?? Infinity));
  if (live.every((s) => s.status === "delivered")) {
    return { status: "delivered", shippedAt: Number.isFinite(shippedAt) ? shippedAt : undefined, deliveredAt: Math.max(...live.map((s) => s.deliveredAt!)) };
  }
  if (live.every((s) => s.status === "returned_to_sender" || s.status === "delivered") && live.some((s) => s.status === "returned_to_sender")) return { status: "failed" };
  if (Number.isFinite(shippedAt)) return { status: "shipped", shippedAt };
  return { status: current };
}

/** The ORDER's 6A fulfillmentStatus implied by its ORIGINAL fulfilments and their
 * outbound shipments. Replacements don't change the order's own delivery. */
export function impliedOrderFulfillment(order: { lines: OrderLine[] }, originals: Array<{ status: FulfillmentRecordStatus; lines: FulfillmentLine[] }>,
  outbound: ShipmentState[]): FulfillmentStatus | null {
  const active = originals.filter((f) => f.status !== "cancelled");
  if (!active.length) return null;
  const covered = (pid: string) => active.filter((f) => f.status === "delivered").flatMap((f) => f.lines).filter((l) => l.productId === pid).reduce((n, l) => n + l.quantity, 0);
  const allDelivered = order.lines.every((l) => covered(l.productId) >= l.quantity);
  if (allDelivered) return "delivered";
  const live = outbound.filter((s) => !TERMINAL_SHIPMENT.includes(s.status) || s.status === "delivered");
  if (live.some((s) => s.status === "exception")) return "delivery_failed";
  if (active.some((f) => f.status === "shipped" || f.status === "delivered")) return "shipped";
  return "processing";
}

/** Move the order along 6A's FULFILLMENT_TRANSITIONS only (never backwards). */
export function nextOrderFulfillment(current: FulfillmentStatus, implied: FulfillmentStatus | null): FulfillmentStatus {
  if (!implied || implied === current) return current;
  if (canTransition(FULFILLMENT_TRANSITIONS, current, implied)) return implied;
  // unfulfilled → shipped/delivered needs "processing" first; processing → delivered needs "shipped".
  const path: FulfillmentStatus[] = ["unfulfilled", "processing", "shipped", "delivered"];
  let s = current;
  for (const step of path.slice(path.indexOf(current) + 1, path.indexOf(implied) + 1)) {
    if (!canTransition(FULFILLMENT_TRANSITIONS, s, step)) break;
    s = step;
  }
  return s;
}

/** Quantities of each order line not yet covered by an active ORIGINAL fulfilment. */
export function unfulfilledLines(order: { lines: OrderLine[] }, originals: Array<{ status: FulfillmentRecordStatus; lines: FulfillmentLine[] }>): FulfillmentLine[] {
  const taken = (pid: string) => originals.filter((f) => f.status !== "cancelled" && f.status !== "failed").flatMap((f) => f.lines)
    .filter((l) => l.productId === pid).reduce((n, l) => n + l.quantity, 0);
  return order.lines.map((l) => ({ productId: l.productId, quantity: l.quantity - taken(l.productId) })).filter((l) => l.quantity > 0);
}

/** Whether an order may get a NEW original fulfilment. */
export function canFulfill(order: { paymentStatus: PaymentStatus; returnStatus: ReturnStatus; cancelledAt?: number }): { ok: true } | { ok: false; reason: string } {
  if (order.paymentStatus !== "paid") return { ok: false, reason: order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded" ? "refunded" : "not_paid" };
  if (order.cancelledAt !== undefined) return { ok: false, reason: "cancelled" };
  if (order.returnStatus !== "none") return { ok: false, reason: "return_in_progress" };
  return { ok: true };
}

// ─── Customer tracking (real states only) ────────────────────────────────────

/** 6H: an order is shown only to its owner — anyone else gets nothing (no
 * existence leak). The one gate every customer order view goes through. */
export function visibleToCustomer<O extends { userId: string }>(order: O | null | undefined, viewerUserId: string): O | null {
  return order && order.userId === viewerUserId ? order : null;
}

export type TrackingStep = "confirmed" | "preparing" | "shipped" | "in_transit" | "out_for_delivery" | "delivered";

export function customerTracking(order: { paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus },
  outbound: Array<ShipmentState & { carrier: string }>) {
  const paid = order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded";
  const st = (x: ShipmentStatus) => outbound.some((s) => s.status === x);
  const reached: Record<TrackingStep, boolean> = {
    confirmed: paid,
    preparing: paid && order.fulfillmentStatus !== "unfulfilled",
    shipped: outbound.some((s) => s.shippedAt !== undefined),
    in_transit: st("in_transit") || st("out_for_delivery") || st("delivered"),
    out_for_delivery: st("out_for_delivery") || st("delivered"),
    delivered: order.fulfillmentStatus === "delivered",
  };
  return {
    steps: (Object.keys(reached) as TrackingStep[]).map((step) => ({ step, reached: reached[step] })),
    deliveryProblem: st("exception") || st("returned_to_sender"),
    shipments: outbound.filter((s) => s.status !== "cancelled").map((s) => (s.trackingNumber
      ? { tracking: "available" as const, carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl ?? null,
        status: s.status, estimatedDeliveryAt: s.estimatedDeliveryAt ?? null, lastUpdateAt: s.lastEventAt ?? null }
      : { tracking: "unavailable" as const, status: s.status })),
  };
}

/** Staff view: no carrier update for too long, or past the provider's own ETA. */
export function shipmentAttention(s: ShipmentState & { createdAt: number }, now: number, stalledAfterHours: number): "stalled" | "overdue" | "exception" | null {
  if (TERMINAL_SHIPMENT.includes(s.status)) return null;
  if (s.status === "exception") return "exception";
  if (s.estimatedDeliveryAt !== undefined && now > s.estimatedDeliveryAt) return "overdue";
  if (now - (s.lastEventAt ?? s.createdAt) > stalledAfterHours * 3_600_000) return "stalled";
  return null;
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export const RETURN_RECORD_STATUSES = ["requested", "authorized", "in_transit", "received", "refund_approved", "refunded", "rejected", "cancelled"] as const;
export type ReturnRecordStatus = (typeof RETURN_RECORD_STATUSES)[number];
export const RETURN_RECORD_TRANSITIONS: Record<ReturnRecordStatus, ReturnRecordStatus[]> = {
  requested: ["authorized", "rejected", "cancelled"],
  authorized: ["in_transit", "received", "rejected", "cancelled"],
  in_transit: ["received"],
  received: ["refund_approved", "rejected"],
  refund_approved: ["refunded"],
  refunded: [],
  rejected: [],
  cancelled: [],
};
/** The order's 6A returnStatus each return state rolls up to ("none" = nothing in progress). */
export const ORDER_RETURN_STATUS: Record<ReturnRecordStatus, ReturnStatus> = {
  requested: "requested", authorized: "approved", in_transit: "approved", received: "received",
  refund_approved: "received", refunded: "refunded", rejected: "rejected", cancelled: "none",
};

export const RETURN_REASONS = ["changed_mind", "not_as_expected", "fit_or_comfort", "arrived_damaged", "other"] as const;
export const INSPECTION_CONDITIONS = ["unused", "used", "damaged", "incomplete"] as const;
export type InspectionCondition = (typeof INSPECTION_CONDITIONS)[number];

/** Server-side return eligibility. "Unused" is the customer's statement now and
 * a staff inspection on receipt — there is no automatic usage detection. */
export function returnEligibilityFor(order: {
  lines: OrderLine[]; paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus; returnStatus: ReturnStatus;
  deliveredAt?: number; returnPolicy: { windowDays: number; eligibleConditions: string[] };
}, existingReturns: number, config: CommerceConfig, now: number):
  { eligible: true; windowEndsAt: number } | { eligible: false; reason: string; windowEndsAt: number | null } {
  const windowEndsAt = order.deliveredAt !== undefined ? order.deliveredAt + order.returnPolicy.windowDays * 86_400_000 : null;
  if (!order.lines.every((l) => physicalProduct(config, l.productId)?.returnable)) return { eligible: false, reason: "product_not_returnable", windowEndsAt };
  if (existingReturns > 0) return { eligible: false, reason: "return_already_started", windowEndsAt };
  // 6A's rule, against the policy the order was SOLD under; "unused" is the claim checked at inspection.
  const r = returnEligibility(order, order.returnPolicy, "unused", now);
  if (!r.ok) return { eligible: false, reason: r.reason, windowEndsAt };
  return { eligible: true, windowEndsAt: windowEndsAt! };
}

/** The refund for returned lines: their snapshotted unit prices, nothing the
 * client says. Shipping and tax refunds are not decided (docs §10) — excluded. */
export function refundAmountFor(order: { lines: OrderLine[] }, returned: FulfillmentLine[]): number | null {
  let total = 0;
  for (const r of returned) {
    const line = order.lines.find((l) => l.productId === r.productId);
    if (!line || !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > line.quantity) return null;
    total += line.unitPriceCents * r.quantity;
  }
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export { RETURN_TRANSITIONS };
