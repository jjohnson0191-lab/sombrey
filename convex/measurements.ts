import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { isPlausibleWeightKg } from "./progress/body";

async function currentUser(ctx: { auth: { getUserIdentity(): Promise<{ tokenIdentifier: string } | null> }; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q: any) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

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

// ── Progress › Body ───────────────────────────────────────────────────────

/** A weight the user entered, at the time they say (kg). */
export const logWeight = mutation({
  args: { weightKg: v.number(), date: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isPlausibleWeightKg(args.weightKg)) throw new ConvexError({ code: "BAD_REQUEST", message: "Enter a weight between 20 and 400 kg" });
    if (args.date > Date.now() + 60_000) throw new ConvexError({ code: "BAD_REQUEST", message: "A weight can't be in the future" });
    return await ctx.db.insert("measurements", {
      userId: user._id,
      date: args.date,
      weight: Math.round(args.weightKg * 10) / 10,
      source: "manual",
    });
  },
});

/** Corrects a weight entry the user made (its value and/or time). */
export const updateWeight = mutation({
  args: { id: v.id("measurements"), weightKg: v.optional(v.number()), date: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Entry not found" });
    if (row.source !== undefined && row.source !== "manual") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Only entries you made yourself can be edited" });
    }
    if (args.weightKg !== undefined && !isPlausibleWeightKg(args.weightKg)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Enter a weight between 20 and 400 kg" });
    }
    if (args.date !== undefined && args.date > Date.now() + 60_000) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "A weight can't be in the future" });
    }
    await ctx.db.patch(args.id, {
      ...(args.weightKg !== undefined ? { weight: Math.round(args.weightKg * 10) / 10 } : {}),
      ...(args.date !== undefined ? { date: args.date } : {}),
    });
  },
});
