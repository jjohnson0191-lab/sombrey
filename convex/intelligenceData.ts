// Gathers what the intelligence pipeline (convex/strain/pipeline.ts) needs
// from the stores that already exist, and runs it. Read-only; the result
// is recomputed on every read, so it is idempotent by construction.
//
// Read budget: heart-rate readings are read only inside session windows
// of the last BASELINE window (29 local days), at most PER_SESSION_READS
// per session and TOTAL_READS overall. A session beyond the budget is
// scored from its band summary (lower confidence) — never from invented
// samples. Budget hits are reported, not hidden.

import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { activityName, loadProgressData, type ProgressData } from "./progressData";
import { resolveZone } from "./userTimeZone";
import { loadRecovery, type RecoveryOutcomes } from "./progress/loadRecovery";
import { consistency } from "./progress/consistency";
import { bodySummary } from "./progress/body";
import { personalRecords } from "./progress/records";
import { milestones } from "./progress/milestones";
import { youVsYou } from "./progress/youVsYou";
import { buildIntelligenceContext, renderIntelligenceContext } from "./strain/context";
import { environmentState } from "./strain/environment";
import { computeIntelligence, type IntelligenceDays } from "./strain/pipeline";
import { heartRateProfile, type HeartRateProfile } from "./strain/zones";
import type { SessionInput } from "./strain/sessionLoad";
import type { HRSample } from "./strain/cardiovascularLoad";
import { type Zone, localDayKey, localDayKeyDaysAgo, wallClockToInstant } from "./strain/time";
import { BASELINE_REQUIREMENTS } from "./strain/baseline";
import { STRAIN_FORMULA_VERSION } from "./strain/strainScore";
import { sessionRpeLoad } from "./strain/effort";

const PER_SESSION_READS = 1500;
const TOTAL_READS = 6000;
const DAY_MS = 86_400_000;

export type Intelligence = IntelligenceDays & {
  profile: HeartRateProfile;
  zone: Zone;
  readBudgetHit: boolean;
};

function startOfDayKey(key: string, zone: Zone): number {
  const [y, m, d] = key.split("-").map(Number);
  return wallClockToInstant(y, m, d, 0, 0, 0, zone);
}

export async function loadIntelligence(ctx: QueryCtx, userId: Id<"users">, data: ProgressData, zone: Zone, nowMs: number): Promise<Intelligence> {
  const span = BASELINE_REQUIREMENTS.windowDays + 2;
  const windowStart = startOfDayKey(localDayKeyDaysAgo(nowMs, span - 1, zone), zone);

  // Resting heart rate: the band's own resting readings, last 28 days.
  const resting = await ctx.db.query("wearableMeasurements")
    .withIndex("by_user_metric_and_recordedAt", (q) => q.eq("userId", userId).eq("metricType", "resting_heart_rate").gte("recordedAt", nowMs - 28 * DAY_MS))
    .take(400);
  const peaks = data.sessions
    .filter((s) => s.startedAt >= nowMs - 180 * DAY_MS && s.highestHeartRate !== undefined)
    .map((s) => s.highestHeartRate!);
  const profile = heartRateProfile({ restingReadings: resting.map((r) => r.value), age: data.age, observedPeaks: peaks });

  let reads = 0;
  let readBudgetHit = false;
  const inputs: SessionInput[] = [];
  for (const s of data.sessions) {
    if (s.startedAt < windowStart - DAY_MS) continue;
    const seconds = s.durationSeconds ?? 0;
    if (!(seconds > 0)) continue; // no measured duration → nothing to load
    const startMs = s.startedAt, endMs = s.startedAt + seconds * 1000;

    // Band readings in the window (live stream while connected, scheduled readings otherwise).
    let samples: HRSample[] = [];
    if (reads < TOTAL_READS) {
      const rows = await ctx.db.query("wearableMeasurements")
        .withIndex("by_user_metric_and_recordedAt", (q) => q.eq("userId", userId).eq("metricType", "heart_rate").gte("recordedAt", startMs).lte("recordedAt", endMs))
        .take(Math.min(PER_SESSION_READS, TOTAL_READS - reads));
      reads += rows.length;
      if (rows.length === PER_SESSION_READS || reads >= TOTAL_READS) readBudgetHit = true;
      samples = rows.filter((r) => r.value > 0).map((r) => ({ t: r.recordedAt, bpm: r.value }));
    } else {
      readBudgetHit = true;
    }

    // The band's own per-session series, when its record carries one. Its
    // sample spacing is the record's declared rate — not yet verified on a
    // physical band (docs/SOMBREY_BAND_VALIDATION.md, item E).
    let seriesTimingVerified = true;
    if (s.bandSessionId) {
      const band = await ctx.db.get(s.bandSessionId as Id<"sportPlusSessions">);
      if (band && band.sampleRateSeconds && band.sampleRateSeconds > 0) {
        const detail = await ctx.db.query("sportPlusSessionDetails")
          .withIndex("by_session", (q) => q.eq("sportPlusSessionId", band._id)).first();
        const rates = detail?.heartRates ?? [];
        const bandStart = band.bandStartedAt ?? band.startedAt;
        if (rates.length > samples.length) {
          samples = rates
            .map((bpm, i) => ({ t: bandStart + i * band.sampleRateSeconds! * 1000, bpm }))
            .filter((x) => x.bpm > 0 && x.t >= startMs && x.t <= endMs);
          seriesTimingVerified = false;
        }
      }
    }

    inputs.push({
      id: s.id,
      kind: s.kind,
      origin: s.origin,
      category: s.activityCategory,
      activityKey: s.activityKey,
      startMs,
      endMs,
      averageHR: s.averageHeartRate,
      calories: s.calories,
      samples,
      seriesTimingVerified,
      sets: s.kind === "workout" ? data.sets.filter((x) => x.workoutId === s.id).map((x) => ({ exerciseId: x.exerciseId, reps: x.reps, weightKg: x.weightKg })) : [],
      timestampSuspect: s.timestampSuspect,
      durationSource: s.durationSource,
      rpe: s.rpe,
    });
  }

  const wearableDays = await loadWearableDays(ctx, userId, zone, windowStart);
  const result = computeIntelligence({
    sessions: inputs,
    profile,
    setHistory: data.sets.map((x) => ({ exerciseId: x.exerciseId, reps: x.reps, weightKg: x.weightKg, completedAt: x.completedAt })),
    zone,
    nowMs,
    days: span,
    firstSessionMs: data.sessions.length ? Math.min(...data.sessions.map((s) => s.startedAt)) : undefined,
    wearableDays,
  });
  return { ...result, profile, zone, readBudgetHit };
}

/** Local days on which the band was demonstrably worn or synced: a daily
 * step summary, a resting-HR reading, or a sleep session ending that day.
 * (Heart-rate rows are not scanned — too many; these cheaper signals are
 * enough to tell a rest day from a day with no data.) */
export async function loadWearableDays(ctx: QueryCtx, userId: Id<"users">, zone: Zone, sinceMs: number): Promise<Set<string>> {
  const days = new Set<string>();
  for (const metricType of ["steps", "resting_heart_rate"] as const) {
    const rows = await ctx.db.query("wearableMeasurements")
      .withIndex("by_user_metric_and_recordedAt", (q) => q.eq("userId", userId).eq("metricType", metricType).gte("recordedAt", sinceMs))
      .take(3000);
    for (const r of rows) if (r.value > 0) days.add(localDayKey(r.recordedAt, zone));
  }
  const sleeps = await ctx.db.query("wearableSleepSessions")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", sinceMs - DAY_MS))
    .take(200);
  for (const s of sleeps) days.add(localDayKey(s.endedAt, zone));
  return days;
}

/** Next-morning outcomes by local day, for load ↔ recovery patterns:
 * resting HR (band resting reading, lowest of the day) and sleep minutes
 * (sessions ending that day). 91 days. */
export async function loadRecoveryOutcomes(ctx: QueryCtx, userId: Id<"users">, zone: Zone, nowMs: number): Promise<RecoveryOutcomes> {
  const since = nowMs - 91 * DAY_MS;
  const resting = await ctx.db.query("wearableMeasurements")
    .withIndex("by_user_metric_and_recordedAt", (q) => q.eq("userId", userId).eq("metricType", "resting_heart_rate").gte("recordedAt", since))
    .take(1000);
  const restingHR = new Map<string, number>();
  for (const r of resting) {
    if (!(r.value >= 30 && r.value <= 110)) continue;
    const k = localDayKey(r.recordedAt, zone);
    restingHR.set(k, Math.min(restingHR.get(k) ?? Infinity, r.value));
  }
  const sleeps = await ctx.db.query("wearableSleepSessions")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", since - DAY_MS))
    .take(500);
  const sleepMinutes = new Map<string, number>();
  for (const s of sleeps) {
    const k = localDayKey(s.endedAt, zone);
    sleepMinutes.set(k, (sleepMinutes.get(k) ?? 0) + s.totalSleepMinutes);
  }
  return { restingHR, sleepMinutes };
}

/** The AI Coach's intelligence context lines (strain/context.ts). */
export async function coachIntelligenceLines(ctx: QueryCtx, user: Doc<"users">, nowMs: number): Promise<string[]> {
  const zone = resolveZone(user);
  const data = await loadProgressData(ctx, user._id, nowMs);
  const intelligence = await loadIntelligence(ctx, user._id, data, zone, nowMs);
  const outcomes = await loadRecoveryOutcomes(ctx, user._id, zone, nowMs);
  const lr = loadRecovery(data.sessions, data.readiness, nowMs, zone, 7, outcomes);
  const week = consistency(data.sessions, nowMs, zone, data.plannedPerWeek);
  const body = bodySummary(data.weights, "first", nowMs);
  const envRow = await ctx.db.query("environmentSnapshots")
    .withIndex("by_user_and_kind", (q) => q.eq("userId", user._id).eq("kind", "current")).first();
  const environment = environmentState(envRow ? {
    observedAt: envRow.observedAt, fetchedAt: envRow.fetchedAt, timeZone: envRow.timeZone, locality: envRow.locality,
    temperatureC: envRow.temperatureC, feelsLikeC: envRow.feelsLikeC, humidityPct: envRow.humidityPct, windMs: envRow.windMs,
    uvIndex: envRow.uvIndex, precipitationMm: envRow.precipitationMm, condition: envRow.condition, source: "met_norway",
  } : null, nowMs, false, typeof zone === "string" ? zone : undefined);
  const records = personalRecords(data.sessions, data.sets, nowMs, activityName).slice(0, 6)
    .map((r) => `${r.subject} — ${r.metric} ${r.display} (${localDayKey(r.date, zone)}, ${r.source})`);
  const insights = youVsYou(data.sessions, data.readiness, data.weights, nowMs, activityName).map((i) => `${i.text} [${i.basis}]`);
  const latestReadiness = await ctx.db.query("readinessScores")
    .withIndex("by_user_and_date", (q) => q.eq("userId", user._id)).order("desc").first();
  const readinessToday = latestReadiness && latestReadiness.date === intelligence.today.date ? {
    date: latestReadiness.date,
    score: latestReadiness.score,
    state: latestReadiness.state,
    confidenceLevel: latestReadiness.confidenceLevel,
    version: latestReadiness.algorithmVersion,
    domains: latestReadiness.components.map((c) => ({ metric: c.metric, subScore: c.subScore, weight: c.weight, confidence: c.confidence, description: c.description })),
  } : undefined;
  const context = buildIntelligenceContext({
    timeZone: typeof zone === "string" ? zone : `UTC${zone >= 0 ? "+" : ""}${zone / 60}`,
    intelligence: intelligence,
    profile: intelligence.profile,
    sessionNames: new Map(data.sessions.map((s) => [s.id, s.name])),
    readiness: data.readiness,
    relationships: lr.relationships,
    week: week.thisWeek,
    usualTrainingDays: week.usualTrainingDays,
    environment,
    body: { weightKg: body.latest?.weightKg, source: body.latest?.source, changeKg: body.changeKg },
    records,
    insights,
    readinessToday,
  });
  const lines = renderIntelligenceContext(context);
  for (const m of milestones(data.sessions, zone).slice(0, 3)) lines.push(`- Milestone: ${m.title} (${localDayKey(m.achievedAt, zone)})`);
  return lines;
}

/** Rewrites the per-day load record for every past day in the window
 * (idempotent: one row per user and day; unchanged rows are not written). */
export async function upsertDailyLoadSnapshots(ctx: MutationCtx, userId: Id<"users">, intelligence: Intelligence, nowMs: number): Promise<number> {
  const zone = typeof intelligence.zone === "string" ? intelligence.zone : `UTC${intelligence.zone >= 0 ? "+" : ""}${intelligence.zone / 60}`;
  const first = intelligence.days[0]?.date;
  if (!first) return 0;
  const existing = await ctx.db.query("dailyLoadSnapshots")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", first)).take(100);
  const byDate = new Map(existing.map((r) => [r.date, r]));
  let written = 0;
  for (let i = 0; i < intelligence.days.length - 1; i++) { // today is still in progress
    const d = intelligence.days[i];
    const status = intelligence.loadDays[i]?.status ?? "no_data";
    const strain = intelligence.strainByDay[i];
    const row = {
      userId, date: d.date, timeZone: zone, strainVersion: STRAIN_FORMULA_VERSION, status,
      sessions: d.sessions, activeMinutes: d.activeMinutes, load: d.load,
      cardio: d.components.cardio, resistance: d.components.resistance, activity: d.components.activity,
      confidence: d.confidence,
      strainState: strain?.state, strainValue: strain?.proposedValue,
      baselineReference: strain?.reference,
      computedAt: nowMs,
    };
    const prev = byDate.get(d.date);
    if (prev) {
      const { _id, _creationTime, computedAt: _c, ...old } = prev;
      const { computedAt: _n, ...next } = row;
      if (JSON.stringify(Object.entries(old).sort()) === JSON.stringify(Object.entries(next).filter(([, v]) => v !== undefined).sort())) continue;
      await ctx.db.replace(prev._id, row);
    } else {
      await ctx.db.insert("dailyLoadSnapshots", row);
    }
    written++;
  }
  return written;
}

/** One row per counted session: measured load beside the user's RPE, for
 * future calibration (convex/strain/effort.ts). Idempotent per session. */
export async function upsertSessionLoadSnapshots(ctx: MutationCtx, userId: Id<"users">, intelligence: Intelligence, nowMs: number): Promise<number> {
  const first = intelligence.days[0]?.date;
  if (!first) return 0;
  const existing = await ctx.db.query("sessionLoadSnapshots")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", first)).take(500);
  const byId = new Map(existing.map((r) => [r.sessionId, r]));
  const r1 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 10) / 10);
  let written = 0;
  for (const l of intelligence.sessionLoads) {
    const row = {
      userId, sessionId: l.id, sessionKind: l.kind, origin: l.origin, date: l.date, category: l.category,
      minutes: Math.round(l.minutes), strainVersion: STRAIN_FORMULA_VERSION, aerobicBasis: l.aerobicBasis,
      cardioLoad: l.aerobicBasis === "cardio" ? r1(l.cardio?.load) : undefined,
      minutesByZone: l.aerobicBasis === "cardio" ? l.cardio?.minutesByZone.map((m) => Math.round(m * 10) / 10) : undefined,
      hrCoverage: l.cardio ? Math.round(l.cardio.coverage * 100) / 100 : undefined,
      activityMetMinutes: l.aerobicBasis === "activity" ? r1(l.activity?.load) : undefined,
      resistanceSetEquivalents: r1(l.resistance?.load),
      volumeLoadKg: l.resistance?.volumeLoadKg,
      confidence: l.confidence,
      rpe: l.rpe,
      sessionRpeLoad: sessionRpeLoad(l.rpe, l.minutes),
      computedAt: nowMs,
    };
    const prev = byId.get(l.id);
    if (prev) {
      const { _id, _creationTime, computedAt: _c, ...old } = prev;
      const { computedAt: _n, ...next } = row;
      const clean = (o: object) => JSON.stringify(Object.entries(o).filter(([, v]) => v !== undefined).sort());
      if (clean(old) === clean(next)) continue;
      await ctx.db.replace(prev._id, row);
    } else {
      await ctx.db.insert("sessionLoadSnapshots", row);
    }
    written++;
  }
  return written;
}
