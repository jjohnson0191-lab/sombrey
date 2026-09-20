import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Sombrey-native training session persistence — exercises/sets/reps/weight
// a user actually did, independent of whether AI Coach or the user built
// the workout, and independent of any paired wearable Sport+ session (see
// sportPlusSessions.ts). Deliberately not workoutLogs, which is shaped
// around human-coach program assignment.

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

export const startWorkout = mutation({
  args: {
    name: v.string(),
    startedAt: v.number(),
    source: v.union(v.literal("user_created"), v.literal("ai_created"), v.literal("repeated")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db.insert("sombreyWorkouts", {
      userId: user._id,
      name: args.name,
      startedAt: args.startedAt,
      source: args.source,
    });
  },
});

export const logSet = mutation({
  args: {
    workoutId: v.id("sombreyWorkouts"),
    exerciseId: v.id("exercises"),
    orderIndex: v.number(),
    setIndex: v.number(),
    reps: v.number(),
    weightKg: v.optional(v.number()),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const workout = await ctx.db.get(args.workoutId);
    if (!workout || workout.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });
    }
    return await ctx.db.insert("sombreyWorkoutSets", {
      workoutId: args.workoutId,
      userId: user._id,
      exerciseId: args.exerciseId,
      orderIndex: args.orderIndex,
      setIndex: args.setIndex,
      reps: args.reps,
      weightKg: args.weightKg,
      completedAt: args.completedAt,
    });
  },
});

export const finishWorkout = mutation({
  args: {
    workoutId: v.id("sombreyWorkouts"),
    completedAt: v.number(),
    durationSeconds: v.optional(v.number()),
    sportPlusSessionId: v.optional(v.id("sportPlusSessions")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const workout = await ctx.db.get(args.workoutId);
    if (!workout || workout.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });
    }
    await ctx.db.patch(args.workoutId, {
      completedAt: args.completedAt,
      durationSeconds: args.durationSeconds,
      sportPlusSessionId: args.sportPlusSessionId,
      notes: args.notes,
    });
  },
});

export const discardWorkout = mutation({
  args: { workoutId: v.id("sombreyWorkouts") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const workout = await ctx.db.get(args.workoutId);
    if (!workout || workout.userId !== user._id) return;
    const sets = await ctx.db
      .query("sombreyWorkoutSets")
      .withIndex("by_workout", (q) => q.eq("workoutId", args.workoutId))
      .collect();
    for (const set of sets) await ctx.db.delete(set._id);
    await ctx.db.delete(args.workoutId);
  },
});

export const listHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("sombreyWorkouts")
      .withIndex("by_user_and_completedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .filter((q) => q.neq(q.field("completedAt"), undefined))
      .take(args.limit ?? 20);
  },
});

export const getWorkoutWithSets = query({
  args: { workoutId: v.id("sombreyWorkouts") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const workout = await ctx.db.get(args.workoutId);
    if (!workout || workout.userId !== user._id) return null;
    const sets = await ctx.db
      .query("sombreyWorkoutSets")
      .withIndex("by_workout", (q) => q.eq("workoutId", args.workoutId))
      .collect();
    return { workout, sets: sets.sort((a, b) => a.orderIndex - b.orderIndex || a.setIndex - b.setIndex) };
  },
});

// Powers "repeat previous workout" — the most recent completed session's
// distinct exercises, in the order they first appeared, so the client can
// preselect them for a new session without guessing at a template shape.
export const getMostRecentWorkoutTemplate = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const last = await ctx.db
      .query("sombreyWorkouts")
      .withIndex("by_user_and_completedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .filter((q) => q.neq(q.field("completedAt"), undefined))
      .first();
    if (!last) return null;
    const sets = await ctx.db
      .query("sombreyWorkoutSets")
      .withIndex("by_workout", (q) => q.eq("workoutId", last._id))
      .collect();
    const seen = new Set<string>();
    const exerciseIds: string[] = [];
    for (const set of sets.sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (!seen.has(set.exerciseId)) {
        seen.add(set.exerciseId);
        exerciseIds.push(set.exerciseId);
      }
    }
    return { workoutName: last.name, exerciseIds };
  },
});

// Progression analysis — every completed set for one exercise, in order.
export const getExerciseHistory = query({
  args: { exerciseId: v.id("exercises"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("sombreyWorkoutSets")
      .withIndex("by_user_and_exercise", (q) => q.eq("userId", user._id).eq("exerciseId", args.exerciseId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});
