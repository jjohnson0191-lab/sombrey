import type { SubscriptionTier } from "../lib/roles.js";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

export const getCurrentUserInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
  },
});

export const saveCustomerId = internalMutation({
  args: { userId: v.id("users"), customerId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { customerId: args.customerId });
  },
});

/** #16 — Write the authoritative subscription tier back to the users table. */
export const updateSubscriptionTier = internalMutation({
  args: { userId: v.id("users"), subscriptionTier: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { subscriptionTier: args.subscriptionTier as SubscriptionTier });
  },
});
