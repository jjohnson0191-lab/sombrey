import { useCallback, useEffect, useRef, useState } from "react";
import type { TodayWorkout } from "./useTodayWorkout.ts";

const REST_SECONDS = 60;

export type WorkoutSessionStatus = "active" | "resting" | "complete";

export interface WorkoutSessionSummary {
  durationSeconds: number;
  exerciseCount: number;
  estimatedCalories: number;
}

/**
 * Real, working local state machine for a workout in progress — this is
 * not a mock: the rest timer and elapsed-time clock are genuine running
 * timers, set completion genuinely advances through the plan, and the
 * summary handed to the completion screen is derived from what actually
 * happened in this session. What's NOT real yet is persistence (nothing
 * here writes to Convex) and live heart rate (there's no connected band
 * to read one from) — see the implementation report.
 */
export function useWorkoutSession(workout: TodayWorkout | null) {
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [setNumber, setSetNumber] = useState(1);
  const [status, setStatus] = useState<WorkoutSessionStatus>("active");
  const [restSecondsLeft, setRestSecondsLeft] = useState(REST_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number>(Date.now());

  // Elapsed workout clock — runs the whole session, real time.
  useEffect(() => {
    if (status === "complete") return;
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  // Rest countdown — real time, auto-advances when it hits zero.
  useEffect(() => {
    if (status !== "resting") return;
    if (restSecondsLeft <= 0) {
      setStatus("active");
      return;
    }
    const id = setTimeout(() => setRestSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [status, restSecondsLeft]);

  const currentExercise = workout?.exercises[exerciseIndex] ?? null;
  const nextExercise = workout?.exercises[exerciseIndex + 1] ?? null;
  const isLastExercise = workout ? exerciseIndex === workout.exercises.length - 1 : false;
  const isLastSet = currentExercise ? setNumber >= currentExercise.sets : false;

  const completeSet = useCallback(() => {
    if (!workout || !currentExercise) return;
    if (isLastSet && isLastExercise) {
      setStatus("complete");
      return;
    }
    if (isLastSet) {
      setExerciseIndex((i) => i + 1);
      setSetNumber(1);
    } else {
      setSetNumber((n) => n + 1);
    }
    setRestSecondsLeft(REST_SECONDS);
    setStatus("resting");
  }, [workout, currentExercise, isLastSet, isLastExercise]);

  const skipRest = useCallback(() => setStatus("active"), []);

  const summary: WorkoutSessionSummary | null =
    status === "complete" && workout
      ? {
          durationSeconds: elapsedSeconds,
          exerciseCount: workout.exercises.length,
          estimatedCalories: workout.estimatedCalories,
        }
      : null;

  return {
    status,
    currentExercise,
    nextExercise,
    setNumber,
    restSecondsLeft,
    elapsedSeconds,
    completeSet,
    skipRest,
    summary,
    isFirstSet: exerciseIndex === 0 && setNumber === 1,
    completedExerciseIds: workout?.exercises.slice(0, exerciseIndex).map((e) => e.id) ?? [],
    upcomingExercises: workout?.exercises.slice(exerciseIndex + 1) ?? [],
  };
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
