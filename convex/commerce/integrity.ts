// Sombrey commerce, Phase 6I — a read-only integrity report.
//
// Finds records that disagree with each other (a device marked activated with
// no live ownership, two live ownerships of one device, an order whose total
// isn't its parts, refunds above what was captured, shipments with no parent…).
// It REPORTS; it never repairs. Any repair is a deliberate, audited staff action
// through the existing domain mutations (deactivate, revoke, cancel, refund) —
// there is no bulk "fix" and nothing deletes. Ids and counts only: no address,
// name, hardware id or provider reference leaves this module.
//
// Pure — tested in tests/commerce/hardening.test.ts. Served to owner/admin by
// commerce/staffIntegrity:integrityReport.

import { OWNED_STATUSES, type OwnershipStatus } from "./ownership.ts";
import { orderTotal } from "./orders.ts";

type Id = string;
export type IntegrityInput = {
  orders: Array<{ _id: Id; subtotalCents: number; shippingCents: number | null; taxCents: number | null; totalCents: number | null;
    paymentStatus: string; refundedCents?: number; paymentAttempt?: { amountCents: number } | null; lines: Array<{ quantity: number; unitPriceCents: number }> }>;
  fulfillments: Array<{ _id: Id; orderId: Id }>;
  shipments: Array<{ _id: Id; orderId: Id; fulfillmentId?: Id; returnId?: Id; direction: string }>;
  returns: Array<{ _id: Id; orderId: Id }>;
  devices: Array<{ _id: Id; status: string; ownerUserId?: Id; currentOwnershipId?: Id }>;
  ownerships: Array<{ _id: Id; userId: Id; deviceId?: Id; status: OwnershipStatus }>;
};

export type IntegrityIssue = { kind: IntegrityKind; ids: Id[] };
export type IntegrityKind =
  | "order_total_mismatch" | "order_subtotal_mismatch" | "refunded_more_than_captured" | "paid_without_payment_attempt"
  | "fulfillment_without_order" | "shipment_without_parent" | "return_without_order"
  | "device_activated_without_live_ownership" | "device_with_several_live_ownerships" | "live_ownership_of_ended_device";

const PAID_LIKE = ["paid", "partially_refunded", "refunded"];
const live = (s: OwnershipStatus) => OWNED_STATUSES.includes(s);

export function auditCommerceIntegrity(d: IntegrityInput): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (kind: IntegrityKind, ...ids: Id[]) => issues.push({ kind, ids });
  const orderIds = new Set(d.orders.map((o) => o._id));
  const fulfillmentIds = new Set(d.fulfillments.map((f) => f._id));
  const returnIds = new Set(d.returns.map((r) => r._id));

  for (const o of d.orders) {
    const lines = o.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
    if (lines !== o.subtotalCents) add("order_subtotal_mismatch", o._id);
    if (o.totalCents !== null && o.totalCents !== orderTotal(o.subtotalCents, o.shippingCents, o.taxCents)) add("order_total_mismatch", o._id);
    const captured = o.paymentAttempt?.amountCents ?? 0;
    if ((o.refundedCents ?? 0) > captured) add("refunded_more_than_captured", o._id);
    if (PAID_LIKE.includes(o.paymentStatus) && !o.paymentAttempt) add("paid_without_payment_attempt", o._id);
  }
  for (const f of d.fulfillments) if (!orderIds.has(f.orderId)) add("fulfillment_without_order", f._id);
  for (const s of d.shipments) {
    const parentOk = orderIds.has(s.orderId) && (s.direction === "outbound" ? s.fulfillmentId !== undefined && fulfillmentIds.has(s.fulfillmentId) : s.returnId !== undefined && returnIds.has(s.returnId));
    if (!parentOk) add("shipment_without_parent", s._id);
  }
  for (const r of d.returns) if (!orderIds.has(r.orderId)) add("return_without_order", r._id);

  const liveByDevice = new Map<Id, Id[]>();
  for (const w of d.ownerships) if (w.deviceId && live(w.status)) liveByDevice.set(w.deviceId, [...(liveByDevice.get(w.deviceId) ?? []), w._id]);
  for (const dev of d.devices) {
    const owners = liveByDevice.get(dev._id) ?? [];
    if (owners.length > 1) add("device_with_several_live_ownerships", dev._id, ...owners);
    if (dev.status === "activated" && owners.length === 0) add("device_activated_without_live_ownership", dev._id);
    if (dev.status !== "activated" && owners.length > 0) add("live_ownership_of_ended_device", dev._id, ...owners);
  }
  return issues;
}
