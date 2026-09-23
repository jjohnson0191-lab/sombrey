import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Sombrey Band (QCBandSDK) persistence — added for the native iOS Phase 3
// wearable integration. Every value written here comes from a real
// QCBandSDK callback on the client (see apps/ios/Sombrey/Wearable/); this
// file never fabricates or estimates a reading.

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

const metricTypeValidator = v.union(
  v.literal("heart_rate"),
  v.literal("resting_heart_rate"),
  v.literal("steps"),
  v.literal("active_calories"),
  v.literal("distance_meters"),
  v.literal("spo2"),
  v.literal("skin_temperature"),
  v.literal("blood_pressure_systolic"),
  v.literal("blood_pressure_diastolic"),
  v.literal("battery_pct"),
);

// ─── Device identity/status ─────────────────────────────────────────────
export const upsertDevice = mutation({
  args: {
    deviceId: v.string(),
    model: v.optional(v.string()),
    nickname: v.optional(v.string()),
    firmwareVersion: v.optional(v.string()),
    connected: v.optional(v.boolean()),
    synced: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("wearableDevices")
      .withIndex("by_user_and_device", (q) => q.eq("userId", user._id).eq("deviceId", args.deviceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        model: args.model ?? existing.model,
        nickname: args.nickname ?? existing.nickname,
        firmwareVersion: args.firmwareVersion ?? existing.firmwareVersion,
        lastConnectedAt: args.connected ? now : existing.lastConnectedAt,
        lastSyncedAt: args.synced ? now : existing.lastSyncedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("wearableDevices", {
      userId: user._id,
      deviceId: args.deviceId,
      model: args.model,
      nickname: args.nickname,
      firmwareVersion: args.firmwareVersion,
      lastConnectedAt: args.connected ? now : undefined,
      lastSyncedAt: args.synced ? now : undefined,
    });
  },
});

export const getWearableStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const devices = await ctx.db
      .query("wearableDevices")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    // Most-recently-connected device — a user pairs one band at a time in
    // V1, but nothing here prevents keeping history for a prior one.
    return devices.sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))[0] ?? null;
  },
});

// ─── Measurements ────────────────────────────────────────────────────────
export const recordMeasurements = mutation({
  args: {
    deviceId: v.string(),
    measurements: v.array(v.object({
      metricType: metricTypeValidator,
      value: v.number(),
      unit: v.string(),
      recordedAt: v.number(),
      rawValue: v.optional(v.number()),
      rawUnit: v.optional(v.string()),
      sdkSource: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    if (args.measurements.length === 0) return { inserted: 0, skipped: 0 };
    const user = await requireAuth(ctx);

    const minTime = Math.min(...args.measurements.map((m) => m.recordedAt));
    const maxTime = Math.max(...args.measurements.map((m) => m.recordedAt));
    const existingInRange = await ctx.db
      .query("wearableMeasurements")
      .withIndex("by_device_and_recordedAt", (q) =>
        q.eq("deviceId", args.deviceId).gte("recordedAt", minTime).lte("recordedAt", maxTime))
      .collect();
    const existingKeys = new Set(existingInRange.map((m) => `${m.metricType}:${m.recordedAt}`));

    let inserted = 0;
    let skipped = 0;
    for (const m of args.measurements) {
      const key = `${m.metricType}:${m.recordedAt}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      await ctx.db.insert("wearableMeasurements", {
        userId: user._id,
        deviceId: args.deviceId,
        metricType: m.metricType,
        value: m.value,
        unit: m.unit,
        recordedAt: m.recordedAt,
        source: "sombrey_band",
        rawValue: m.rawValue,
        rawUnit: m.rawUnit,
        sdkSource: m.sdkSource,
      });
      inserted += 1;
    }
    return { inserted, skipped };
  },
});

export const getRecentMeasurements = query({
  args: {
    metricTypes: v.optional(v.array(metricTypeValidator)),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const results = await ctx.db
      .query("wearableMeasurements")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 200);
    const since = args.sinceMs;
    const types = args.metricTypes ? new Set(args.metricTypes) : null;
    return results.filter((m) =>
      (since === undefined || m.recordedAt >= since) &&
      (types === null || types.has(m.metricType)));
  },
});

// One generic range query for a single metric type, used by every Vitals
// graph (1D/7D/30D) and by Home's resting-HR-today derivation. Unlike
// `getRecentMeasurements` above (which takes its `limit` across ALL metric
// types before filtering — fine for "latest snapshot," wrong for "every
// heart-rate reading in the last 30 days," since a busy day of other
// metrics could crowd out older heart-rate rows before the filter ever
// runs), this scopes directly to one metric type via
// `by_user_metric_and_recordedAt`, so a range is always complete for the
// metric actually asked for. Ascending order — chronological, ready for a
// line chart's x-axis.
// Metric-specific validity — a physically impossible sentinel (most
// commonly a zero-filled "no reading for this slot" gap in a scheduled-
// history payload) must never reach a graph, even if it was persisted
// before the native client started rejecting these at the source
// (`QCBandSDKService.emit`). Zero IS a legitimate reading for
// steps/distance/battery, so this is deliberately per-metric, not a
// blanket "zero is invalid" rule.
//
// `active_calories` is the one addition to this set that isn't simply
// "physically impossible at 0": the device's cumulative-since-midnight
// calorie counter has no documented way to distinguish "genuinely zero
// effort today" from "no real reading yet," so per explicit product
// decision Sombrey never surfaces a bare `0` for it — matching
// `WearableMetricType.isPhysicallyPlausible` on the native client, which
// already rejects `0` for this metric at the source. Kept here too as a
// second, independent gate for any row written before that client-side
// rule existed.
const metricsWhereZeroIsInvalid = new Set([
  "heart_rate",
  "resting_heart_rate",
  "spo2",
  "skin_temperature",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "active_calories",
]);

function isValidMeasurement(metricType: string, value: number): boolean {
  return metricsWhereZeroIsInvalid.has(metricType) ? value > 0 : value >= 0;
}

export const getMeasurementsByRange = query({
  args: {
    metricType: metricTypeValidator,
    sinceMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const rows = await ctx.db
      .query("wearableMeasurements")
      .withIndex("by_user_metric_and_recordedAt", (q) =>
        q.eq("userId", user._id).eq("metricType", args.metricType).gte("recordedAt", args.sinceMs))
      .order("asc")
      .take(args.limit ?? 5000);
    return rows.filter((r) => isValidMeasurement(r.metricType, r.value));
  },
});

// One-time correction for active_calories rows written before the native
// client converted the band's calorie counter from its raw unit. Every
// such row came from QCSportModel.calories (sync) or the currentStepInfo
// live callback — the only two writers — both of which the vendor SDK
// reports in small calories (cal), yet they were stored verbatim with
// unit "kcal" (a 30,040 cal reading showed as 30,040 kcal). See
// `BandCalorieUnits` in apps/ios/Sombrey/Wearable/Models/WearableModels.swift
// for the vendor evidence. This is a unit relabel, not an estimate: the
// band's original number is kept in `rawValue`, and a row that already
// carries `rawUnit` is never touched, so re-running is a no-op.
export const correctLegacyActiveCaloriesUnit = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("wearableMeasurements")
      .filter((q) => q.eq(q.field("metricType"), "active_calories"))
      .collect();
    const legacy = rows.filter((r) => r.rawUnit === undefined);
    if (!args.dryRun) {
      for (const r of legacy) {
        await ctx.db.patch(r._id, {
          value: r.value / 1000,
          unit: "kcal",
          rawValue: r.value,
          rawUnit: "cal",
        });
      }
    }
    return {
      dryRun: args.dryRun,
      activeCalorieRows: rows.length,
      corrected: legacy.length,
      largestRawValue: legacy.reduce((max, r) => Math.max(max, r.value), 0),
    };
  },
});

// ─── Sleep sessions ──────────────────────────────────────────────────────
export const recordSleepSessions = mutation({
  args: {
    deviceId: v.string(),
    sessions: v.array(v.object({
      startedAt: v.number(),
      endedAt: v.number(),
      totalSleepMinutes: v.number(),
      stages: v.optional(v.array(v.object({
        stage: v.union(v.literal("light"), v.literal("deep"), v.literal("rem"), v.literal("awake")),
        startedAt: v.number(),
        durationMinutes: v.number(),
      }))),
    })),
  },
  handler: async (ctx, args) => {
    if (args.sessions.length === 0) return { inserted: 0, skipped: 0 };
    const user = await requireAuth(ctx);

    const existing = await ctx.db
      .query("wearableSleepSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id))
      .collect();
    const existingStarts = new Set(existing.map((s) => s.startedAt));

    let inserted = 0;
    let skipped = 0;
    for (const s of args.sessions) {
      if (existingStarts.has(s.startedAt)) {
        skipped += 1;
        continue;
      }
      existingStarts.add(s.startedAt);
      await ctx.db.insert("wearableSleepSessions", {
        userId: user._id,
        deviceId: args.deviceId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        totalSleepMinutes: s.totalSleepMinutes,
        stages: s.stages,
      });
      inserted += 1;
    }
    return { inserted, skipped };
  },
});

export const getRecentSleepSessions = query({
  args: { sinceMs: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const results = await ctx.db
      .query("wearableSleepSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 30);
    const since = args.sinceMs;
    return since === undefined ? results : results.filter((s) => s.startedAt >= since);
  },
});
