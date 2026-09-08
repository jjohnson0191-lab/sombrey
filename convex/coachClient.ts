import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hasRole } from "./lib/roles.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

async function requireCoach(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db.query("users").withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user || !hasRole(user, "coach", "assistant_coach", "admin", "owner")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
  }
  return user;
}

// ─── Coach Notes ───────────────────────────────────────────────────────────

export const getNotes = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    return await ctx.db.query("coachClientNotes")
      .withIndex("by_coach_and_client", q => q.eq("coachId", coach._id).eq("clientId", args.clientId))
      .order("desc")
      .take(50);
  },
});

export const addNote = mutation({
  args: {
    clientId: v.id("users"),
    note: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    const now = new Date().toISOString();
    return await ctx.db.insert("coachClientNotes", {
      coachId: coach._id,
      clientId: args.clientId,
      note: args.note,
      category: args.category,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateNote = mutation({
  args: {
    noteId: v.id("coachClientNotes"),
    note: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    const existing = await ctx.db.get(args.noteId);
    if (!existing || existing.coachId !== coach._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Note not found or access denied" });
    }
    await ctx.db.patch(args.noteId, { note: args.note, category: args.category, updatedAt: new Date().toISOString() });
  },
});

export const deleteNote = mutation({
  args: { noteId: v.id("coachClientNotes") },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    const existing = await ctx.db.get(args.noteId);
    if (!existing || existing.coachId !== coach._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Note not found or access denied" });
    }
    await ctx.db.delete(args.noteId);
  },
});

// ─── Nutrition Assignment ───────────────────────────────────────────────────

export const getNutritionAssignment = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    return await ctx.db.query("coachNutritionAssignments")
      .withIndex("by_client", q => q.eq("clientId", args.clientId))
      .first();
  },
});

export const upsertNutritionAssignment = mutation({
  args: {
    clientId: v.id("users"),
    targetCalories: v.optional(v.number()),
    targetProtein: v.optional(v.number()),
    targetCarbs: v.optional(v.number()),
    targetFats: v.optional(v.number()),
    targetFiber: v.optional(v.number()),
    targetWaterMl: v.optional(v.number()),
    mealPlanId: v.optional(v.id("mealPlans")),
    customNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    const existing = await ctx.db.query("coachNutritionAssignments")
      .withIndex("by_coach_and_client", q => q.eq("coachId", coach._id).eq("clientId", args.clientId))
      .first();
    const { clientId, ...fields } = args;
    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
    } else {
      await ctx.db.insert("coachNutritionAssignments", {
        coachId: coach._id,
        clientId,
        ...fields,
        updatedAt: now,
      });
    }
  },
});

// ─── Supplement Protocol ───────────────────────────────────────────────────

export const getSupplementProtocol = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    return await ctx.db.query("supplementProtocols")
      .withIndex("by_client", q => q.eq("clientId", args.clientId))
      .first();
  },
});

export const upsertSupplementProtocol = mutation({
  args: {
    clientId: v.id("users"),
    supplements: v.array(v.object({
      name: v.string(),
      dosage: v.string(),
      timing: v.string(),
      duration: v.optional(v.string()),
      notes: v.optional(v.string()),
    })),
    generalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoach(ctx);
    const existing = await ctx.db.query("supplementProtocols")
      .withIndex("by_coach_and_client", q => q.eq("coachId", coach._id).eq("clientId", args.clientId))
      .first();
    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, {
        supplements: args.supplements,
        generalNotes: args.generalNotes,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("supplementProtocols", {
        coachId: coach._id,
        clientId: args.clientId,
        supplements: args.supplements,
        generalNotes: args.generalNotes,
        updatedAt: now,
      });
    }
  },
});

// ─── Client Activity Feed ──────────────────────────────────────────────────

export const getClientActivity = query({
  args: { clientId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Array<{ type: string; description: string; timestamp: number; id: string }>> => {
    await requireCoach(ctx);
    const limit = args.limit ?? 30;
    const events: Array<{ type: string; description: string; timestamp: number; id: string }> = [];

    // Workout logs
    const workoutLogs = await ctx.db.query("workoutLogs")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(10);
    for (const log of workoutLogs) {
      const workout = await ctx.db.get(log.workoutId);
      events.push({
        type: "workout_completed",
        description: `Completed workout: ${workout?.name ?? "Unknown"}`,
        timestamp: log.completedAt,
        id: log._id,
      });
    }

    // Progress photos
    const photos = await ctx.db.query("progressPhotos")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(5);
    for (const photo of photos) {
      events.push({
        type: "progress_photo",
        description: `Uploaded ${photo.view} progress photo`,
        timestamp: photo.date,
        id: photo._id,
      });
    }

    // Measurements
    const measurements = await ctx.db.query("measurements")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(5);
    for (const m of measurements) {
      const details = [];
      if (m.weight) details.push(`${m.weight}kg`);
      if (m.bodyFat) details.push(`${m.bodyFat}% BF`);
      events.push({
        type: "measurement",
        description: `Updated measurements${details.length ? `: ${details.join(", ")}` : ""}`,
        timestamp: m.date,
        id: m._id,
      });
    }

    // Check-ins
    const checkIns = await ctx.db.query("checkIns")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(5);
    for (const ci of checkIns) {
      events.push({
        type: "check_in",
        description: `Submitted ${ci.type} check-in`,
        timestamp: ci.date,
        id: ci._id,
      });
    }

    // Sort all events by timestamp descending and take limit
    events.sort((a, b) => b.timestamp - a.timestamp);
    return events.slice(0, limit);
  },
});

// ─── Client Dashboard Summary ──────────────────────────────────────────────

export const getClientDashboard = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    await requireCoach(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "NOT_FOUND", message: "Client not found" });

    // Avatar URL
    let avatarUrl: string | null = null;
    if (client.avatarStorageId) {
      avatarUrl = await ctx.storage.getUrl(client.avatarStorageId);
    }

    // Active program
    const activeAssignment = await ctx.db.query("assignedPrograms")
      .withIndex("by_user_and_status", q => q.eq("userId", args.clientId).eq("status", "active"))
      .first();
    let activeProgram = null;
    if (activeAssignment) {
      const program = await ctx.db.get(activeAssignment.programId);
      activeProgram = program ? { ...program, assignmentId: activeAssignment._id, currentWeek: activeAssignment.currentWeek } : null;
    }

    // Workout history (last 20 for display)
    const workoutLogs = await ctx.db.query("workoutLogs")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(20);
    const workoutHistory = await Promise.all(workoutLogs.map(async (log) => {
      const workout = await ctx.db.get(log.workoutId);
      return { ...log, workoutName: workout?.name ?? "Unknown" };
    }));

    // #24 — Count ALL workout logs for this client (not just the 20 fetched for history).
    // `.collect()` on a large table is fine here because the count is for a single user
    // and workout logs are append-only; the real total is the meaningful metric shown
    // to coaches as "Total Workouts Completed" in the stats grid.
    const allWorkoutLogs = await ctx.db.query("workoutLogs")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .collect();

    // Measurements (last 10)
    const measurements = await ctx.db.query("measurements")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(10);

    // Progress photos (last 12)
    const photosDocs = await ctx.db.query("progressPhotos")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(12);
    const progressPhotos = await Promise.all(photosDocs.map(async (p) => {
      const url = await ctx.storage.getUrl(p.storageId);
      return { ...p, url };
    }));

    // Goal
    const goal = await ctx.db.query("clientGoals")
      .withIndex("by_user_and_active", q => q.eq("userId", args.clientId).eq("isActive", true))
      .first();

    // Active phase
    const activePhase = await ctx.db.query("programPhases")
      .withIndex("by_client", q => q.eq("clientId", args.clientId))
      .filter(q => q.eq(q.field("status"), "active"))
      .first();

    // Check-ins (coach system)
    const checkIns = await ctx.db.query("checkIns")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(10);

    // Weekly check-ins (AI system)
    const weeklyCheckIns = await ctx.db.query("weeklyCheckIns")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(20);

    // AI workout logs (for AI plan clients)
    const aiWorkoutLogsRaw = await ctx.db.query("aiWorkoutLogs")
      .withIndex("by_user", q => q.eq("userId", args.clientId))
      .order("desc")
      .take(20);

    // Workout stats — computed from the full logs, not just the 20 fetched for history
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const workoutsThisWeek = allWorkoutLogs.filter(w => w.completedAt >= weekStart).length;
    // Also count AI workouts this week
    const aiWorkoutsThisWeekCount = aiWorkoutLogsRaw.filter(
      (w) => new Date(w.completedAt).getTime() >= weekStart
    ).length;

    return {
      client: { ...client, avatarUrl },
      activeProgram,
      workoutHistory,
      measurements,
      progressPhotos,
      goal,
      activePhase,
      checkIns,
      weeklyCheckIns,
      aiWorkoutLogs: aiWorkoutLogsRaw,
      workoutsThisWeek: workoutsThisWeek + aiWorkoutsThisWeekCount,
      totalWorkouts: allWorkoutLogs.length + aiWorkoutLogsRaw.length,
    };
  },
});
