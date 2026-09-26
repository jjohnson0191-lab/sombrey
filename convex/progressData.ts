// Loads the user's recorded history for Progress (and the AI Coach) from
// the stores that already exist — nothing is copied or duplicated. Each
// record becomes a ProgressSession / ProgressSet with its provenance.

import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { labelledRecord, sessionRecord, type ActivityRecord } from "./activities";
import { activityCatalog } from "./activityTaxonomy";
import { ageFromDateOfBirth, estimatedMaxHeartRate } from "./activityIntensity";
import type { ProgressSession, ProgressSet, Provenance, ReadinessDay, WeightEntry } from "./progress/model";

const HISTORY_MS = 400 * 24 * 60 * 60 * 1000;
const catalog = new Map(activityCatalog().map((a) => [a.key, a.name]));

export function activityName(key: string): string {
  return catalog.get(key) ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function workoutSession(w: Doc<"sombreyWorkouts">): ProgressSession | null {
  if (w.completedAt === undefined) return null;
  const manual = w.source === "manual";
  const timeSource: Provenance = w.startTimeSource === "band" ? "band_record" : w.startTimeSource === "manual" || manual ? "manual" : "sombrey";
  const bandCalories = w.calories !== undefined && w.calories > 0;
  return {
    id: w._id,
    kind: "workout",
    origin: manual ? "manual_workout" : w.source === "plan" ? "plan_workout" : "sombrey_workout",
    name: w.name,
    startedAt: w.actualStartedAt ?? w.startedAt,
    durationSeconds: w.actualDurationSeconds ?? w.durationSeconds,
    durationSource: timeSource,
    activityKey: manual ? undefined : "structured_workout",
    activityCategory: manual ? undefined : "strength",
    calories: bandCalories ? w.calories : w.userReportedCalories,
    caloriesSource: bandCalories ? (w.caloriesSource === "band_live" ? "band_live" : "band_record") : w.userReportedCalories !== undefined ? "manual" : undefined,
    averageHeartRate: w.averageHeartRate,
    highestHeartRate: w.highestHeartRate,
    heartRateSource: w.averageHeartRate !== undefined ? "band_record" : undefined,
    distanceMeters: w.distanceMeters,
    movementSource: w.distanceMeters !== undefined ? "manual" : undefined,
    fromPlan: w.source === "plan",
    bandSessionId: w.sportPlusSessionId,
    rpe: w.rpe,
  };
}

function activitySession(a: ActivityRecord): ProgressSession {
  return {
    id: a.id,
    kind: "activity",
    origin: a.provenance === "band_sport_plus" ? "band_activity" : a.provenance === "user_labelled" ? "noticed_activity" : "app_activity",
    name: a.displayName,
    startedAt: a.startedAt,
    durationSeconds: a.durationSeconds,
    durationSource: a.provenance === "user_labelled" ? "band_samples" : a.durationSource === "sombrey_timer" ? "sombrey" : "band_record",
    activityKey: a.activityKey,
    activityCategory: a.activityCategory,
    calories: a.calories,
    caloriesSource: a.caloriesSource === "band_live" ? "band_live" : a.caloriesSource === "user_entered" ? "manual" : a.caloriesSource ? "band_record" : undefined,
    averageHeartRate: a.averageHeartRate,
    highestHeartRate: a.highestHeartRate,
    heartRateSource: a.heartRateSource === "band_samples" ? "band_samples" : a.heartRateSource ? "band_record" : undefined,
    distanceMeters: a.distanceMeters,
    steps: a.steps,
    averageSpeed: a.averageSpeedMetersPerSecond,
    climbMeters: a.climbMeters,
    movementSource: a.movementSource === "band_live" ? "band_live" : a.movementSource ? "band_record" : undefined,
    bandSessionId: a.provenance === "user_labelled" ? undefined : a.id,
    timestampSuspect: a.timestampSuspect,
  };
}

export type ProgressData = {
  sessions: ProgressSession[];
  sets: ProgressSet[];
  readiness: ReadinessDay[];
  weights: WeightEntry[];
  plannedPerWeek?: number;
  estimatedMaxHeartRate?: number;
  age?: number;
  timeZone?: string;
};

export async function loadProgressData(ctx: QueryCtx, userId: Id<"users">, nowMs: number): Promise<ProgressData> {
  const since = nowMs - HISTORY_MS;
  const workouts = await ctx.db.query("sombreyWorkouts")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", since)).take(2000);
  const attached = new Set(workouts.map((w) => w.sportPlusSessionId).filter((id): id is Id<"sportPlusSessions"> => id !== undefined));
  const sportRows = await ctx.db.query("sportPlusSessions")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", since)).take(3000);
  const labels = await ctx.db.query("activityLabels")
    .withIndex("by_user_and_startedAt", (q) => q.eq("userId", userId).gte("startedAt", since)).take(1000);
  const setRows = await ctx.db.query("sombreyWorkoutSets")
    .withIndex("by_user_and_completedAt", (q) => q.eq("userId", userId).gte("completedAt", since)).take(20000);
  const readinessRows = await ctx.db.query("readinessScores")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId)).order("desc").take(120);
  const measurementRows = await ctx.db.query("measurements").withIndex("by_user", (q) => q.eq("userId", userId)).take(5000);
  const plans = await ctx.db.query("trainingPlans").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  const user = await ctx.db.get(userId);

  const sessions: ProgressSession[] = [
    ...workouts.map(workoutSession).filter((s): s is ProgressSession => s !== null),
    // A band session that belongs to a workout is that workout — counted once.
    ...sportRows.filter((s) => !attached.has(s._id)).map((s) => ({ s, r: sessionRecord(s) })).filter((x) => x.r !== null).map((x) => ({ ...activitySession(x.r!), rpe: x.s.rpe })),
    ...labels.map((l) => ({ l, r: labelledRecord(l) })).filter((x) => x.r !== null).map((x) => ({ ...activitySession(x.r!), rpe: x.l.rpe })),
  ].sort((a, b) => a.startedAt - b.startedAt);

  const names = new Map<string, string>();
  const sets: ProgressSet[] = [];
  for (const s of setRows.sort((a, b) => a.completedAt - b.completedAt)) {
    let name = s.exerciseName ?? names.get(s.exerciseId);
    if (!name) {
      name = (await ctx.db.get(s.exerciseId))?.name ?? "Exercise";
      names.set(s.exerciseId, name);
    }
    sets.push({ workoutId: s.workoutId, exerciseId: s.exerciseId, exerciseName: name, reps: s.reps, weightKg: s.weightKg, completedAt: s.completedAt });
  }

  const current = plans.find((p) => p.isCurrent);
  const weekdays = current ? current.days.filter((d) => d.weekday !== undefined).length : 0;

  return {
    sessions,
    sets,
    readiness: readinessRows.map((r) => ({ date: r.date, score: r.score })),
    weights: measurementRows
      .filter((m) => m.weight !== undefined && m.weight > 0)
      .map((m) => ({ id: m._id, date: m.date, weightKg: m.weight!, source: (m.source ?? "manual") as Provenance })),
    plannedPerWeek: weekdays > 0 ? weekdays : undefined,
    estimatedMaxHeartRate: estimatedMaxHeartRate(ageFromDateOfBirth(user?.dateOfBirth, nowMs)),
    age: ageFromDateOfBirth(user?.dateOfBirth, nowMs),
    timeZone: user?.timeZone,
  };
}
