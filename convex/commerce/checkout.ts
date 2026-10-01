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
import { quoteDraft, attachProviderRef, cancelCheckout as cancelCheckoutRecord, createOrderRecord, ownOrder, recordQuote, reservePaymentAttempt, updateAddress } from "./checkoutStore";
import type { OrderQuote } from "./quotes";
import { providersFor } from "./providers";
import { beginPaymentFlow, requestQuoteFlow, type BeginPaymentResult } from "./flows";

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
  handler: async (ctx, args): Promise<ReturnType<typeof publicQuote>> => publicQuote(await requestQuoteFlow({
    draft: async () => {
      const d = await ctx.runQuery(internal.commerce.checkout.draftForQuote, { orderId: args.orderId });
      return { ...d, recentQuote: d.recentQuote as OrderQuote | null };
    },
    providers: providersFor(COMMERCE_CONFIG), config: COMMERCE_CONFIG, now: Date.now(), quoteId: crypto.randomUUID(),
    store: (quote) => ctx.runMutation(internal.commerce.checkout.storeQuote, { orderId: args.orderId, quote }),
  })),
});

export type { BeginPaymentResult } from "./flows";

export const beginPayment = action({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args): Promise<BeginPaymentResult> => beginPaymentFlow({
    payment: providersFor(COMMERCE_CONFIG).payment,
    methods: [...COMMERCE_CONFIG.checkout.methods],
    reserve: (provider) => ctx.runMutation(internal.commerce.checkout.reservePayment, { orderId: args.orderId, provider }),
    attach: (idempotencyKey, providerRef) => ctx.runMutation(internal.commerce.checkout.attachRef, { orderId: args.orderId, idempotencyKey, providerRef }),
  }),
});

// ─── Internal steps of the actions above (the caller's identity carries through) ──

export const draftForQuote = internalQuery({
  args: { orderId: v.id("commerceOrders") },
  handler: async (ctx, args) => quoteDraft(ctx.db, (await requireUser(ctx))._id, args.orderId, COMMERCE_CONFIG, Date.now()),
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
