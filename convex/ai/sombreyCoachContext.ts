// V8 runtime — queries only (no "use node")
import { internalQuery } from "../_generated/server";
import { ConvexError } from "convex/values";

/**
 * Fitness context for the Sombrey Coach — isolated from
 * ai/coachHelpers.ts::getFitnessContext on purpose.
 *
 * Reuses the same underlying tables/indexes (workoutLogs, nutritionLogs,
 * measurements) since those are real, existing, per-user data — this is
 * "using existing infrastructure," not a new capability. What it
 * deliberately does NOT pull in:
 *
 *  - assignedPrograms (a human coach assigning a program to a client —
 *    Sombrey has no human/online coaching; that concept must never
 *    reach the model's context).
 *  - aiGeneratedPlans (the legacy AI-plan feature's own shape —
 *    workoutSplit/macroTargets fields that belong to a different
 *    product surface than Sombrey's Train/Home).
 *  - any premium/subscription gate (hasPremiumAccess is entangled with
 *    legacy coaching tiers; Sombrey's own entitlement backend doesn't
 *    exist yet — see subscriptionService.ts — so gating on the legacy
 *    one would incorrectly block every Sombrey test account).
 *
 * Phase 3 training-architecture expansion: now also pulls real wearable
 * measurements, sleep, Sport+ activity sessions, Sombrey-native workout
 * sessions, and the user's active goal/coaching mode — all real, existing
 * tables as of this phase. Every line here is either a real number or an
 * explicit "not available yet" — never a guess.
 */
export const getSombreyContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const lines: string[] = [`Name: ${user.name ?? "there"}`];
    const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    lines.push(`Coaching mode: ${user.coachingMode ?? "recommendations"} (${describeCoachingMode(user.coachingMode)})`);

    const activeGoal = await ctx.db
      .query("clientGoals")
      .withIndex("by_user_and_active", (q) => q.eq("userId", user._id).eq("isActive", true))
      .first();
    lines.push(
      activeGoal
        ? `Active goal: ${activeGoal.primaryGoal}${activeGoal.category ? ` (category: ${activeGoal.category})` : ""}${activeGoal.secondaryCategory ? `, secondary: ${activeGoal.secondaryCategory}` : ""}`
        : "Active goal: none set yet",
    );

    // ── Sombrey-native training sessions ──────────────────────────────────
    const recentWorkouts = await ctx.db
      .query("sombreyWorkouts")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", weekAgoMs))
      .collect();
    const completedRecent = recentWorkouts.filter((w) => w.completedAt !== undefined);
    lines.push(`Sombrey training sessions this week: ${completedRecent.length}`);

    const allWorkouts = await ctx.db
      .query("sombreyWorkouts")
      .withIndex("by_user_and_completedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .filter((q) => q.neq(q.field("completedAt"), undefined))
      .take(5);
    if (allWorkouts.length > 0) {
      const summary = allWorkouts
        .map((w) => `${w.name} (${w.source})`)
        .join(", ");
      lines.push(`Most recent training sessions: ${summary}`);
    } else {
      lines.push("Training session history: none logged yet");
    }

    // Legacy coach-assigned workout logs — still real data where present.
    const legacyWorkoutsThisWeek = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("completedAt", weekAgoMs))
      .collect();
    if (legacyWorkoutsThisWeek.length > 0) {
      lines.push(`Coach-assigned workouts logged this week: ${legacyWorkoutsThisWeek.length}`);
    }

    // ── Sport+ activity sessions ───────────────────────────────────────────
    const recentSportSessions = await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", weekAgoMs))
      .collect();
    if (recentSportSessions.length > 0) {
      const totalDistance = recentSportSessions.reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0);
      const totalCalories = recentSportSessions.reduce((sum, s) => sum + (s.calories ?? 0), 0);
      lines.push(
        `Wearable-tracked activity sessions this week: ${recentSportSessions.length}` +
        (totalDistance > 0 ? `, ${(totalDistance / 1000).toFixed(1)}km total distance` : "") +
        (totalCalories > 0 ? `, ~${Math.round(totalCalories)} kcal` : ""),
      );
    } else {
      lines.push("Wearable-tracked activity sessions this week: none");
    }

    // ── Nutrition ───────────────────────────────────────────────────────────
    const todayNow = new Date();
    const todayUTCMs = Date.UTC(todayNow.getUTCFullYear(), todayNow.getUTCMonth(), todayNow.getUTCDate());
    const nutritionLog = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", todayUTCMs))
      .unique();
    lines.push(
      nutritionLog
        ? `Today's logged intake: ${Math.round(nutritionLog.totalCalories)} kcal, ${Math.round(nutritionLog.totalProtein)}g protein`
        : "Today's nutrition: nothing logged yet today",
    );

    // ── Body measurements ────────────────────────────────────────────────
    const latestMeasurement = await ctx.db
      .query("measurements")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    lines.push(
      latestMeasurement?.weight
        ? `Most recent logged weight: ${latestMeasurement.weight}kg`
        : "No body measurements logged yet",
    );

    // ── Wearable: sleep ─────────────────────────────────────────────────────
    const recentSleep = await ctx.db
      .query("wearableSleepSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (recentSleep) {
      const hours = (recentSleep.totalSleepMinutes / 60).toFixed(1);
      lines.push(`Most recent sleep session: ${hours}h total sleep`);
    } else {
      lines.push("Sleep data: not available yet (no Sombrey band connected or no sleep synced)");
    }

    // ── Wearable: recent vitals ────────────────────────────────────────────
    const recentMeasurements = await ctx.db
      .query("wearableMeasurements")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    if (recentMeasurements.length > 0) {
      const latestByMetric = new Map<string, number>();
      for (const m of recentMeasurements) {
        if (!latestByMetric.has(m.metricType)) latestByMetric.set(m.metricType, m.value);
      }
      const restingHr = recentMeasurements
        .filter((m) => m.metricType === "heart_rate")
        .slice(0, 20)
        .reduce((min, m) => Math.min(min, m.value), Infinity);
      const parts: string[] = [];
      if (Number.isFinite(restingHr)) parts.push(`recent low heart rate ~${Math.round(restingHr)}bpm`);
      if (latestByMetric.has("spo2")) parts.push(`SpO2 ${latestByMetric.get("spo2")}%`);
      if (latestByMetric.has("skin_temperature")) parts.push(`skin temp ${latestByMetric.get("skin_temperature")}°C`);
      if (latestByMetric.has("blood_pressure_systolic") && latestByMetric.has("blood_pressure_diastolic")) {
        parts.push(`blood pressure ~${latestByMetric.get("blood_pressure_systolic")}/${latestByMetric.get("blood_pressure_diastolic")}`);
      }
      lines.push(parts.length > 0 ? `Recent wearable vitals: ${parts.join(", ")}` : "Wearable vitals: synced but no recognizable recent readings");
    } else {
      lines.push("Wearable vitals: not available yet (no Sombrey band connected)");
    }

    lines.push(
      "Readiness/recovery score: not available yet — Sombrey has no computed readiness algorithm live yet, even though wearable data above may be present. Do not compute or estimate one yourself.",
    );

    return lines.join("\n");
  },
});

function describeCoachingMode(mode: string | undefined): string {
  switch (mode) {
    case "full_control":
      return "the user has given the AI full control to create/adjust training and nutrition recommendations directly";
    case "tracking_only":
      return "the user wants tracking/analysis only — do not proactively suggest training or nutrition changes unless asked";
    case "recommendations":
    default:
      return "the user keeps control of their own program — offer recommendations, never assume they should be applied";
  }
}
