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
 * Readiness and wearable data are not queried at all — there is no
 * readiness or wearable table in the schema yet (see
 * packages/readiness, packages/wearable). The context says so
 * explicitly, so the model can honestly tell the user it doesn't have
 * that data yet rather than silently having nothing to say about it.
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

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentWorkouts = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("completedAt", weekAgo))
      .collect();
    lines.push(`Workouts logged this week: ${recentWorkouts.length}`);

    const allLogs = await ctx.db
      .query("workoutLogs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    lines.push(`Total workouts logged: ${allLogs.length}`);

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

    lines.push("Readiness/recovery data: not available yet (no wearable connected or readiness history).");
    lines.push("Wearable data: not available yet (no Sombrey band connected).");

    return lines.join("\n");
  },
});
