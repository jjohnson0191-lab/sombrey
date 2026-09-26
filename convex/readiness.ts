import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isValidTimeZone, localDayKey } from "./strain/time";
import { computeReadinessScore, deriveSleepSignal, median, overnightRestingHR, scoreBand, confidenceBand, sleepMidpointAfterNoon, type DailyAggregate, type RecentLoadInput } from "./readiness/scoring";
import { loadProgressData } from "./progressData";
import { loadIntelligence, upsertDailyLoadSnapshots, upsertSessionLoadSnapshots } from "./intelligenceData";

// Sombrey Readiness Score — see `readiness/scoring.ts` for the algorithm
// itself and its documented scientific basis/limitations. This file only
// gathers real data from the already-existing wearable/Sport+ tables and
// persists the result; no scoring math lives here. `algorithmVersion` is
// stored on every row specifically so historical scores stay correctly
// interpretable if the algorithm changes later (see `readinessScores` in
// schema.ts).
//
// Day boundaries: the user's local calendar day in their IANA time zone
// (Sombrey owns the time zone — convex/strain/time.ts). The app sends its
// zone with each computation and `date` in that zone; older clients that
// send neither fall back to UTC days, as V1 did. Scoring is unchanged.

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

export const computeAndStore = mutation({
  args: { date: v.string(), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const zone = args.timeZone && isValidTimeZone(args.timeZone) ? args.timeZone : "UTC";
    if (zone !== "UTC" && user.timeZone !== zone) await ctx.db.patch(user._id, { timeZone: zone, timeZoneUpdatedAt: Date.now() });
    const dayOf = (timestampMs: number): string => localDayKey(timestampMs, zone);
    const now = Date.now();
    const windowStart = now - 35 * 24 * 60 * 60 * 1000;

    // Per-metric index ranges (never a scan of the user's whole history).
    const metric = (metricType: "heart_rate" | "resting_heart_rate" | "spo2" | "skin_temperature", limit: number) =>
      ctx.db.query("wearableMeasurements")
        .withIndex("by_user_metric_and_recordedAt", (q) => q.eq("userId", user._id).eq("metricType", metricType).gte("recordedAt", windowStart))
        .take(limit);
    const [restingRows, spo2Rows, tempRows, sleepSessions] = await Promise.all([
      metric("resting_heart_rate", 1000),
      metric("spo2", 3000),
      metric("skin_temperature", 3000),
      ctx.db.query("wearableSleepSessions")
        .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", windowStart))
        .take(300),
    ]);

    const days = new Map<string, DailyAggregate>();
    const dayFor = (date: string): DailyAggregate => {
      let d = days.get(date);
      if (!d) { d = { date }; days.set(date, d); }
      return d;
    };

    // Sleep — assigned to the wake-up day; naps summed; timing from the
    // longest session of the day.
    const mainSleep = new Map<string, { start: number; end: number }>();
    const windowsByDay = new Map<string, { start: number; end: number }[]>();
    for (const s of sleepSessions) {
      const date = dayOf(s.endedAt);
      const agg = dayFor(date);
      agg.sleepMinutes = (agg.sleepMinutes ?? 0) + s.totalSleepMinutes;
      windowsByDay.set(date, [...(windowsByDay.get(date) ?? []), { start: s.startedAt, end: s.endedAt }]);
      const main = mainSleep.get(date);
      if (!main || s.endedAt - s.startedAt > main.end - main.start) mainSleep.set(date, { start: s.startedAt, end: s.endedAt });
    }
    for (const [date, w] of mainSleep) dayFor(date).sleepMidpoint = sleepMidpointAfterNoon(w.start, w.end, zone);

    // Overnight resting HR: the band's own resting readings for the day, else
    // the sustained low of the heart-rate readings inside that night's sleep.
    const bandRestingByDay = new Map<string, number[]>();
    for (const r of restingRows) if (r.value > 0) bandRestingByDay.set(dayOf(r.recordedAt), [...(bandRestingByDay.get(dayOf(r.recordedAt)) ?? []), r.value]);
    const hrDays = new Set([...bandRestingByDay.keys(), ...windowsByDay.keys()]);
    for (const date of hrDays) {
      const windows = windowsByDay.get(date) ?? [];
      const inWindow: number[] = [];
      if (!bandRestingByDay.has(date)) {
        for (const w of windows) {
          const rows = await ctx.db.query("wearableMeasurements")
            .withIndex("by_user_metric_and_recordedAt", (q) => q.eq("userId", user._id).eq("metricType", "heart_rate").gte("recordedAt", w.start).lte("recordedAt", w.end))
            .take(1500);
          for (const r of rows) if (r.value > 0) inWindow.push(r.value);
        }
      }
      const rhr = overnightRestingHR(bandRestingByDay.get(date) ?? [], inWindow);
      if (rhr.value !== undefined) dayFor(date).restingHeartRate = rhr.value;
    }

    // SpO2 / skin temperature — daily medians. A persisted 0 is a
    // zero-filled "no reading" gap, never a measurement.
    const medianOf = (values: number[]) => median(values);
    const byDay = (rows: { value: number; recordedAt: number }[]) => {
      const m = new Map<string, number[]>();
      for (const r of rows) if (r.value > 0) m.set(dayOf(r.recordedAt), [...(m.get(dayOf(r.recordedAt)) ?? []), r.value]);
      return m;
    };
    for (const [date, values] of byDay(spo2Rows)) { const m = medianOf(values); if (m !== undefined) dayFor(date).spo2 = m; }
    for (const [date, values] of byDay(tempRows)) { const m = medianOf(values); if (m !== undefined) dayFor(date).skinTemperature = m; }

    // Recent load: the one intelligence pipeline (convex/strain/*) — the same
    // Daily Load Strain is made from, in the same local days.
    const data = await loadProgressData(ctx, user._id, now);
    const intelligence = await loadIntelligence(ctx, user._id, data, zone, now);
    const pastDays = intelligence.loadDays.filter((d) => d.date < args.date);
    const recentLoad: RecentLoadInput = { reference: intelligence.baseline.reference, days: pastDays, rolling: intelligence.rolling };

    const today = dayFor(args.date);
    const history = [...days.values()].filter((d) => d.date !== args.date).sort((a, b) => a.date.localeCompare(b.date));
    const result = computeReadinessScore(history, today, recentLoad);

    // One row per (user, date): recomputing replaces it (idempotent).
    const row = {
      userId: user._id,
      date: args.date,
      algorithmVersion: result.version,
      score: result.score ?? undefined,
      confidence: result.confidence,
      confidenceLevel: result.confidenceLevel,
      state: result.state,
      timeZone: zone,
      components: result.components.map((c) => ({
        metric: c.metric,
        subScore: c.subScore,
        weight: c.weight,
        nominalWeight: c.nominalWeight,
        confidence: c.confidence,
        description: c.description,
        personal: c.personal,
        detail: c.detail ? JSON.stringify(c.detail) : undefined,
      })),
      missingInputs: result.missingInputs,
      calculatedAt: now,
    };
    const existing = await ctx.db.query("readinessScores")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", args.date)).collect();
    let id;
    if (existing.length) {
      id = existing[0]._id;
      await ctx.db.replace(id, row);
      for (const extra of existing.slice(1)) await ctx.db.delete(extra._id);
    } else {
      id = await ctx.db.insert("readinessScores", row);
    }

    // The daily load record for longitudinal validation: every past day in
    // the window, recomputed (so a late import corrects its day), versioned.
    await upsertDailyLoadSnapshots(ctx, user._id, intelligence, now);
    await upsertSessionLoadSnapshots(ctx, user._id, intelligence, now);

    const sleepComponent = result.components.find((c) => c.metric === "sleep");
    const sleepSignal = deriveSleepSignal(sleepComponent);
    return { id, score: result.score, confidence: result.confidence, sleepSignal };
  },
});

// `scoreBand`/`confidenceBand` are pure presentation labels already
// defined and tested in `readiness/scoring.ts` — computed here on read,
// never stored, so a future threshold tweak there applies retroactively
// to old rows too. This does not change the score/confidence themselves
// or how they're computed; it only surfaces an already-existing piece of
// the algorithm's own output that no query exposed to the client before.
function withBands<T extends { score?: number; confidence: number }>(row: T) {
  return {
    ...row,
    scoreBand: row.score !== undefined ? scoreBand(row.score) : null,
    confidenceBand: confidenceBand(row.confidence),
  };
}

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const row = await ctx.db
      .query("readinessScores")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    return row ? withBands(row) : null;
  },
});

export const getHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const rows = await ctx.db
      .query("readinessScores")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 14);
    return rows.map(withBands);
  },
});
