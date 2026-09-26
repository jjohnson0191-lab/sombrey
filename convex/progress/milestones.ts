// Milestones — quiet markers of real accumulated history. Pure.
// Each definition is a threshold over the user's own data; a milestone
// exists only once the data crosses it, dated to the session that did.

import { type ProgressSession, DAY_MS, startOfLocalWeek, dayKey, type Zone } from "./model.ts";

export type Milestone = { id: string; title: string; detail: string; achievedAt: number };

type Counter = { id: string; unit: string; thresholds: number[]; title: (n: number) => string; value: (s: ProgressSession) => number; filter?: (s: ProgressSession) => boolean };

const COUNTERS: Counter[] = [
  { id: "workouts", unit: "workouts", thresholds: [1, 10, 25, 50, 100, 250, 500], title: (n) => (n === 1 ? "First workout" : `${n} workouts`), value: () => 1, filter: (s) => s.kind === "workout" },
  { id: "activities", unit: "activities", thresholds: [1, 10, 25, 50, 100, 250], title: (n) => (n === 1 ? "First activity" : `${n} activities`), value: () => 1, filter: (s) => s.kind === "activity" },
  { id: "hours", unit: "hours", thresholds: [10, 25, 50, 100, 250, 500], title: (n) => `${n} hours of activity`, value: (s) => (s.durationSeconds ?? 0) / 3600 },
  { id: "distance", unit: "km", thresholds: [50, 100, 250, 500, 1000, 2500], title: (n) => `${n} km recorded`, value: (s) => (s.distanceMeters ?? 0) / 1000 },
];

export function milestones(sessions: ProgressSession[], tz: Zone): Milestone[] {
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const out: Milestone[] = [];
  for (const c of COUNTERS) {
    let total = 0;
    let next = 0;
    for (const s of ordered) {
      if (c.filter && !c.filter(s)) continue;
      total += c.value(s);
      while (next < c.thresholds.length && total >= c.thresholds[next]) {
        out.push({ id: `${c.id}:${c.thresholds[next]}`, title: c.title(c.thresholds[next]), detail: `Reached ${dayKey(s.startedAt, tz)}`, achievedAt: s.startedAt });
        next++;
      }
    }
  }
  // First month of consistent training: four consecutive weeks, each with
  // at least two training days.
  const workoutDaysByWeek = new Map<number, Set<string>>();
  for (const s of ordered.filter((x) => x.kind === "workout")) {
    const w = startOfLocalWeek(s.startedAt, tz);
    workoutDaysByWeek.set(w, new Set([...(workoutDaysByWeek.get(w) ?? []), dayKey(s.startedAt, tz)]));
  }
  const weeks = [...workoutDaysByWeek.keys()].sort((a, b) => a - b);
  let run = 0, prev: number | undefined;
  for (const w of weeks) {
    const ok = (workoutDaysByWeek.get(w)?.size ?? 0) >= 2;
    run = ok && prev !== undefined && Math.round((w - prev) / (7 * DAY_MS)) === 1 ? run + 1 : ok ? 1 : 0;
    prev = w;
    if (run === 4) {
      const last = ordered.filter((s) => s.kind === "workout" && startOfLocalWeek(s.startedAt, tz) === w).pop()!;
      out.push({ id: "consistent-month", title: "First month of consistent training", detail: "Four weeks in a row with two or more training days", achievedAt: last.startedAt });
      break;
    }
  }
  return out.sort((a, b) => b.achievedAt - a.achievedAt);
}
