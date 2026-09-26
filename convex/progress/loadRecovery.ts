// Load ↔ Recovery — each day's measured load beside what followed. Pure.
//
// A relationship is described only under strain/relationships.ts rules
// (Spearman, n ≥ 28 paired days, p < 0.05, |ρ| ≥ 0.4), in "tended to"
// language — a pattern in the user's history, never a cause. Load here is
// measured active time (a fact), not the unapproved strain formula.

import { dailyLoad } from "./strainEngine.ts";
import { type ProgressSession, type ReadinessDay, type Zone, dayKey, dayKeyDaysAgo } from "./model.ts";
import { describeRelationship, RELATIONSHIP_RULES, type Outcome, type Relationship } from "../strain/relationships.ts";

export type LoadRecoveryDay = { date: string; activeMinutes: number; sessions: number; readiness?: number; nextMorningReadiness?: number };

export type LoadRecovery = {
  days: LoadRecoveryDay[];
  pairedDays: number;
  /** The readiness relationship, when one holds (what Progress shows). */
  relationship?: { correlation: number; statement: string };
  /** Every outcome that holds (for the AI Coach). */
  relationships: Relationship[];
};

export const MIN_PAIRED_DAYS = RELATIONSHIP_RULES.minPairs;

/** Per local day: the next-morning resting HR and the sleep ending that
 * morning — keyed by the day they were measured (the morning after). */
export type RecoveryOutcomes = { restingHR?: Map<string, number>; sleepMinutes?: Map<string, number> };

/** Readiness dates are the day they describe (the morning after the night). */
export function loadRecovery(sessions: ProgressSession[], readiness: ReadinessDay[], nowMs: number, tz: Zone, days = 7, outcomes: RecoveryOutcomes = {}): LoadRecovery {
  const scoreByDate = new Map(readiness.filter((r) => r.score !== undefined).map((r) => [r.date, r.score!]));
  const byDay = new Map<string, ProgressSession[]>();
  for (const s of sessions) { const k = dayKey(s.startedAt, tz); byDay.set(k, [...(byDay.get(k) ?? []), s]); }
  const keyAt = (i: number) => dayKeyDaysAgo(nowMs, i, tz);
  const row = (i: number): LoadRecoveryDay => {
    const date = keyAt(i);
    const load = dailyLoad(date, byDay.get(date) ?? []);
    return { date, activeMinutes: load.activeMinutes, sessions: load.sessionCount, readiness: scoreByDate.get(date), nextMorningReadiness: i > 0 ? scoreByDate.get(keyAt(i - 1)) : undefined };
  };
  const shown = Array.from({ length: days }, (_, i) => row(days - 1 - i));

  // Pairs over up to 90 days: load on D, the outcome measured on D+1.
  const pairs: Record<Outcome, { load: number; outcome: number }[]> = {
    next_morning_readiness: [], next_morning_resting_hr: [], next_night_sleep_minutes: [],
  };
  for (let i = 1; i <= 90; i++) {
    const load = dailyLoad(keyAt(i), byDay.get(keyAt(i)) ?? []).activeMinutes;
    const next = keyAt(i - 1);
    const r = scoreByDate.get(next), hr = outcomes.restingHR?.get(next), sl = outcomes.sleepMinutes?.get(next);
    if (r !== undefined) pairs.next_morning_readiness.push({ load, outcome: r });
    if (hr !== undefined) pairs.next_morning_resting_hr.push({ load, outcome: hr });
    if (sl !== undefined) pairs.next_night_sleep_minutes.push({ load, outcome: sl });
  }
  const relationships = (Object.keys(pairs) as Outcome[])
    .map((o) => describeRelationship(o, pairs[o]))
    .filter((r): r is Relationship => r !== null);
  const readinessRel = relationships.find((r) => r.outcome === "next_morning_readiness");
  return {
    days: shown,
    pairedDays: pairs.next_morning_readiness.length,
    relationship: readinessRel ? { correlation: readinessRel.rho, statement: readinessRel.statement } : undefined,
    relationships,
  };
}
