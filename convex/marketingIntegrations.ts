import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { hasRole } from "./lib/roles.js";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireOwnerCtx(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user || !hasRole(user, "owner")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Owner only" });
  }
  return user;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export const PLATFORMS = [
  "meta_pixel",
  "meta_conversions_api",
  "google_analytics_4",
  "google_tag_manager",
  "google_ads",
  "tiktok_pixel",
  "linkedin_insight",
  "pinterest_tag",
  "x_pixel",
  "snapchat_pixel",
] as const;

export type Platform = typeof PLATFORMS[number];

// ─── Queries ──────────────────────────────────────────────────────────────────

export const listIntegrations = query({
  args: {},
  handler: async (ctx) => {
    await requireOwnerCtx(ctx);
    return ctx.db.query("marketingIntegrations").collect();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const upsertIntegration = mutation({
  args: {
    platform: v.string(),
    pixelId:      v.optional(v.string()),
    trackingId:   v.optional(v.string()),
    apiKey:       v.optional(v.string()),
    apiSecret:    v.optional(v.string()),
    enabled:      v.boolean(),
    notes:        v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireOwnerCtx(ctx);

    const existing = await ctx.db
      .query("marketingIntegrations")
      .withIndex("by_platform", (q) => q.eq("platform", args.platform))
      .unique();

    const now = new Date().toISOString();

    if (existing) {
      await ctx.db.patch(existing._id, {
        pixelId:    args.pixelId,
        trackingId: args.trackingId,
        apiKey:     args.apiKey,
        apiSecret:  args.apiSecret,
        enabled:    args.enabled,
        notes:      args.notes,
        updatedAt:  now,
      });
    } else {
      await ctx.db.insert("marketingIntegrations", {
        platform:   args.platform,
        pixelId:    args.pixelId,
        trackingId: args.trackingId,
        apiKey:     args.apiKey,
        apiSecret:  args.apiSecret,
        enabled:    args.enabled,
        notes:      args.notes,
        createdAt:  now,
        updatedAt:  now,
      });
    }
  },
});

export const toggleIntegration = mutation({
  args: { platform: v.string(), enabled: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    await requireOwnerCtx(ctx);
    const existing = await ctx.db
      .query("marketingIntegrations")
      .withIndex("by_platform", (q) => q.eq("platform", args.platform))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { enabled: args.enabled, updatedAt: new Date().toISOString() });
    }
  },
});

export const deleteIntegration = mutation({
  args: { platform: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await requireOwnerCtx(ctx);
    const existing = await ctx.db
      .query("marketingIntegrations")
      .withIndex("by_platform", (q) => q.eq("platform", args.platform))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
