/**
 * Progress Analytics queries
 * Aggregates check-in history, workout history, AI workout logs, and measurements
 * into a single comprehensive data object for the analytics page.
 */

import { ConvexError, v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel.d.ts";

// ─── Helper ──────────────────────────────────────────────────────────────────

async function resolveUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

// ─── Main analytics query (for the authenticated user) ───────────────────────

export const getMyAnalytics = query({
  args: {},
  handler: async (ctx): Promise<AnalyticsData | null> => {
    const user = await resolveUser(ctx);
    if (!user) return null;
    return buildAnalytics(ctx, user._id);
  },
});

/** Coach calls this to view a specific client's analytics */
export const getClientAnalytics = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args): Promise<AnalyticsData | null> => {
    const me = await resolveUser(ctx);
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    // Only coaches, admins, owners can view client analytics
    const myRoles: string[] = (me.roles ?? (me.role ? [me.role] : []));
    const allowed = ["coach", "assistant_coach", "admin", "owner"];
    if (!allowed.some((r) => myRoles.includes(r))) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
    }
    return buildAnalytics(ctx, args.clientId);
  },
});

// ─── Internal version (called from other queries if needed) ──────────────────

export const getAnalyticsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<AnalyticsData | null> => {
    return buildAnalytics(ctx, args.userId);
  },
});

// ─── Core builder ────────────────────────────────────────────────────────────

export type CheckInPoint = {
  weekNumber: number;
  checkInDate: string;
  weightKg: number;
  estimatedBodyFatPct: number | null;
  frontPhotoUrl: string | null;
  isInitialCheckIn: boolean;
};

export type WorkoutPoint = {
  completedAt: string; // ISO 8601
  workoutDayName: string;
  weekNumber: number;
  durationSeconds: number | null;
};

export type AnalyticsData = {
  // Summary
  startingWeightKg: number | null;
  currentWeightKg: number | null;
  totalWeightChange: number | null;
  startingBodyFatPct: number | null;
  currentBodyFatPct: number | null;
  totalBodyFatChange: number | null;
  totalWorkoutsCompleted: number;
  totalCheckIns: number;
  currentPlanWeek: number | null;
  totalPlanWeeks: number;
  // Time-series
  checkInSeries: CheckInPoint[];
  workoutSeries: WorkoutPoint[];
  // Weekly adherence — workouts per ISO week string
  weeklyWorkoutCounts: { week: string; count: number }[];
  // Photo comparison trio
  photoComparison: {
    start: { url: string | null; date: string; weightKg: number | null; bodyFatPct: number | null } | null;
    previous: { url: string | null; date: string; weightKg: number | null; bodyFatPct: number | null } | null;
    latest: { url: string | null; date: string; weightKg: number | null; bodyFatPct: number | null } | null;
  };
  // Plan info
  planGoal: string | null;
  planStartDate: string | null;
  // This week counts
  workoutsThisWeek: number;
  checkInsTotal: number;
};

async function buildAnalytics(ctx: QueryCtx, userId: Id<"users">): Promise<AnalyticsData> {
  // ── Fetch all check-ins ────────────────────────────────────────────────────
  const checkIns = await ctx.db
    .query("weeklyCheckIns")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("asc")
    .collect();

  // ── Fetch AI plan ──────────────────────────────────────────────────────────
  const plan = await ctx.db
    .query("aiGeneratedPlans")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .first();

  // ── Fetch AI workout logs ──────────────────────────────────────────────────
  const aiWorkoutLogs = plan
    ? await ctx.db
        .query("aiWorkoutLogs")
        .withIndex("by_plan", (q) => q.eq("planId", plan._id))
        .order("asc")
        .collect()
    : [];

  // ── Fetch program-based workout logs ───────────────────────────────────────
  const programLogs = await ctx.db
    .query("workoutLogs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("asc")
    .collect();

  // ── Derive current plan week ───────────────────────────────────────────────
  let currentPlanWeek: number | null = null;
  if (plan?.startDate) {
    const now = new Date();
    const start = new Date(plan.startDate);
    currentPlanWeek = Math.min(12, Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))));
  }

  // ── Build check-in series ──────────────────────────────────────────────────
  const checkInSeries: CheckInPoint[] = await Promise.all(
    checkIns.map(async (ci) => ({
      weekNumber: ci.weekNumber,
      checkInDate: ci.checkInDate,
      weightKg: ci.weightKg,
      estimatedBodyFatPct: ci.estimatedBodyFatPct ?? null,
      frontPhotoUrl: ci.frontPhotoStorageId
        ? await ctx.storage.getUrl(ci.frontPhotoStorageId)
        : null,
      isInitialCheckIn: ci.isInitialCheckIn === true,
    }))
  );

  // ── Build workout series (AI logs + program logs) ──────────────────────────
  const workoutSeries: WorkoutPoint[] = [
    ...aiWorkoutLogs.map((l) => ({
      completedAt: l.completedAt,
      workoutDayName: l.workoutDayName,
      weekNumber: l.weekNumber,
      durationSeconds: l.durationSeconds ?? null,
    })),
    ...programLogs.map((l) => ({
      completedAt: new Date(l.completedAt).toISOString(),
      workoutDayName: "Workout",
      weekNumber: 0,
      durationSeconds: l.duration ?? null,
    })),
  ].sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  // ── Weekly workout counts ──────────────────────────────────────────────────
  const weekCounts: Record<string, number> = {};
  for (const w of workoutSeries) {
    const d = new Date(w.completedAt);
    // ISO week: Monday-based
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    weekCounts[key] = (weekCounts[key] ?? 0) + 1;
  }
  const weeklyWorkoutCounts = Object.entries(weekCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }));

  // ── Workouts this week ─────────────────────────────────────────────────────
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const weekStart = monday.toISOString().slice(0, 10);
  const workoutsThisWeek = workoutSeries.filter((w) => w.completedAt.slice(0, 10) >= weekStart).length;

  // ── Summary stats ──────────────────────────────────────────────────────────
  const initialCheckIn = checkIns.find((c) => c.isInitialCheckIn === true) ?? checkIns[0] ?? null;
  const latestCheckIn = checkIns.length > 0 ? checkIns[checkIns.length - 1] : null;

  const startingWeightKg = initialCheckIn?.weightKg ?? null;
  const currentWeightKg = latestCheckIn?.weightKg ?? null;
  const totalWeightChange = startingWeightKg !== null && currentWeightKg !== null
    ? Math.round((currentWeightKg - startingWeightKg) * 10) / 10
    : null;

  const startingBodyFatPct = initialCheckIn?.estimatedBodyFatPct ?? null;
  const currentBodyFatPct = latestCheckIn?.estimatedBodyFatPct ?? null;
  const totalBodyFatChange = startingBodyFatPct !== null && currentBodyFatPct !== null
    ? Math.round((currentBodyFatPct - startingBodyFatPct) * 10) / 10
    : null;

  // ── Photo comparison ───────────────────────────────────────────────────────
  const nonInitialCheckIns = checkIns.filter((c) => !c.isInitialCheckIn);
  const startCi = checkIns.find((c) => c.isInitialCheckIn === true) ?? (checkIns.length > 0 ? checkIns[0] : null);
  const previousCi = nonInitialCheckIns.length >= 2 ? nonInitialCheckIns[nonInitialCheckIns.length - 2] : null;
  const latestCi = nonInitialCheckIns.length > 0 ? nonInitialCheckIns[nonInitialCheckIns.length - 1] : null;

  const toPhotoEntry = async (ci: typeof checkIns[number] | null) => {
    if (!ci) return null;
    return {
      url: ci.frontPhotoStorageId ? await ctx.storage.getUrl(ci.frontPhotoStorageId) : null,
      date: ci.checkInDate,
      weightKg: ci.weightKg,
      bodyFatPct: ci.estimatedBodyFatPct ?? null,
    };
  };

  const [startPhoto, previousPhoto, latestPhoto] = await Promise.all([
    toPhotoEntry(startCi),
    toPhotoEntry(previousCi),
    toPhotoEntry(latestCi),
  ]);

  return {
    startingWeightKg,
    currentWeightKg,
    totalWeightChange,
    startingBodyFatPct,
    currentBodyFatPct,
    totalBodyFatChange,
    totalWorkoutsCompleted: workoutSeries.length,
    totalCheckIns: nonInitialCheckIns.length,
    currentPlanWeek,
    totalPlanWeeks: 12,
    checkInSeries,
    workoutSeries,
    weeklyWorkoutCounts,
    photoComparison: { start: startPhoto, previous: previousPhoto, latest: latestPhoto },
    planGoal: plan?.primaryGoal ?? null,
    planStartDate: plan?.startDate ?? null,
    workoutsThisWeek,
    checkInsTotal: nonInitialCheckIns.length,
  };
}
