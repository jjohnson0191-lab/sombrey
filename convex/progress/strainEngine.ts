// Daily Strain — what Progress shows for today. Pure.
//
// Two layers, never mixed:
//   - `dailyLoad` below: the day's MEASURED facts (sessions, minutes) —
//     always shown;
//   - the Sombrey intelligence pipeline (convex/strain/pipeline.ts): session
//     loads → normalized Daily Load → baseline → Strain STATE. Its proposed
//     0–100 value stays internal until the formula is approved
//     (strain/strainScore.ts STRAIN_FORMULA_APPROVED) — only then does
//     `score` carry a number. There is no other strain calculation.

import { type ProgressSession, type Zone, dayKey, dayKeyDaysAgo, median, minutes } from "./model.ts";
import type { IntelligenceDays } from "../strain/pipeline.ts";
import { BASELINE_REQUIREMENTS } from "../strain/baseline.ts";
import { STRAIN_FORMULA_APPROVED, STRAIN_FORMULA_VERSION, relativeLabel, strainBand } from "../strain/strainScore.ts";
import { SIGNALS } from "../strain/signals.ts";

/** What the band and Sombrey provide today, for the strain audit (from the
 * signal registry, strain/signals.ts). */
export const STRAIN_SIGNALS = {
  available: SIGNALS.filter((s) => s.reliability === "reliable" || s.reliability === "intermittent").map((s) => `${s.id}: ${s.notes}`),
  missing: SIGNALS.filter((s) => s.reliability === "unavailable" || s.reliability === "unverified").map((s) => `${s.id}: ${s.notes}`),
  currentFormula: "Sombrey Strain v1 (strain-1.0): Daily Load — cardiovascular 45 / resistance 30 / activity 25 as exchange rates — against your own typical training day, 100 × (1 − 2^(−load/reference)). Computed and versioned; shown once the band passes physical validation.",
  proposedInputs: [
    "Time in heart-rate-reserve zones (resting and maximum heart rate), weighted by zone — TRIMP family",
    "Activity energy cost (MET minutes) only for sessions without usable heart rate",
    "Resistance sets relative to your own best lifts (set-equivalents)",
    "Your own typical training day as the reference",
  ],
  limitations: [
    "Band clock basis, duration unit and heart-rate series spacing are being verified on a physical band",
    "Optical wrist heart rate is noisy during intense or grip-heavy movement",
    "Maximum heart rate is estimated (Tanaka) unless measured",
    "Calories, weather and readiness are never strain inputs",
  ],
};

export type StrainScore =
  | { state: "no_formula" }
  | { state: "scored"; value: number; scaleMax: number };

/** The pipeline's view of today, for display — states and progress, never
 * the unapproved value. */
export type StrainIntelligence = {
  state: "NOT_ENOUGH_DATA" | "BUILDING_BASELINE" | "LOW_CONFIDENCE" | "READY";
  confidence: string;
  baseline: {
    status: string;
    historyDays: number;
    activeDays: number;
    qualitySessions: number;
    required: { historyDays: number; activeDays: number; qualitySessions: number };
  };
  sessions: { id: string; basis: "cardio" | "activity" | "none"; resistance: boolean; confidence: string; trimmed: boolean }[];
  duplicatesRemoved: number;
  /** Recent load, ending yesterday (unknown days excluded, never zero). */
  recent: {
    yesterdayStatus?: string;
    yesterdayRelative?: number;
    knownDays7: number;
    activeDays7: number;
    highLoadDays7: number;
    unknownDays7: number;
    relative7?: number;
    consecutiveHighLoadDays: number;
    trend?: string;
  };
  strainVersion: string;
  validated: boolean;
  /** Today's Strain value when displayable (band/label are presentation). */
  value?: number;
  band?: string;
  relative?: number;
  relativeLabel?: string;
  /** The last 28 days + today, oldest → newest (unknown days carry no value). */
  series: { date: string; status: string; load: number; relative?: number; strain?: number; state: string }[];
  windows: { id: "d3" | "d7" | "d14" | "d28"; days: number; knownDays: number; unknownDays: number; activeDays: number; highLoadDays: number; total: number; relativeToBaseline?: number; averageStrain?: number }[];
  reference?: number;
  monotony7?: number;
};

/** A day's measured load — facts, not a score. */
export type DailyLoad = {
  date: string;
  sessionCount: number;
  activeMinutes: number;
  workoutMinutes: number;
  activityMinutes: number;
  /** Minutes whose duration came from the band's own record. */
  bandRecordedMinutes: number;
};

export function dailyLoad(date: string, sessions: ProgressSession[]): DailyLoad {
  let workoutMinutes = 0, activityMinutes = 0, bandRecordedMinutes = 0;
  for (const s of sessions) {
    const m = minutes(s);
    if (s.kind === "workout") workoutMinutes += m; else activityMinutes += m;
    if (s.heartRateSource === "band_record" || s.caloriesSource === "band_record") bandRecordedMinutes += m;
  }
  return {
    date,
    sessionCount: sessions.length,
    activeMinutes: Math.round(workoutMinutes + activityMinutes),
    workoutMinutes: Math.round(workoutMinutes),
    activityMinutes: Math.round(activityMinutes),
    bandRecordedMinutes: Math.round(bandRecordedMinutes),
  };
}

export const MIN_BASELINE_DAYS = 14;

export type StrainDay = {
  date: string;
  load: DailyLoad;
  score: StrainScore;
  engine: { id: string; version: string; validated: boolean };
  intelligence?: StrainIntelligence;
  /** Usual daily active minutes over the previous 28 days (median), once
   * there are MIN_BASELINE_DAYS days of history. */
  usualActiveMinutes?: number;
  baselineDays: number;
  /** Sentences derived from the data above only. */
  context: string[];
  week: DailyLoad[];
};

const round2 = (x: number) => Math.round(x * 100) / 100;

function describeIntelligence(i: IntelligenceDays): StrainIntelligence {
  const r = BASELINE_REQUIREMENTS;
  const ref = i.baseline.reference;
  const series = i.days.slice(-29).map((d, k, arr) => {
    const idx = i.days.length - arr.length + k;
    const status = i.loadDays[idx].status;
    const st = i.strainByDay[idx];
    return {
      date: d.date, status, load: d.load,
      relative: ref && status !== "no_data" ? round2(d.load / ref) : undefined,
      strain: status === "no_data" ? undefined : st.value,
      state: st.state,
    };
  });
  return {
    state: i.strain.state,
    confidence: i.today.confidence,
    baseline: {
      status: i.baseline.status,
      historyDays: i.baseline.historyDays,
      activeDays: i.baseline.activeDays,
      qualitySessions: i.baseline.qualitySessions,
      required: { historyDays: r.minHistoryDays, activeDays: r.minActiveDays, qualitySessions: r.minQualitySessions },
    },
    sessions: i.todaySessions.map((l) => ({ id: l.id, basis: l.aerobicBasis, resistance: (l.resistance?.completedSets ?? 0) > 0, confidence: l.confidence, trimmed: l.trimmed })),
    duplicatesRemoved: i.droppedAsDuplicate.length,
    recent: {
      yesterdayStatus: i.rolling.yesterday?.status,
      yesterdayRelative: i.rolling.yesterday?.relative,
      knownDays7: i.rolling.windows.d7.knownDays,
      activeDays7: i.rolling.windows.d7.activeDays,
      highLoadDays7: i.rolling.windows.d7.highLoadDays,
      unknownDays7: i.rolling.windows.d7.unknownDays,
      relative7: i.rolling.windows.d7.relativeToBaseline,
      consecutiveHighLoadDays: i.rolling.consecutiveHighLoadDays,
      trend: i.rolling.trend,
    },
    strainVersion: i.strain.version,
    validated: i.strain.approved,
    value: i.strain.value,
    band: i.strain.value !== undefined ? strainBand(i.strain.value) : undefined,
    relative: ref ? round2(i.today.load / ref) : undefined,
    relativeLabel: ref && i.today.sessions > 0 ? relativeLabel(i.today.load / ref) : undefined,
    series,
    windows: (["d3", "d7", "d14", "d28"] as const).map((id) => {
      const w = i.rolling.windows[id];
      const n = w.days;
      const known = series.slice(-(n + 1), -1).filter((d) => d.strain !== undefined).map((d) => d.strain!);
      return { id, days: n, knownDays: w.knownDays, unknownDays: w.unknownDays, activeDays: w.activeDays, highLoadDays: w.highLoadDays, total: w.total, relativeToBaseline: w.relativeToBaseline, averageStrain: known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : undefined };
    }),
    reference: ref,
    monotony7: i.rolling.monotony7,
  };
}

/** Today's measured load, the pipeline's Strain state, and data-derived context. */
export function strainDay(sessions: ProgressSession[], nowMs: number, zone: Zone, intelligence?: IntelligenceDays): StrainDay {
  const byDay = new Map<string, ProgressSession[]>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt, zone);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const today = dayKey(nowMs, zone);
  const load = dailyLoad(today, byDay.get(today) ?? []);
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = dayKeyDaysAgo(nowMs, 6 - i, zone);
    return dailyLoad(key, byDay.get(key) ?? []);
  });

  // Usual day: the 28 days before today, counted only from the first day
  // Sombrey has any session (days before that aren't "rest", they're unknown).
  const first = sessions.length ? Math.min(...sessions.map((s) => s.startedAt)) : undefined;
  const firstKey = first !== undefined ? dayKey(first, zone) : undefined;
  const history: number[] = [];
  for (let i = 1; i <= 28; i++) {
    const key = dayKeyDaysAgo(nowMs, i, zone);
    if (firstKey === undefined || key < firstKey) break;
    history.push(dailyLoad(key, byDay.get(key) ?? []).activeMinutes);
  }
  const usual = history.length >= MIN_BASELINE_DAYS ? median(history) : undefined;

  const context: string[] = [];
  if (load.sessionCount > 0) {
    context.push(`${load.sessionCount} session${load.sessionCount === 1 ? "" : "s"} today · ${load.activeMinutes} active min`);
  }
  const otherWeekDays = week.slice(0, 6).filter((d) => d.activeMinutes > 0);
  if (load.activeMinutes > 0 && otherWeekDays.length >= 2 && otherWeekDays.every((d) => d.activeMinutes < load.activeMinutes)) {
    context.push("Your highest-load day this week.");
  }
  if (usual !== undefined && load.activeMinutes > 0) {
    if (usual === 0) context.push("Active on a day you'd usually rest.");
    else if (load.activeMinutes >= usual * 1.25) context.push("Above your usual daily load.");
    else if (load.activeMinutes <= usual * 0.75) context.push("Below your usual daily load.");
    else context.push("About your usual daily load.");
  }
  if (usual === undefined && load.sessionCount > 0) context.push("Not enough data to establish your baseline.");

  const approvedValue = intelligence?.strain.value;
  return {
    date: today,
    load,
    score: approvedValue !== undefined ? { state: "scored", value: approvedValue, scaleMax: 100 } : { state: "no_formula" },
    engine: { id: "sombrey-intelligence", version: STRAIN_FORMULA_VERSION, validated: STRAIN_FORMULA_APPROVED },
    intelligence: intelligence ? describeIntelligence(intelligence) : undefined,
    usualActiveMinutes: usual,
    baselineDays: history.length,
    context,
    week,
  };
}
