import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { detectActiveWindows, restingBaseline, type Interval } from "./activityDetection";
import { ageFromDateOfBirth, estimatedMaxHeartRate } from "./activityIntensity";
import { summarizeActivity, usageOf } from "./activityProfile";
import {
  activityCatalog,
  isAmbiguousSportType,
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

export type ActivityRecord = {
  id: string;
  provenance: ActivityProvenance;
  activityKey: string;
  activityCategory: string;
  displayName: string;
  vendorSportType?: number;
  // Who said what this activity was: the band's own mode, the user choosing
  // it in the app before starting, or the user answering afterwards.
  classificationSource: "band" | "app" | "user";
  // The band's mode was too generic to say what was done, and the user
  // hasn't said yet.
  needsClassification?: boolean;
  startedAt: number;
  durationSeconds?: number;
  // "band": the band's own figure. "sombrey_timer": no band figure exists,
  // so the Sombrey app's own active time for an app-started activity.
  durationSource?: "band" | "sombrey_timer";
  // Physiological response — band measurements only.
  averageHeartRate?: number;
  lowestHeartRate?: number;
  highestHeartRate?: number;
  // "band_record": the band's own session summary. "band_samples":
  // calculated by Sombrey from the band's heart-rate readings in the window.
  heartRateSource?: "band_record" | "band_samples";
  // Energy/movement, each labelled with where it came from.
  calories?: number;
  caloriesSource?: "band_record" | "band_live" | "user_entered";
  distanceMeters?: number;
  steps?: number;
  averageSpeedMetersPerSecond?: number;
  fastestSpeedMetersPerSecond?: number;
  cadence?: number;
  actionCount?: number;
  climbMeters?: number;
  descentMeters?: number;
  averageAltitudeMeters?: number;
  // Where distance/steps/speed/cadence/altitude came from: the band's own
  // session record, or its last live update (app-started, record pending).
  movementSource?: "band_record" | "band_live";
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
      const record = sessionRecord(s);
      if (record) records.push(record);
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
        classificationSource: "user",
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

    const labels = await ctx.db
      .query("activityLabels")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", args.sinceMs))
      .collect();
    for (const label of labels) {
      const record = labelledRecord(label);
      if (record) records.push(record);
    }

    return records.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  },
});

// ── Activity intelligence foundation ──────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

const catalogByKey = new Map(activityCatalog().map((a) => [a.key, a]));

export function sessionRecord(s: Doc<"sportPlusSessions">): ActivityRecord | null {
  if (s.endedAt === undefined && s.bandStartTimeSec === undefined) return null; // still in progress
  const band = normalizeSportPlusType(s.sportType);
  const bandKey = s.activityKey ?? band.activityKey;
  const key = s.userActivityKey ?? bandKey;
  const catalogEntry = catalogByKey.get(key);
  const fromBandRecord = s.summarySource === "band_record";
  const movementSource = fromBandRecord ? "band_record" as const : "band_live" as const;
  const hasMovement = [s.distanceMeters, s.steps, s.averageSpeedMetersPerSecond].some((v) => v !== undefined);
  return {
    id: s._id,
    provenance: s.recordSource === "band" ? "band_sport_plus" : "app_sport_plus",
    activityKey: key,
    activityCategory: s.userActivityCategory ?? s.activityCategory ?? catalogEntry?.category ?? band.activityCategory,
    displayName: s.userActivityKey ? (catalogEntry?.name ?? band.displayName) : band.displayName,
    vendorSportType: s.sportType,
    classificationSource: s.userActivityKey ? "user" : s.recordSource === "band" ? "band" : "app",
    needsClassification: s.userActivityKey === undefined && isAmbiguousSportType(s.sportType) ? true : undefined,
    startedAt: s.startedAt,
    durationSeconds: s.durationSeconds ?? s.appActiveSeconds,
    durationSource: s.durationSeconds !== undefined ? "band" : s.appActiveSeconds !== undefined ? "sombrey_timer" : undefined,
    averageHeartRate: fromBandRecord ? s.averageHeartRate : undefined,
    lowestHeartRate: fromBandRecord ? s.lowestHeartRate : undefined,
    highestHeartRate: fromBandRecord ? s.highestHeartRate : undefined,
    heartRateSource: fromBandRecord && s.averageHeartRate !== undefined ? "band_record" : undefined,
    calories: s.calories,
    caloriesSource: s.calories === undefined ? undefined : fromBandRecord ? "band_record" : "band_live",
    distanceMeters: s.distanceMeters,
    steps: s.steps,
    averageSpeedMetersPerSecond: s.averageSpeedMetersPerSecond,
    fastestSpeedMetersPerSecond: s.fastestSpeedMetersPerSecond,
    cadence: s.stepFrequency,
    actionCount: s.actionCount,
    climbMeters: s.climbMeters,
    descentMeters: s.descentMeters,
    averageAltitudeMeters: s.averageAltitudeMeters,
    movementSource: hasMovement ? movementSource : undefined,
    timestampSuspect: s.timestampSuspect,
  };
}

export function labelledRecord(label: Doc<"activityLabels">): ActivityRecord | null {
  if (label.status !== "labelled" || label.activityKey === undefined) return null;
  const entry = activityCatalog().find((a) => a.key === label.activityKey);
  return {
    id: label._id,
    provenance: "user_labelled",
    classificationSource: "user",
    activityKey: label.activityKey,
    activityCategory: label.activityCategory ?? entry?.category ?? "other",
    displayName: entry?.name ?? label.activityKey,
    vendorSportType: label.vendorSportType,
    startedAt: label.startedAt,
    durationSeconds: Math.round((label.endedAt - label.startedAt) / 1000),
    averageHeartRate: label.averageHeartRate,
    highestHeartRate: label.highestHeartRate,
    heartRateSource: label.averageHeartRate !== undefined ? "band_samples" : undefined,
  };
}

/** Every completed activity (band sessions and named detections) since
 * `sinceMs`, newest first — the pool for usage and per-activity history. */
async function activityPool(ctx: QueryCtx, userId: Id<"users">, sinceMs: number): Promise<ActivityRecord[]> {
  const sessions = await ctx.db
    .query("sportPlusSessions")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs))
    .order("desc")
    .take(1000);
  const labels = await ctx.db
    .query("activityLabels")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs))
    .order("desc")
    .take(500);
  const records = [
    ...sessions.map(sessionRecord),
    ...labels.map(labelledRecord),
  ].filter((r): r is ActivityRecord => r !== null);
  return records.sort((a, b) => b.startedAt - a.startedAt);
}

/** Which activities the user actually does: count and last time per
 * activity over the past year, most recent first. */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const pool = await activityPool(ctx, user._id, Date.now() - 365 * DAY_MS);
    return usageOf(pool);
  },
});

/** "Your Tennis": the user's sessions of one activity and what they add
 * up to. Averages only from sessions that measured the value. */
export const history = query({
  args: { activityKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const pool = await activityPool(ctx, user._id, Date.now() - 365 * DAY_MS);
    const sessions = pool.filter((r) => r.activityKey === args.activityKey);
    return {
      sessions: sessions.slice(0, Math.min(args.limit ?? 30, 100)),
      profile: summarizeActivity(sessions, Date.now()),
    };
  },
});

/** What intensity can be expressed against. `estimatedMaxHeartRate` is
 * the age-predicted estimate (Tanaka, 208 − 0.7·age), present only with a date of
 * birth; `restingHeartRate` is the band's most recent resting reading. */
export const intensityContext = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const age = ageFromDateOfBirth(user.dateOfBirth, Date.now());
    const resting = await ctx.db
      .query("wearableMeasurements")
      .withIndex("by_user_metric_and_recordedAt", (q) =>
        q.eq("userId", user._id).eq("metricType", "resting_heart_rate").gte("recordedAt", Date.now() - 14 * DAY_MS))
      .order("desc")
      .first();
    return {
      estimatedMaxHeartRate: estimatedMaxHeartRate(age),
      restingHeartRate: resting && resting.value > 0 ? resting.value : undefined,
    };
  },
});

const DETECTION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// A period that may still be going on isn't asked about yet.
const DETECTION_SETTLE_MS = 10 * 60 * 1000;

async function coveredIntervals(ctx: QueryCtx, userId: Id<"users">, sinceMs: number): Promise<Interval[]> {
  const covered: Interval[] = [];
  const pad = 12 * 60 * 60 * 1000; // a long session that started before the window
  const sessions = await ctx.db
    .query("sportPlusSessions")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs - pad))
    .collect();
  for (const s of sessions) {
    const end = s.endedAt ?? (s.durationSeconds !== undefined ? s.startedAt + s.durationSeconds * 1000 : Date.now());
    covered.push({ startedAt: s.startedAt, endedAt: end });
  }
  const workouts = await ctx.db
    .query("sombreyWorkouts")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs - pad))
    .collect();
  for (const w of workouts) {
    const end = w.completedAt ?? (w.durationSeconds !== undefined ? w.startedAt + w.durationSeconds * 1000 : Date.now());
    covered.push({ startedAt: w.startedAt, endedAt: end });
  }
  const sleeps = await ctx.db
    .query("wearableSleepSessions")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs - pad))
    .collect();
  for (const s of sleeps) covered.push({ startedAt: s.startedAt, endedAt: s.endedAt });
  const labels = await ctx.db
    .query("activityLabels")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs - pad))
    .collect();
  for (const l of labels) covered.push({ startedAt: l.startedAt, endedAt: l.endedAt });
  return covered;
}

async function heartRateSamples(ctx: QueryCtx, userId: Id<"users">, sinceMs: number, untilMs?: number) {
  const rows = await ctx.db
    .query("wearableMeasurements")
    .withIndex("by_user_metric_and_recordedAt", (q) => {
      const range = q.eq("userId", userId).eq("metricType", "heart_rate").gte("recordedAt", sinceMs);
      return untilMs === undefined ? range : range.lte("recordedAt", untilMs);
    })
    .take(8000);
  return rows.filter((r) => r.value > 0).map((r) => ({ recordedAt: r.recordedAt, bpm: r.value }));
}

/** Periods of the last day when the band's heart rate says the user was
 * active and nothing recorded explains it. Oldest first. */
export const pendingDetections = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const now = Date.now();
    const since = now - DETECTION_LOOKBACK_MS;
    const samples = await heartRateSamples(ctx, user._id, since);
    const resting = await ctx.db
      .query("wearableMeasurements")
      .withIndex("by_user_metric_and_recordedAt", (q) =>
        q.eq("userId", user._id).eq("metricType", "resting_heart_rate").gte("recordedAt", now - 7 * DAY_MS))
      .take(100);
    const baseline = restingBaseline(resting.map((r) => r.value), samples.map((s) => s.bpm));
    const covered = await coveredIntervals(ctx, user._id, since);
    return detectActiveWindows(samples, baseline, covered).filter((w) => w.endedAt <= now - DETECTION_SETTLE_MS);
  },
});

/** Names a noticed period (`activityKey`), or dismisses it (no key). The
 * heart-rate figures are recomputed here from the band's own readings in
 * the window — never taken from the client. */
export const labelDetection = mutation({
  args: { startedAt: v.number(), endedAt: v.number(), activityKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!(args.endedAt > args.startedAt) || args.endedAt - args.startedAt > 24 * 60 * 60 * 1000) {
      throw new ConvexError({ code: "INVALID", message: "Invalid period" });
    }
    const existing = await ctx.db
      .query("activityLabels")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).eq("startedAt", args.startedAt))
      .first();
    if (existing) return existing._id;
    if (args.activityKey === undefined) {
      return await ctx.db.insert("activityLabels", {
        userId: user._id, startedAt: args.startedAt, endedAt: args.endedAt, status: "dismissed", createdAt: Date.now(),
      });
    }
    const entry = activityCatalog().find((a) => a.key === args.activityKey);
    if (!entry) throw new ConvexError({ code: "INVALID", message: "Unknown activity" });
    const samples = await heartRateSamples(ctx, user._id, args.startedAt, args.endedAt);
    const bpms = samples.map((s) => s.bpm);
    return await ctx.db.insert("activityLabels", {
      userId: user._id,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      status: "labelled",
      activityKey: entry.key,
      activityCategory: entry.category,
      vendorSportType: entry.vendorSportType,
      averageHeartRate: bpms.length > 0 ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : undefined,
      highestHeartRate: bpms.length > 0 ? Math.max(...bpms) : undefined,
      heartRateSampleCount: bpms.length,
      createdAt: Date.now(),
    });
  },
});

// ── Band records the user hasn't seen yet ─────────────────────────────────

const REVIEW_WINDOW_MS = 7 * DAY_MS;

/** Activities the band recorded on its own (started on the band) that the
 * user hasn't looked at yet — newest first. Those whose band mode is too
 * generic carry `needsClassification`: Sombrey asks what they were rather
 * than guessing. */
export const pendingReviews = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const sessions = await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", Date.now() - REVIEW_WINDOW_MS))
      .order("desc")
      .take(100);
    return sessions
      .filter((s) => s.recordSource === "band" && s.reviewedAt === undefined)
      .map(sessionRecord)
      .filter((r): r is ActivityRecord => r !== null)
      .slice(0, 5);
  },
});

/** Marks a band-started record as seen. `activityKey` answers "what was
 * this?" for a record whose band mode was too generic; a specific band mode
 * stays the source of truth and can't be overridden here. */
export const reviewSession = mutation({
  args: { sessionId: v.id("sportPlusSessions"), activityKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    }
    if (args.activityKey === undefined) {
      await ctx.db.patch(args.sessionId, { reviewedAt: Date.now() });
      return;
    }
    if (!isAmbiguousSportType(session.sportType)) {
      throw new ConvexError({ code: "INVALID", message: "The band already recorded what this activity was" });
    }
    const entry = catalogByKey.get(args.activityKey);
    if (!entry) throw new ConvexError({ code: "INVALID", message: "Unknown activity" });
    await ctx.db.patch(args.sessionId, {
      userActivityKey: entry.key,
      userActivityCategory: entry.category,
      reviewedAt: Date.now(),
    });
  },
});
