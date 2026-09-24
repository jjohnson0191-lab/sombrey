import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { reconcileWorkout } from "./workoutBandSync";

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
    source: v.union(v.literal("user_created"), v.literal("ai_created"), v.literal("repeated"), v.literal("plan")),
    trainingPlanId: v.optional(v.id("trainingPlans")),
    trainingPlanDayIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (args.trainingPlanId) {
      const plan = await ctx.db.get(args.trainingPlanId);
      if (!plan || plan.userId !== user._id) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Training plan not found" });
      }
    }
    return await ctx.db.insert("sombreyWorkouts", {
      userId: user._id,
      name: args.name,
      startedAt: args.startedAt,
      source: args.source,
      trainingPlanId: args.trainingPlanId,
      trainingPlanDayIndex: args.trainingPlanDayIndex,
    });
  },
});

// A workout done outside Sombrey/Sport+ (gym, run, ride, walk, swim…),
// entered afterwards. Stored as a completed Sombrey workout with source
// "manual" so it sits in the same history the AI and future training-load
// systems read — always identifiable as USER-ENTERED, never device data.
export const logManualWorkout = mutation({
  args: {
    name: v.string(),
    activityType: v.union(
      v.literal("gym"), v.literal("run"), v.literal("cycle"),
      v.literal("walk"), v.literal("swim"), v.literal("other"),
    ),
    startedAt: v.number(),
    durationSeconds: v.number(),
    distanceMeters: v.optional(v.number()),
    userReportedCalories: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (args.durationSeconds <= 0 || args.durationSeconds > 24 * 3600) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Duration must be between 1 second and 24 hours" });
    }
    if (args.startedAt > Date.now() + 60_000) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "A logged workout can't start in the future" });
    }
    return await ctx.db.insert("sombreyWorkouts", {
      userId: user._id,
      name: args.name,
      startedAt: args.startedAt,
      completedAt: args.startedAt + args.durationSeconds * 1000,
      durationSeconds: args.durationSeconds,
      source: "manual",
      activityType: args.activityType,
      distanceMeters: args.distanceMeters,
      userReportedCalories: args.userReportedCalories,
      notes: args.notes,
      // Entered by the user: the times are theirs, and no band data applies.
      actualStartedAt: args.startedAt,
      actualEndedAt: args.startedAt + args.durationSeconds * 1000,
      actualDurationSeconds: args.durationSeconds,
      startTimeSource: "manual",
      endTimeSource: "manual",
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
    // The exercise as it is now, kept with the set: history must read
    // correctly even if the library entry later changes or disappears.
    const exercise = await ctx.db.get(args.exerciseId);
    return await ctx.db.insert("sombreyWorkoutSets", {
      workoutId: args.workoutId,
      userId: user._id,
      exerciseId: args.exerciseId,
      orderIndex: args.orderIndex,
      setIndex: args.setIndex,
      reps: args.reps,
      weightKg: args.weightKg,
      completedAt: args.completedAt,
      exerciseName: exercise?.name,
      exerciseMuscleGroup: exercise?.muscleGroup,
    });
  },
});

// Correcting a set already logged during the workout (a mistyped rep
// count or weight). Owner-checked through the parent workout.
export const updateSet = mutation({
  args: {
    setId: v.id("sombreyWorkoutSets"),
    reps: v.number(),
    weightKg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const set = await ctx.db.get(args.setId);
    if (!set || set.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Set not found" });
    }
    await ctx.db.patch(args.setId, { reps: args.reps, weightKg: args.weightKg });
  },
});

// Removing a set logged by mistake.
export const deleteSet = mutation({
  args: { setId: v.id("sombreyWorkoutSets") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const set = await ctx.db.get(args.setId);
    if (!set || set.userId !== user._id) return;
    await ctx.db.delete(args.setId);
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
    // Actual times, calories and heart rate from the band session when it
    // has them — refined again when the band's full record is imported.
    await reconcileWorkout(ctx, args.workoutId);
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
    // Each set names its exercise from what was kept when it was logged,
    // falling back to the library only for sets from before that existed.
    const named = await Promise.all(sets.map(async (set) => ({
      ...set,
      exerciseName: set.exerciseName ?? (await ctx.db.get(set.exerciseId))?.name ?? "Exercise",
    })));
    return { workout, sets: named.sort((a, b) => a.orderIndex - b.orderIndex || a.setIndex - b.setIndex) };
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
