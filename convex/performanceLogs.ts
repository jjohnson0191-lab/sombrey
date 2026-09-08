import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { hasRole } from "./lib/roles.js";

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

// ─── Log workout performance ───────────────────────────────────────────────
export const logPerformance = mutation({
  args: {
    workoutId: v.id("workouts"),
    scheduledWorkoutId: v.optional(v.id("scheduledWorkouts")),
    loggedDate: v.string(), // "YYYY-MM-DD"
    exercises: v.array(v.object({
      exerciseId: v.id("exercises"),
      exerciseName: v.string(),
      sets: v.array(v.object({
        setNumber: v.number(),
        weight: v.optional(v.number()),
        reps: v.optional(v.number()),
        completed: v.boolean(),
        rpe: v.optional(v.number()),
        notes: v.optional(v.string()),
      })),
    })),
    notes: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const id = await ctx.db.insert("workoutPerformanceLogs", {
      userId: user._id,
      workoutId: args.workoutId,
      scheduledWorkoutId: args.scheduledWorkoutId,
      loggedDate: args.loggedDate,
      loggedAt: Date.now(),
      exercises: args.exercises,
      notes: args.notes,
      durationMinutes: args.durationMinutes,
    });

    // Mark scheduled workout as completed
    if (args.scheduledWorkoutId) {
      const sw = await ctx.db.get(args.scheduledWorkoutId);
      if (sw && sw.clientId === user._id) {
        await ctx.db.patch(args.scheduledWorkoutId, {
          status: "completed",
          completedAt: Date.now(),
        });
      }
    }

    return id;
  },
});

// ─── Get performance logs for a user ──────────────────────────────────────
export const getUserLogs = query({
  args: {
    userId: v.optional(v.id("users")), // omit for current user
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireAuth(ctx);
    const targetId = args.userId ?? viewer._id;
    // Coaches can view client logs; clients can only view their own
    if (args.userId && args.userId !== viewer._id) {
      if (!hasRole(viewer, "coach", "admin", "owner")) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Not authorized" });
      }
    }
    const logs = await ctx.db
      .query("workoutPerformanceLogs")
      .withIndex("by_user", (q) => q.eq("userId", targetId))
      .order("desc")
      .take(args.limit ?? 20);
    // Enrich with workout name
    return await Promise.all(logs.map(async (log) => {
      const workout = await ctx.db.get(log.workoutId);
      return { ...log, workoutName: workout?.name ?? "Unknown" };
    }));
  },
});

// ─── Get logs for a specific workout (progression data) ──────────────────
export const getWorkoutProgression = query({
  args: {
    workoutId: v.id("workouts"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<Array<{
    loggedDate: string;
    loggedAt: number;
    exercises: Array<{
      exerciseId: Id<"exercises">;
      exerciseName: string;
      totalVolume: number;
      maxWeight: number;
      totalReps: number;
    }>;
  }>> => {
    const viewer = await requireAuth(ctx);
    const targetId = args.userId ?? viewer._id;

    const logs = await ctx.db
      .query("workoutPerformanceLogs")
      .withIndex("by_workout", (q) => q.eq("workoutId", args.workoutId))
      .order("asc")
      .collect();

    const userLogs = logs.filter((l) => l.userId === targetId);

    return userLogs.map((log) => ({
      loggedDate: log.loggedDate,
      loggedAt: log.loggedAt,
      exercises: log.exercises.map((ex) => {
        const completedSets = ex.sets.filter((s) => s.completed);
        const maxWeight = completedSets.reduce((m, s) => Math.max(m, s.weight ?? 0), 0);
        const totalReps = completedSets.reduce((sum, s) => sum + (s.reps ?? 0), 0);
        const totalVolume = completedSets.reduce(
          (sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0),
          0,
        );
        return {
          exerciseId: ex.exerciseId,
          exerciseName: ex.exerciseName,
          totalVolume,
          maxWeight,
          totalReps,
        };
      }),
    }));
  },
});

// ─── Get exercise progression across all workouts ─────────────────────────
export const getExerciseProgression = query({
  args: {
    exerciseId: v.id("exercises"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<Array<{
    date: string;
    maxWeight: number;
    totalVolume: number;
    totalReps: number;
  }>> => {
    const viewer = await requireAuth(ctx);
    const targetId = args.userId ?? viewer._id;

    const logs = await ctx.db
      .query("workoutPerformanceLogs")
      .withIndex("by_user", (q) => q.eq("userId", targetId))
      .order("asc")
      .collect();

    const result: Array<{ date: string; maxWeight: number; totalVolume: number; totalReps: number }> = [];

    for (const log of logs) {
      const exEntry = log.exercises.find((e) => e.exerciseId === args.exerciseId);
      if (!exEntry) continue;
      const completedSets = exEntry.sets.filter((s) => s.completed);
      const maxWeight = completedSets.reduce((m, s) => Math.max(m, s.weight ?? 0), 0);
      const totalReps = completedSets.reduce((sum, s) => sum + (s.reps ?? 0), 0);
      const totalVolume = completedSets.reduce(
        (sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0),
        0,
      );
      result.push({ date: log.loggedDate, maxWeight, totalVolume, totalReps });
    }

    return result;
  },
});

// ─── Get performance log for a specific workout + date ───────────────────
export const getLogForDate = query({
  args: {
    workoutId: v.id("workouts"),
    loggedDate: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("workoutPerformanceLogs")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).eq("loggedDate", args.loggedDate),
      )
      .filter((q) => q.eq(q.field("workoutId"), args.workoutId))
      .first();
  },
});
