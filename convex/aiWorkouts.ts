/**
 * AI Workout Logging and Progressive Overload Engine
 *
 * Rep structure:
 *   Week 1 (and after weight reset): [15, 12, 10, 8]
 *   Each week: +1 rep per set until [15, 15, 15, 15]
 *   Then: bump weight +3%, reset to [15, 12, 10, 8]
 *
 * Plateau detection: stallCount >= 2 → mark hasPlateaued, suggest intensifier
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";

// ─── Progression Math (inlined — also in src/lib/progression.ts for frontend) ─

const BASE_REPS = [15, 12, 10, 8] as const;
const MAX_REPS = 15;
const WEIGHT_INCREASE_PCT = 0.03;

function computeTargetReps(weightCycleWeek: number): number[] {
  return BASE_REPS.map((base) => Math.min(MAX_REPS, base + (weightCycleWeek - 1)));
}

function isRepCeiling(targetReps: number[]): boolean {
  return targetReps.every((r) => r >= MAX_REPS);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATEAU_STALL_THRESHOLD = 2;
const INTENSIFIERS = ["drop_set", "tempo", "shorter_rest", "rest_pause", "superset", "extra_volume"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

function pickIntensifier(exerciseName: string): string {
  const idx = exerciseName.length % INTENSIFIERS.length;
  return INTENSIFIERS[idx];
}

function hitAllTargets(
  sets: Array<{ actualReps: number; targetReps: number; completed: boolean }>
): boolean {
  return sets.every((s) => s.completed && s.actualReps >= s.targetReps);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Returns today's workout from the AI plan with per-exercise progression targets */
export const getTodayWorkout = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (!plan || plan.status !== "ready") return null;

    const now = new Date();
    const startDate = plan.startDate ? new Date(plan.startDate) : null;
    const currentWeek = startDate
      ? Math.min(12, Math.max(1, Math.ceil((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))))
      : 1;

    const todayName = now.toLocaleDateString("en", { weekday: "long" });
    const todaySchedule = plan.weeklySchedule.find((s) =>
      s.day.toLowerCase().startsWith(todayName.toLowerCase().slice(0, 3))
    );
    if (!todaySchedule || todaySchedule.type.toLowerCase() === "rest") {
      return { isRestDay: true as const, currentWeek, planId: plan._id };
    }

    const workoutDay = plan.workoutDays.find((w) =>
      todaySchedule.type &&
      w.dayName.toLowerCase().includes(todaySchedule.type.toLowerCase().slice(0, 4))
    ) ?? plan.workoutDays[0];

    if (!workoutDay) return { isRestDay: true as const, currentWeek, planId: plan._id };

    const todayStr = now.toISOString().slice(0, 10);
    const alreadyLogged = await ctx.db
      .query("aiWorkoutLogs")
      .withIndex("by_user_and_week", (q) =>
        q.eq("userId", user._id).eq("weekNumber", currentWeek)
      )
      .filter((q) => q.eq(q.field("workoutDayName"), workoutDay.dayName))
      .first();
    const loggedToday = alreadyLogged
      ? alreadyLogged.completedAt.slice(0, 10) === todayStr
      : false;

    const exercisesWithProgression = await Promise.all(
      workoutDay.exercises.map(async (ex) => {
        const prog = await ctx.db
          .query("exerciseProgressions")
          .withIndex("by_user_plan_exercise", (q) =>
            q.eq("userId", user._id).eq("planId", plan._id).eq("exerciseName", ex.name)
          )
          .unique();

        const weightCycleWeek = prog?.weightCycleWeek ?? 1;
        const targetReps = computeTargetReps(weightCycleWeek);
        const isBaseline = !prog?.currentWeightKg;

        return {
          exerciseName: ex.name,
          sets: ex.sets,
          rest: ex.rest,
          notes: ex.notes,
          targetReps,
          currentWeightKg: prog?.currentWeightKg ?? null,
          isBaseline,
          hasPlateaued: prog?.hasPlateaued ?? false,
          plateauIntensifier: prog?.plateauIntensifier ?? null,
          stallCount: prog?.stallCount ?? 0,
          weightCycleWeek,
          lastLog: alreadyLogged
            ? alreadyLogged.exercises.find((e) => e.exerciseName === ex.name) ?? null
            : null,
        };
      })
    );

    return {
      isRestDay: false as const,
      planId: plan._id,
      currentWeek,
      workoutDayName: workoutDay.dayName,
      scheduleType: todaySchedule.type,
      scheduleFocus: todaySchedule.focus,
      exercises: exercisesWithProgression,
      loggedToday,
      lastLogId: alreadyLogged?._id ?? null,
    };
  },
});

/** Get all exercise progressions for the current plan */
export const getExerciseProgressions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];
    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (!plan) return [];
    return ctx.db
      .query("exerciseProgressions")
      .withIndex("by_user_and_plan", (q) =>
        q.eq("userId", user._id).eq("planId", plan._id)
      )
      .collect();
  },
});

/** Get recent AI workout logs */
export const listRecentLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];
    return ctx.db
      .query("aiWorkoutLogs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 10);
  },
});

/** Get the last logged workout for a specific workout day name */
export const getLastWorkoutLog = query({
  args: { workoutDayName: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (!plan) return null;
    const logs = await ctx.db
      .query("aiWorkoutLogs")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .order("desc")
      .collect();
    return logs.find((l) => l.workoutDayName === args.workoutDayName) ?? null;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Log a completed AI workout and update per-exercise progression state */
export const logAiWorkout = mutation({
  args: {
    planId: v.id("aiGeneratedPlans"),
    weekNumber: v.number(),
    workoutDayName: v.string(),
    durationSeconds: v.optional(v.number()),
    exercises: v.array(v.object({
      exerciseName: v.string(),
      targetReps: v.array(v.number()),
      sets: v.array(v.object({
        setNumber: v.number(),
        targetReps: v.number(),
        actualReps: v.number(),
        weightKg: v.number(),
        completed: v.boolean(),
        notes: v.optional(v.string()),
      })),
    })),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = new Date().toISOString();

    const logId = await ctx.db.insert("aiWorkoutLogs", {
      userId: user._id,
      planId: args.planId,
      weekNumber: args.weekNumber,
      workoutDayName: args.workoutDayName,
      completedAt: now,
      durationSeconds: args.durationSeconds,
      exercises: args.exercises,
      notes: args.notes,
    });

    for (const ex of args.exercises) {
      const existing = await ctx.db
        .query("exerciseProgressions")
        .withIndex("by_user_plan_exercise", (q) =>
          q.eq("userId", user._id).eq("planId", args.planId).eq("exerciseName", ex.exerciseName)
        )
        .unique();

      const firstSetWeight = ex.sets[0]?.weightKg ?? 0;
      const hitAll = hitAllTargets(ex.sets);
      const currentWeight = existing?.currentWeightKg ?? firstSetWeight;

      if (!existing) {
        await ctx.db.insert("exerciseProgressions", {
          userId: user._id,
          planId: args.planId,
          exerciseName: ex.exerciseName,
          currentWeightKg: firstSetWeight > 0 ? firstSetWeight : undefined,
          weightCycleWeek: 1,
          lastLoggedWeek: args.weekNumber,
          stallCount: 0,
          hasPlateaued: false,
          weightHistory: firstSetWeight > 0
            ? [{ weightKg: firstSetWeight, setAtWeek: args.weekNumber, setAt: now }]
            : [],
        });
        continue;
      }

      const currentCycleWeek = existing.weightCycleWeek;
      const currentTargetReps = computeTargetReps(currentCycleWeek);
      const atCeiling = isRepCeiling(currentTargetReps);

      let newWeightKg = existing.currentWeightKg ?? firstSetWeight;
      let newCycleWeek = currentCycleWeek;
      let newStallCount = existing.stallCount;
      let hasPlateaued = existing.hasPlateaued;
      let plateauIntensifier = existing.plateauIntensifier;
      const weightHistory = [...existing.weightHistory];

      if (hitAll && atCeiling) {
        // Hit all sets at 15 reps → bump weight +3%, reset cycle
        const newWeight = Math.round(currentWeight * (1 + WEIGHT_INCREASE_PCT) * 2) / 2;
        newWeightKg = newWeight;
        newCycleWeek = 1;
        newStallCount = 0;
        hasPlateaued = false;
        plateauIntensifier = undefined;
        weightHistory.push({ weightKg: newWeight, setAtWeek: args.weekNumber, setAt: now });
      } else if (hitAll) {
        // Hit all targets → advance +1 rep next week
        newCycleWeek = currentCycleWeek + 1;
        newStallCount = 0;
        hasPlateaued = false;
        plateauIntensifier = undefined;
      } else {
        // Stall
        newStallCount = existing.stallCount + 1;
        if (newStallCount >= PLATEAU_STALL_THRESHOLD) {
          hasPlateaued = true;
          plateauIntensifier = plateauIntensifier ?? pickIntensifier(ex.exerciseName);
        }
      }

      // Capture baseline weight on first log
      const finalWeight = (!existing.currentWeightKg && firstSetWeight > 0)
        ? firstSetWeight
        : newWeightKg;

      await ctx.db.patch(existing._id, {
        currentWeightKg: finalWeight > 0 ? finalWeight : existing.currentWeightKg,
        weightCycleWeek: newCycleWeek,
        lastLoggedWeek: args.weekNumber,
        stallCount: newStallCount,
        hasPlateaued,
        plateauIntensifier,
        weightHistory: (!existing.currentWeightKg && firstSetWeight > 0)
          ? [{ weightKg: firstSetWeight, setAtWeek: args.weekNumber, setAt: now }]
          : weightHistory,
      });
    }

    return logId;
  },
});
