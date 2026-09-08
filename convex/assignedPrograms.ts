import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";
import { api } from "./_generated/api.js";

export const listByUser = query({
  args: { 
    userId: v.optional(v.id("users")),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("paused")
    )),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    // If no userId provided, use current user
    const targetUserId = args.userId || currentUser._id;

    // Clients can only query their own assigned programs
    if (targetUserId !== currentUser._id && !hasRole(currentUser, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    let query = ctx.db
      .query("assignedPrograms")
      .withIndex("by_user", (q) => q.eq("userId", targetUserId));

    let assignments = await query.collect();

    if (args.status) {
      assignments = assignments.filter(a => a.status === args.status);
    }

    // Get program details for each assignment
    const assignmentsWithDetails = await Promise.all(
      assignments.map(async (assignment) => {
        const program = await ctx.db.get(assignment.programId);
        return {
          ...assignment,
          programName: program?.name || "Unknown",
          programPhase: program?.phase,
          programDuration: program?.durationWeeks,
        };
      })
    );

    return assignmentsWithDetails;
  },
});

export const assign = mutation({
  args: {
    userId: v.id("users"),
    programId: v.id("programs"),
    startDate: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user || !hasRole(user, "coach", "admin")) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only coaches and admins can assign programs",
      });
    }

    const assignmentId = await ctx.db.insert("assignedPrograms", {
      userId: args.userId,
      programId: args.programId,
      startDate: args.startDate,
      status: "active",
      currentWeek: 1,
      currentDay: 1,
    });

    // Automatically create client-specific workout copies (non-blocking via scheduler)
    await ctx.scheduler.runAfter(0, api.workouts.ensureClientWorkouts, {
      clientId: args.userId,
      programId: args.programId,
    });

    return assignmentId;
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("assignedPrograms"),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("paused")
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    await ctx.db.patch(args.id, {
      status: args.status,
    });
  },
});

export const updateProgress = mutation({
  args: {
    id: v.id("assignedPrograms"),
    currentWeek: v.number(),
    currentDay: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

/**
 * #10 — Returns real program completion progress based on scheduledWorkouts statuses,
 * not time elapsed or week position.
 *
 * Counts all scheduledWorkouts for the client whose workoutId belongs to this program:
 *   - total: all scheduled (including rest/skipped/future)
 *   - completed: those with status "completed"
 *   - skipped: those with status "skipped"
 *   - remaining: all that are still "scheduled"
 *   - completionPct: completed / total (as 0–100 integer)
 */
export const getProgramProgress = query({
  args: {
    assignmentId: v.id("assignedPrograms"),
  },
  handler: async (ctx, args): Promise<{
    total: number;
    completed: number;
    skipped: number;
    remaining: number;
    completionPct: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw new ConvexError({ code: "NOT_FOUND", message: "Assignment not found" });

    // Authorization: the client themselves or a coach/admin/owner can query
    if (assignment.userId !== user._id && !hasRole(user, "coach", "admin", "owner", "assistant_coach")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    // Collect all scheduledWorkouts for this client
    const allScheduled = await ctx.db
      .query("scheduledWorkouts")
      .withIndex("by_client", (q) => q.eq("clientId", assignment.userId))
      .collect();

    // Filter to those whose workout belongs to this program
    const programWorkoutIds = new Set<string>();
    {
      const programWorkouts = await ctx.db
        .query("workouts")
        .withIndex("by_program", (q) => q.eq("programId", assignment.programId))
        .collect();
      for (const w of programWorkouts) {
        programWorkoutIds.add(w._id);
      }
    }

    const programScheduled = allScheduled.filter((sw) =>
      programWorkoutIds.has(sw.workoutId),
    );

    const total = programScheduled.length;
    const completed = programScheduled.filter((sw) => sw.status === "completed").length;
    const skipped = programScheduled.filter((sw) => sw.status === "skipped").length;
    const remaining = programScheduled.filter((sw) => sw.status === "scheduled").length;
    const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, skipped, remaining, completionPct };
  },
});
