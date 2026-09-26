// V8 runtime — queries only (no "use node")
import { internalQuery } from "../_generated/server";
import { ConvexError } from "convex/values";
import { labelledRecord, sessionRecord } from "../activities";
import { describeActivitiesForCoach } from "../activityCoach";
import { describeExerciseForCoach } from "../exerciseNormalization";
import { coachIntelligenceLines } from "../intelligenceData";

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
 *
 * Nutrition/notification-awareness expansion: adds nutrition adherence
 * (today's intake vs. target, and this week's logging consistency — a
 * pattern, not a single day), meal/workout schedule presence, and the
 * real computed readiness score (previously always "not available yet"
 * here even after the readiness engine shipped — now fixed). Nutrition
 * is deliberately NOT part of the numeric Readiness Score itself (see
 * readiness/scoring.ts) — it's surfaced here as context for the model's
 * own qualitative reasoning, which is the right tool for a genuinely
 * context-dependent relationship a rigid formula would either ignore or
 * overweight.
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

    // Exercises actually trained in the last 14 days, described in Sombrey's
    // own exercise terms (convex/exerciseNormalization.ts) — never the
    // exercise-data provider's.
    const recentSets = await ctx.db
      .query("sombreyWorkoutSets")
      .withIndex("by_user_and_completedAt", (q) => q.eq("userId", user._id).gte("completedAt", Date.now() - 14 * 24 * 60 * 60 * 1000))
      .take(500);
    if (recentSets.length > 0) {
      const byExercise = new Map<string, typeof recentSets>();
      for (const set of recentSets) byExercise.set(set.exerciseId, [...(byExercise.get(set.exerciseId) ?? []), set]);
      lines.push("Exercises trained in the last 14 days:");
      for (const [exerciseId, sets] of [...byExercise.entries()].slice(0, 12)) {
        const exercise = await ctx.db.get(sets[0].exerciseId);
        const name = exercise?.name ?? sets[0].exerciseName ?? "Exercise";
        const best = sets.reduce((a, b) => ((b.weightKg ?? 0) > (a.weightKg ?? 0) || ((b.weightKg ?? 0) === (a.weightKg ?? 0) && b.reps > a.reps) ? b : a));
        const described = exercise
          ? describeExerciseForCoach({
            name, primaryMuscles: exercise.primaryMuscles, secondaryMuscles: exercise.secondaryMuscles,
            equipment: exercise.equipment, difficulty: exercise.difficulty, mechanic: exercise.mechanic,
          })
          : name;
        const bestText = best.weightKg ? `best ${best.weightKg} kg × ${best.reps}` : `best ${best.reps} reps (bodyweight)`;
        void exerciseId;
        lines.push(`- ${described} — ${sets.length} set${sets.length === 1 ? "" : "s"}, ${bestText} [user-logged]`);
      }
    }

    // Legacy coach-assigned workout logs — still real data where present.
    const legacyWorkoutsThisWeek = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("completedAt", weekAgoMs))
      .collect();
    if (legacyWorkoutsThisWeek.length > 0) {
      lines.push(`Coach-assigned workouts logged this week: ${legacyWorkoutsThisWeek.length}`);
    }

    // ── Physical activities (band Sport+ sessions and named detections) ──
    // One line per activity with its provenance (convex/activityCoach.ts),
    // so the coach knows "tennis for 90 minutes yesterday", not "1 workout".
    const recentSportSessions = await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", weekAgoMs))
      .collect();
    const recentLabels = await ctx.db
      .query("activityLabels")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", weekAgoMs))
      .collect();
    const recentActivities = [
      ...recentSportSessions.map(sessionRecord),
      ...recentLabels.map(labelledRecord),
    ].filter((r): r is NonNullable<typeof r> => r !== null);
    lines.push(...describeActivitiesForCoach(recentActivities, Date.now()));

    // ── Sombrey intelligence: structured context (convex/strain/context.ts)
    // Days in the user's own time zone (reported by the app); load with its
    // basis and confidence; no strain number (not validated); weather as
    // context only; recovery patterns in "tended to" language.
    lines.push(...(await coachIntelligenceLines(ctx, user, Date.now())));

    // ── Nutrition ───────────────────────────────────────────────────────────
    // Nutrition-as-context expansion. Targets resolve the same way
    // nutritionLogs.ts's getTodayProgress already does (the user's own
    // Nutrition screen) — reusing that resolution, not the excluded
    // legacy "workoutSplit" concept aiGeneratedPlans also carries; only
    // its macroTargets field is touched here.
    const todayNow = new Date();
    const todayUTCMs = Date.UTC(todayNow.getUTCFullYear(), todayNow.getUTCMonth(), todayNow.getUTCDate());
    const nutritionLog = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", todayUTCMs))
      .unique();
    const aiPlan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    const macroTargets = aiPlan?.status === "ready" ? aiPlan.macroTargets : null;
    const caloriesTarget = macroTargets?.calories ?? 2500;
    const proteinTarget = macroTargets?.protein ?? 180;
    if (nutritionLog) {
      const caloriesPct = Math.round((nutritionLog.totalCalories / caloriesTarget) * 100);
      const proteinPct = Math.round((nutritionLog.totalProtein / proteinTarget) * 100);
      lines.push(
        `Today's logged intake: ${Math.round(nutritionLog.totalCalories)} kcal (${caloriesPct}% of target), ${Math.round(nutritionLog.totalProtein)}g protein (${proteinPct}% of target)`,
      );
    } else {
      lines.push("Today's nutrition: nothing logged yet today");
    }

    // Logging consistency this week — a single missed day/meal is not
    // itself meaningful; the pattern across the week is what the AI
    // should actually reason about (see this file's own header note on
    // not overreacting to isolated events).
    const weekAgoUTCMs = Date.UTC(todayNow.getUTCFullYear(), todayNow.getUTCMonth(), todayNow.getUTCDate() - 6);
    const nutritionLogsThisWeek = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("date", weekAgoUTCMs))
      .collect();
    const daysWithCaloriesBelowHalfTarget = nutritionLogsThisWeek.filter((l) => l.totalCalories < caloriesTarget * 0.5).length;
    lines.push(
      `Nutrition logged on ${nutritionLogsThisWeek.length} of the last 7 days` +
      (daysWithCaloriesBelowHalfTarget >= 3 ? ` (${daysWithCaloriesBelowHalfTarget} of those days were well below calorie target — a real pattern, not an isolated event)` : ""),
    );

    // ── Meal / workout schedule ──────────────────────────────────────────
    const mealScheduleCount = (await ctx.db.query("mealSchedules").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).length;
    const workoutScheduleCount = (await ctx.db.query("workoutSchedules").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).length;
    lines.push(
      mealScheduleCount > 0 ? `User has a configured meal schedule (${mealScheduleCount} slot(s) across the week)` : "User has not configured a meal schedule",
    );
    lines.push(
      workoutScheduleCount > 0 ? `User has a configured training schedule (${workoutScheduleCount} session(s) across the week)` : "User has not configured a training schedule",
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

    // ── Readiness ───────────────────────────────────────────────────────────
    const latestReadiness = await ctx.db
      .query("readinessScores")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (latestReadiness?.score !== undefined) {
      const confidencePct = Math.round(latestReadiness.confidence * 100);
      const factors = latestReadiness.components
        .filter((c) => c.subScore !== undefined)
        .sort((a, b) => b.weight - a.weight)
        .map((c) => c.description)
        .join("; ");
      lines.push(
        `Readiness score (${latestReadiness.date}): ${latestReadiness.score}/100, confidence ${confidencePct}%` +
        (factors ? ` — ${factors}` : ""),
      );
    } else {
      lines.push(
        "Readiness score: not enough wearable data yet to compute one. Do not estimate or guess a number in its place.",
      );
    }

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
