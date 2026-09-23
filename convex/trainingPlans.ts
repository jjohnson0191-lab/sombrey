import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// The user's training plans — their own, and Sombrey-generated ones, side
// by side (`source`). Not every user wants AI to build their training, so
// a user-created plan is a first-class citizen here, not a fallback.
//
// Plans reference Sombrey's own `exercises` table. Where that table's
// content comes from (e.g. an external exercise-data provider) is an
// infrastructure detail the plan never sees.

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

const dayValidator = v.object({
  name: v.string(),
  weekday: v.optional(v.number()),
  exercises: v.array(v.object({
    exerciseId: v.id("exercises"),
    sets: v.number(),
    reps: v.number(),
    restSeconds: v.optional(v.number()),
  })),
});

function validateDays(days: Array<{ name: string; weekday?: number; exercises: Array<{ sets: number; reps: number; restSeconds?: number }> }>) {
  if (days.length === 0) throw new ConvexError({ code: "BAD_REQUEST", message: "A plan needs at least one day" });
  for (const day of days) {
    if (day.weekday !== undefined && (day.weekday < 1 || day.weekday > 7)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Weekday must be 1–7" });
    }
    for (const e of day.exercises) {
      if (e.sets < 1 || e.sets > 20 || e.reps < 1 || e.reps > 100) {
        throw new ConvexError({ code: "BAD_REQUEST", message: "Sets must be 1–20 and reps 1–100" });
      }
      if (e.restSeconds !== undefined && (e.restSeconds < 0 || e.restSeconds > 900)) {
        throw new ConvexError({ code: "BAD_REQUEST", message: "Rest must be 0–900 seconds" });
      }
    }
  }
}

async function ownedPlan(ctx: MutationCtx, userId: Id<"users">, planId: Id<"trainingPlans">) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Training plan not found" });
  return plan;
}

async function clearCurrent(ctx: MutationCtx, userId: Id<"users">) {
  const plans = await ctx.db.query("trainingPlans").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const plan of plans) {
    if (plan.isCurrent) await ctx.db.patch(plan._id, { isCurrent: false });
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const plans = await ctx.db.query("trainingPlans").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return plans.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.updatedAt - a.updatedAt);
  },
});

export const create = mutation({
  args: { name: v.string(), days: v.array(dayValidator), makeCurrent: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError({ code: "BAD_REQUEST", message: "Give the plan a name" });
    validateDays(args.days);
    const now = Date.now();
    const existing = await ctx.db.query("trainingPlans").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    const makeCurrent = args.makeCurrent ?? existing === null;
    if (makeCurrent) await clearCurrent(ctx, user._id);
    return await ctx.db.insert("trainingPlans", {
      userId: user._id,
      name,
      source: "user",
      days: args.days,
      isCurrent: makeCurrent,
      nextDayIndex: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: { planId: v.id("trainingPlans"), name: v.string(), days: v.array(dayValidator) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const plan = await ownedPlan(ctx, user._id, args.planId);
    const name = args.name.trim();
    if (!name) throw new ConvexError({ code: "BAD_REQUEST", message: "Give the plan a name" });
    validateDays(args.days);
    await ctx.db.patch(plan._id, {
      name,
      days: args.days,
      nextDayIndex: Math.min(plan.nextDayIndex, args.days.length - 1),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { planId: v.id("trainingPlans") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const plan = await ownedPlan(ctx, user._id, args.planId);
    await ctx.db.delete(plan._id);
  },
});

export const setCurrent = mutation({
  args: { planId: v.id("trainingPlans") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const plan = await ownedPlan(ctx, user._id, args.planId);
    await clearCurrent(ctx, user._id);
    await ctx.db.patch(plan._id, { isCurrent: true, updatedAt: Date.now() });
  },
});

// Progress through the plan: called when a workout started from a plan day
// is finished. Advances to the following day, wrapping to the first.
export const completeDay = mutation({
  args: { planId: v.id("trainingPlans"), dayIndex: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const plan = await ownedPlan(ctx, user._id, args.planId);
    if (args.dayIndex < 0 || args.dayIndex >= plan.days.length) return;
    await ctx.db.patch(plan._id, { nextDayIndex: (args.dayIndex + 1) % plan.days.length, updatedAt: Date.now() });
  },
});
