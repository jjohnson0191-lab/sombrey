/**
 * Shared progressive overload math utilities.
 * Used by both the Convex backend (aiWorkouts.ts) and the frontend logger UI.
 */

/** Baseline reps for each set in week 1 of a weight cycle */
export const BASE_REPS = [15, 12, 10, 8] as const;

/** Maximum reps per set before triggering weight increase */
export const MAX_REPS = 15;

/** Weight increase percentage when cap is reached */
export const WEIGHT_INCREASE_PCT = 0.03;

/**
 * Compute the target reps array for a given weight-cycle week.
 * weightCycleWeek starts at 1 (first week with this weight).
 * e.g. week 1 → [15,12,10,8], week 2 → [16,13,11,9], ...
 */
export function computeTargetReps(weightCycleWeek: number): number[] {
  return BASE_REPS.map((base) =>
    Math.min(MAX_REPS, base + (weightCycleWeek - 1))
  );
}

/** True if all sets have hit the rep ceiling (15/15/15/15) */
export function isRepCeiling(targetReps: number[]): boolean {
  return targetReps.every((r) => r >= MAX_REPS);
}

/** Human-readable rep string, e.g. "15 / 12 / 10 / 8" */
export function formatTargetReps(targetReps: number[]): string {
  return targetReps.join(" / ");
}

/** Next cycle's target reps (for display as "next week target") */
export function nextTargetReps(weightCycleWeek: number): number[] {
  if (isRepCeiling(computeTargetReps(weightCycleWeek))) {
    // After weight bump, resets to week 1
    return [...BASE_REPS];
  }
  return computeTargetReps(weightCycleWeek + 1);
}
