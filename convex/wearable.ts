import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
