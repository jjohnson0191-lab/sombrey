import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hasRole } from "./lib/roles.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

async function requireCoach(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  // assistant_coach is included: they can view/manage their own assigned clients.
  // The per-operation ownership checks below further restrict what they can touch.
  if (!user || !hasRole(user, "coach", "assistant_coach", "admin", "owner"))
    throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
  return user;
}

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

// ─── Coach: schedule a workout for a client ────────────────────────────────
export const scheduleWorkout = mutation({
  args: {
    clientId: v.id("users"),
    workoutId: v.id("workouts"),
    scheduledDate: v.string(), // "YYYY-MM-DD"
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    // Owner/admin can schedule for any client; coaches only for their own assigned clients
    if (!hasRole(coach, "admin", "owner")) {
      const client = await ctx.db.get(args.clientId);
      if (!client || client.coachId !== coach._id) {
        throw new ConvexError({ code: "FORBIDDEN", message: "You can only schedule workouts for your own clients" });
      }
    }
    return await ctx.db.insert("scheduledWorkouts", {
      coachId: coach._id,
      clientId: args.clientId,
      workoutId: args.workoutId,
      scheduledDate: args.scheduledDate,
      scheduledAt: new Date().toISOString(),
      notes: args.notes,
      status: "scheduled",
    });
  },
});

// ─── Coach: reschedule or update a scheduled workout ──────────────────────
export const updateScheduledWorkout = mutation({
  args: {
    id: v.id("scheduledWorkouts"),
    scheduledDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("skipped"),
      v.literal("rest"),
    )),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    const { id, ...updates } = args;
    // Owner/admin can update any scheduled workout; coaches only their own
    if (!hasRole(coach, "admin", "owner")) {
      const sw = await ctx.db.get(id);
      if (!sw || sw.coachId !== coach._id) {
        throw new ConvexError({ code: "FORBIDDEN", message: "You can only update your own scheduled workouts" });
      }
    }
    await ctx.db.patch(id, updates);
  },
});

// ─── Coach: delete a scheduled workout ────────────────────────────────────
export const deleteScheduledWorkout = mutation({
  args: { id: v.id("scheduledWorkouts") },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    // Owner/admin can delete any scheduled workout; coaches only their own
    if (!hasRole(coach, "admin", "owner")) {
      const sw = await ctx.db.get(args.id);
      if (!sw || sw.coachId !== coach._id) {
        throw new ConvexError({ code: "FORBIDDEN", message: "You can only delete your own scheduled workouts" });
      }
    }
    await ctx.db.delete(args.id);
  },
});

// ─── Coach: get all scheduled workouts for a date range ───────────────────
export const getCoachCalendar = query({
  args: {
    startDate: v.string(), // "YYYY-MM-DD"
    endDate: v.string(),
    clientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);

    let rows = await ctx.db
      .query("scheduledWorkouts")
      .withIndex("by_coach", (q) => q.eq("coachId", coach._id))
      .collect();

    rows = rows.filter(
      (r) => r.scheduledDate >= args.startDate && r.scheduledDate <= args.endDate,
    );

    if (args.clientId) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const workout = await ctx.db.get(row.workoutId);
        const client = await ctx.db.get(row.clientId);
        return {
          ...row,
          workoutName: workout?.name ?? "Unknown",
          clientName: client?.name ?? "Unknown",
        };
      }),
    );

    return enriched;
  },
});

// ─── Client: get own calendar for a date range ────────────────────────────
export const getClientCalendar = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const rows = await ctx.db
      .query("scheduledWorkouts")
      .withIndex("by_client", (q) => q.eq("clientId", user._id))
      .collect();

    const filtered = rows.filter(
      (r) => r.scheduledDate >= args.startDate && r.scheduledDate <= args.endDate,
    );

    const enriched = await Promise.all(
      filtered.map(async (row) => {
        const workout = await ctx.db.get(row.workoutId);
        let exercisesWithDetails: Array<Record<string, unknown>> = [];

        if (workout) {
          exercisesWithDetails = await Promise.all(
            workout.exercises.map(async (ex) => {
              const exercise = await ctx.db.get(ex.exerciseId);
              let supersetName: string | undefined;
              if (ex.supersetWith) {
                const ss = await ctx.db.get(ex.supersetWith);
                supersetName = ss?.name;
              }
              // Resolve superset names inside setConfigs
              const setConfigsResolved = ex.setConfigs
                ? await Promise.all(ex.setConfigs.map(async (sc) => {
                    if (sc.supersetExerciseId) {
                      const ssEx = await ctx.db.get(sc.supersetExerciseId);
                      return { ...sc, supersetExerciseName: ssEx?.name };
                    }
                    return sc;
                  }))
                : undefined;
              // Resolve video URL if exercise has a storageId
              const videoUrl = exercise?.storageId
                ? await ctx.storage.getUrl(exercise.storageId)
                : exercise?.videoUrl ?? undefined;
              return {
                ...ex,
                exerciseName: exercise?.name ?? "Unknown",
                exerciseDescription: exercise?.description,
                exerciseMuscleGroup: exercise?.muscleGroup,
                exerciseEquipment: (exercise as Record<string, unknown> | null)?.equipment as string | undefined,
                exerciseVideoUrl: videoUrl ?? undefined,
                supersetName,
                setConfigs: setConfigsResolved,
              };
            }),
          );
        }

        // Check if client has logged performance for this
        const perfLog = await ctx.db
          .query("workoutPerformanceLogs")
          .withIndex("by_user_and_date", (q) =>
            q.eq("userId", user._id).eq("loggedDate", row.scheduledDate),
          )
          .filter((q) => q.eq(q.field("workoutId"), row.workoutId))
          .first();

        return {
          ...row,
          workoutName: workout?.name ?? "Unknown",
          workout: workout
            ? { ...workout, exercisesWithDetails }
            : null,
          performanceLog: perfLog ?? null,
        };
      }),
    );

    return enriched;
  },
});

// ─── Client: mark scheduled workout as completed/skipped ──────────────────
export const markWorkoutStatus = mutation({
  args: {
    id: v.id("scheduledWorkouts"),
    status: v.union(v.literal("completed"), v.literal("skipped")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const sw = await ctx.db.get(args.id);
    if (!sw || sw.clientId !== user._id)
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your scheduled workout" });
    await ctx.db.patch(args.id, {
      status: args.status,
      completedAt: Date.now(),
    });
  },
});

// ─── Coach: get all clients for scheduling ────────────────────────────────
export const getCoachClients = query({
  args: {},
  handler: async (ctx) => {
    const coach = await requireCoach(ctx);
    // Owner/admin see all clients; coaches see only their assigned clients
    const isOwnerAdmin = hasRole(coach, "admin", "owner");
    let clients;
    if (isOwnerAdmin) {
      const allUsers = await ctx.db.query("users").collect();
      clients = allUsers.filter((u) => {
        const roles = (u.roles as string[] | undefined) ?? [];
        return roles.includes("client") || roles.length === 0;
      });
    } else {
      clients = await ctx.db
        .query("users")
        .withIndex("by_coach", (q) => q.eq("coachId", coach._id))
        .collect();
    }
    return clients.map((c) => ({
      _id: c._id,
      name: c.name ?? "Unknown",
      email: c.email,
      avatarStorageId: c.avatarStorageId,
    }));
  },
});

// ─── Coach: get calendar for a specific client (owner/admin see all) ──────
export const getClientCalendarForCoach = query({
  args: {
    clientId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: Id<"scheduledWorkouts">;
    coachId: Id<"users">;
    clientId: Id<"users">;
    workoutId: Id<"workouts">;
    scheduledDate: string;
    scheduledAt: string;
    notes?: string;
    status: "scheduled" | "completed" | "skipped" | "rest";
    completedAt?: number;
    workoutName: string;
    clientName: string;
    programName?: string;
  }>> => {
    const coach = await requireCoach(ctx);
    const isOwnerAdmin = hasRole(coach, "admin", "owner");

    // Permission check: coaches can only view assigned clients
    if (!isOwnerAdmin) {
      const client = await ctx.db.get(args.clientId);
      if (!client || client.coachId !== coach._id) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Not your client" });
      }
    }

    const rows = await ctx.db
      .query("scheduledWorkouts")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();

    const filtered = rows.filter(
      (r) => r.scheduledDate >= args.startDate && r.scheduledDate <= args.endDate,
    );

    const client = await ctx.db.get(args.clientId);

    const enriched = await Promise.all(
      filtered.map(async (row) => {
        const workout = await ctx.db.get(row.workoutId);
        let programName: string | undefined;
        if (workout?.programId) {
          const prog = await ctx.db.get(workout.programId);
          programName = prog?.name;
        }
        return {
          ...row,
          workoutName: workout?.name ?? "Unknown",
          clientName: client?.name ?? "Unknown",
          programName,
        };
      }),
    );

    return enriched;
  },
});

// ─── Coach: copy a scheduled workout to a new date ────────────────────────
/**
 * Copies a scheduled workout to a different date.
 * Creates an independent copy of the workout record so edits to the copy
 * do not affect the original, and vice-versa.
 * Returns the new scheduledWorkout ID, new workout ID, and a conflict count
 * (number of workouts already on the destination date for this client).
 */
export const copyScheduledWorkout = mutation({
  args: {
    scheduledWorkoutId: v.id("scheduledWorkouts"),
    destinationDate: v.string(), // "YYYY-MM-DD"
  },
  handler: async (ctx, args): Promise<{
    newScheduledId: Id<"scheduledWorkouts">;
    newWorkoutId: Id<"workouts">;
    conflictCount: number;
  }> => {
    const coach = await requireCoach(ctx);

    // Fetch the original scheduled workout
    const original = await ctx.db.get(args.scheduledWorkoutId);
    if (!original) throw new ConvexError({ code: "NOT_FOUND", message: "Scheduled workout not found" });

    // Ownership: owner/admin can copy any; coaches only their own
    if (!hasRole(coach, "admin", "owner") && original.coachId !== coach._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    // Fetch the underlying workout template/copy
    const workout = await ctx.db.get(original.workoutId);
    if (!workout) throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });

    // Count existing scheduled workouts on destination date for this client (for conflict warning)
    const existingOnDate = await ctx.db
      .query("scheduledWorkouts")
      .withIndex("by_client", (q) => q.eq("clientId", original.clientId))
      .filter((q) => q.eq(q.field("scheduledDate"), args.destinationDate))
      .collect();

    // Deep-clone the exercises array via JSON round-trip.
    // This guarantees every nested field — including setConfigs with
    // intensifierType, intensifierValue, dropSubSets, supersetExerciseId,
    // and legacy per-exercise intensifiers (isDropSet, tempo, rpe, etc.) —
    // is serialised into a fresh value that Convex stores independently.
    // Passing workout.exercises directly (a Doc<"workouts"> reference) can
    // cause the TypeScript type to narrow away optional fields before Convex
    // serialises the insert, silently dropping intensifier configuration.
    type WorkoutExercise = (typeof workout.exercises)[number];
    const exercisesCopy = JSON.parse(
      JSON.stringify(workout.exercises),
    ) as WorkoutExercise[];

    const newWorkoutId = await ctx.db.insert("workouts", {
      programId: workout.programId,
      ...(workout.clientId ? { clientId: workout.clientId } : {}),
      name: workout.name,
      day: workout.day,
      week: workout.week,
      exercises: exercisesCopy,
    });

    // Schedule the new independent workout for the destination date
    const newScheduledId = await ctx.db.insert("scheduledWorkouts", {
      coachId: coach._id,
      clientId: original.clientId,
      workoutId: newWorkoutId,
      scheduledDate: args.destinationDate,
      scheduledAt: new Date().toISOString(),
      notes: original.notes,
      status: "scheduled",
    });

    return { newScheduledId, newWorkoutId, conflictCount: existingOnDate.length };
  },
});

// ─── Coach: schedule all workouts in a program for a client ───────────────
export const scheduleProgramForClient = mutation({
  args: {
    clientId: v.id("users"),
    programId: v.id("programs"),
    startDate: v.string(), // "YYYY-MM-DD" — first day of the program
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);

    // Load all workouts for the program ordered by week/day
    const workouts = await ctx.db
      .query("workouts")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .collect();

    if (workouts.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "This program has no workouts" });
    }

    // Sort by week then day
    workouts.sort((a, b) => a.week !== b.week ? a.week - b.week : a.day - b.day);

    // Calculate date offset for each workout (day 1 of week 1 = startDate)
    const [year, month, day] = args.startDate.split("-").map(Number);
    const base = new Date(year, month - 1, day);

    const insertedIds: Id<"scheduledWorkouts">[] = [];
    for (const workout of workouts) {
      const offsetDays = (workout.week - 1) * 7 + (workout.day - 1);
      const d = new Date(base);
      d.setDate(base.getDate() + offsetDays);
      const scheduledDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const id = await ctx.db.insert("scheduledWorkouts", {
        coachId: coach._id,
        clientId: args.clientId,
        workoutId: workout._id,
        scheduledDate,
        scheduledAt: new Date().toISOString(),
        notes: args.notes,
        status: "scheduled",
      });
      insertedIds.push(id);
    }

    return { count: insertedIds.length, ids: insertedIds };
  },
});
