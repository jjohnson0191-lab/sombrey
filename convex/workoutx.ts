"use node";
/**
 * WorkoutX Exercise API integration — Node.js runtime (required for @workoutx/sdk).
 * The API key is read exclusively from server-side env: WORKOUTX_API_KEY.
 * It is NEVER returned to the frontend or stored in the database.
 *
 * DB helpers live in workoutxDb.ts (V8 runtime), called via ctx.runQuery/runMutation.
 *
 * Caching strategy — lazy search-and-cache:
 *   1. Frontend calls api.workoutx.syncAndSearch with a query/muscleGroup.
 *   2. Backend checks wxQueryCache. If hit → return immediately (0 WX API calls).
 *   3. If miss → fetch from WorkoutX, upsert all results into Convex exercises table,
 *      write a wxQueryCache entry with the current timestamp.
 *   4. Future calls for the same query → cache hit → zero WX API calls (30-day TTL).
 *
 * This means each unique query costs exactly 1 WX API call the first time, then
 * nothing for 30 days. With ~10 muscle groups and typical search terms,
 * the 10,000/month limit is nowhere near threatened.
 */

import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { WorkoutX, WorkoutXError } from "@workoutx/sdk";
import type { Id } from "./_generated/dataModel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapBodyPartToMuscleGroup(
  bodyPart: string,
): "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio" {
  const bp = bodyPart.toLowerCase();
  if (bp.includes("chest")) return "chest";
  if (bp.includes("back") || bp.includes("lat") || bp.includes("trap")) return "back";
  if (bp.includes("shoulder") || bp.includes("delt")) return "shoulders";
  if (bp.includes("arm") || bp.includes("bicep") || bp.includes("tricep") || bp.includes("forearm")) return "arms";
  if (bp.includes("quad") || bp.includes("hamstring") || bp.includes("glute") || bp.includes("calf") || bp.includes("thigh") || bp.includes("upper legs") || bp.includes("lower legs")) return "legs";
  if (bp.includes("leg")) return "legs";
  if (bp.includes("core") || bp.includes("ab") || bp.includes("waist")) return "core";
  if (bp.includes("cardio") || bp.includes("cardiovascular")) return "cardio";
  return "core";
}

/** Map our muscleGroup enum → WorkoutX bodyPart query string */
const MUSCLE_GROUP_TO_BODY_PART: Record<string, string> = {
  chest: "chest",
  back: "back",
  shoulders: "shoulders",
  arms: "upper arms",
  legs: "upper legs",
  core: "waist",
  cardio: "cardio",
};

function getWxClient(): WorkoutX {
  const apiKey = process.env.WORKOUTX_API_KEY;
  if (!apiKey) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "WorkoutX API key (WORKOUTX_API_KEY) is not configured in Secrets.",
    });
  }
  return new WorkoutX({ apiKey });
}

type RawExercise = {
  id: string;
  name: string;
  bodyPart: string;
  target: string;
  secondaryMuscles: string[];
  equipment: string;
  instructions: string[];
};

/** Upsert a batch of raw WX exercises into Convex — skips if already present */
async function upsertBatch(
  ctx: ActionCtx,
  wx: WorkoutX,
  exercises: RawExercise[],
): Promise<void> {
  for (const e of exercises) {
    // Skip if already cached in Convex
    const existing = await ctx.runQuery(internal.workoutxDb.getExerciseByWorkoutxId, {
      workoutxId: e.id,
    });
    if (existing) continue;

    const muscleGroup = mapBodyPartToMuscleGroup(e.bodyPart ?? "");
    await ctx.runMutation(internal.workoutxDb.upsertWxExercise, {
      workoutxId: e.id,
      name: e.name,
      description: e.target
        ? `${e.bodyPart ?? ""} exercise targeting ${e.target}`
        : (e.bodyPart ?? ""),
      muscleGroup,
      equipment: e.equipment ? [e.equipment] : [],
      primaryMuscles: e.target ? [e.target] : [],
      secondaryMuscles: e.secondaryMuscles ?? [],
      instructions: e.instructions ?? [],
      cues: [],
      gifUrl: wx.gifUrl(e.id),
      wxBodyPart: e.bodyPart ?? undefined,
      wxTarget: e.target ?? undefined,
    });
  }
}

// ── Main public action ────────────────────────────────────────────────────────

/**
 * syncAndSearch — the primary entry point for the exercise library.
 *
 * Called by the frontend when:
 *   - The page loads (muscleGroup filter selected, or "all")
 *   - The user types in the search box
 *
 * On first call for a given query → fetches from WorkoutX, upserts into Convex,
 * marks cache. On subsequent calls → returns immediately (cache hit). The caller
 * then queries Convex directly via useQuery(api.exercises.list, ...) which is
 * the live reactive source of truth.
 *
 * Returns: true if a WorkoutX sync was performed, false if served from cache.
 */
export const syncAndSearch = action({
  args: {
    // Text search term (e.g. "bench press")
    searchTerm: v.optional(v.string()),
    // Our muscleGroup enum value — used to pre-populate the group on page load
    muscleGroup: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ synced: boolean; cacheKey: string }> => {
    const wx = getWxClient();

    // Build a deterministic cache key from the query params
    let cacheKey: string;
    let wxBodyPart: string | undefined;
    let wxSearchName: string | undefined;

    const term = args.searchTerm?.trim().toLowerCase() ?? "";

    if (term.length >= 2) {
      cacheKey = `name:${term}`;
      wxSearchName = term;
    } else if (args.muscleGroup && args.muscleGroup !== "all") {
      const bp = MUSCLE_GROUP_TO_BODY_PART[args.muscleGroup] ?? args.muscleGroup;
      cacheKey = `bodyPart:${bp}`;
      wxBodyPart = bp;
    } else {
      // "all" — fetch a broad set to populate the library
      cacheKey = `bodyPart:back`;
      wxBodyPart = "back";
    }

    // Check cache — if hit, no WX API call needed
    const hit = await ctx.runQuery(internal.workoutxDb.isCacheHit, { cacheKey });
    if (hit) {
      return { synced: false, cacheKey };
    }

    // Cache miss — fetch from WorkoutX and upsert results into Convex
    try {
      let raw: { data: RawExercise[] };
      if (wxSearchName) {
        raw = (await wx.exercises.search({ name: wxSearchName, limit: 30 })) as typeof raw;
      } else if (wxBodyPart) {
        raw = (await wx.exercises.byBodyPart(wxBodyPart, { limit: 50 })) as typeof raw;
      } else {
        raw = (await wx.exercises.list({ limit: 30 })) as typeof raw;
      }

      await upsertBatch(ctx, wx, raw.data ?? []);

      // Write cache entry — future calls for this key are free
      await ctx.runMutation(internal.workoutxDb.markCached, { cacheKey });

      return { synced: true, cacheKey };
    } catch (err) {
      if (err instanceof WorkoutXError) {
        // Don't throw — degrade gracefully, just serve existing Convex data
        console.warn(`[workoutx] syncAndSearch failed for "${cacheKey}":`, err.message);
        return { synced: false, cacheKey };
      }
      throw err;
    }
  },
});

// ── Remaining public actions (used by coach Import panel) ────────────────────

/** Search WorkoutX directly — used by the coach Import Exercise panel. */
export const searchExercises = action({
  args: {
    query: v.optional(v.string()),
    bodyPart: v.optional(v.string()),
    target: v.optional(v.string()),
    equipment: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<{
    id: string;
    name: string;
    bodyPart: string;
    target: string;
    secondaryMuscles: string[];
    equipment: string;
    gifUrl: string;
    instructions: string[];
  }[]> => {
    const wx = getWxClient();
    const limit = args.limit ?? 30;

    try {
      let results: { data: RawExercise[] };
      if (args.query?.trim()) {
        results = (await wx.exercises.search({ name: args.query.trim(), limit })) as typeof results;
      } else if (args.bodyPart) {
        results = (await wx.exercises.byBodyPart(args.bodyPart, { limit })) as typeof results;
      } else if (args.target) {
        results = (await wx.exercises.byTarget(args.target, { limit })) as typeof results;
      } else if (args.equipment) {
        results = (await wx.exercises.byEquipment(args.equipment, { limit })) as typeof results;
      } else {
        results = (await wx.exercises.list({ limit })) as typeof results;
      }

      return (results.data ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        bodyPart: e.bodyPart ?? "",
        target: e.target ?? "",
        secondaryMuscles: e.secondaryMuscles ?? [],
        equipment: e.equipment ?? "",
        gifUrl: wx.gifUrl(e.id),
        instructions: e.instructions ?? [],
      }));
    } catch (err) {
      if (err instanceof WorkoutXError) {
        throw new ConvexError({ code: "EXTERNAL_SERVICE_ERROR", message: err.message });
      }
      throw err;
    }
  },
});

/**
 * Import a single WorkoutX exercise into Convex (upsert).
 * Used by the coach Import Exercise panel.
 */
export const importExercise = action({
  args: { workoutxId: v.string() },
  handler: async (ctx, args): Promise<Id<"exercises">> => {
    const wx = getWxClient();

    try {
      const existing = await ctx.runQuery(internal.workoutxDb.getExerciseByWorkoutxId, {
        workoutxId: args.workoutxId,
      });
      if (existing) return existing._id;

      const e = await wx.exercises.get(args.workoutxId);
      if (!e) throw new ConvexError({ code: "NOT_FOUND", message: "Exercise not found in WorkoutX" });

      const muscleGroup = mapBodyPartToMuscleGroup(e.bodyPart ?? "");

      return await ctx.runMutation(internal.workoutxDb.upsertWxExercise, {
        workoutxId: e.id,
        name: e.name,
        description: e.target
          ? `${e.bodyPart ?? ""} exercise targeting ${e.target}`
          : (e.bodyPart ?? ""),
        muscleGroup,
        equipment: e.equipment ? [e.equipment] : [],
        primaryMuscles: e.target ? [e.target] : [],
        secondaryMuscles: e.secondaryMuscles ?? [],
        instructions: e.instructions ?? [],
        cues: [],
        gifUrl: wx.gifUrl(e.id),
        wxBodyPart: e.bodyPart ?? undefined,
        wxTarget: e.target ?? undefined,
      });
    } catch (err) {
      if (err instanceof WorkoutXError) {
        if (err.isNotFound) throw new ConvexError({ code: "NOT_FOUND", message: "Exercise not found in WorkoutX" });
        throw new ConvexError({ code: "EXTERNAL_SERVICE_ERROR", message: err.message });
      }
      throw err;
    }
  },
});

/** Bulk import — used by the coach Import panel after a search. */
export const bulkImportExercises = action({
  args: { workoutxIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const wx = getWxClient();
    const result: Record<string, string> = {};
    for (const wxId of args.workoutxIds) {
      try {
        const existing = await ctx.runQuery(internal.workoutxDb.getExerciseByWorkoutxId, { workoutxId: wxId });
        if (existing) { result[wxId] = existing._id; continue; }
        const e = await wx.exercises.get(wxId);
        const convexId = await ctx.runMutation(internal.workoutxDb.upsertWxExercise, {
          workoutxId: e.id,
          name: e.name,
          description: e.target ? `${e.bodyPart ?? ""} exercise targeting ${e.target}` : (e.bodyPart ?? ""),
          muscleGroup: mapBodyPartToMuscleGroup(e.bodyPart ?? ""),
          equipment: e.equipment ? [e.equipment] : [],
          primaryMuscles: e.target ? [e.target] : [],
          secondaryMuscles: e.secondaryMuscles ?? [],
          instructions: e.instructions ?? [],
          cues: [],
          gifUrl: wx.gifUrl(e.id),
          wxBodyPart: e.bodyPart ?? undefined,
          wxTarget: e.target ?? undefined,
        });
        result[wxId] = convexId;
      } catch {
        console.warn(`[workoutx] Failed to import exercise ${wxId}`);
      }
    }
    return result;
  },
});

/** Get similar exercises — used on the exercise detail page. */
export const getSimilarExercises = action({
  args: { workoutxId: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, args): Promise<{
    id: string; name: string; bodyPart: string; target: string; gifUrl: string;
  }[]> => {
    const wx = getWxClient();
    try {
      const raw = (await wx.exercises.similar(args.workoutxId)) as { data: { id: string; name: string; bodyPart: string; target: string }[] };
      return (raw.data ?? []).slice(0, args.limit ?? 6).map((e) => ({
        id: e.id,
        name: e.name,
        bodyPart: e.bodyPart ?? "",
        target: e.target ?? "",
        gifUrl: wx.gifUrl(e.id),
      }));
    } catch (err) {
      if (err instanceof WorkoutXError) {
        throw new ConvexError({ code: "EXTERNAL_SERVICE_ERROR", message: err.message });
      }
      throw err;
    }
  },
});

/** Get filter lists — used by coach tooling. */
export const getFilterLists = action({
  args: {},
  handler: async (_ctx): Promise<{ bodyParts: string[]; targets: string[]; equipment: string[] }> => {
    const wx = getWxClient();
    try {
      const [bodyParts, targets, equipment] = await Promise.all([
        wx.exercises.bodyPartList(),
        wx.exercises.targetList(),
        wx.exercises.equipmentList(),
      ]);
      return { bodyParts: bodyParts ?? [], targets: targets ?? [], equipment: equipment ?? [] };
    } catch (err) {
      if (err instanceof WorkoutXError) {
        throw new ConvexError({ code: "EXTERNAL_SERVICE_ERROR", message: err.message });
      }
      throw err;
    }
  },
});
