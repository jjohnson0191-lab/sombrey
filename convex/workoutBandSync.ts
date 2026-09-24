// Applies convex/workoutBand.ts to stored workouts: gives a finished
// Sombrey workout its actual times, calories and heart rate from its band
// session. Runs when the workout finishes and again whenever the band's
// record is imported (the record usually lands seconds later), so the
// workout always reflects the best source available — without a second
// importer: the band record arrives through sportPlusSessions:importBandSessions.

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ATTACH_START_TOLERANCE_MS,
  findSessionRecordedDuring,
  resolveWorkoutCalories,
  resolveWorkoutHeartRate,
  resolveWorkoutTiming,
} from "./workoutBand";

/** Reconciles one workout with its band session (attaching one recorded on
 * the band during it, when it has none). Manual and unfinished workouts are
 * left as they are. */
export async function reconcileWorkout(ctx: MutationCtx, workoutId: Id<"sombreyWorkouts">): Promise<void> {
  const workout = await ctx.db.get(workoutId);
  if (!workout || workout.completedAt === undefined || workout.source === "manual") return;
  const completedAt = workout.completedAt;

  let session: Doc<"sportPlusSessions"> | null = workout.sportPlusSessionId ? await ctx.db.get(workout.sportPlusSessionId) : null;
  let attachId: Id<"sportPlusSessions"> | undefined;
  if (!session) {
    const candidates = await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) =>
        q.eq("userId", workout.userId)
          .gte("startedAt", workout.startedAt - ATTACH_START_TOLERANCE_MS)
          .lte("startedAt", workout.startedAt + ATTACH_START_TOLERANCE_MS))
      .collect();
    // Never take a session another workout already owns.
    const free: Doc<"sportPlusSessions">[] = [];
    for (const c of candidates) {
      const owner = await ctx.db.query("sombreyWorkouts").withIndex("by_sportPlusSession", (q) => q.eq("sportPlusSessionId", c._id)).first();
      if (!owner) free.push(c);
    }
    const found = findSessionRecordedDuring({ startedAt: workout.startedAt, completedAt }, free);
    if (found) {
      session = found;
      attachId = found._id;
    }
  }

  const band = session ?? undefined;
  const timing = resolveWorkoutTiming({ startedAt: workout.startedAt, completedAt, durationSeconds: workout.durationSeconds }, band);
  const calories = resolveWorkoutCalories(band, timing.durationSeconds);
  const heart = resolveWorkoutHeartRate(band);
  await ctx.db.patch(workoutId, {
    ...(attachId ? { sportPlusSessionId: attachId } : {}),
    actualStartedAt: timing.startedAt,
    actualEndedAt: timing.endedAt,
    actualDurationSeconds: timing.durationSeconds,
    startTimeSource: timing.startTimeSource,
    endTimeSource: timing.endTimeSource,
    calories: calories?.calories,
    caloriesSource: calories?.caloriesSource,
    averageHeartRate: heart?.averageHeartRate,
    lowestHeartRate: heart?.lowestHeartRate,
    highestHeartRate: heart?.highestHeartRate,
    heartRateSource: heart?.heartRateSource,
    bandReconciledAt: Date.now(),
  });
}

/** After a band session changed: reconcile the workout that owns it, or —
 * for a session started on the band — a finished workout it may belong to. */
export async function reconcileWorkoutsForSession(ctx: MutationCtx, session: Doc<"sportPlusSessions">): Promise<void> {
  const owner = await ctx.db.query("sombreyWorkouts").withIndex("by_sportPlusSession", (q) => q.eq("sportPlusSessionId", session._id)).first();
  if (owner) {
    await reconcileWorkout(ctx, owner._id);
    return;
  }
  if (session.recordSource !== "band" || session.bandStartTimeSec === undefined) return;
  const bandStart = session.bandStartTimeSec * 1000;
  const nearby = await ctx.db
    .query("sombreyWorkouts")
    .withIndex("by_user_and_startedAt", (q) =>
      q.eq("userId", session.userId).gte("startedAt", bandStart - ATTACH_START_TOLERANCE_MS).lte("startedAt", bandStart + ATTACH_START_TOLERANCE_MS))
    .collect();
  for (const w of nearby) {
    if (w.sportPlusSessionId === undefined && w.completedAt !== undefined && w.source !== "manual") {
      await reconcileWorkout(ctx, w._id);
    }
  }
}
