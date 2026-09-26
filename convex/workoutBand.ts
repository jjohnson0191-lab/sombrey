// A structured workout and the band's record of it. Pure (no Convex
// imports) — the rules for which source a workout's times, calories and
// heart rate come from.
//
// Priority, per value:
//   1. the band's own session record — when it is present and credible;
//   2. Sombrey's own timing (the session the user ran in the app);
//   3. manual — what the user entered for a workout done elsewhere.
// A value no source measured stays absent. Nothing is estimated (in
// particular, exercise MET/calorie tables are never used as workout calories).

export type TimeSource = "band" | "sombrey" | "manual";

/** The band session's fields these rules read (as stored in sportPlusSessions). */
export type BandSession = {
  startedAt: number;
  endedAt?: number;
  bandStartTimeSec?: number;
  /** The band start as a canonical instant (strain/time.ts); older rows lack it. */
  bandStartedAt?: number;
  durationSeconds?: number;
  summarySource?: "band_record" | "live_final_tick";
  timestampSuspect?: boolean;
  calories?: number;
  averageHeartRate?: number;
  lowestHeartRate?: number;
  highestHeartRate?: number;
  recordSource?: "band" | "app";
};

export type WorkoutTiming = {
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  startTimeSource: TimeSource;
  endTimeSource: TimeSource;
};

const MINUTE = 60 * 1000;
/** The band's clock must agree with the app's within this to be trusted
 * (its time zone/epoch is not yet verified on a physical band). */
export const BAND_CLOCK_TOLERANCE_MS = 10 * MINUTE;
/** A band session started on the band attaches to a workout only when it
 * starts and ends this close to the workout. */
export const ATTACH_START_TOLERANCE_MS = 10 * MINUTE;
export const ATTACH_END_TOLERANCE_MS = 15 * MINUTE;
/** Above this, a calorie figure isn't a physical reading. */
export const MAX_KCAL_PER_MINUTE = 25;

/** The band's own start/end for a session, when its record carries them. */
export function bandBounds(s: BandSession): { start: number; end: number } | undefined {
  if (s.summarySource !== "band_record" || s.timestampSuspect) return undefined;
  if (s.bandStartTimeSec === undefined || !(s.durationSeconds !== undefined && s.durationSeconds > 0)) return undefined;
  const start = s.bandStartedAt ?? s.bandStartTimeSec * 1000;
  return { start, end: start + s.durationSeconds * 1000 };
}

/** Timing for a workout run in Sombrey: the band's record when credible
 * (present, not suspect, and its clock agrees with the app's), else the
 * app's own session timing (`appDurationSeconds` excludes pauses). */
export function resolveWorkoutTiming(
  app: { startedAt: number; completedAt: number; durationSeconds?: number },
  band: BandSession | undefined,
): WorkoutTiming {
  const bounds = band ? bandBounds(band) : undefined;
  if (bounds && Math.abs(bounds.start - app.startedAt) <= BAND_CLOCK_TOLERANCE_MS && bounds.end > bounds.start) {
    return {
      startedAt: bounds.start,
      endedAt: bounds.end,
      durationSeconds: Math.round((bounds.end - bounds.start) / 1000),
      startTimeSource: "band",
      endTimeSource: "band",
    };
  }
  return {
    startedAt: app.startedAt,
    endedAt: app.completedAt,
    durationSeconds: app.durationSeconds ?? Math.max(0, Math.round((app.completedAt - app.startedAt) / 1000)),
    startTimeSource: "sombrey",
    endTimeSource: "sombrey",
  };
}

export type WorkoutCalories = { calories: number; caloriesSource: "band_record" | "band_live" };

/** The band session's calories (already kcal as stored — the band's record
 * reports kcal and the live figure was converted once on the phone), when
 * present and physically plausible. Never converted again here. */
export function resolveWorkoutCalories(band: BandSession | undefined, durationSeconds: number | undefined): WorkoutCalories | undefined {
  if (!band || band.calories === undefined || !Number.isFinite(band.calories) || band.calories <= 0) return undefined;
  const minutes = (durationSeconds ?? band.durationSeconds ?? 0) / 60;
  if (minutes > 0 && band.calories / minutes > MAX_KCAL_PER_MINUTE) return undefined;
  if (minutes <= 0 && band.calories > 3000) return undefined;
  return {
    calories: Math.round(band.calories),
    caloriesSource: band.summarySource === "band_record" ? "band_record" : "band_live",
  };
}

export type WorkoutHeartRate = {
  averageHeartRate: number;
  lowestHeartRate?: number;
  highestHeartRate?: number;
  heartRateSource: "band_record";
};

/** Heart-rate statistics only from the band's full record — a last live
 * reading is never an average. */
export function resolveWorkoutHeartRate(band: BandSession | undefined): WorkoutHeartRate | undefined {
  if (!band || band.summarySource !== "band_record") return undefined;
  const avg = band.averageHeartRate;
  if (avg === undefined || !(avg > 0)) return undefined;
  return {
    averageHeartRate: avg,
    lowestHeartRate: band.lowestHeartRate && band.lowestHeartRate > 0 ? band.lowestHeartRate : undefined,
    highestHeartRate: band.highestHeartRate && band.highestHeartRate > 0 ? band.highestHeartRate : undefined,
    heartRateSource: "band_record",
  };
}

/** For a workout with no band session of its own: a session the user
 * started on the band during it — starting and ending close to the
 * workout's own start and end. Nearest start wins; anything else is
 * unrelated and never attached. */
export function findSessionRecordedDuring<T extends BandSession>(
  workout: { startedAt: number; completedAt: number },
  sessions: T[],
): T | undefined {
  let best: T | undefined;
  let bestGap = Infinity;
  for (const s of sessions) {
    if (s.recordSource !== "band") continue;
    const bounds = bandBounds(s);
    if (!bounds) continue;
    const startGap = Math.abs(bounds.start - workout.startedAt);
    const endGap = Math.abs(bounds.end - workout.completedAt);
    if (startGap <= ATTACH_START_TOLERANCE_MS && endGap <= ATTACH_END_TOLERANCE_MS && startGap < bestGap) {
      best = s;
      bestGap = startGap;
    }
  }
  return best;
}
