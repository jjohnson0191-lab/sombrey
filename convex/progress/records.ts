// Personal records — what the data genuinely shows as the user's best. Pure.
// Built from the exercise and activity taxonomy: each exercise the user has
// logged, and each activity's own family metrics. Never a leaderboard.

import { termsFor } from "../activityFamilies.ts";
import type { ActivityCategory } from "../activityTaxonomy.ts";
import { type ProgressSession, type ProgressSet, type Provenance, DAY_MS } from "./model.ts";

export type PersonalRecord = {
  id: string;
  subject: string;       // exercise or activity name
  metric: string;        // "Heaviest set", "Longest session", …
  value: number;
  display: string;       // "110 kg × 5"
  date: number;
  source: Provenance;
  previous?: { display: string; date: number };
  isNew: boolean;        // set in the last NEW_WINDOW_DAYS
};

export const NEW_WINDOW_DAYS = 14;

type Candidate = { value: number; display: string; date: number; source: Provenance };

/** The best candidate, and the best one before it (a record needs history:
 * a single occurrence is a first, not a record). */
function record(id: string, subject: string, metric: string, candidates: Candidate[], higherIsBetter: boolean, nowMs: number): PersonalRecord | undefined {
  if (candidates.length < 2) return undefined;
  const better = (a: Candidate, b: Candidate) => (higherIsBetter ? a.value > b.value : a.value < b.value);
  const sorted = [...candidates].sort((a, b) => a.date - b.date);
  let best = sorted[0];
  let previous: Candidate | undefined;
  for (const c of sorted.slice(1)) {
    if (better(c, best)) {
      previous = best;
      best = c;
    }
  }
  return {
    id, subject, metric, value: best.value, display: best.display, date: best.date, source: best.source,
    previous: previous ? { display: previous.display, date: previous.date } : undefined,
    isNew: previous !== undefined && nowMs - best.date <= NEW_WINDOW_DAYS * DAY_MS,
  };
}

const fmt = (n: number, digits = 0) => (digits === 0 ? `${Math.round(n)}` : n.toFixed(digits));

export function personalRecords(sessions: ProgressSession[], sets: ProgressSet[], nowMs: number, displayName: (key: string) => string): PersonalRecord[] {
  const out: PersonalRecord[] = [];

  // Exercises: heaviest set (weighted), most reps in a set (bodyweight).
  const byExercise = new Map<string, ProgressSet[]>();
  for (const s of sets) byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
  for (const [exerciseId, rows] of byExercise) {
    const name = rows[rows.length - 1].exerciseName;
    const weighted = rows.filter((r) => (r.weightKg ?? 0) > 0);
    // One candidate per workout: its heaviest set (ties → more reps).
    const perWorkout = new Map<string, ProgressSet>();
    for (const r of weighted) {
      const cur = perWorkout.get(r.workoutId);
      if (!cur || r.weightKg! > cur.weightKg! || (r.weightKg === cur.weightKg && r.reps > cur.reps)) perWorkout.set(r.workoutId, r);
    }
    const heavy = record(`ex:${exerciseId}:heaviest`, name, "Heaviest set",
      [...perWorkout.values()].map((r) => ({ value: r.weightKg! + r.reps / 1000, display: `${fmt(r.weightKg!, r.weightKg! % 1 ? 1 : 0)} kg × ${r.reps}`, date: r.completedAt, source: "manual" as Provenance })),
      true, nowMs);
    if (heavy) out.push({ ...heavy, value: Math.floor(heavy.value * 10) / 10 });
    const bodyweight = rows.filter((r) => !((r.weightKg ?? 0) > 0));
    if (bodyweight.length > 0 && weighted.length === 0) {
      const perW = new Map<string, ProgressSet>();
      for (const r of bodyweight) { const c = perW.get(r.workoutId); if (!c || r.reps > c.reps) perW.set(r.workoutId, r); }
      const reps = record(`ex:${exerciseId}:reps`, name, "Most reps in a set",
        [...perW.values()].map((r) => ({ value: r.reps, display: `${r.reps} reps`, date: r.completedAt, source: "manual" as Provenance })), true, nowMs);
      if (reps) out.push(reps);
    }
  }

  // Activities: longest session, and — where the family measures them —
  // longest distance and fastest average pace/speed.
  const byActivity = new Map<string, ProgressSession[]>();
  for (const s of sessions) if (s.kind === "activity" && s.activityKey) byActivity.set(s.activityKey, [...(byActivity.get(s.activityKey) ?? []), s]);
  for (const [key, list] of byActivity) {
    const name = displayName(key);
    const terms = termsFor(key, (list[0].activityCategory ?? "other") as ActivityCategory);
    const metrics = new Set([...terms.primary, ...terms.secondary]);
    const longest = record(`act:${key}:duration`, name, `Longest ${terms.sessionNoun}`,
      list.filter((s) => (s.durationSeconds ?? 0) > 0).map((s) => ({ value: s.durationSeconds!, display: `${Math.round(s.durationSeconds! / 60)} min`, date: s.startedAt, source: s.durationSource ?? "band_record" })), true, nowMs);
    if (longest) out.push(longest);
    if (metrics.has("distance")) {
      const far = record(`act:${key}:distance`, name, "Longest distance",
        list.filter((s) => (s.distanceMeters ?? 0) > 0).map((s) => ({ value: s.distanceMeters!, display: `${(s.distanceMeters! / 1000).toFixed(2)} km`, date: s.startedAt, source: s.movementSource ?? "band_record" })), true, nowMs);
      if (far) out.push(far);
    }
    if (metrics.has("pace") || metrics.has("speed")) {
      const fast = record(`act:${key}:speed`, name, metrics.has("pace") ? "Fastest average pace" : "Fastest average speed",
        list.filter((s) => (s.averageSpeed ?? 0) > 0.3).map((s) => {
          const perKm = 1000 / s.averageSpeed! / 60;
          const display = metrics.has("pace") ? `${Math.floor(perKm)}:${String(Math.round((perKm % 1) * 60)).padStart(2, "0")} /km` : `${(s.averageSpeed! * 3.6).toFixed(1)} km/h`;
          return { value: s.averageSpeed!, display, date: s.startedAt, source: s.movementSource ?? "band_record" };
        }), true, nowMs);
      if (fast) out.push(fast);
    }
  }
  return out.sort((a, b) => b.date - a.date);
}
