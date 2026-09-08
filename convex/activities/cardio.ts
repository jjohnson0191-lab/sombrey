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

// ─── Coach: schedule a cardio session for a client ────────────────────────
export const scheduleCardio = mutation({
  args: {
    clientId: v.id("users"),
    scheduledDate: v.string(),
    cardioType: v.string(),
    targetDurationMinutes: v.number(),
    targetDistanceKm: v.optional(v.number()),
    targetPace: v.optional(v.string()),
    targetSpeed: v.optional(v.number()),
    targetIncline: v.optional(v.number()),
    targetResistance: v.optional(v.number()),
    intensity: v.optional(v.union(
      v.literal("low"),
      v.literal("moderate"),
      v.literal("high"),
      v.literal("max"),
    )),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    return await ctx.db.insert("scheduledCardio", {
      coachId: coach._id,
      clientId: args.clientId,
      scheduledDate: args.scheduledDate,
      scheduledAt: new Date().toISOString(),
      cardioType: args.cardioType,
      targetDurationMinutes: args.targetDurationMinutes,
      targetDistanceKm: args.targetDistanceKm,
      targetPace: args.targetPace,
      targetSpeed: args.targetSpeed,
      targetIncline: args.targetIncline,
      targetResistance: args.targetResistance,
      intensity: args.intensity,
      notes: args.notes,
      status: "scheduled",
    });
  },
});

// ─── Coach: update a scheduled cardio session ────────────────────────────
export const updateScheduledCardio = mutation({
  args: {
    id: v.id("scheduledCardio"),
    scheduledDate: v.optional(v.string()),
    cardioType: v.optional(v.string()),
    targetDurationMinutes: v.optional(v.number()),
    targetDistanceKm: v.optional(v.number()),
    targetPace: v.optional(v.string()),
    targetSpeed: v.optional(v.number()),
    targetIncline: v.optional(v.number()),
    targetResistance: v.optional(v.number()),
    intensity: v.optional(v.union(
      v.literal("low"),
      v.literal("moderate"),
      v.literal("high"),
      v.literal("max"),
    )),
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

// ─── Coach: delete a scheduled cardio session ────────────────────────────
export const deleteScheduledCardio = mutation({
  args: { id: v.id("scheduledCardio") },
  handler: async (ctx, args) => {
    await requireCoach(ctx);
    await ctx.db.delete(args.id);
  },
});

// ─── Coach: get cardio sessions for a date range (optionally filtered by client) ──
export const getCoachCardioCalendar = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    clientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);

    let rows = await ctx.db
      .query("scheduledCardio")
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
          .query("cardioLogs")
          .withIndex("by_scheduled", (q) => q.eq("scheduledCardioId", row._id))
          .first();
        return {
          ...row,
          clientName: client?.name ?? "Unknown",
          cardioLog: log ?? null,
        };
      }),
    );

    return enriched;
  },
});

// ─── Client: get own cardio calendar ──────────────────────────────────────
export const getClientCardioCalendar = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const rows = await ctx.db
      .query("scheduledCardio")
      .withIndex("by_client", (q) => q.eq("clientId", user._id))
      .collect();

    const filtered = rows.filter(
      (r) => r.scheduledDate >= args.startDate && r.scheduledDate <= args.endDate,
    );

    const enriched = await Promise.all(
      filtered.map(async (row) => {
        const log = await ctx.db
          .query("cardioLogs")
          .withIndex("by_scheduled", (q) => q.eq("scheduledCardioId", row._id))
          .first();
        return { ...row, cardioLog: log ?? null };
      }),
    );

    return enriched;
  },
});

// ─── Client: log cardio performance ───────────────────────────────────────
export const logCardio = mutation({
  args: {
    scheduledCardioId: v.id("scheduledCardio"),
    actualDurationMinutes: v.number(),
    actualDistanceKm: v.optional(v.number()),
    actualPace: v.optional(v.string()),
    actualSpeed: v.optional(v.number()),
    caloriesBurned: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const scheduled = await ctx.db.get(args.scheduledCardioId);
    if (!scheduled || scheduled.clientId !== user._id)
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your cardio session" });

    // Remove existing log for idempotency
    const existing = await ctx.db
      .query("cardioLogs")
      .withIndex("by_scheduled", (q) => q.eq("scheduledCardioId", args.scheduledCardioId))
      .first();
    if (existing) await ctx.db.delete(existing._id);

    const logId = await ctx.db.insert("cardioLogs", {
      userId: user._id,
      scheduledCardioId: args.scheduledCardioId,
      loggedDate: scheduled.scheduledDate,
      loggedAt: Date.now(),
      actualDurationMinutes: args.actualDurationMinutes,
      actualDistanceKm: args.actualDistanceKm,
      actualPace: args.actualPace,
      actualSpeed: args.actualSpeed,
      caloriesBurned: args.caloriesBurned,
      notes: args.notes,
    });

    // Mark scheduled session as completed
    await ctx.db.patch(args.scheduledCardioId, { status: "completed", completedAt: Date.now() });

    return logId;
  },
});

// ─── Analytics: get cardio history for a user ─────────────────────────────
export const getCardioAnalytics = query({
  args: {
    userId: v.optional(v.id("users")), // coach passes clientId; client omits (self)
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuth(ctx);
    const targetUserId = args.userId ?? caller._id;

    // Permission: coaches/admins can query any userId; clients only self
    if (targetUserId !== caller._id && !hasRole(caller, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    const logs = await ctx.db
      .query("cardioLogs")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", targetUserId).gte("loggedDate", args.startDate)
      )
      .collect();

    const filtered = logs.filter((l) => l.loggedDate <= args.endDate);

    const totalSessions = filtered.length;
    const totalMinutes = filtered.reduce((s, l) => s + l.actualDurationMinutes, 0);
    const totalDistanceKm = filtered.reduce((s, l) => s + (l.actualDistanceKm ?? 0), 0);

    return { totalSessions, totalMinutes, totalDistanceKm, logs: filtered };
  },
});
