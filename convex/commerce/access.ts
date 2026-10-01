// Sombrey commerce (Phase 6A) — everything a CLIENT may call.
//
//   publicConfig   → prices, countries and policies to display (anyone)
//   myEntitlements → what the signed-in user may access (computed, never stored;
//                    6D: per-feature access, membership summary, offers)
//   myOrders       → the user's own orders (no provider internals; 6E: stage + quote summary)
//
// Phase 6E: Band checkout (start, address, quote, payment, cancel) lives in
// commerce/checkout.ts — same rules: the user from the token, nothing priced by the client.
//   mySubscription → the user's own subscription state (no transaction ids)
//   recordEvent    → a client-side commerce event (closed list, validated,
//                    rate-limited; money events are server-only)
//   linkAppStoreAccount → (6C, no arguments) records the caller's App Store
//                    appAccountToken, DERIVED HERE from the authenticated
//                    identity, so Apple's notifications can find the account
//
// Phase 6C: the App Store submission action lives in commerce/appStore.ts
// (it verifies Apple's signature and asks Apple for the current status).
//
// There is deliberately NO client mutation that creates, pays, ships,
// delivers, returns, assigns or prices an order, touches a subscription or
// claims a Band — those are internal functions (commerce/internal.ts) run only
// by trusted backend/provider flows. The user always comes from the auth token.

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { COMMERCE_CONFIG, FEATURE_IDS, publicCommerceConfig } from "./config";
import { unlockFor } from "./entitlements";
import { entitlementsFor } from "./gate";
import { orderStage } from "./quotes";
import { validateEvent } from "./events";
import { EVENTS_PER_HOUR } from "./events";
import { linkAccountToken } from "./subscriptionStore";
import { appAccountTokenFor } from "./accountToken";

async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
}

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  return user;
}

/** Prices, countries and policies to display. PROVISIONAL — from convex/commerce/config.ts.
 * 6D: plus what unlocks each feature (from the feature matrix) so the app can
 * explain the Band and Membership without holding any rules itself. */
export const publicConfig = query({
  args: {},
  handler: async () => ({
    ...publicCommerceConfig(COMMERCE_CONFIG),
    featureUnlocks: Object.fromEntries(FEATURE_IDS.map((f) => [f, unlockFor(COMMERCE_CONFIG.featureMatrix[f].requires, COMMERCE_CONFIG)])),
  }),
});

/** What the signed-in user may access — computed from verified facts each
 * time (commerce/gate.ts): the commercial state, capabilities, per-feature
 * access with what would unlock it, the membership summary and which
 * purchase entry points to offer. The app renders this; it never decides it. */
export const myEntitlements = query({
  args: {},
  handler: async (ctx) => entitlementsFor(ctx, await requireUser(ctx)),
});

/** The user's own orders — status, items, amounts, tracking; no provider internals. */
export const myOrders = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const orders = await ctx.db.query("commerceOrders").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(50);
    const now = Date.now();
    return orders.map((o) => ({
      // 6E: the id lets an interrupted checkout resume; the stage is derived from
      // the payment/fulfilment/return machines; the quote shows amounts only.
      orderId: o._id, stage: orderStage({ ...o, quote: o.quote ?? null, paymentAttempt: o.paymentAttempt ?? null }, now),
      quote: o.quote ? {
        complete: o.quote.complete, totalCents: o.quote.totalCents, expiresAt: o.quote.expiresAt,
        shipping: o.quote.shipping.status, tax: o.quote.tax.status,
      } : null,
      orderNumber: o.orderNumber, createdAt: o.createdAt, currency: o.currency, lines: o.lines,
      subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents, totalCents: o.totalCents,
      paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus, returnStatus: o.returnStatus,
      shippingAddress: o.shippingAddress,
      shipments: o.shipments.map(({ carrier, trackingNumber, trackingUrl, status, shippedAt, deliveredAt }) => ({ carrier, trackingNumber, trackingUrl, status, shippedAt, deliveredAt })),
      deliveredAt: o.deliveredAt ?? null,
    }));
  },
});

/** The user's own subscription state (for display) — no transaction ids. */
export const mySubscription = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const subs = await ctx.db.query("commerceSubscriptions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return subs.map((s) => ({
      productId: s.productId, environment: s.environment, status: s.status, autoRenewEnabled: s.autoRenewEnabled,
      purchaseDate: s.purchaseDate, expiresDate: s.expiresDate, gracePeriodExpiresDate: s.gracePeriodExpiresDate ?? null,
      revoked: s.revocationDate !== undefined, lastVerifiedAt: s.lastVerifiedAt,
    }));
  },
});

/** Phase 6C: link the caller's App Store appAccountToken to their account.
 * Takes NO arguments — the token is computed from the authenticated identity's
 * Clerk user id (the same algorithm as the app), so no one can link a token to
 * another account. Called before a purchase so an early App Store notification
 * can be matched; idempotent. */
export const linkAppStoreAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const user = await requireUser(ctx);
    const token = identity ? await appAccountTokenFor(identity.subject) : null;
    if (!token) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    await linkAccountToken(ctx.db, user._id, token, Date.now());
    return { linked: true as const };
  },
});

/** Client-side events only (viewing, starting a purchase, abandoning a checkout). */
export const recordEvent = mutation({
  args: {
    name: v.string(),
    platform: v.string(),
    productId: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const problem = validateEvent(args, "client", [COMMERCE_CONFIG.products.band.id, COMMERCE_CONFIG.products.membership.id]);
    if (problem) throw new ConvexError({ code: "INVALID", message: problem });
    const now = Date.now();
    const recent = await ctx.db.query("commerceEvents")
      .withIndex("by_user_and_at", (q) => q.eq("userId", user._id).gt("at", now - 3_600_000))
      .take(EVENTS_PER_HOUR + 1);
    if (recent.length >= EVENTS_PER_HOUR) return { recorded: false as const };
    await ctx.db.insert("commerceEvents", {
      name: args.name as Doc<"commerceEvents">["name"],
      userId: user._id,
      at: now,
      origin: "client",
      platform: args.platform as "ios" | "web",
      ...(args.productId ? { productId: args.productId } : {}),
      ...(args.countryCode ? { countryCode: args.countryCode } : {}),
      ...(args.source ? { source: args.source } : {}),
      configVersion: COMMERCE_CONFIG.version,
    });
    return { recorded: true as const };
  },
});
