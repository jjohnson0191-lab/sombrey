import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeSportPlusType } from "./activityTaxonomy";
import { findAppStartedMatch, isMalformed, isTimestampSuspect } from "./sportPlusImport";

// QCBand Sport+ activity sessions — the wearable's own physiological/
// activity record, distinct from a sombreyWorkouts row (sets/reps/weight).
// Every value here comes from a real QCBandSDK Sport+ call on the client
// (see apps/ios/Sombrey/Wearable/QCBandSDKService.swift); nothing is
// fabricated.

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

export const startSession = mutation({
  args: { deviceId: v.string(), sportType: v.number(), startedAt: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const activity = normalizeSportPlusType(args.sportType);
    return await ctx.db.insert("sportPlusSessions", {
      userId: user._id,
      deviceId: args.deviceId,
      sportType: args.sportType,
      startedAt: args.startedAt,
      source: "sombrey_band",
      recordSource: "app",
      activityKey: activity.activityKey,
      activityCategory: activity.activityCategory,
    });
  },
});

export const finishSession = mutation({
  args: {
    sessionId: v.id("sportPlusSessions"),
    endedAt: v.number(),
    durationSeconds: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
    calories: v.optional(v.number()),
    averageHeartRate: v.optional(v.number()),
    lowestHeartRate: v.optional(v.number()),
    highestHeartRate: v.optional(v.number()),
    averageSpeedMetersPerSecond: v.optional(v.number()),
    steps: v.optional(v.number()),
    appActiveSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    }
    // Heart-rate statistics are never taken from this call: the only
    // figure a client has here is the last live reading, which earlier
    // builds sent as the "average". The band's own record supplies real
    // min/avg/max when it's imported (importBandSessions). If the band
    // record already landed, its figures are left untouched.
    if (session.summarySource === "band_record") {
      await ctx.db.patch(args.sessionId, { endedAt: session.endedAt ?? args.endedAt, appActiveSeconds: args.appActiveSeconds });
      return;
    }
    await ctx.db.patch(args.sessionId, {
      endedAt: args.endedAt,
      durationSeconds: args.durationSeconds,
      distanceMeters: args.distanceMeters,
      calories: args.calories,
      averageSpeedMetersPerSecond: args.averageSpeedMetersPerSecond,
      steps: args.steps,
      appActiveSeconds: args.appActiveSeconds,
      summarySource: "live_final_tick",
    });
  },
});

export const recordDetail = mutation({
  args: {
    sessionId: v.id("sportPlusSessions"),
    heartRates: v.optional(v.array(v.number())),
    speedsMetersPerSecond: v.optional(v.array(v.number())),
    route: v.optional(v.array(v.object({
      latitude: v.number(),
      longitude: v.number(),
      recordedAt: v.number(),
      altitudeMeters: v.optional(v.number()),
    }))),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    }
    // One detail row per session: a band-record import may already have
    // created it (heart-rate/speed series), so the phone's route is added
    // to that row rather than a second one. Its provenance is recorded.
    const existing = await ctx.db
      .query("sportPlusSessionDetails")
      .withIndex("by_session", (q) => q.eq("sportPlusSessionId", args.sessionId))
      .first();
    const routeFields = args.route ? { route: args.route, routeSource: "phone_gps" } : {};
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...routeFields,
        ...(args.heartRates ? { heartRates: args.heartRates } : {}),
        ...(args.speedsMetersPerSecond ? { speedsMetersPerSecond: args.speedsMetersPerSecond } : {}),
      });
      return existing._id;
    }
    return await ctx.db.insert("sportPlusSessionDetails", {
      sportPlusSessionId: args.sessionId,
      userId: user._id,
      heartRates: args.heartRates,
      speedsMetersPerSecond: args.speedsMetersPerSecond,
      ...routeFields,
    });
  },
});

export const getRecentSessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const getSessionDetail = query({
  args: { sessionId: v.id("sportPlusSessions") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) return null;
    const detail = await ctx.db
      .query("sportPlusSessionDetails")
      .withIndex("by_session", (q) => q.eq("sportPlusSessionId", args.sessionId))
      .first();
    return { session, detail };
  },
});

// ─── Band-record import ─────────────────────────────────────────────────
// Sessions recorded by the band — including ones started on the band that
// Sombrey never saw live — imported from the band's own Sport+ history.

/** Latest band start time already imported (the band's own seconds), so
 * the client can ask the band only for newer records (with an overlap). */
export const importCursor = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const latest = await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_bandStart", (q) => q.eq("userId", user._id).gt("bandStartTimeSec", 0))
      .order("desc")
      .first();
    return latest?.bandStartTimeSec ?? null;
  },
});

const optionalNumber = v.optional(v.number());

const bandRecordValidator = v.object({
  sportType: v.number(),
  recordSource: v.optional(v.union(v.literal("band"), v.literal("app"))),
  bandStartTimeSec: v.number(),
  bandDurationRaw: v.number(),
  durationSeconds: v.number(),
  distanceMeters: optionalNumber,
  calories: optionalNumber,
  averageHeartRate: optionalNumber,
  lowestHeartRate: optionalNumber,
  highestHeartRate: optionalNumber,
  averageSpeedMetersPerSecond: optionalNumber,
  fastestSpeedMetersPerSecond: optionalNumber,
  stepFrequency: optionalNumber,
  actionCount: optionalNumber,
  averageAltitudeMeters: optionalNumber,
  climbMeters: optionalNumber,
  descentMeters: optionalNumber,
  steps: optionalNumber,
  sampleRateSeconds: optionalNumber,
  heartRates: v.optional(v.array(v.number())),
  speedsMetersPerSecond: v.optional(v.array(v.number())),
  route: v.optional(v.array(v.object({
    latitude: v.number(),
    longitude: v.number(),
    recordedAt: v.number(),
    altitudeMeters: v.optional(v.number()),
  }))),
});

/** Idempotent: a record already imported (same band start time) is
 * refreshed in place; a record completing an app-started row is merged
 * into it; anything else becomes a new row. Malformed records are skipped.
 * Absent fields stay absent — the client only sends values the band
 * actually reported. */
export const importBandSessions = mutation({
  args: { deviceId: v.string(), records: v.array(bandRecordValidator) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const now = Date.now();
    let inserted = 0;
    let merged = 0;
    let refreshed = 0;
    let skipped = 0;

    for (const record of args.records) {
      if (isMalformed(record, now)) {
        skipped += 1;
        continue;
      }
      const activity = normalizeSportPlusType(record.sportType);
      const startedAt = record.bandStartTimeSec * 1000;
      const summary = {
        sportType: record.sportType,
        recordSource: record.recordSource,
        bandStartTimeSec: record.bandStartTimeSec,
        bandDurationRaw: record.bandDurationRaw,
        durationSeconds: record.durationSeconds,
        endedAt: startedAt + record.durationSeconds * 1000,
        distanceMeters: record.distanceMeters,
        calories: record.calories,
        averageHeartRate: record.averageHeartRate,
        lowestHeartRate: record.lowestHeartRate,
        highestHeartRate: record.highestHeartRate,
        averageSpeedMetersPerSecond: record.averageSpeedMetersPerSecond,
        fastestSpeedMetersPerSecond: record.fastestSpeedMetersPerSecond,
        stepFrequency: record.stepFrequency,
        actionCount: record.actionCount,
        averageAltitudeMeters: record.averageAltitudeMeters,
        climbMeters: record.climbMeters,
        descentMeters: record.descentMeters,
        steps: record.steps,
        sampleRateSeconds: record.sampleRateSeconds,
        activityKey: activity.activityKey,
        activityCategory: activity.activityCategory,
        summarySource: "band_record" as const,
        timestampSuspect: isTimestampSuspect(record, now) || undefined,
        importedAt: now,
      };

      const already = await ctx.db
        .query("sportPlusSessions")
        .withIndex("by_user_and_bandStart", (q) => q.eq("userId", user._id).eq("bandStartTimeSec", record.bandStartTimeSec))
        .first();

      let sessionId;
      if (already) {
        await ctx.db.patch(already._id, summary);
        sessionId = already._id;
        refreshed += 1;
      } else {
        const nearby = await ctx.db
          .query("sportPlusSessions")
          .withIndex("by_user_and_startedAt", (q) =>
            q.eq("userId", user._id).gte("startedAt", startedAt - 5 * 60 * 1000).lte("startedAt", startedAt + 5 * 60 * 1000))
          .collect();
        const appRow = findAppStartedMatch(nearby, record);
        if (appRow) {
          // The same real session Sombrey started from the app: keep the
          // app's start time (when the user pressed start), take the band's
          // summary.
          const { endedAt: _bandEnd, ...rest } = summary;
          await ctx.db.patch(appRow._id, { ...rest, endedAt: appRow.endedAt ?? summary.endedAt });
          sessionId = appRow._id;
          merged += 1;
        } else {
          sessionId = await ctx.db.insert("sportPlusSessions", {
            userId: user._id,
            deviceId: args.deviceId,
            startedAt,
            source: "sombrey_band",
            ...summary,
          });
          inserted += 1;
        }
      }

      const hasSeries = (record.heartRates?.length ?? 0) > 0 || (record.speedsMetersPerSecond?.length ?? 0) > 0 || (record.route?.length ?? 0) > 0;
      if (hasSeries) {
        const detail = await ctx.db
          .query("sportPlusSessionDetails")
          .withIndex("by_session", (q) => q.eq("sportPlusSessionId", sessionId))
          .first();
        const series = {
          heartRates: record.heartRates && record.heartRates.length > 0 ? record.heartRates : undefined,
          speedsMetersPerSecond: record.speedsMetersPerSecond && record.speedsMetersPerSecond.length > 0 ? record.speedsMetersPerSecond : undefined,
          seriesSource: "band_record",
        };
        if (detail) {
          await ctx.db.patch(detail._id, {
            ...series,
            // A phone GPS route recorded during an app-started session is
            // kept; a band route only fills an empty slot.
            ...(detail.route === undefined && record.route && record.route.length > 0
              ? { route: record.route, routeSource: "band_record" }
              : {}),
          });
        } else {
          await ctx.db.insert("sportPlusSessionDetails", {
            sportPlusSessionId: sessionId,
            userId: user._id,
            ...series,
            ...(record.route && record.route.length > 0 ? { route: record.route, routeSource: "band_record" } : {}),
          });
        }
      }
    }
    return { inserted, merged, refreshed, skipped };
  },
});
