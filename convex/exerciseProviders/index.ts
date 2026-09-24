// The one place that chooses Sombrey's exercise provider. Everything else
// asks for "the provider" and works with the neutral interface in
// convex/exerciseProvider.ts. Replacing the provider = a new adapter here.

import type { ExerciseProvider } from "../exerciseProvider.ts";
import { WorkoutXProvider } from "./workoutx.ts";

/** The configured provider, or null when none is configured — the library
 * then serves what it already holds. */
export function configuredExerciseProvider(): ExerciseProvider | null {
  const key = process.env.WORKOUTX_API_KEY;
  if (!key) return null;
  return new WorkoutXProvider(key, (input, init) => fetch(input, init));
}

/** Optional override of the monthly request budget. */
export function configuredBudgetOverride(): number | undefined {
  const raw = process.env.EXERCISE_PROVIDER_MONTHLY_BUDGET;
  return raw ? Number(raw) : undefined;
}
