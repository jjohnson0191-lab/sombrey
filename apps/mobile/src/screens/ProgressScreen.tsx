import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api.js";
import { Screen } from "@/ui/index.ts";
import { LoadingState } from "@/ui/StateViews.tsx";

/**
 * Progress — analytical, not a spreadsheet. Readiness and strength
 * trends need history that doesn't exist yet (no readiness engine, no
 * Sombrey-native workout logging — see useReadiness.ts and
 * useTodayWorkout.ts), so both render an honest "not enough data yet"
 * line instead of a fabricated chart. Weight and progress photos are
 * wired to the real, already-existing Convex queries
 * (measurements.list, progressPhotos.list) — genuinely live data, and
 * genuinely empty for a brand-new account.
 */
export function ProgressScreen() {
  const measurements = useQuery(api.measurements.list, {});
  const photos = useQuery(api.progressPhotos.list, {});

  if (measurements === undefined || photos === undefined) {
    return (
      <Screen scene="progress">
        <LoadingState label="Loading progress…" />
      </Screen>
    );
  }

  const latestWeight = measurements.filter((m) => m.weight !== undefined).at(-1);
  const latestPhoto = photos[0];

  return (
    <Screen scene="progress" className="pt-14 pb-6">
      <h1 className="text-[26px] font-semibold text-paper">Progress</h1>

      <div className="mt-8">
        <p className="text-[11px] tracking-[0.08em] text-paper-soft uppercase">Readiness</p>
        <p className="mt-2 text-[13px] text-paper/70">
          Not enough data yet — check back after a few more days of wearing your band.
        </p>
      </div>

      <div className="mt-8 h-px bg-paper/15" />

      <div className="mt-6">
        <p className="text-[11px] tracking-[0.08em] text-ink-soft uppercase">Upper body strength</p>
        <p className="mt-2 text-[13px] text-ink-soft">
          Log a few workouts to see your strength trend here.
        </p>
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <div>
          <p className="text-[11px] tracking-[0.08em] text-ink-soft uppercase">Weight</p>
          <p className="mt-1 text-[15px] font-medium text-ink">
            {latestWeight?.weight !== undefined ? `${latestWeight.weight} kg` : "No entries yet"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] tracking-[0.08em] text-ink-soft uppercase">Photos</p>
          <p className="mt-1 text-[15px] font-medium text-ink">
            {latestPhoto ? "View progress photos" : "Add your first photo"}
          </p>
        </div>
      </div>
    </Screen>
  );
}
