// The one Sombrey intelligence pipeline. Pure and deterministic.
//
//   stored sessions + band readings
//     → overlap resolution (sessionLoad.resolveOverlaps)
//     → SessionLoad per session (cardiovascular | activity fallback, + resistance)
//     → DailyLoad per local day (the user's IANA time zone)
//     → personal baseline → Strain state (proposed value internal only)
//
// Everything is recomputed from the stored records, so the result is
// idempotent: importing a late band record, or re-importing the same one,
// changes the day it belongs to and never adds a second copy. Progress,
// Home and the AI Coach all read this — there is no other strain path.

import { type Zone, localDayKey, localDayKeyDaysAgo } from "./time.ts";
import { resolveOverlaps, sessionLoad, type SessionInput, type SessionLoad } from "./sessionLoad.ts";
import { dailyLoad, type DailyLoadResult } from "./dailyLoad.ts";
import { strainBaseline, BASELINE_REQUIREMENTS, type Baseline } from "./baseline.ts";
import { strainFor, type Strain } from "./strainScore.ts";
import { epley } from "./resistanceLoad.ts";
import type { HeartRateProfile } from "./zones.ts";
import { dayStatus, rollingLoad, type LoadDay, type RollingLoad } from "./rollingLoad.ts";

export type HistoricSet = { exerciseId: string; reps: number; weightKg?: number; completedAt: number };

/** Best e1RM per exercise from sets completed before `beforeMs`. */
export function referencesBefore(history: HistoricSet[], beforeMs: number): Map<string, number> {
  const best = new Map<string, number>();
  for (const s of history) {
    if (s.completedAt >= beforeMs || !s.weightKg || s.weightKg <= 0 || s.reps <= 0) continue;
    const e = epley(s.weightKg, s.reps);
    if (e !== undefined && e > (best.get(s.exerciseId) ?? 0)) best.set(s.exerciseId, e);
  }
  return best;
}

export type IntelligenceInput = {
  sessions: SessionInput[];
  profile: HeartRateProfile;
  setHistory: HistoricSet[];
  zone: Zone;
  nowMs: number;
  /** Days of load to compute, ending today (baseline needs 28 + today). */
  days?: number;
  /** The user's first recorded session ever (days before it are unknown, not rest). */
  firstSessionMs?: number;
  /** Local days on which the band was worn/synced (any reading or sleep) —
   * lets a day without sessions count as a measured rest day rather than
   * unknown. Absent → days without sessions are unknown. */
  wearableDays?: Set<string>;
};

export type IntelligenceDays = {
  today: DailyLoadResult;
  todaySessions: SessionLoad[];
  /** Every counted session in the span with its local day (de-duplicated). */
  sessionLoads: (SessionLoad & { date: string })[];
  /** Oldest → newest, ending today. */
  days: DailyLoadResult[];
  baseline: Baseline;
  strain: Strain;
  /** Yesterday's Strain against the baseline as it stood before yesterday. */
  yesterdayStrain?: Strain;
  /** Strain for every day, each against the baseline as it stood before
   * that day (so a day's value doesn't drift as the baseline moves). */
  strainByDay: Strain[];
  /** Every day in the span with its status (oldest → today). */
  loadDays: LoadDay[];
  rolling: RollingLoad;
  droppedAsDuplicate: string[];
};

export function computeIntelligence(input: IntelligenceInput): IntelligenceDays {
  // 28 days of history + yesterday's own baseline window + today.
  const span = input.days ?? BASELINE_REQUIREMENTS.windowDays + 2;
  const { kept, dropped } = resolveOverlaps(input.sessions);
  const loads = kept.map((s) => sessionLoad(s, input.profile, referencesBefore(input.setHistory, s.startMs)));
  const byDay = new Map<string, SessionLoad[]>();
  for (const l of loads) {
    const k = localDayKey(l.startMs, input.zone); // a session belongs to the day it started
    byDay.set(k, [...(byDay.get(k) ?? []), l]);
  }
  const days = Array.from({ length: span }, (_, i) => {
    const key = localDayKeyDaysAgo(input.nowMs, span - 1 - i, input.zone);
    return dailyLoad(key, byDay.get(key) ?? []);
  });
  const today = days[days.length - 1];

  const first = input.firstSessionMs ?? (input.sessions.length ? Math.min(...input.sessions.map((s) => s.startMs)) : undefined);
  const firstKey = first !== undefined ? localDayKey(first, input.zone) : undefined;
  // The baseline as it stood at day index i (from the days before it).
  const baselineAt = (i: number): Baseline => {
    const previous = days.slice(Math.max(0, i - BASELINE_REQUIREMENTS.windowDays), i).filter((d) => firstKey !== undefined && d.date >= firstKey);
    const quality = previous.flatMap((d) => (byDay.get(d.date) ?? []).map((l) => l.confidence));
    return strainBaseline(previous, quality, previous.length);
  };
  const baseline = baselineAt(days.length - 1);

  const yesterday = days.length >= 2 ? days[days.length - 2] : undefined;

  const loadDays: LoadDay[] = days.map((d, i) => ({
    date: d.date,
    load: d.load,
    confidence: d.confidence,
    status: firstKey !== undefined && d.date < firstKey && d.sessions === 0 && !input.wearableDays?.has(d.date)
      ? "no_data"
      : dayStatus(d, input.wearableDays?.has(d.date) ?? false, i === days.length - 1),
  }));

  // A day with no data is unknown — never "Strain 0".
  const strainByDay = days.map((d, i): Strain => loadDays[i].status === "no_data"
    ? { state: "NOT_ENOUGH_DATA", confidence: "INSUFFICIENT_DATA", approved: false, version: strainFor(d, baseline).version }
    : strainFor(d, i === days.length - 1 ? baseline : baselineAt(i)));

  return {
    today,
    todaySessions: byDay.get(today.date) ?? [],
    sessionLoads: loads.map((l) => ({ ...l, date: localDayKey(l.startMs, input.zone) })),
    days,
    baseline,
    strain: strainFor(today, baseline),
    yesterdayStrain: yesterday ? strainByDay[days.length - 2] : undefined,
    strainByDay,
    loadDays,
    rolling: rollingLoad(loadDays, baseline.reference),
    droppedAsDuplicate: dropped,
  };
}
