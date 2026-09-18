// V8 runtime — queries only (no "use node")
import { internalQuery } from "../_generated/server";
import { ConvexError } from "convex/values";
import { hasPremiumAccess } from "../lib/roles.js";

export const getFitnessContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    // Subscription gate — coaches/admins/owners always pass; clients need premium
    if (!hasPremiumAccess(user)) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Premium subscription required to use AI Coach" });
    }

    const lines: string[] = [
      `Name: ${user.name ?? "Unknown"}`,
      `Subscription tier: ${user.subscriptionTier}`,
    ];

    // Active program
    const activeAssignment = await ctx.db
      .query("assignedPrograms")
      .withIndex("by_user_and_status", (q) => q.eq("userId", user._id).eq("status", "active"))
      .first();

    if (activeAssignment) {
      const program = await ctx.db.get(activeAssignment.programId);
      if (program) {
        lines.push(`Active program: ${program.name} (${program.phase.replace(/_/g, " ")}, ${program.durationWeeks} weeks)`);
        lines.push(`Program progress: Week ${activeAssignment.currentWeek}/${program.durationWeeks}, Day ${activeAssignment.currentDay}`);
      }
    } else {
      lines.push("Active program: None assigned");
    }

    // Recent workouts (last 7 days)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentWorkouts = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("completedAt", weekAgo))
      .collect();
    lines.push(`Workouts this week: ${recentWorkouts.length}`);

    // Total workouts
    const allLogs = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    lines.push(`Total workouts logged: ${allLogs.length}`);

    // Today's nutrition — use UTC midnight to match how nutritionLogs stores dates
    const todayNow = new Date();
    const todayUTCMs = Date.UTC(todayNow.getUTCFullYear(), todayNow.getUTCMonth(), todayNow.getUTCDate());
    const nutritionLog = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).eq("date", todayUTCMs)
      )
      .unique();

    if (nutritionLog) {
      lines.push(`Today's intake: ${Math.round(nutritionLog.totalCalories)} kcal, ${Math.round(nutritionLog.totalProtein)}g protein, ${Math.round(nutritionLog.totalCarbs)}g carbs, ${Math.round(nutritionLog.totalFats)}g fats`);
    } else {
      lines.push("Today's nutrition: No foods logged yet today");
    }

    // Active meal plan targets
    const activePlan = await ctx.db
      .query("mealPlans")
      .withIndex("by_user_and_active", (q) => q.eq("userId", user._id).eq("isActive", true))
      .first();

    if (activePlan) {
      lines.push(`Nutrition targets: ${activePlan.targetCalories} kcal, ${activePlan.targetProtein}g protein, ${activePlan.targetCarbs}g carbs, ${activePlan.targetFats}g fats`);
    }

    // Latest measurements
    const latestMeasurement = await ctx.db
      .query("measurements")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (latestMeasurement) {
      const parts: string[] = [];
      if (latestMeasurement.weight) parts.push(`${latestMeasurement.weight}kg`);
      if (latestMeasurement.bodyFat) parts.push(`${latestMeasurement.bodyFat}% body fat`);
      if (parts.length > 0) lines.push(`Latest measurements: ${parts.join(", ")}`);
    }

    // AI-generated plan context
    const aiPlan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (aiPlan && aiPlan.status === "ready") {
      lines.push(`\nAI-Generated Plan:`);
      lines.push(`Goal: ${aiPlan.primaryGoal.replace(/_/g, " ")}`);
      lines.push(`Workout split: ${aiPlan.workoutSplit}`);
      lines.push(`Macro targets: ${aiPlan.macroTargets.calories} kcal, ${aiPlan.macroTargets.protein}g protein, ${aiPlan.macroTargets.carbs}g carbs, ${aiPlan.macroTargets.fats}g fats`);
      if (aiPlan.workoutDays.length > 0) {
        lines.push(`Training days: ${aiPlan.workoutDays.map((d) => d.dayName).join(", ")}`);
        // Include today's workout if available
        const todayName = new Date().toLocaleDateString("en", { weekday: "long" });
        const todaySchedule = aiPlan.weeklySchedule.find((s) => s.day.toLowerCase().startsWith(todayName.toLowerCase().slice(0, 3)));
        if (todaySchedule) {
          lines.push(`Today (${todaySchedule.day}): ${todaySchedule.type}${todaySchedule.focus ? ` - ${todaySchedule.focus}` : ""}`);
          const todayWorkout = aiPlan.workoutDays.find((w) => w.dayName.toLowerCase().includes(todaySchedule.type.toLowerCase().slice(0, 4)));
          if (todayWorkout) {
            lines.push(`Today's exercises: ${todayWorkout.exercises.map((e) => `${e.name} (${e.sets}x${e.reps})`).join(", ")}`);
          }
        }
      }
      if (aiPlan.meals.length > 0) {
        lines.push(`Meal plan: ${aiPlan.meals.map((m) => m.name).join(", ")}`);
      }
    }

    return lines.join("\n");
  },
});
