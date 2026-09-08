import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";

export const listByUser = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    const logs = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 10);

    const logsWithDetails = await Promise.all(
      logs.map(async (log) => {
        const workout = await ctx.db.get(log.workoutId);
        return {
          ...log,
          workoutName: workout?.name || "Workout",
        };
      }),
    );

    return logsWithDetails;
  },
});

export const logWorkout = mutation({
  args: {
    workoutId: v.id("workouts"),
    exercises: v.array(v.object({
      exerciseId: v.id("exercises"),
      sets: v.array(v.object({
        weight: v.number(),
        reps: v.number(),
        completed: v.boolean(),
      })),
    })),
    duration: v.number(),
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

    // Verify the workout exists and the user is authorized to log it.
    // Clients may log template workouts (no clientId) or workouts assigned to them.
    // Coaches/admins can log any workout.
    const workout = await ctx.db.get(args.workoutId);
    if (!workout) throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });
    if (!hasRole(user, "coach", "admin", "owner")) {
      // Must be a template workout OR a workout belonging to this user
      if (workout.clientId !== undefined && workout.clientId !== user._id) {
        throw new ConvexError({ code: "FORBIDDEN", message: "You are not authorized to log this workout" });
      }
    }

    return await ctx.db.insert("workoutLogs", {
      userId: user._id,
      workoutId: args.workoutId,
      completedAt: Date.now(),
      exercises: args.exercises,
      duration: args.duration,
      notes: args.notes,
    });
  },
});
