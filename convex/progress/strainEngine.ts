// Daily Strain — the isolated engine boundary. Pure.
//
// Progress is built around Daily Strain, but Sombrey has NO validated strain
// formula yet. This module keeps that decision in one place:
//   - `StrainEngine` is the interface any future formula implements;
//   - `CURRENT_STRAIN_ENGINE` is the engine in use — today one that
//     declares "no validated formula" and never returns a number;
//   - `dailyLoad` describes the day's MEASURED load (sessions and their
//     recorded minutes), which the hero shows instead of a score.
// Swapping in a real formula later = a new engine here; the UI reads
// `StrainDay` and needs no rewrite.

import { type ProgressSession, dayKey, median, minutes } from "./model.ts";

/** What the band and Sombrey provide today, for the strain audit. */
export const STRAIN_SIGNALS = {
  available: [
    "Session duration — workouts (band-reconciled when the band recorded them) and activities",
    "Session type — Sombrey workout / plan workout / manual log, and activity key + category (Sport+ taxonomy)",
    "Session heart rate — average, lowest, peak from the band's own record (when imported)",
    "Session calories — band record (kcal) or band live figure",
    "Band heart-rate readings through the day (live stream while connected; scheduled readings otherwise)",
    "Resting heart rate reading (band)",
    "Readiness v1 (sleep, resting HR, Sport+ minutes, SpO2, temperature)",
    "Sets × reps × weight for structured workouts",
  ],
  missing: [
    "Continuous all-day heart rate at a known, verified sample rate",
    "Validated per-session heart-rate series with sample rate on the physical band (SDK exposes it; unverified)",
    "HRV (ring-only per the vendor SDK)",
    "A verified maximum heart rate (only the 220−age estimate, and only with a date of birth)",
    "Session RPE (perceived exertion) — not collected",
  ],
  currentFormula: "None. No strain score is calculated.",
  proposedInputs: [
    "Time in heart-rate zones relative to the user's own resting and maximum heart rate (TRIMP-family)",
    "Session duration and type (activity family), for sessions without usable heart rate",
    "Resistance-training volume as a separate load component",
    "The user's own rolling baseline (acute vs chronic load) for context, not as the score itself",
  ],
  limitations: [
    "Band clock/time zone and duration unit not yet verified on a physical band",
    "Optical wrist heart rate is noisy during intense or grip-heavy movement",
    "Maximum heart rate is estimated, not measured",
    "Readiness v1 training load is duration-only",
  ],
};

export type StrainScore =
  | { state: "no_formula" }
  | { state: "insufficient_data"; reason: string }
  | { state: "scored"; value: number; scaleMax: number };

export type StrainDayInputs = {
  date: string;
  sessions: ProgressSession[];
  restingHeartRate?: number;
  estimatedMaxHeartRate?: number;
  readinessScore?: number;
};

export interface StrainEngine {
  id: string;
  version: string;
  validated: boolean;
  score(inputs: StrainDayInputs): StrainScore;
}

/** The engine in use: no validated formula exists, so none is applied. */
export const CURRENT_STRAIN_ENGINE: StrainEngine = {
  id: "none",
  version: "0",
  validated: false,
  score: () => ({ state: "no_formula" }),
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
  /** Usual daily active minutes over the previous 28 days (median), once
   * there are MIN_BASELINE_DAYS days of history. */
  usualActiveMinutes?: number;
  baselineDays: number;
  /** Sentences derived from the data above only. */
  context: string[];
  week: DailyLoad[];
};

/** Today's load, its engine score (none today) and data-derived context. */
export function strainDay(
  sessions: ProgressSession[],
  nowMs: number,
  tzOffsetMinutes: number,
  engine: StrainEngine = CURRENT_STRAIN_ENGINE,
): StrainDay {
  const byDay = new Map<string, ProgressSession[]>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt, tzOffsetMinutes);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const today = dayKey(nowMs, tzOffsetMinutes);
  const load = dailyLoad(today, byDay.get(today) ?? []);
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = dayKey(nowMs - (6 - i) * 86_400_000, tzOffsetMinutes);
    return dailyLoad(key, byDay.get(key) ?? []);
  });

  // Baseline: the 28 days before today, counted only from the first day
  // Sombrey has any session (days before that aren't "rest", they're unknown).
  const first = sessions.length ? Math.min(...sessions.map((s) => s.startedAt)) : undefined;
  const firstKey = first !== undefined ? dayKey(first, tzOffsetMinutes) : undefined;
  const history: number[] = [];
  for (let i = 1; i <= 28; i++) {
    const key = dayKey(nowMs - i * 86_400_000, tzOffsetMinutes);
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
  if (usual === undefined) context.push("Not enough data to establish your baseline.");

  return {
    date: today,
    load,
    score: engine.score({ date: today, sessions: byDay.get(today) ?? [] }),
    engine: { id: engine.id, version: engine.version, validated: engine.validated },
    usualActiveMinutes: usual,
    baselineDays: history.length,
    context,
    week,
  };
}
