import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
  normalizeManualActivity,
  normalizeSombreyWorkout,
  normalizeSportPlusType,
  type ActivityProvenance,
} from "./activityTaxonomy";

// The unified activity layer: every activity the user did, from any
// pathway, in Sombrey's own normalized terms — the foundation for future
// training-load, strain and AI Coach reasoning ("tennis for 82 minutes
// yesterday", not "one workout"). Read-only; nothing here is estimated.
// Each item keeps its provenance, and a value is present only when its
// source actually measured or recorded it.

async function requireAuth(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

export type ActivityRecord = {
  id: string;
  provenance: ActivityProvenance;
  activityKey: string;
  activityCategory: string;
  displayName: string;
  vendorSportType?: number;
  startedAt: number;
  durationSeconds?: number;
  // Physiological response — band measurements only.
  averageHeartRate?: number;
  lowestHeartRate?: number;
  highestHeartRate?: number;
  heartRateSource?: "band_record";
  // Energy/movement, each labelled with where it came from.
  calories?: number;
  caloriesSource?: "band_record" | "band_live" | "user_entered";
  distanceMeters?: number;
  steps?: number;
  timestampSuspect?: boolean;
};

export const listRecent = query({
  args: { sinceMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ActivityRecord[]> => {
    const user = await requireAuth(ctx);
    const limit = Math.min(args.limit ?? 100, 500);

    const sessions = await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", args.sinceMs))
      .collect();
    const workouts = await ctx.db
      .query("sombreyWorkouts")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", args.sinceMs))
      .collect();

    const records: ActivityRecord[] = [];

    for (const s of sessions) {
      if (s.endedAt === undefined && s.bandStartTimeSec === undefined) continue; // still in progress
      const activity = normalizeSportPlusType(s.sportType);
      const fromBandRecord = s.summarySource === "band_record";
      records.push({
        id: s._id,
        provenance: s.recordSource === "band" ? "band_sport_plus" : "app_sport_plus",
        activityKey: s.activityKey ?? activity.activityKey,
        activityCategory: s.activityCategory ?? activity.activityCategory,
        displayName: activity.displayName,
        vendorSportType: s.sportType,
        startedAt: s.startedAt,
        durationSeconds: s.durationSeconds,
        averageHeartRate: fromBandRecord ? s.averageHeartRate : undefined,
        lowestHeartRate: fromBandRecord ? s.lowestHeartRate : undefined,
        highestHeartRate: fromBandRecord ? s.highestHeartRate : undefined,
        heartRateSource: fromBandRecord && s.averageHeartRate !== undefined ? "band_record" : undefined,
        calories: s.calories,
        caloriesSource: s.calories === undefined ? undefined : fromBandRecord ? "band_record" : "band_live",
        distanceMeters: s.distanceMeters,
        steps: s.steps,
        timestampSuspect: s.timestampSuspect,
      });
    }

    for (const w of workouts) {
      if (w.completedAt === undefined) continue;
      // A structured workout paired with a Sport+ session is one activity:
      // the session above already represents its physiology.
      if (w.sportPlusSessionId !== undefined && sessions.some((s) => s._id === w.sportPlusSessionId)) continue;
      const manual = w.source === "manual";
      const activity = manual ? normalizeManualActivity(w.activityType) : normalizeSombreyWorkout();
      records.push({
        id: w._id,
        provenance: manual ? "manual" : "sombrey_workout",
        activityKey: activity.activityKey,
        activityCategory: activity.activityCategory,
        displayName: manual ? w.name : activity.displayName,
        startedAt: w.startedAt,
        durationSeconds: w.durationSeconds,
        calories: w.userReportedCalories,
        caloriesSource: w.userReportedCalories === undefined ? undefined : "user_entered",
        distanceMeters: w.distanceMeters,
      });
    }

    return records.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  },
});
