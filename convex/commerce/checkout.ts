// Sombrey commerce — Phase 6E: physical Band checkout, the customer API.
//
//   startBandCheckout      a draft order for N Bands to an address (idempotent
//                          per requestKey: double taps / retries → same order)
//   updateShippingAddress  before payment only (drops the quote)
//   requestQuote           shipping + tax from real providers → a quote that
//                          expires; "unavailable" while no provider exists
//   beginPayment           a payment session for exactly the quoted total;
//                          "payment_unavailable" while no provider exists
//   cancelCheckout         before any payment started
// Reads: commerce/access:myOrders.
//
// The client sends a request key, a quantity, an address and an order id —
// never a price, total, currency, shipping, tax, status or owner. Prices come
// from config.ts; amounts from providers; "paid" only from a VERIFIED provider
// event (internal.commerce.internal.applyPaymentUpdate). The Band is a
// physical good: never Apple In-App Purchase. Nothing here creates Band
// ownership, activation or pairing (Phase 6G).

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { COMMERCE_CONFIG } from "./config";
import { orderQuote, shippingAddress } from "./validators";
import { attachProviderRef, cancelCheckout as cancelCheckoutRecord, createOrderRecord, ownOrder, recordQuote, reservePaymentAttempt, updateAddress } from "./checkoutStore";
import { computeQuote, reusableQuote, type OrderQuote } from "./quotes";
import { providersFor } from "./providers";

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  return user;
}

/** What the app may see of a quote — amounts and states, no provider references. */
function publicQuote(q: OrderQuote) {
  const part = (c: OrderQuote["shipping"]) => (c.status === "quoted" ? { status: "quoted" as const, amountCents: c.amountCents } : { status: "unavailable" as const, reason: c.reason });
  return {
    complete: q.complete, subtotalCents: q.subtotalCents, shipping: part(q.shipping), tax: part(q.tax),
    totalCents: q.totalCents, currency: q.currency, expiresAt: q.expiresAt,
  };
}

export const startBandCheckout = mutation({
  args: { requestKey: v.string(), quantity: v.number(), shippingAddress },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const r = await createOrderRecord(ctx.db, {
      userId: user._id, items: [{ productId: COMMERCE_CONFIG.products.band.id, quantity: args.quantity }],
      shippingAddress: args.shippingAddress, checkoutRequestKey: args.requestKey,
    }, COMMERCE_CONFIG, Date.now(), Math.random);
    return { orderId: r.orderId, orderNumber: r.orderNumber, created: r.created };
  },
});

export const updateShippingAddress = mutation({
  args: { orderId: v.id("commerceOrders"), shippingAddress },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await updateAddress(ctx.db, user._id, args.orderId, args.shippingAddress, COMMERCE_CONFIG, Date.now());
    return null;
  },
});

export const cancelCheckout = mutation({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await cancelCheckoutRecord(ctx.db, user._id, args.orderId, Date.now());
  },
});

export const requestQuote = action({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args): Promise<ReturnType<typeof publicQuote>> => {
    const draft = await ctx.runQuery(internal.commerce.checkout.draftForQuote, { orderId: args.orderId });
    if (draft.recentQuote) return publicQuote(draft.recentQuote as OrderQuote);
    const quote = await computeQuote(draft, providersFor(COMMERCE_CONFIG), COMMERCE_CONFIG, Date.now(), crypto.randomUUID(), COMMERCE_CONFIG.version);
    await ctx.runMutation(internal.commerce.checkout.storeQuote, { orderId: args.orderId, quote });
    return publicQuote(quote);
  },
});

export type BeginPaymentResult =
  | { status: "ready"; provider: string; clientHandoff: Record<string, string> }
  | { status: "payment_unavailable" | "quote_missing" | "quote_expired" | "quote_incomplete" | "payment_in_progress" | "not_open" | "checkout_outdated" };

export const beginPayment = action({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args): Promise<BeginPaymentResult> => {
    const payment = providersFor(COMMERCE_CONFIG).payment;
    // No provider is integrated yet: nothing is reserved, nothing is charged.
    if (!payment) return { status: "payment_unavailable" };
    const r = await ctx.runMutation(internal.commerce.checkout.reservePayment, { orderId: args.orderId, provider: payment.name });
    if (r.kind === "refused") return { status: r.reason };
    const session = await payment.createSession({
      orderNumber: r.orderNumber, amountCents: r.attempt.amountCents, currency: r.attempt.currency,
      idempotencyKey: r.attempt.idempotencyKey, methods: [...COMMERCE_CONFIG.checkout.methods],
    }).catch(() => ({ ok: false as const, reason: "provider_error" as const }));
    // The attempt stays reserved: a retry uses the same idempotency key, so the
    // provider returns the same session rather than a second charge.
    if (!session.ok) return { status: "payment_unavailable" };
    await ctx.runMutation(internal.commerce.checkout.attachRef, { orderId: args.orderId, idempotencyKey: r.attempt.idempotencyKey, providerRef: session.providerRef });
    return { status: "ready", provider: payment.name, clientHandoff: session.clientHandoff };
  },
});

// ─── Internal steps of the actions above (the caller's identity carries through) ──

export const draftForQuote = internalQuery({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const o = await ctx.db.get(args.orderId);
    if (!o || o.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Order not found" });
    if (o.paymentStatus !== "awaiting_payment" || o.cancelledAt !== undefined || o.paymentAttempt !== undefined) {
      throw new ConvexError({ code: "INVALID", message: "This order can't be re-quoted" });
    }
    return { lines: o.lines, currency: o.currency, subtotalCents: o.subtotalCents, shippingAddress: o.shippingAddress, recentQuote: reusableQuote(o.quote, Date.now(), COMMERCE_CONFIG) };
  },
});

export const storeQuote = internalMutation({
  args: { orderId: v.id("commerceOrders"), quote: orderQuote },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await recordQuote(ctx.db, user._id, args.orderId, args.quote as OrderQuote, COMMERCE_CONFIG, Date.now());
    return null;
  },
});

export const reservePayment = internalMutation({
  args: { orderId: v.id("commerceOrders"), provider: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await reservePaymentAttempt(ctx.db, user._id, args.orderId, args.provider, COMMERCE_CONFIG, Date.now());
  },
});

export const attachRef = internalMutation({
  args: { orderId: v.id("commerceOrders"), idempotencyKey: v.string(), providerRef: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ownOrder(ctx.db, user._id, args.orderId as Id<"commerceOrders">);
    await attachProviderRef(ctx.db, args.orderId, args.idempotencyKey, args.providerRef, Date.now());
    return null;
  },
});
