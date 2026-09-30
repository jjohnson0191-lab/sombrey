// Sombrey commerce (Phase 6A) — everything a CLIENT may call.
//
//   publicConfig   → prices, countries and policies to display (anyone)
//   myEntitlements → what the signed-in user may access (computed, never stored)
//   myOrders       → the user's own orders (no provider internals)
//   mySubscription → the user's own subscription state (no transaction ids)
//   recordEvent    → a client-side commerce event (closed list, validated,
//                    rate-limited; money events are server-only)
//
// There is deliberately NO client mutation that creates, pays, ships,
// delivers, returns, assigns or prices an order, touches a subscription or
// claims a Band — those are internal functions (commerce/internal.ts) run only
// by trusted backend/provider flows. The user always comes from the auth token.

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { hasPremiumAccess } from "../lib/roles.js";
import { COMMERCE_CONFIG, publicCommerceConfig } from "./config";
import { computeEntitlements } from "./entitlements";
import { validateEvent } from "./events";
import { EVENTS_PER_HOUR } from "./events";
import { toSubscriptionRecord } from "./records";

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

/** Prices, countries and policies to display. PROVISIONAL — from convex/commerce/config.ts. */
export const publicConfig = query({
  args: {},
  handler: async () => publicCommerceConfig(COMMERCE_CONFIG),
});

/** What the signed-in user may access — computed from verified facts each time. */
export const myEntitlements = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const ownership = await ctx.db.query("bandOwnership").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const subscriptions = await ctx.db.query("commerceSubscriptions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const paired = await ctx.db.query("wearableDevices").withIndex("by_user", (q) => q.eq("userId", user._id)).take(10);
    return computeEntitlements({
      ownership: ownership.map((o) => ({ status: o.status, source: o.source })),
      subscriptions: subscriptions.map(toSubscriptionRecord),
      legacyPremium: hasPremiumAccess(user),
      pairedDevices: paired.length,
    }, COMMERCE_CONFIG, Date.now());
  },
});

/** The user's own orders — status, items, amounts, tracking; no provider internals. */
export const myOrders = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const orders = await ctx.db.query("commerceOrders").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(50);
    return orders.map((o) => ({
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
      purchaseDate: s.purchaseDate, expiresDate: s.expiresDate, lastVerifiedAt: s.lastVerifiedAt,
    }));
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
