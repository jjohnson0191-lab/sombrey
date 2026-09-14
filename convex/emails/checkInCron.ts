import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Processes check-in reminders for all active premium users.
 * Runs in the V8 runtime (not node) so it can use ctx.db.
 *
 * Logic:
 * - Find all users with an active aiGeneratedPlan (status="ready", currentWeek<=12)
 * - For each, check if the current week's check-in has been submitted
 * - If not submitted and it's been 7+ days since plan start (or last check-in):
 *   - If 0–24h overdue → send reminder
 *   - If 24h+ overdue → send missed check-in notice
 * - Rate-limit: only send one reminder email per user per calendar day
 */
export const processReminders = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    // Get all active AI plans
    const activePlans = await ctx.db
      .query("aiGeneratedPlans")
      .filter((q) => q.eq(q.field("status"), "ready"))
      .collect();

    for (const plan of activePlans) {
      const user = await ctx.db.get(plan.userId);
      if (!user || !user.email) continue;
      // Only premium/coaching_client users
      if (user.subscriptionTier === "free") continue;
      if (user.disabled) continue;

      const currentWeek = plan.currentWeek ?? 1;
      if (currentWeek > 12) continue;

      // Check if user already has a check-in for the current week (non-initial)
      const existingCheckIn = await ctx.db
        .query("weeklyCheckIns")
        .withIndex("by_user", (q) => q.eq("userId", plan.userId))
        .filter((q) =>
          q.and(
            q.eq(q.field("weekNumber"), currentWeek),
            q.neq(q.field("isInitialCheckIn"), true),
          ),
        )
        .first();

      if (existingCheckIn) continue; // Already done this week

      // Rate-limit: check if we sent a reminder today already
      const sentToday = await ctx.db
        .query("emailRateLimits")
        .withIndex("by_user_and_date", (q) =>
          q.eq("userId", plan.userId).eq("date", todayStr),
        )
        .filter((q) => q.eq(q.field("emailType"), "check_in_reminder"))
        .first();

      if (sentToday) continue;

      // Determine if overdue: plan start + (currentWeek - 1) * 7 days
      const planStartMs = plan.startDate
        ? new Date(plan.startDate).getTime()
        : 0;
      const weekDueMs = planStartMs + (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000;
      const nowMs = now.getTime();
      const overdueMs = nowMs - weekDueMs;

      // Only send if check-in window has opened (>=0ms past due date)
      if (overdueMs < 0) continue;

      const overdueHours = overdueMs / (1000 * 60 * 60);

      // Record rate limit entry
      await ctx.db.insert("emailRateLimits", {
        userId: plan.userId,
        emailType: "check_in_reminder",
        date: todayStr,
        sentAt: now.toISOString(),
      });

      const dueDate = new Date(weekDueMs).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });

      if (overdueHours < 24) {
        // Due today — send reminder
        await ctx.scheduler.runAfter(0, internal.emails.transactional.sendCheckInReminderEmail, {
          toEmail: user.email,
          name: user.name ?? "Athlete",
          weekNumber: currentWeek,
          dueDate,
        });
      } else {
        // Overdue — send missed check-in notice
        await ctx.scheduler.runAfter(0, internal.emails.transactional.sendMissedCheckInEmail, {
          toEmail: user.email,
          name: user.name ?? "Athlete",
          weekNumber: currentWeek,
        });
      }
    }
  },
});
