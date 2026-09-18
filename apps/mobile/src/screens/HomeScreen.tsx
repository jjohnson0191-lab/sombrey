import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api.js";
import { Screen, Button } from "@/ui/index.ts";
import { ReadinessIndicator } from "@/ui/ReadinessIndicator.tsx";
import { WearableStatusBadge } from "@/ui/WearableStatusBadge.tsx";
import { LoadingState } from "@/ui/StateViews.tsx";
import { useReadiness } from "@/features/readiness/useReadiness.ts";
import { useWearable } from "@/features/wearable/useWearable.ts";
import { useTodayWorkout } from "@/features/training/useTodayWorkout.ts";

/**
 * Home — the daily Sombrey experience. Readiness is the dominant visual
 * moment (top-right, in the environment's cool zone); today's training
 * recommendation, activity, and nutrition sit in the warm lower zone as
 * plain text rows, not cards. The AI interpretation line only renders
 * when there's a real readiness score to interpret — see
 * useReadiness.ts; today that's never, so it's honestly absent rather
 * than showing fabricated commentary.
 */
export function HomeScreen() {
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const { result: readiness } = useReadiness();
  const { status: wearableStatus } = useWearable();
  const { workout } = useTodayWorkout();

  if (currentUser === undefined) {
    return (
      <Screen scene="home">
        <LoadingState label="Loading your data…" />
      </Screen>
    );
  }

  const firstName = currentUser?.name?.split(" ")[0];
  const connectionState = wearableStatus?.connectionState ?? "disconnected";

  return (
    <Screen scene="home" className="pt-14 pb-6">
      <div className="flex items-start justify-between">
        <p className="text-[13px] text-paper-soft">{firstName ? `Good morning, ${firstName}` : "Good morning"}</p>
        <WearableStatusBadge state={connectionState} batteryPct={wearableStatus?.batteryPct} />
      </div>

      <div className="mt-6 flex justify-end">
        <ReadinessIndicator result={readiness} tone="paper" />
      </div>

      {readiness?.score !== null && readiness?.score !== undefined && (
        <div className="mt-6 flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-ink-dark" />
          <p className="text-[13px] leading-relaxed text-paper/85">
            {readiness.contributingFactors[0]?.description ?? "Your readiness has changed today."}
          </p>
        </div>
      )}

      <div className="mt-10">
        <p className="text-[11px] tracking-[0.08em] text-ink-soft uppercase">Today</p>
        {workout ? (
          <button
            type="button"
            onClick={() => navigate("/train")}
            className="mt-1 block w-full text-left"
          >
            <p className="text-base font-medium text-ink">{workout.title}</p>
            {workout.coachNote && <p className="mt-0.5 text-xs text-ink-soft">{workout.coachNote}</p>}
          </button>
        ) : (
          <p className="mt-1 text-base font-medium text-ink">No workout scheduled</p>
        )}
      </div>

      <div className="mt-6 h-px bg-ink/10" />

      <div className="mt-4 flex flex-wrap gap-5 text-xs tabular text-ink-soft">
        <span>— steps</span>
        <span>— active cal</span>
        <span>HR —</span>
      </div>

      <button
        type="button"
        onClick={() => navigate("/home/nutrition")}
        className="mt-3 block text-left text-xs text-ink-soft underline underline-offset-2"
      >
        Log your first meal
      </button>

      <div className="mt-8 flex gap-3">
        <Button variant="primary" onClick={() => navigate("/train")}>
          Start workout
        </Button>
        <Button variant="secondary" onClick={() => navigate("/ai")}>
          Ask Sombrey
        </Button>
      </div>
    </Screen>
  );
}
