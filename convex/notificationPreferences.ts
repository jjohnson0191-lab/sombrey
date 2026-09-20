import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Per-category notification preferences — deliberately not a single
// on/off switch. Actual scheduling happens on-device
// (NotificationManager.swift via UNUserNotificationCenter); this is the
// source of truth the client reconciles against and reads before
// deciding whether to post anything.

async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

// Sensible defaults for a user who has never visited Settings ->
// Notifications — meal/workout reminders and the morning summary on,
// missed-* nags off by default (opt-in to being reminded about
// something not done, rather than opt-out).
const DEFAULTS = {
  mealReminders: true,
  missedMealReminders: false,
  workoutReminders: true,
  missedWorkoutReminders: false,
  morningReadiness: true,
  poorSleep: true,
  goodSleep: true,
  wearableStatus: true,
};

export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    return existing ?? { userId: user._id, ...DEFAULTS };
  },
});

export const set = mutation({
  args: {
    mealReminders: v.optional(v.boolean()),
    missedMealReminders: v.optional(v.boolean()),
    workoutReminders: v.optional(v.boolean()),
    missedWorkoutReminders: v.optional(v.boolean()),
    morningReadiness: v.optional(v.boolean()),
    poorSleep: v.optional(v.boolean()),
    goodSleep: v.optional(v.boolean()),
    wearableStatus: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("notificationPreferences", { userId: user._id, ...DEFAULTS, ...args });
  },
});
