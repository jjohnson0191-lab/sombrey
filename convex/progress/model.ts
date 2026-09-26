// Progress — the shared shapes every Progress module reads. Pure.
//
// Sessions come from the stores that already exist (sombreyWorkouts,
// sportPlusSessions, activityLabels); these types only describe them. A
// field is present only when its source recorded it, and every figure
// carries where it came from.

import { type Zone, localDayKey, localDayKeyDaysAgo, startOfLocalDay as timeStartOfLocalDay, startOfLocalWeek as timeStartOfLocalWeek } from "../strain/time.ts";

export type Provenance =
  | "band_record"   // the band's own session record
  | "band_live"     // the band's live figures during an app-started session
  | "band_samples"  // calculated by Sombrey from band readings in a window
  | "sombrey"       // timed/recorded by the Sombrey app
  | "manual"        // entered by the user
  | "scanner"       // body scanner (future)
  | "calculated"    // Sombrey arithmetic over recorded values
  | "estimated";    // an estimate (e.g. age-predicted max HR, e1RM)

export type ProgressSession = {
  id: string;
  kind: "workout" | "activity";
  /** Where the session itself came from. */
  origin: "sombrey_workout" | "plan_workout" | "manual_workout" | "band_activity" | "app_activity" | "noticed_activity";
  name: string;
  startedAt: number;
  durationSeconds?: number;
  durationSource?: Provenance;
  activityKey?: string;
  activityCategory?: string;
  calories?: number;
  caloriesSource?: Provenance;
  averageHeartRate?: number;
  highestHeartRate?: number;
  heartRateSource?: Provenance;
  distanceMeters?: number;
  steps?: number;
  averageSpeed?: number;
  climbMeters?: number;
  /** Where distance / steps / speed / climb came from. */
  movementSource?: Provenance;
  /** A workout started from a day of the user's training plan. */
  fromPlan?: boolean;
  /** The band's Sport+ record of this session (its own row for band/app
   * activities; the attached record for a workout). */
  bandSessionId?: string;
  /** The band record's timing couldn't be real (strain/time.ts). */
  timestampSuspect?: boolean;
};

export type ProgressSet = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  weightKg?: number;
  completedAt: number;
};

export type ReadinessDay = { date: string; score?: number };

export type WeightEntry = { id: string; date: number; weightKg: number; source: Provenance };

export const DAY_MS = 24 * 60 * 60 * 1000;

// Days are the user's local calendar days in their time zone — an IANA
// name (DST-correct), or a fixed offset from older clients. See
// convex/strain/time.ts, the one time model.
export type { Zone } from "../strain/time.ts";

/** The user's local calendar day ("2026-09-26") for an instant. */
export function dayKey(ms: number, zone: Zone): string {
  return localDayKey(ms, zone);
}

/** Local midnight (as epoch ms) of the day containing `ms`. */
export function startOfLocalDay(ms: number, zone: Zone): number {
  return timeStartOfLocalDay(ms, zone);
}

/** Local Monday 00:00 of the week containing `ms`. */
export function startOfLocalWeek(ms: number, zone: Zone): number {
  return timeStartOfLocalWeek(ms, zone);
}

/** The local day `n` calendar days before the day of `ms`. */
export function dayKeyDaysAgo(ms: number, n: number, zone: Zone): string {
  return localDayKeyDaysAgo(ms, n, zone);
}

export function minutes(s: ProgressSession): number {
  return s.durationSeconds !== undefined && s.durationSeconds > 0 ? s.durationSeconds / 60 : 0;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
}
