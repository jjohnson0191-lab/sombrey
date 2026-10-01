// Sombrey commerce — Phase 6E: the ONE writer of physical checkout state.
//
// Used by the customer API (commerce/checkout.ts — the user always comes from
// the auth token) and by trusted internal functions (commerce/internal.ts).
// Every function here runs inside one serializable Convex mutation, so its
// check-then-write is atomic: double taps, retries and duplicate webhooks
// can't create two orders, two payment attempts or two payments.
//
//   createOrderRecord      a priced draft (config prices; idempotent per request key)
//   updateAddress          change the destination before payment (drops the quote)
//   recordQuote            store a server-computed quote on an open draft
//   reservePaymentAttempt  freeze the quoted total for ONE payment attempt
//   cancelCheckout         the customer abandons before any payment started
//   applyVerifiedPayment   a provider-SIGNED payment event (internal only)
//
// Paying never creates Band ownership, activation or pairing — those are
// Phase 6G (ORDER ≠ OWNERSHIP ≠ PAIRING).
//
// Tested against an in-memory database in tests/commerce/checkout.test.ts.

import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { knownProductIds, type CommerceConfig } from "./config.ts";
import { PAYMENT_TRANSITIONS, buildOrderDraft, canTransition, formatOrderNumber, validateAddress, type PaymentStatus, type ShippingAddress } from "./orders.ts";
import { draftStillCurrent, quoteUsable, reusableQuote, type OrderQuote } from "./quotes.ts";
import { validateEvent, type CommerceEventName } from "./events.ts";
import { completeRefund } from "./returnsStore.ts";

type Db = MutationCtx["db"];
type Order = Doc<"commerceOrders">;

/** A client-generated key for one checkout (e.g. a UUID made when the checkout opens). */
export const REQUEST_KEY = /^[A-Za-z0-9_-]{16,64}$/;

const fail = (code: string, message: string) => new ConvexError({ code, message });

async function event(db: Db, config: CommerceConfig, name: CommerceEventName, order: Order, extra: { amountCents?: number; currency?: string } = {}, now: number) {
  // 6I: the order's own product (any physical product), never an assumed Band.
  const productId = order.lines[0]?.productId;
  const rest = { countryCode: order.shippingAddress.countryCode, ...extra };
  const problem = validateEvent({ name, platform: "backend", ...(productId ? { productId } : {}), ...rest }, "server", knownProductIds(config));
  if (problem) throw fail("INVALID", problem);
  await db.insert("commerceEvents", { name, userId: order.userId, at: now, origin: "server", platform: "backend", ...(productId ? { productId } : {}), ...rest, orderId: order._id, configVersion: config.version });
}

/** An order the caller owns — anything else is "not found" (no existence leak). */
export async function ownOrder(db: Db, userId: Id<"users">, orderId: Id<"commerceOrders">): Promise<Order> {
  const o = await db.get(orderId);
  if (!o || o.userId !== userId) throw fail("NOT_FOUND", "Order not found");
  return o;
}

const ADDRESS_FIELDS = ["fullName", "line1", "line2", "city", "region", "postalCode", "countryCode", "phone"] as const;

/** Is a retried checkout request the same as the order its key created? (The
 * address may have been changed since, legitimately — compare against the
 * products only once the address was updated after creation.) */
function sameCheckoutRequest(o: Order, items: Array<{ productId: string; quantity: number }>, address: ShippingAddress): boolean {
  const sameItems = items.length === o.lines.length && items.every((i) => o.lines.some((l) => l.productId === i.productId && l.quantity === i.quantity));
  if (!sameItems) return false;
  if (o.updatedAt !== o.createdAt) return true;
  return ADDRESS_FIELDS.every((k) => (o.shippingAddress[k] ?? null) === (address[k] ?? null));
}

/** 6J: what checkout:requestQuote prices — only the customer's own open checkout
 * (a quote made seconds ago comes back as `recentQuote`, 6I). */
export async function quoteDraft(db: QueryCtx["db"], userId: Id<"users">, orderId: Id<"commerceOrders">, config: CommerceConfig, now: number) {
  const o = await db.get(orderId);
  if (!o || o.userId !== userId) throw fail("NOT_FOUND", "Order not found");
  if (o.paymentStatus !== "awaiting_payment" || o.cancelledAt !== undefined || o.paymentAttempt !== undefined) throw fail("INVALID", "This order can't be re-quoted");
  return { lines: o.lines, currency: o.currency, subtotalCents: o.subtotalCents, shippingAddress: o.shippingAddress, recentQuote: reusableQuote(o.quote, now, config) };
}

/** Still a checkout: unpaid, not cancelled, no payment started. */
function openCheckout(o: Order): boolean {
  return o.paymentStatus === "awaiting_payment" && o.cancelledAt === undefined && o.paymentAttempt === undefined;
}

export async function createOrderRecord(db: Db, args: {
  userId: Id<"users">;
  items: Array<{ productId: string; quantity: number }>;
  shippingAddress: ShippingAddress;
  checkoutRequestKey?: string;
}, config: CommerceConfig, now: number, random: () => number): Promise<{ orderId: Id<"commerceOrders">; orderNumber: string; created: boolean }> {
  if (args.checkoutRequestKey !== undefined) {
    if (!REQUEST_KEY.test(args.checkoutRequestKey)) throw fail("INVALID", "Invalid checkout request");
    const existing = await db.query("commerceOrders").withIndex("by_user_and_request_key", (q) => q.eq("userId", args.userId).eq("checkoutRequestKey", args.checkoutRequestKey)).first();
    if (existing) {
      // 6I: the same key must mean the same request — a retry, never a different order.
      if (!sameCheckoutRequest(existing, args.items, args.shippingAddress)) throw fail("CONFLICT", "That checkout request was already used for a different order");
      return { orderId: existing._id, orderNumber: existing.orderNumber, created: false };
    }
    const mine = await db.query("commerceOrders").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect();
    if (mine.filter((o) => o.checkoutRequestKey !== undefined && openCheckout(o)).length >= config.checkout.maxOpenCheckoutsPerUser) {
      throw fail("TOO_MANY_OPEN_CHECKOUTS", "Finish or cancel an open checkout first");
    }
  }
  const r = buildOrderDraft(config, { items: args.items, shippingAddress: args.shippingAddress });
  if (!r.ok) throw fail("INVALID", r.error);
  let orderNumber = formatOrderNumber(random);
  for (let i = 0; i < 5 && (await db.query("commerceOrders").withIndex("by_order_number", (q) => q.eq("orderNumber", orderNumber)).first()); i++) {
    orderNumber = formatOrderNumber(random);
  }
  const { returnStatus: _r, ...draft } = r.draft;
  const orderId = await db.insert("commerceOrders", {
    userId: args.userId, orderNumber, ...draft, returnStatus: "none",
    returnPolicy: { windowDays: config.returns.windowDays, eligibleConditions: [...config.returns.eligibleConditions] },
    shipments: [], createdAt: now, updatedAt: now,
    ...(args.checkoutRequestKey !== undefined ? { checkoutRequestKey: args.checkoutRequestKey } : {}),
  });
  return { orderId, orderNumber, created: true };
}

export async function updateAddress(db: Db, userId: Id<"users">, orderId: Id<"commerceOrders">, address: ShippingAddress, config: CommerceConfig, now: number) {
  const o = await ownOrder(db, userId, orderId);
  if (!openCheckout(o)) throw fail("INVALID", "This order can't be changed any more");
  const problem = validateAddress(address, config);
  if (problem) throw fail("INVALID", problem);
  // A new destination invalidates the quote (shipping and tax depend on it).
  await db.patch(o._id, { shippingAddress: address, quote: undefined, shippingCents: null, taxCents: null, totalCents: null, updatedAt: now });
}

export async function recordQuote(db: Db, userId: Id<"users">, orderId: Id<"commerceOrders">, quote: OrderQuote, config: CommerceConfig, now: number) {
  const o = await ownOrder(db, userId, orderId);
  if (!openCheckout(o)) throw fail("INVALID", "This order can't be re-quoted");
  if (!draftStillCurrent(o, config)) throw fail("CHECKOUT_OUTDATED", "The Band's price or availability changed — please start again");
  if (quote.subtotalCents !== o.subtotalCents || quote.currency !== o.currency) throw fail("INVALID", "Quote doesn't match the order");
  await db.patch(o._id, {
    quote,
    shippingCents: quote.shipping.status === "quoted" ? quote.shipping.amountCents : null,
    taxCents: quote.tax.status === "quoted" ? quote.tax.amountCents : null,
    totalCents: quote.totalCents,
    updatedAt: now,
  });
  await event(db, config, "band_quote_requested", o, {}, now);
}

export type PaymentReservation =
  | { kind: "new" | "existing"; attempt: NonNullable<Order["paymentAttempt"]>; orderNumber: string }
  | { kind: "refused"; reason: "quote_missing" | "quote_expired" | "quote_incomplete" | "payment_in_progress" | "not_open" | "checkout_outdated" | "already_paid" };

/** Freezes the quoted total for exactly one payment attempt. The same quote
 * returns the same attempt (and the same provider idempotency key). */
export async function reservePaymentAttempt(db: Db, userId: Id<"users">, orderId: Id<"commerceOrders">, provider: string, config: CommerceConfig, now: number): Promise<PaymentReservation> {
  const o = await ownOrder(db, userId, orderId);
  // 6J: the provider's verified event can beat the app's retry — a paid order
  // never hands out its payment session again.
  if (["authorized", "paid", "partially_refunded", "refunded"].includes(o.paymentStatus)) return { kind: "refused", reason: "already_paid" };
  if (o.paymentAttempt) {
    return o.quote && o.paymentAttempt.quoteId === o.quote.quoteId
      ? { kind: "existing", attempt: o.paymentAttempt, orderNumber: o.orderNumber }
      : { kind: "refused", reason: "payment_in_progress" };
  }
  if (o.paymentStatus !== "awaiting_payment" || o.cancelledAt !== undefined) return { kind: "refused", reason: "not_open" };
  if (!draftStillCurrent(o, config)) return { kind: "refused", reason: "checkout_outdated" };
  if (!o.quote) return { kind: "refused", reason: "quote_missing" };
  if (!o.quote.complete || o.quote.totalCents === null) return { kind: "refused", reason: "quote_incomplete" };
  if (!quoteUsable(o.quote, now)) return { kind: "refused", reason: "quote_expired" };
  // Integrity: the stored total is exactly subtotal + shipping + tax.
  const sum = o.subtotalCents + (o.shippingCents ?? NaN) + (o.taxCents ?? NaN);
  if (!Number.isSafeInteger(sum) || sum !== o.quote.totalCents || sum !== o.totalCents) return { kind: "refused", reason: "quote_incomplete" };
  const attempt = {
    provider, idempotencyKey: `${o._id}:${o.quote.quoteId}`, quoteId: o.quote.quoteId,
    amountCents: o.quote.totalCents, currency: o.currency, startedAt: now,
  };
  await db.patch(o._id, { paymentAttempt: attempt, provider: { name: provider }, updatedAt: now });
  await event(db, config, "band_payment_started", o, {}, now);
  return { kind: "new", attempt, orderNumber: o.orderNumber };
}

/** Records the provider's session/payment id on the attempt it belongs to. */
export async function attachProviderRef(db: Db, orderId: Id<"commerceOrders">, idempotencyKey: string, providerRef: string, now: number) {
  const o = await db.get(orderId);
  if (!o?.paymentAttempt || o.paymentAttempt.idempotencyKey !== idempotencyKey) throw fail("INVALID", "No such payment attempt");
  if (o.paymentAttempt.providerRef && o.paymentAttempt.providerRef !== providerRef) throw fail("INVALID", "Payment attempt already has a provider reference");
  await db.patch(o._id, { paymentAttempt: { ...o.paymentAttempt, providerRef }, provider: { name: o.paymentAttempt.provider, paymentId: providerRef }, updatedAt: now });
}

/** The customer abandons a checkout. Only before a payment was started — once
 * a provider may be charging, only a verified provider event changes it. */
export async function cancelCheckout(db: Db, userId: Id<"users">, orderId: Id<"commerceOrders">, now: number) {
  const o = await ownOrder(db, userId, orderId);
  if (o.cancelledAt !== undefined) return { changed: false };
  if (!openCheckout(o)) throw fail("INVALID", o.paymentAttempt ? "A payment is in progress" : "This order can't be cancelled here");
  await db.patch(o._id, { paymentStatus: "cancelled", cancelledAt: now, updatedAt: now });
  return { changed: true };
}

export type PaymentOutcome = "applied" | "unchanged" | "rejected" | "duplicate" | "conflict";

const EVENT_TO_STATUS: Record<string, PaymentStatus> = {
  authorized: "authorized", paid: "paid", failed: "failed", cancelled: "cancelled", refunded: "refunded", partially_refunded: "partially_refunded",
};

/** A payment event the provider SIGNED (verified before this is called). Applied
 * once per provider event id; amounts must match the frozen attempt exactly. */
export async function applyVerifiedPayment(db: Db, args: {
  orderId: Id<"commerceOrders">;
  provider: string;
  /** `idempotencyKey`: the attempt key Sombrey gave the provider, echoed back in
   * the signed event — how an event is bound to its attempt before the
   * provider's own reference has been recorded (a webhook can beat the app). */
  event: { eventId: string; providerRef: string; type: string; amountCents: number; currency: string; idempotencyKey?: string };
}, config: CommerceConfig, now: number): Promise<{ outcome: PaymentOutcome; reason?: string }> {
  const e = args.event;
  if (typeof e.eventId !== "string" || !e.eventId || e.eventId.length > 200 || typeof e.providerRef !== "string" || !e.providerRef || e.providerRef.length > 120) {
    return { outcome: "rejected", reason: "malformed_event" };
  }
  const seen = await db.query("commercePaymentEvents").withIndex("by_provider_event", (q) => q.eq("provider", args.provider).eq("eventId", e.eventId)).first();
  if (seen) {
    // 6I: the same event id with different contents is never applied (nor recorded twice).
    const same = seen.type === e.type && seen.amountCents === e.amountCents && seen.currency === e.currency && seen.orderId === args.orderId;
    return same ? { outcome: "duplicate" } : { outcome: "conflict", reason: "event_id_reused_with_different_contents" };
  }
  const record = async (outcome: Exclude<PaymentOutcome, "duplicate" | "conflict">, reason?: string) => {
    await db.insert("commercePaymentEvents", {
      provider: args.provider, eventId: e.eventId, orderId: args.orderId, type: e.type, amountCents: e.amountCents, currency: e.currency,
      outcome, ...(reason ? { reason } : {}), receivedAt: now,
    });
    return { outcome, ...(reason ? { reason } : {}) };
  };
  const o = await db.get(args.orderId);
  const to = EVENT_TO_STATUS[e.type];
  if (!o || !to) return record("rejected", !o ? "unknown_order" : "unknown_event_type");
  const a = o.paymentAttempt;
  if (!a || a.provider !== args.provider) return record("rejected", "not_this_payment");
  if (a.providerRef !== undefined ? a.providerRef !== e.providerRef : e.idempotencyKey !== a.idempotencyKey) return record("rejected", "not_this_payment");
  if (!Number.isSafeInteger(e.amountCents) || e.amountCents < 0 || e.currency !== a.currency) return record("rejected", "amount_mismatch");
  if ((to === "authorized" || to === "paid") && (e.amountCents !== a.amountCents || e.amountCents !== o.totalCents)) return record("rejected", "amount_mismatch");
  // 6F: a refund event carries the amount refunded BY THAT EVENT. Refunds add up
  // and can never exceed what was captured; "refunded" means fully refunded.
  if (to === "partially_refunded" || to === "refunded") {
    const already = o.refundedCents ?? 0;
    const after = already + e.amountCents;
    if (e.amountCents <= 0 || after > a.amountCents) return record("rejected", "amount_mismatch");
    if (to === "partially_refunded" && after === a.amountCents) return record("rejected", "amount_mismatch");
    if (to === "refunded" && after !== a.amountCents) return record("rejected", "amount_mismatch");
    if (o.paymentStatus !== to && !canTransition(PAYMENT_TRANSITIONS, o.paymentStatus, to)) return record("rejected", "invalid_transition");
    await db.patch(o._id, { paymentStatus: to, refundedCents: after, updatedAt: now });
    await completeRefund(db, o._id, e.amountCents, config, now);
    return record("applied");
  }
  if (o.paymentStatus === to) return record("unchanged");
  if (!canTransition(PAYMENT_TRANSITIONS, o.paymentStatus, to)) return record("rejected", "invalid_transition");
  await db.patch(o._id, {
    paymentStatus: to, updatedAt: now,
    ...(to === "paid" ? { paidAt: now } : {}),
    ...(a.providerRef === undefined ? { paymentAttempt: { ...a, providerRef: e.providerRef } } : {}),
    // The attempt is kept even after "failed": the provider may still report
    // the same payment as paid (a retried charge), and that must be recorded.
  });
  if (to === "paid") {
    await event(db, config, "band_checkout_completed", o, { amountCents: e.amountCents, currency: e.currency }, now);
  }
  return record("applied");
}
