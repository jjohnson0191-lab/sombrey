/**
 * Training feature boundary — typed foundation only, following the
 * same honest pattern as features/readiness/useReadiness.ts.
 *
 * No Sombrey-native (AI-generated, non-coaching) workout backend is
 * wired into the mobile app yet. convex/workouts.ts, programs.ts, and
 * aiWorkouts.ts exist, but they're shaped around the legacy coaching
 * platform's program/phase/assigned-coach model, which is a different
 * product than Sombrey (AI-only, no human coaching) — reusing them
 * directly here would be the wrong backend, not just a stopgap one.
 * The real Sombrey workout-generation backend is a dedicated later
 * phase; this hook's shape is what the Train screens are written
 * against today, so wiring in the real thing later is a change to this
 * one file, not a screen rewrite.
 *
 * Returns a realistic, clearly-mock plan for now so the Train
 * experience can be built and tested end to end before that backend
 * exists.
 */
export interface WorkoutExercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  loadKg: number;
}

export interface TodayWorkout {
  title: string;
  estimatedMinutes: number;
  estimatedCalories: number;
  coachNote: string | null;
  exercises: WorkoutExercise[];
}

const MOCK_WORKOUT: TodayWorkout = {
  title: "Upper Body Strength",
  estimatedMinutes: 45,
  estimatedCalories: 320,
  coachNote: "Adjusted by Sombrey Coach for recovery — volume trimmed slightly today.",
  exercises: [
    { id: "row", name: "Barbell Row", sets: 4, reps: 8, loadKg: 42.5 },
    { id: "incline-press", name: "Incline Dumbbell Press", sets: 4, reps: 8, loadKg: 22.5 },
    { id: "cable-fly", name: "Cable Fly", sets: 3, reps: 12, loadKg: 15 },
    { id: "face-pull", name: "Face Pull", sets: 3, reps: 15, loadKg: 12 },
  ],
};

export function useTodayWorkout(): { workout: TodayWorkout | null; isLoading: boolean } {
  return { workout: MOCK_WORKOUT, isLoading: false };
}
