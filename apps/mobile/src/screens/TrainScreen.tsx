import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Screen, Button } from "@/ui/index.ts";
import { HeroNumber } from "@/ui/HeroNumber.tsx";
import { LoadingState, EmptyState } from "@/ui/StateViews.tsx";
import { useTodayWorkout, type TodayWorkout } from "@/features/training/useTodayWorkout.ts";
import { useWorkoutSession, formatClock } from "@/features/training/useWorkoutSession.ts";

type Session = ReturnType<typeof useWorkoutSession>;

/**
 * Train — one screen, three real phases (overview / active+rest /
 * complete), not three separate routes. The workout session
 * (useWorkoutSession) is lifted here so its state — current set, the
 * real running rest timer, the real elapsed-time clock — survives the
 * phase transition without a cross-route state-sharing problem. See the
 * implementation report for why this was a deliberate simplification
 * from the three-URL design artifact rather than an oversight.
 */
export function TrainScreen() {
  const { workout, isLoading } = useTodayWorkout();
  const session = useWorkoutSession(workout);
  const [manualPhase, setManualPhase] = useState<"overview" | "session">("overview");
  const phase = session.status === "complete" ? "complete" : manualPhase;

  if (isLoading) {
    return (
      <Screen scene="trainOverview">
        <LoadingState label="Loading your workout…" />
      </Screen>
    );
  }

  if (!workout) {
    return (
      <Screen scene="trainOverview">
        <EmptyState title="No workout today" description="Check back tomorrow, or ask Sombrey Coach." />
      </Screen>
    );
  }

  if (phase === "session") {
    return <ActiveOrResting workout={workout} session={session} />;
  }

  if (phase === "complete") {
    return <Complete workout={workout} session={session} />;
  }

  return <Overview workout={workout} onStart={() => setManualPhase("session")} />;
}

function Overview({ workout, onStart }: { workout: TodayWorkout; onStart: () => void }) {
  return (
    <Screen scene="trainOverview" className="pt-14 pb-28">
      <p className="text-[11px] tracking-[0.08em] text-paper-soft uppercase">Today's workout</p>
      <h1 className="mt-1 text-[26px] font-semibold text-ink">{workout.title}</h1>
      <p className="mt-1 text-xs text-ink-soft">
        {workout.estimatedMinutes} min &middot; ~{workout.estimatedCalories} cal &middot; {workout.exercises.length}{" "}
        exercises
      </p>
      {workout.coachNote && <p className="mt-4 text-xs text-accent-ink">{workout.coachNote}</p>}

      <div className="mt-8 flex flex-col gap-5">
        {workout.exercises.map((ex, i) => (
          <div key={ex.id}>
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-medium text-ink">{ex.name}</span>
              <span className="tabular text-xs text-ink-soft">
                {ex.sets} &times; {ex.reps} &middot; {ex.loadKg} kg
              </span>
            </div>
            {i < workout.exercises.length - 1 && <div className="mt-5 h-px bg-ink/10" />}
          </div>
        ))}
      </div>

      <div className="fixed bottom-24 left-6 right-6">
        <Button variant="primary" onClick={onStart}>
          Start workout
        </Button>
      </div>
    </Screen>
  );
}

function ActiveOrResting({ workout, session }: { workout: TodayWorkout; session: Session }) {
  const { currentExercise, nextExercise, setNumber, status, restSecondsLeft, completeSet, skipRest } = session;
  if (!currentExercise) return null;
  const exerciseIndex = workout.exercises.findIndex((e) => e.id === currentExercise.id);

  return (
    <Screen scene="trainActive" className="pt-11 pb-28">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[11px] tracking-[0.08em] text-ink-soft uppercase">
            Set {setNumber} of {currentExercise.sets}
          </p>
          <h1 className="mt-0.5 text-[19px] font-semibold text-ink">{currentExercise.name}</h1>
        </div>
      </div>

      {status === "active" ? (
        <>
          <div className="mt-8">
            <p className="text-[10px] tracking-[0.1em] text-ink-soft uppercase">Set</p>
            <div className="flex items-baseline gap-2.5">
              <HeroNumber size="lg" tone="ink">
                {setNumber}
              </HeroNumber>
              <span className="tabular text-[15px] text-ink-faint">of {currentExercise.sets}</span>
            </div>
            <p className="mt-1 text-[13px] text-ink-soft">
              {currentExercise.reps} reps &middot; {currentExercise.loadKg} kg
            </p>
          </div>

          <div className="mt-8">
            <Button variant="primary" onClick={completeSet}>
              Complete set
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-8">
            <p className="text-[10px] tracking-[0.1em] text-ink-soft uppercase">Rest</p>
            <HeroNumber size="md" tone="ink">
              {formatClock(restSecondsLeft)}
            </HeroNumber>
          </div>
          {nextExercise && (
            <p className="mt-6 text-xs text-ink-soft">
              Next: {nextExercise.name} &middot; {nextExercise.sets} &times; {nextExercise.reps} &middot;{" "}
              {nextExercise.loadKg} kg
            </p>
          )}
          <button
            type="button"
            onClick={skipRest}
            className="mt-4 text-[13px] font-semibold text-ink underline underline-offset-2"
          >
            Skip rest
          </button>
        </>
      )}

      {exerciseIndex > 0 && (
        <div className="mt-10 flex flex-col gap-3 opacity-55">
          {workout.exercises.slice(0, exerciseIndex).map((ex) => (
            <div key={ex.id} className="flex items-center justify-between">
              <span className="text-[13px] text-ink line-through">{ex.name}</span>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[9px] text-paper">
                ✓
              </span>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

function Complete({ workout, session }: { workout: TodayWorkout; session: Session }) {
  const navigate = useNavigate();
  const summary = session.summary;
  if (!summary) return null;

  return (
    <Screen scene="trainComplete" nav={false} className="pt-11 pb-10">
      <button type="button" onClick={() => navigate("/home")} className="text-[13px] text-paper/75">
        Close
      </button>

      <p className="mt-16 text-[11px] tracking-[0.1em] text-ink-soft uppercase">Workout complete</p>
      <HeroNumber size="md" tone="ink" className="mt-1">
        {formatClock(summary.durationSeconds)}
      </HeroNumber>
      <p className="mt-3 text-[15px] font-medium text-ink">{workout.title}</p>
      <div className="mt-3 flex gap-5 text-[13px] tabular text-ink-soft">
        <span>{summary.exerciseCount} exercises</span>
        <span>{summary.estimatedCalories} cal</span>
      </div>

      <div className="mt-6 flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-ink" />
        <p className="text-[13px] leading-relaxed text-ink/85">
          Nice work — recovery-adjusted sessions like this keep you consistent without digging a deeper hole.
        </p>
      </div>

      <div className="mt-10 flex gap-3">
        <Button variant="primary" onClick={() => navigate("/home")}>
          Done
        </Button>
      </div>
    </Screen>
  );
}
