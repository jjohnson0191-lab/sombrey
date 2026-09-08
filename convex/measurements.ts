import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    return ctx.db
      .query("measurements")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    date: v.number(),
    weight: v.optional(v.number()),
    bodyFat: v.optional(v.number()),
    chest: v.optional(v.number()),
    waist: v.optional(v.number()),
    hips: v.optional(v.number()),
    arms: v.optional(v.number()),
    thighs: v.optional(v.number()),
    calves: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    // #12 — Enforce one measurement record per user per date (upsert).
    // The app shows a single row per day; a second submission for the same date
    // should update the existing record rather than creating a duplicate.
    // Using a Convex transaction here ensures concurrent requests are serialised
    // by the OCC system, so at most one row is ever created per (userId, date).
    const existing = await ctx.db
      .query("measurements")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .first();

    const { date, ...fields } = args;

    if (existing) {
      // Patch only the fields supplied so a partial update doesn't overwrite
      // other fields with undefined.
      const updates: Record<string, number | string | undefined> = {};
      if (fields.weight !== undefined) updates.weight = fields.weight;
      if (fields.bodyFat !== undefined) updates.bodyFat = fields.bodyFat;
      if (fields.chest !== undefined) updates.chest = fields.chest;
      if (fields.waist !== undefined) updates.waist = fields.waist;
      if (fields.hips !== undefined) updates.hips = fields.hips;
      if (fields.arms !== undefined) updates.arms = fields.arms;
      if (fields.thighs !== undefined) updates.thighs = fields.thighs;
      if (fields.calves !== undefined) updates.calves = fields.calves;
      if (fields.notes !== undefined) updates.notes = fields.notes;
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    return ctx.db.insert("measurements", { ...args, userId: user._id });
  },
});

export const remove = mutation({
  args: { id: v.id("measurements") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    const measurement = await ctx.db.get(args.id);
    if (!measurement) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    if (measurement.userId !== user?._id) throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden" });

    await ctx.db.delete(args.id);
  },
});
