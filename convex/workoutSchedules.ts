import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// A user's own explicitly-configured training days/times. Sombrey has
// no AI-generated workout-scheduling feature yet, so workout reminders
// and missed-workout detection are driven only by what the user sets
// here — never inferred from app-usage behavior. If/when Full Control
// AI scheduling is built, it would populate rows here the same way, and
// this same notification logic keeps working unchanged.

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

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("workoutSchedules")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const upsertSlot = mutation({
  args: {
    id: v.optional(v.id("workoutSchedules")),
    dayOfWeek: v.number(),
    name: v.optional(v.string()),
    hour: v.number(),
    minute: v.number(),
    enabled: v.boolean(),
    reminderEnabled: v.boolean(),
    missedReminderEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const { id, ...fields } = args;
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.userId !== user._id) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Workout slot not found" });
      }
      await ctx.db.patch(id, fields);
      return id;
    }
    return await ctx.db.insert("workoutSchedules", { userId: user._id, ...fields });
  },
});

export const removeSlot = mutation({
  args: { id: v.id("workoutSchedules") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.userId !== user._id) return;
    await ctx.db.delete(args.id);
  },
});
