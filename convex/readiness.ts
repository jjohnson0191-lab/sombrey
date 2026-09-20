import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ALGORITHM_VERSION, computeReadinessScore, deriveSleepSignal, type DailyAggregate } from "./readiness/scoring";

// Sombrey Readiness Score — see `readiness/scoring.ts` for the algorithm
// itself and its documented scientific basis/limitations. This file only
// gathers real data from the already-existing wearable/Sport+ tables and
// persists the result; no scoring math lives here. `algorithmVersion` is
// stored on every row specifically so historical scores stay correctly
// interpretable if the algorithm changes later (see `readinessScores` in
// schema.ts).
//
// Day boundaries here are computed from each timestamp's UTC calendar
// date (`toISOString().slice(0, 10)`) — a deliberate V1 simplification,
// not per-user-timezone-aware. Documented, not hidden: see the Phase 3
// readiness report.

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

function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export const computeAndStore = mutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const now = Date.now();
    const windowStart = now - 30 * 24 * 60 * 60 * 1000;

    const [measurements, sleepSessions, sportSessions] = await Promise.all([
      ctx.db
        .query("wearableMeasurements")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .filter((q) => q.gte(q.field("recordedAt"), windowStart))
        .collect(),
      ctx.db
        .query("wearableSleepSessions")
        .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", windowStart))
        .collect(),
      ctx.db
        .query("sportPlusSessions")
        .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", windowStart))
        .collect(),
    ]);

    const days = new Map<string, DailyAggregate>();
    const dayFor = (dateStr: string): DailyAggregate => {
      let d = days.get(dateStr);
      if (!d) {
        d = { date: dateStr, trainingMinutes: 0 };
        days.set(dateStr, d);
      }
      return d;
    };

    // Sleep — assigned to the wake-up day (a session's endedAt), summed
    // if multiple sessions/naps land on the same day. The session's own
    // [startedAt, endedAt] window is kept to scope the resting-HR proxy
    // below to actual sleep time when we have it.
    const sleepWindowByDay = new Map<string, { start: number; end: number }>();
    for (const session of sleepSessions) {
      const dateStr = utcDay(session.endedAt);
      const agg = dayFor(dateStr);
      agg.sleepMinutes = (agg.sleepMinutes ?? 0) + session.totalSleepMinutes;
      const existingWindow = sleepWindowByDay.get(dateStr);
      sleepWindowByDay.set(dateStr, {
        start: Math.min(existingWindow?.start ?? session.startedAt, session.startedAt),
        end: Math.max(existingWindow?.end ?? session.endedAt, session.endedAt),
      });
    }

    // Heart rate / SpO2 / temperature, bucketed by day with timestamps
    // kept so resting-HR can be scoped to the sleep window when known.
    const hrReadingsByDay = new Map<string, { value: number; recordedAt: number }[]>();
    const spo2ByDay = new Map<string, number[]>();
    const tempByDay = new Map<string, number[]>();
    for (const m of measurements) {
      const dateStr = utcDay(m.recordedAt);
      if (m.metricType === "heart_rate") {
        const list = hrReadingsByDay.get(dateStr) ?? [];
        list.push({ value: m.value, recordedAt: m.recordedAt });
        hrReadingsByDay.set(dateStr, list);
      } else if (m.metricType === "spo2") {
        const list = spo2ByDay.get(dateStr) ?? [];
        list.push(m.value);
        spo2ByDay.set(dateStr, list);
      } else if (m.metricType === "skin_temperature") {
        const list = tempByDay.get(dateStr) ?? [];
        list.push(m.value);
        tempByDay.set(dateStr, list);
      }
    }

    for (const [dateStr, readings] of hrReadingsByDay) {
      const window = sleepWindowByDay.get(dateStr);
      const scoped = window ? readings.filter((r) => r.recordedAt >= window.start && r.recordedAt <= window.end) : readings;
      const pool = scoped.length > 0 ? scoped : readings;
      if (pool.length === 0) continue;
      dayFor(dateStr).restingHeartRate = Math.min(...pool.map((r) => r.value));
    }
    const medianOf = (values: number[]): number | undefined => {
      if (values.length === 0) return undefined;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };
    for (const [dateStr, values] of spo2ByDay) {
      const m = medianOf(values);
      if (m !== undefined) dayFor(dateStr).spo2 = m;
    }
    for (const [dateStr, values] of tempByDay) {
      const m = medianOf(values);
      if (m !== undefined) dayFor(dateStr).skinTemperature = m;
    }

    // Training load — total Sport+ session minutes per day (see
    // scoring.ts's header for why this is duration-only in V1).
    for (const session of sportSessions) {
      const dateStr = utcDay(session.startedAt);
      const agg = dayFor(dateStr);
      const minutes = (session.durationSeconds ?? 0) / 60;
      agg.trainingMinutes += minutes;
    }

    const today = dayFor(args.date);
    const history = [...days.values()]
      .filter((d) => d.date !== args.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const result = computeReadinessScore(history, today);

    const id = await ctx.db.insert("readinessScores", {
      userId: user._id,
      date: args.date,
      algorithmVersion: ALGORITHM_VERSION,
      score: result.score ?? undefined,
      confidence: result.confidence,
      components: result.components.map((c) => ({
        metric: c.metric,
        subScore: c.subScore,
        weight: c.weight,
        confidence: c.confidence,
        description: c.description,
      })),
      missingInputs: result.missingInputs,
      calculatedAt: Date.now(),
    });

    // Derived from the sleep component's OWN existing baseline/confidence
    // logic via `deriveSleepSignal` — never a separate hardcoded
    // threshold, and never fed back into the score itself. Purely for
    // the client to decide whether a good/poor-sleep notification is
    // warranted (see NotificationManager.swift).
    const sleepComponent = result.components.find((c) => c.metric === "sleep");
    const sleepSignal = deriveSleepSignal(sleepComponent);

    return { id, score: result.score, confidence: result.confidence, sleepSignal };
  },
});

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("readinessScores")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
  },
});

export const getHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("readinessScores")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 14);
  },
});
