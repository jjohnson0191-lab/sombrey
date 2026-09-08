import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { hasRole } from "../lib/roles.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";

async function requireCoach(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user || !hasRole(user, "coach", "admin", "owner"))
    throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
  return user;
}

async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

// ─── Coach: assign a step goal to a client ────────────────────────────────
export const scheduleStepGoal = mutation({
  args: {
    clientId: v.id("users"),
    scheduledDate: v.string(),
    targetSteps: v.number(),
    targetCompletionDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    return await ctx.db.insert("scheduledStepGoals", {
      coachId: coach._id,
      clientId: args.clientId,
      scheduledDate: args.scheduledDate,
      scheduledAt: new Date().toISOString(),
      targetSteps: args.targetSteps,
      targetCompletionDate: args.targetCompletionDate,
      notes: args.notes,
      status: "scheduled",
    });
  },
});

// ─── Coach: update a step goal ────────────────────────────────────────────
export const updateStepGoal = mutation({
  args: {
    id: v.id("scheduledStepGoals"),
    scheduledDate: v.optional(v.string()),
    targetSteps: v.optional(v.number()),
    targetCompletionDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("skipped"),
    )),
  },
  handler: async (ctx, args) => {
    await requireCoach(ctx);
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

// ─── Coach: delete a step goal ────────────────────────────────────────────
export const deleteStepGoal = mutation({
  args: { id: v.id("scheduledStepGoals") },
  handler: async (ctx, args) => {
    await requireCoach(ctx);
    await ctx.db.delete(args.id);
  },
});

// ─── Coach: get step goals for a date range ───────────────────────────────
export const getCoachStepGoalCalendar = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    clientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);

    let rows = await ctx.db
      .query("scheduledStepGoals")
      .withIndex("by_coach", (q) => q.eq("coachId", coach._id))
      .collect();

    rows = rows.filter(
      (r) => r.scheduledDate >= args.startDate && r.scheduledDate <= args.endDate,
    );

    if (args.clientId) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const client = await ctx.db.get(row.clientId);
        const log = await ctx.db
          .query("stepLogs")
          .withIndex("by_scheduled", (q) => q.eq("scheduledStepGoalId", row._id))
          .first();
        return {
          ...row,
          clientName: client?.name ?? "Unknown",
          stepLog: log ?? null,
          completionPct: log
            ? Math.min(100, Math.round((log.actualSteps / row.targetSteps) * 100))
            : null,
        };
      }),
    );

    return enriched;
  },
});

// ─── Client: get own step goal calendar ───────────────────────────────────
export const getClientStepGoalCalendar = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const rows = await ctx.db
      .query("scheduledStepGoals")
      .withIndex("by_client", (q) => q.eq("clientId", user._id))
      .collect();

    const filtered = rows.filter(
      (r) => r.scheduledDate >= args.startDate && r.scheduledDate <= args.endDate,
    );

    const enriched = await Promise.all(
      filtered.map(async (row) => {
        const log = await ctx.db
          .query("stepLogs")
          .withIndex("by_scheduled", (q) => q.eq("scheduledStepGoalId", row._id))
          .first();
        return {
          ...row,
          stepLog: log ?? null,
          completionPct: log
            ? Math.min(100, Math.round((log.actualSteps / row.targetSteps) * 100))
            : null,
        };
      }),
    );

    return enriched;
  },
});

// ─── Client: log actual steps ─────────────────────────────────────────────
export const logSteps = mutation({
  args: {
    scheduledStepGoalId: v.id("scheduledStepGoals"),
    actualSteps: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const scheduled = await ctx.db.get(args.scheduledStepGoalId);
    if (!scheduled || scheduled.clientId !== user._id)
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your step goal" });

    // Remove existing log for idempotency
    const existing = await ctx.db
      .query("stepLogs")
      .withIndex("by_scheduled", (q) => q.eq("scheduledStepGoalId", args.scheduledStepGoalId))
      .first();
    if (existing) await ctx.db.delete(existing._id);

    const logId = await ctx.db.insert("stepLogs", {
      userId: user._id,
      scheduledStepGoalId: args.scheduledStepGoalId,
      loggedDate: scheduled.scheduledDate,
      loggedAt: Date.now(),
      actualSteps: args.actualSteps,
      notes: args.notes,
    });

    // Auto-complete if step goal met
    const completed = args.actualSteps >= scheduled.targetSteps;
    await ctx.db.patch(args.scheduledStepGoalId, {
      status: completed ? "completed" : "scheduled",
      completedAt: completed ? Date.now() : undefined,
    });

    return logId;
  },
});

// ─── Analytics: step goal history for a user ──────────────────────────────
export const getStepAnalytics = query({
  args: {
    userId: v.optional(v.id("users")),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuth(ctx);
    const targetUserId = args.userId ?? caller._id;

    if (targetUserId !== caller._id && !hasRole(caller, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    const logs = await ctx.db
      .query("stepLogs")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", targetUserId).gte("loggedDate", args.startDate)
      )
      .collect();

    const filtered = logs.filter((l) => l.loggedDate <= args.endDate);

    const goals = await ctx.db
      .query("scheduledStepGoals")
      .withIndex("by_client", (q) => q.eq("clientId", targetUserId))
      .collect();

    const filteredGoals = goals.filter(
      (g) => g.scheduledDate >= args.startDate && g.scheduledDate <= args.endDate,
    );

    const totalSteps = filtered.reduce((s, l) => s + l.actualSteps, 0);
    const avgDailySteps = filtered.length > 0 ? Math.round(totalSteps / filtered.length) : 0;
    const goalsCompleted = filteredGoals.filter((g) => g.status === "completed").length;
    const totalGoals = filteredGoals.length;
    const adherencePct = totalGoals > 0 ? Math.round((goalsCompleted / totalGoals) * 100) : 0;

    return { totalSteps, avgDailySteps, goalsCompleted, totalGoals, adherencePct, logs: filtered };
  },
});
