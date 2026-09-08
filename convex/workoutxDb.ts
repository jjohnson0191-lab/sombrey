/**
 * WorkoutX internal DB helpers — V8 runtime (no "use node").
 * These are called by the Node.js workoutx.ts actions via ctx.runQuery / ctx.runMutation.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** 30-day cache TTL in milliseconds */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Cache helpers ─────────────────────────────────────────────────────────────

export const isCacheHit = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx: QueryCtx, args): Promise<boolean> => {
    const entry = await ctx.db
      .query("wxQueryCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    if (!entry) return false;
    return Date.now() - entry.cachedAt < CACHE_TTL_MS;
  },
});

export const markCached = internalMutation({
  args: { cacheKey: v.string() },
  handler: async (ctx: MutationCtx, args): Promise<void> => {
    const existing = await ctx.db
      .query("wxQueryCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { cachedAt: Date.now() });
    } else {
      await ctx.db.insert("wxQueryCache", { cacheKey: args.cacheKey, cachedAt: Date.now() });
    }
  },
});

// ── Exercise helpers ──────────────────────────────────────────────────────────

export const getExerciseByWorkoutxId = internalQuery({
  args: { workoutxId: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    return await ctx.db
      .query("exercises")
      .withIndex("by_workoutx_id", (q) => q.eq("workoutxId", args.workoutxId))
      .first();
  },
});

export const upsertWxExercise = internalMutation({
  args: {
    workoutxId: v.string(),
    name: v.string(),
    description: v.string(),
    muscleGroup: v.union(
      v.literal("chest"), v.literal("back"), v.literal("shoulders"),
      v.literal("arms"), v.literal("legs"), v.literal("core"), v.literal("cardio"),
    ),
    equipment: v.array(v.string()),
    primaryMuscles: v.array(v.string()),
    secondaryMuscles: v.array(v.string()),
    instructions: v.array(v.string()),
    cues: v.array(v.string()),
    gifUrl: v.optional(v.string()),
    wxBodyPart: v.optional(v.string()),
    wxTarget: v.optional(v.string()),
  },
  handler: async (ctx: MutationCtx, args): Promise<Id<"exercises">> => {
    const existing = await ctx.db
      .query("exercises")
      .withIndex("by_workoutx_id", (q) => q.eq("workoutxId", args.workoutxId))
      .first();

    if (existing) {
      // Update metadata but don't overwrite manually-authored cues/instructions
      await ctx.db.patch(existing._id, {
        name: args.name,
        gifUrl: args.gifUrl,
        wxBodyPart: args.wxBodyPart,
        wxTarget: args.wxTarget,
        muscleGroup: args.muscleGroup,
        equipment: args.equipment,
        primaryMuscles: args.primaryMuscles,
        secondaryMuscles: args.secondaryMuscles,
      });
      return existing._id;
    }

    return await ctx.db.insert("exercises", {
      workoutxId: args.workoutxId,
      name: args.name,
      description: args.description,
      muscleGroup: args.muscleGroup,
      equipment: args.equipment,
      primaryMuscles: args.primaryMuscles,
      secondaryMuscles: args.secondaryMuscles,
      instructions: args.instructions,
      cues: args.cues,
      gifUrl: args.gifUrl,
      wxBodyPart: args.wxBodyPart,
      wxTarget: args.wxTarget,
    });
  },
});
