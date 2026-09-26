// Performance — one metric over time, for workouts (all, or one exercise)
// or for one activity. Pure. Which metrics an activity offers comes from the
// Activity Intelligence Framework's terms for that activity; a metric is
// offered only if at least one session recorded it.

import { termsFor } from "../activityFamilies.ts";
import type { ActivityCategory } from "../activityTaxonomy.ts";
import { comparePeriods, type Comparison } from "./baseline.ts";
import { type ProgressSession, type ProgressSet, type Provenance, DAY_MS, dayKey, mean, minutes } from "./model.ts";

export const RANGES = [
  { id: "7d", days: 7 },
  { id: "30d", days: 30 },
  { id: "90d", days: 90 },
  { id: "1y", days: 365 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

export type MetricDef = { key: string; label: string; unit: string; higherIsBetter: boolean; estimated?: boolean };

export type SeriesPoint = { t: number; value: number; source: Provenance; label?: string };

export type PerformanceResult = {
  subjects: { id: string; label: string; count: number }[];
  subject?: string;
  metrics: MetricDef[];
  metric?: MetricDef;
  ranges: RangeId[];
  range?: RangeId;
  points: SeriesPoint[];
  stats?: { current: number; low: number; average: number; high: number; count: number };
  /** Against the previous equal period, when both have enough points. */
  comparison?: Comparison;
  /** The average of everything before this range, as a personal baseline. */
  baseline?: number;
};

// ── Metric definitions ────────────────────────────────────────────────────

const WORKOUT_METRICS: Record<string, MetricDef> = {
  duration: { key: "duration", label: "Duration", unit: "min", higherIsBetter: true },
  sets: { key: "sets", label: "Sets", unit: "sets", higherIsBetter: true },
  volume: { key: "volume", label: "Volume", unit: "kg", higherIsBetter: true },
  calories: { key: "calories", label: "Calories", unit: "kcal", higherIsBetter: true },
  heart_rate: { key: "heart_rate", label: "Avg heart rate", unit: "bpm", higherIsBetter: false },
  top_weight: { key: "top_weight", label: "Top weight", unit: "kg", higherIsBetter: true },
  estimated_1rm: { key: "estimated_1rm", label: "Estimated 1RM", unit: "kg", higherIsBetter: true, estimated: true },
  reps: { key: "reps", label: "Reps", unit: "reps", higherIsBetter: true },
};

const ACTIVITY_METRICS: Record<string, MetricDef> = {
  duration: { key: "duration", label: "Duration", unit: "min", higherIsBetter: true },
  distance: { key: "distance", label: "Distance", unit: "km", higherIsBetter: true },
  pace: { key: "pace", label: "Pace", unit: "min/km", higherIsBetter: false },
  speed: { key: "speed", label: "Speed", unit: "km/h", higherIsBetter: true },
  heart_rate: { key: "heart_rate", label: "Avg heart rate", unit: "bpm", higherIsBetter: false },
  calories: { key: "calories", label: "Calories", unit: "kcal", higherIsBetter: true },
  steps: { key: "steps", label: "Steps", unit: "steps", higherIsBetter: true },
  climb: { key: "climb", label: "Climb", unit: "m", higherIsBetter: true },
};

/** Epley estimate, only for sets of 1–10 reps where it's reasonable. */
export function estimatedOneRepMax(weightKg: number, reps: number): number | undefined {
  if (!(weightKg > 0) || reps < 1 || reps > 10) return undefined;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

// ── Values per session ────────────────────────────────────────────────────

function activityValue(metric: string, s: ProgressSession): { value: number; source: Provenance } | undefined {
  const band: Provenance = s.movementSource ?? "band_record";
  switch (metric) {
    case "duration": return s.durationSeconds && s.durationSeconds > 0 ? { value: s.durationSeconds / 60, source: s.durationSource ?? "band_record" } : undefined;
    case "distance": return s.distanceMeters && s.distanceMeters > 0 ? { value: s.distanceMeters / 1000, source: band } : undefined;
    case "pace": return s.averageSpeed && s.averageSpeed > 0.3 ? { value: 1000 / s.averageSpeed / 60, source: band } : undefined;
    case "speed": return s.averageSpeed && s.averageSpeed > 0 ? { value: s.averageSpeed * 3.6, source: band } : undefined;
    case "heart_rate": return s.averageHeartRate && s.averageHeartRate > 0 ? { value: s.averageHeartRate, source: s.heartRateSource ?? "band_record" } : undefined;
    case "calories": return s.calories && s.calories > 0 ? { value: s.calories, source: s.caloriesSource ?? "band_record" } : undefined;
    case "steps": return s.steps && s.steps > 0 ? { value: s.steps, source: band } : undefined;
    case "climb": return s.climbMeters && s.climbMeters > 0 ? { value: s.climbMeters, source: band } : undefined;
    default: return undefined;
  }
}

/** Activity-family metric keys → the metrics Progress can chart. */
function activityMetricKeys(activityKey: string, category: string): string[] {
  const terms = termsFor(activityKey, category as ActivityCategory);
  const order = ["duration", ...terms.primary, ...terms.secondary];
  const map: Record<string, string> = { duration: "duration", distance: "distance", pace: "pace", speed: "speed", heart_rate: "heart_rate", calories: "calories", steps: "steps", climb: "climb" };
  return [...new Set(order.map((k) => map[k]).filter((k): k is string => k !== undefined))];
}

// ── Series ────────────────────────────────────────────────────────────────

function withinRange(points: SeriesPoint[], nowMs: number, days: number): SeriesPoint[] {
  return points.filter((p) => p.t > nowMs - days * DAY_MS && p.t <= nowMs);
}

/** Ranges worth offering: at least two points in range, and — beyond the
 * shortest — history reaching past the next-shorter range. */
export function availableRanges(points: SeriesPoint[], nowMs: number): RangeId[] {
  if (points.length === 0) return [];
  const oldest = Math.min(...points.map((p) => p.t));
  const spanDays = (nowMs - oldest) / DAY_MS;
  const out: RangeId[] = [];
  RANGES.forEach((r, i) => {
    const inRange = withinRange(points, nowMs, r.days).length;
    const reachesPast = i === 0 || spanDays > RANGES[i - 1].days;
    if (inRange >= 2 && reachesPast) out.push(r.id);
  });
  return out;
}

function finish(all: SeriesPoint[], subjects: PerformanceResult["subjects"], subject: string | undefined,
                metrics: MetricDef[], metric: MetricDef | undefined, requestedRange: RangeId | undefined, nowMs: number): PerformanceResult {
  const sorted = [...all].sort((a, b) => a.t - b.t);
  const ranges = availableRanges(sorted, nowMs);
  const range = requestedRange && ranges.includes(requestedRange) ? requestedRange : ranges[ranges.length > 1 ? 1 : 0];
  const days = RANGES.find((r) => r.id === range)?.days;
  const points = days ? withinRange(sorted, nowMs, days) : sorted;
  const values = points.map((p) => p.value);
  const stats = values.length > 0
    ? { current: values[values.length - 1], low: Math.min(...values), average: mean(values)!, high: Math.max(...values), count: values.length }
    : undefined;
  const previous = days ? sorted.filter((p) => p.t <= nowMs - days * DAY_MS && p.t > nowMs - 2 * days * DAY_MS).map((p) => p.value) : [];
  const before = days ? sorted.filter((p) => p.t <= nowMs - days * DAY_MS).map((p) => p.value) : [];
  return {
    subjects, subject, metrics, metric, ranges, range, points, stats,
    comparison: comparePeriods(values, previous),
    baseline: before.length >= 3 ? mean(before) : undefined,
  };
}

/** Workouts: "all" (per workout) or one exercise (per workout day). */
export function workoutPerformance(
  sessions: ProgressSession[], sets: ProgressSet[], subject: string | undefined, metricKey: string | undefined,
  range: RangeId | undefined, nowMs: number, tzOffsetMinutes: number,
): PerformanceResult {
  const workouts = sessions.filter((s) => s.kind === "workout");
  const byExercise = new Map<string, ProgressSet[]>();
  for (const set of sets) byExercise.set(set.exerciseId, [...(byExercise.get(set.exerciseId) ?? []), set]);
  const subjects = [
    { id: "all", label: "All workouts", count: workouts.length },
    ...[...byExercise.entries()]
      .map(([id, rows]) => ({ id, label: rows[rows.length - 1].exerciseName, count: new Set(rows.map((r) => r.workoutId)).size }))
      .sort((a, b) => b.count - a.count),
  ].filter((s) => s.count > 0);
  const chosen = subjects.find((s) => s.id === subject)?.id ?? subjects[0]?.id;
  if (!chosen) return finish([], [], undefined, [], undefined, range, nowMs);

  const setsByWorkout = new Map<string, ProgressSet[]>();
  for (const set of sets) setsByWorkout.set(set.workoutId, [...(setsByWorkout.get(set.workoutId) ?? []), set]);

  const seriesFor = (key: string): SeriesPoint[] => {
    if (chosen === "all") {
      return workouts.flatMap((w): SeriesPoint[] => {
        const ws = setsByWorkout.get(w.id) ?? [];
        switch (key) {
          case "duration": return w.durationSeconds && w.durationSeconds > 0 ? [{ t: w.startedAt, value: w.durationSeconds / 60, source: w.durationSource ?? "sombrey", label: w.name }] : [];
          case "sets": return ws.length ? [{ t: w.startedAt, value: ws.length, source: "manual", label: w.name }] : [];
          case "volume": {
            const v = ws.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0);
            return v > 0 ? [{ t: w.startedAt, value: v, source: "calculated", label: w.name }] : [];
          }
          case "calories": return w.calories && w.calories > 0 ? [{ t: w.startedAt, value: w.calories, source: w.caloriesSource ?? "band_record", label: w.name }] : [];
          case "heart_rate": return w.averageHeartRate && w.averageHeartRate > 0 ? [{ t: w.startedAt, value: w.averageHeartRate, source: w.heartRateSource ?? "band_record", label: w.name }] : [];
          default: return [];
        }
      });
    }
    const rows = byExercise.get(chosen) ?? [];
    const byDay = new Map<string, ProgressSet[]>();
    for (const r of rows) {
      const k = dayKey(r.completedAt, tzOffsetMinutes);
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    return [...byDay.values()].flatMap((day): SeriesPoint[] => {
      const t = Math.max(...day.map((d) => d.completedAt));
      switch (key) {
        case "top_weight": {
          const w = Math.max(...day.map((d) => d.weightKg ?? 0));
          return w > 0 ? [{ t, value: w, source: "manual" }] : [];
        }
        case "estimated_1rm": {
          const best = Math.max(...day.map((d) => estimatedOneRepMax(d.weightKg ?? 0, d.reps) ?? 0));
          return best > 0 ? [{ t, value: best, source: "estimated" }] : [];
        }
        case "volume": {
          const v = day.reduce((sum, d) => sum + (d.weightKg ?? 0) * d.reps, 0);
          return v > 0 ? [{ t, value: v, source: "calculated" }] : [];
        }
        case "reps": return [{ t, value: day.reduce((sum, d) => sum + d.reps, 0), source: "manual" }];
        default: return [];
      }
    });
  };

  const candidateKeys = chosen === "all" ? ["duration", "volume", "sets", "calories", "heart_rate"] : ["top_weight", "estimated_1rm", "volume", "reps"];
  const metrics = candidateKeys.filter((k) => seriesFor(k).length > 0).map((k) => WORKOUT_METRICS[k]);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  return finish(metric ? seriesFor(metric.key) : [], subjects, chosen, metrics, metric, range, nowMs);
}

/** Activities: one activity at a time, in its own family's metrics. */
export function activityPerformance(
  sessions: ProgressSession[], subject: string | undefined, metricKey: string | undefined,
  range: RangeId | undefined, nowMs: number,
  displayName: (key: string) => string,
): PerformanceResult {
  const activities = sessions.filter((s) => s.kind === "activity" && s.activityKey);
  const counts = new Map<string, { count: number; category: string }>();
  for (const a of activities) {
    const c = counts.get(a.activityKey!);
    counts.set(a.activityKey!, { count: (c?.count ?? 0) + 1, category: a.activityCategory ?? "other" });
  }
  const subjects = [...counts.entries()]
    .map(([id, c]) => ({ id, label: displayName(id), count: c.count }))
    .sort((a, b) => b.count - a.count);
  const chosen = subjects.find((s) => s.id === subject)?.id ?? subjects[0]?.id;
  if (!chosen) return finish([], [], undefined, [], undefined, range, nowMs);
  const mine = activities.filter((a) => a.activityKey === chosen);
  const seriesFor = (key: string): SeriesPoint[] =>
    mine.flatMap((s) => { const v = activityValue(key, s); return v ? [{ t: s.startedAt, value: v.value, source: v.source }] : []; });
  const metrics = activityMetricKeys(chosen, counts.get(chosen)!.category)
    .filter((k) => seriesFor(k).length > 0)
    .map((k) => ACTIVITY_METRICS[k]);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  return finish(metric ? seriesFor(metric.key) : [], subjects, chosen, metrics, metric, range, nowMs);
}

export { minutes };
