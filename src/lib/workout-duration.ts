/**
 * Workout duration estimation utilities.
 *
 * Formula per set:
 *   rep time ≈ reps × 3s (eccentric + concentric) + tempo buffer
 *   set time = rep_time + rest_seconds
 *
 * Intensifier adjustments:
 *   - Drop set: each sub-set adds (subReps × 3s + minimal 15s rest)
 *   - Superset: two exercises share the rest period (overlap 50%)
 *   - Tempo: multiplier on rep time based on tempo string
 *
 * Transition time between exercises: 60s
 */

const SECS_PER_REP = 3; // average time per rep in seconds
const TRANSITION_SECS = 60; // transition / setup between exercises
const DROP_SUB_REST_SECS = 10; // minimal rest between drop sub-sets

export type SetConfigForDuration = {
  reps?: number | string;
  weightKg?: number;
  restSeconds?: number;
  intensifierType?: string;
  intensifierValue?: string;
  dropSubSets?: Array<{
    subSetNumber: number;
    reps?: number;
    restSeconds?: number;
  }>;
};

export type ExerciseForDuration = {
  sets: number;
  reps: number | string;
  restSeconds: number;
  isDropSet?: boolean;
  supersetWith?: string;
  setConfigs?: SetConfigForDuration[];
};

/** Parse reps – handles "8-12" ranges (use average), plain numbers, and strings. */
function parseReps(reps: number | string | undefined): number {
  if (reps === undefined) return 10;
  if (typeof reps === "number") return reps;
  if (reps.includes("-")) {
    const parts = reps.split("-").map(Number).filter((n) => !isNaN(n));
    if (parts.length === 2) return Math.round((parts[0] + parts[1]) / 2);
  }
  const n = Number(reps);
  return isNaN(n) ? 10 : n;
}

/** Parse tempo string "3-1-2-0" → total seconds per rep. */
function parseTempoMultiplier(tempo: string): number {
  const parts = tempo.split("-").map(Number).filter((n) => !isNaN(n));
  if (parts.length >= 3) {
    const totalSecs = parts.reduce((a, b) => a + b, 0);
    // ratio vs. default 3s per rep
    return totalSecs / 3;
  }
  return 1;
}

/** Estimate seconds for a single set given its config. */
function estimateSetSeconds(
  reps: number,
  restSecs: number,
  intensifierType?: string,
  intensifierValue?: string,
  dropSubSets?: Array<{ reps?: number; restSeconds?: number }>,
): number {
  let repTime = reps * SECS_PER_REP;

  if (intensifierType === "tempo" && intensifierValue) {
    repTime = reps * SECS_PER_REP * parseTempoMultiplier(intensifierValue);
  }

  let setTime = repTime + restSecs;

  if (intensifierType === "dropset" && dropSubSets && dropSubSets.length > 0) {
    for (const ds of dropSubSets) {
      const dsReps = ds.reps ?? reps;
      const dsRest = ds.restSeconds ?? DROP_SUB_REST_SECS;
      setTime += dsReps * SECS_PER_REP + dsRest;
    }
  }

  return setTime;
}

/**
 * Estimate the duration (in seconds) for a single exercise.
 * Uses setConfigs if present; falls back to legacy flat fields.
 */
export function estimateExerciseDurationSeconds(ex: ExerciseForDuration): number {
  // Superset: this exercise's rest overlaps with partner → halve rest contribution
  const supersetFactor = ex.supersetWith ? 0.5 : 1;

  if (ex.setConfigs && ex.setConfigs.length > 0) {
    let total = 0;
    for (const sc of ex.setConfigs) {
      const reps = parseReps(sc.reps ?? ex.reps);
      const rest = (sc.restSeconds ?? ex.restSeconds) * supersetFactor;
      total += estimateSetSeconds(
        reps,
        rest,
        sc.intensifierType,
        sc.intensifierValue,
        sc.dropSubSets,
      );
    }
    // superset: add a per-set intensifier multiplier for linked exercise time
    if (ex.supersetWith) total *= 1.8; // ~80% extra for paired movement
    return total;
  }

  // Legacy flat fields
  const reps = parseReps(ex.reps);
  const rest = ex.restSeconds * supersetFactor;
  let total = 0;
  for (let i = 0; i < ex.sets; i++) {
    total += estimateSetSeconds(
      reps,
      rest,
      ex.isDropSet ? "dropset" : undefined,
      undefined,
      [],
    );
  }
  if (ex.supersetWith) total *= 1.8;
  return total;
}

/**
 * Estimate total workout duration in seconds.
 * Adds transition time between each exercise.
 */
export function estimateWorkoutDurationSeconds(exercises: ExerciseForDuration[]): number {
  if (exercises.length === 0) return 0;
  const exerciseTime = exercises.reduce(
    (sum, ex) => sum + estimateExerciseDurationSeconds(ex),
    0,
  );
  const transitions = Math.max(0, exercises.length - 1) * TRANSITION_SECS;
  return exerciseTime + transitions;
}

/** Format seconds into a human-readable string like "45 min" or "1h 12min". */
export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
