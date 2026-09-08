import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hasRole } from "./lib/roles.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireUser(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getActiveGoal = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db
      .query("clientGoals")
      .withIndex("by_user_and_active", (q) => q.eq("userId", user._id).eq("isActive", true))
      .first();
  },
});

export const getGoalForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Require auth — coaches see client goals, clients see only their own
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const caller = await ctx.db.query("users").withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!caller) return null;
    if (caller._id !== args.userId && !hasRole(caller, "coach", "admin", "owner")) return null;
    return ctx.db
      .query("clientGoals")
      .withIndex("by_user_and_active", (q) => q.eq("userId", args.userId).eq("isActive", true))
      .first();
  },
});

export const listGoals = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db
      .query("clientGoals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const setGoal = mutation({
  args: {
    primaryGoal: v.string(),
    targetWeightKg: v.optional(v.number()),
    targetBodyFatPct: v.optional(v.number()),
    targetDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Deactivate existing active goals
    const existing = await ctx.db
      .query("clientGoals")
      .withIndex("by_user_and_active", (q) => q.eq("userId", user._id).eq("isActive", true))
      .collect();
    for (const g of existing) {
      await ctx.db.patch(g._id, { isActive: false });
    }

    return ctx.db.insert("clientGoals", {
      userId: user._id,
      primaryGoal: args.primaryGoal,
      targetWeightKg: args.targetWeightKg,
      targetBodyFatPct: args.targetBodyFatPct,
      targetDate: args.targetDate,
      isActive: true,
    });
  },
});

export const removeGoal = mutation({
  args: { id: v.id("clientGoals") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const goal = await ctx.db.get(args.id);
    if (!goal) throw new ConvexError({ code: "NOT_FOUND", message: "Goal not found" });
    if (goal.userId !== user._id) throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden" });
    await ctx.db.delete(args.id);
  },
});
