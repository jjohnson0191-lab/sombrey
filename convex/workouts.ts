import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";

// ─── Shared validator for a single set config ──────────────────────────────
const setConfigValidator = v.object({
  setNumber: v.number(),
  reps: v.optional(v.union(v.number(), v.string())),
  weightKg: v.optional(v.number()),
  restSeconds: v.optional(v.number()),
  intensifierType: v.optional(v.union(
    v.literal("superset"),
    v.literal("dropset"),
    v.literal("tempo"),
    v.literal("rpe"),
    v.literal("suggested_weight"),
  )),
  intensifierValue: v.optional(v.string()),
  dropSubSets: v.optional(v.array(v.object({
    subSetNumber: v.number(),
    weightKg: v.optional(v.number()),
    reps: v.optional(v.number()),
    restSeconds: v.optional(v.number()),
  }))),
  supersetExerciseId: v.optional(v.id("exercises")),
  notes: v.optional(v.string()),
});

// ─── Shared exercise validator ─────────────────────────────────────────────
const exerciseValidator = v.object({
  exerciseId: v.id("exercises"),
  sets: v.number(),
  reps: v.union(v.number(), v.string()),
  restSeconds: v.number(),
  notes: v.optional(v.string()),
  supersetWith: v.optional(v.id("exercises")),
  isDropSet: v.optional(v.boolean()),
  tempo: v.optional(v.string()),
  suggestedWeightKg: v.optional(v.number()),
  rpe: v.optional(v.number()),
  setConfigs: v.optional(v.array(setConfigValidator)),
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    // Returns template workouts only (no client-specific copies)
    const workouts = await ctx.db.query("workouts").collect();
    return workouts.filter(w => !w.clientId);
  },
});

/** List workouts for a specific client (client-specific copies only). */
export const listByClientAndProgram = query({
  args: {
    clientId: v.id("users"),
    programId: v.optional(v.id("programs")),
  },
  handler: async (ctx, args) => {
    const workouts = await ctx.db
      .query("workouts")
      .withIndex("by_client_and_program", (q) => {
        if (args.programId) {
          return q.eq("clientId", args.clientId).eq("programId", args.programId);
        }
        return q.eq("clientId", args.clientId);
      })
      .collect();
    return workouts;
  },
});

export const listByProgram = query({
  args: { 
    programId: v.id("programs"),
    week: v.optional(v.number()),
    clientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // If clientId provided, try client-specific workouts first
    let workouts;
    if (args.clientId) {
      const clientWorkouts = await ctx.db
        .query("workouts")
        .withIndex("by_client_and_program", (q) => q.eq("clientId", args.clientId!).eq("programId", args.programId))
        .collect();
      if (clientWorkouts.length > 0) {
        workouts = clientWorkouts;
      } else {
        // Fall back to template workouts (no clientId)
        const allForProgram = await ctx.db
          .query("workouts")
          .withIndex("by_program", (q) => q.eq("programId", args.programId))
          .collect();
        workouts = allForProgram.filter(w => !w.clientId);
      }
    } else {
      // No clientId — return template workouts only
      const allForProgram = await ctx.db
        .query("workouts")
        .withIndex("by_program", (q) => q.eq("programId", args.programId))
        .collect();
      workouts = allForProgram.filter(w => !w.clientId);
    }

    if (args.week !== undefined) {
      workouts = workouts.filter((w) => w.week === args.week);
    }

    const workoutsWithExercises = await Promise.all(
      workouts.map(async (workout) => {
        const exercisesWithDetails = await Promise.all(
          workout.exercises.map(async (ex) => {
            const exercise = await ctx.db.get(ex.exerciseId);
            // Resolve superset exercise names inside setConfigs
            const setConfigsResolved = ex.setConfigs
              ? await Promise.all(ex.setConfigs.map(async (sc) => {
                  if (sc.supersetExerciseId) {
                    const ssEx = await ctx.db.get(sc.supersetExerciseId);
                    return { ...sc, supersetExerciseName: ssEx?.name };
                  }
                  return sc;
                }))
              : undefined;
            return {
              ...ex,
              exerciseName: exercise?.name || "Unknown",
              exerciseDescription: exercise?.description,
              setConfigs: setConfigsResolved,
            };
          })
        );
        return { ...workout, exercisesWithDetails };
      })
    );

    return workoutsWithExercises;
  },
});

export const get = query({
  args: { id: v.id("workouts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const workout = await ctx.db.get(args.id);
    if (!workout) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });
    }

    const exercisesWithDetails = await Promise.all(
      workout.exercises.map(async (ex) => {
        const exercise = await ctx.db.get(ex.exerciseId);
        // Resolve superset names for legacy field
        let supersetName: string | undefined;
        if (ex.supersetWith) {
          const ssEx = await ctx.db.get(ex.supersetWith);
          supersetName = ssEx?.name;
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
        return {
          ...ex,
          exerciseName: exercise?.name || "Unknown",
          exerciseDescription: exercise?.description,
          exerciseMuscleGroup: exercise?.muscleGroup,
          supersetName,
          setConfigs: setConfigsResolved,
        };
      })
    );

    return { ...workout, exercisesWithDetails };
  },
});

export const create = mutation({
  args: {
    programId: v.id("programs"),
    clientId: v.optional(v.id("users")),
    name: v.string(),
    day: v.number(),
    week: v.number(),
    exercises: v.array(exerciseValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can create workouts" });
    }

    return await ctx.db.insert("workouts", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("workouts"),
    name: v.optional(v.string()),
    day: v.optional(v.number()),
    week: v.optional(v.number()),
    exercises: v.optional(v.array(exerciseValidator)),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can update workouts" });
    }

    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

export const duplicate = mutation({
  args: { id: v.id("workouts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user || !hasRole(user, "coach", "admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can duplicate workouts" });
    }
    const original = await ctx.db.get(args.id);
    if (!original) throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });
    const newId = await ctx.db.insert("workouts", {
      programId: original.programId,
      // Do not copy clientId — duplicated workouts become templates
      name: `${original.name} (Copy)`,
      day: original.day,
      week: original.week,
      exercises: original.exercises,
    });
    return newId;
  },
});

export const remove = mutation({
  args: { id: v.id("workouts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user || !hasRole(user, "coach", "admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches and admins can delete workouts" });
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * Update exercise configuration for a workout — saves a version snapshot before patching.
 * Used by coaches to edit reps/sets/rest/tempo/RIR/weight without creating duplicates.
 */
export const updateExerciseConfig = mutation({
  args: {
    workoutId: v.id("workouts"),
    // New exercises array (same structure as workout.exercises)
    exercises: v.array(exerciseValidator),
    changeSummary: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
    }

    const workout = await ctx.db.get(args.workoutId);
    if (!workout) throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });

    // Count existing versions to get next version number
    const existing = await ctx.db
      .query("workoutVersions")
      .withIndex("by_workout", q => q.eq("workoutId", args.workoutId))
      .collect();
    const nextVersion = existing.length + 1;

    // Save snapshot of current state BEFORE applying the change
    await ctx.db.insert("workoutVersions", {
      workoutId: args.workoutId,
      planVersion: nextVersion,
      effectiveDate: new Date().toISOString(),
      changeSummary: args.changeSummary ?? "Exercise configuration updated",
      savedBy: user._id,
      exercisesSnapshot: JSON.stringify(workout.exercises),
    });

    // Apply the update to the workout (no new workout created)
    await ctx.db.patch(args.workoutId, { exercises: args.exercises });
  },
});

/** Get version history for a workout — coach view only. */
export const getVersionHistory = query({
  args: { workoutId: v.id("workouts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
    }

    return await ctx.db
      .query("workoutVersions")
      .withIndex("by_workout", q => q.eq("workoutId", args.workoutId))
      .order("desc")
      .take(20);
  },
});

/**
 * Ensure a client has their own copies of all workouts for a program.
 * Called when a program is assigned to a client, and also as a backfill
 * for existing assignments that predate client-specific workouts.
 *
 * If client-specific workouts already exist for this program+client, does nothing.
 * Otherwise duplicates all template workouts (clientId = undefined) for the client.
 */
export const ensureClientWorkouts = mutation({
  args: {
    clientId: v.id("users"),
    programId: v.id("programs"),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user || !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
    }

    // Get template workouts for this program (no clientId)
    const allForProgram = await ctx.db
      .query("workouts")
      .withIndex("by_program", q => q.eq("programId", args.programId))
      .collect();
    const templates = allForProgram.filter(w => !w.clientId);
    if (templates.length === 0) return; // no templates to copy

    // Get existing client-specific workouts for this program
    const existing = await ctx.db
      .query("workouts")
      .withIndex("by_client_and_program", q => q.eq("clientId", args.clientId).eq("programId", args.programId))
      .collect();

    // Build a set of names that already exist for this client (to avoid duplicates)
    const existingNames = new Set(existing.map(w => w.name));

    // Duplicate any template that doesn't already have a client copy (by name)
    for (const template of templates) {
      if (!existingNames.has(template.name)) {
        await ctx.db.insert("workouts", {
          programId: template.programId,
          clientId: args.clientId,
          name: template.name,
          day: template.day,
          week: template.week,
          exercises: template.exercises,
        });
      }
    }
  },
});
