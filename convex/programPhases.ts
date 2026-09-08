import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hasRole } from "./lib/roles.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireCoachOrAbove(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  if (!hasRole(user, "coach") && !hasRole(user, "admin") && !hasRole(user, "owner")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
  }
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** List all phases created by the current coach, ordered by displayOrder */
export const listByCoach = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const coach = await requireCoachOrAbove(ctx);
    const phases = await ctx.db
      .query("programPhases")
      .withIndex("by_coach", (q) => q.eq("coachId", coach._id))
      .collect();

    const filtered = args.includeArchived
      ? phases
      : phases.filter((p) => p.status !== "archived");

    // Sort by displayOrder
    filtered.sort((a, b) => a.displayOrder - b.displayOrder);

    // Enrich with client name
    return Promise.all(
      filtered.map(async (phase) => {
        const client = phase.clientId ? await ctx.db.get(phase.clientId) : null;
        const program = phase.programId ? await ctx.db.get(phase.programId) : null;
        return {
          ...phase,
          clientName: client?.name ?? null,
          programName: program?.name ?? null,
        };
      })
    );
  },
});

/** Get phases assigned to a specific client */
export const listByClient = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    const phases = await ctx.db
      .query("programPhases")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();

    phases.sort((a, b) => a.displayOrder - b.displayOrder);

    return Promise.all(
      phases.map(async (phase) => {
        const program = phase.programId ? await ctx.db.get(phase.programId) : null;
        return { ...phase, programName: program?.name ?? null };
      })
    );
  },
});

/** Get the active phase for a client */
export const getActivePhaseForClient = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args): Promise<{ name: string; description?: string; startDate?: string; endDate?: string } | null> => {
    const phases = await ctx.db
      .query("programPhases")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();

    const active = phases.find((p) => p.status === "active");
    if (!active) return null;
    return {
      name: active.name,
      description: active.description,
      startDate: active.startDate,
      endDate: active.endDate,
    };
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    clientId: v.optional(v.id("users")),
    name: v.string(),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    programId: v.optional(v.id("programs")),
    mealPlanId: v.optional(v.id("mealPlans")),
    coachNotes: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoachOrAbove(ctx);

    // Find max displayOrder to append at end
    const existing = await ctx.db
      .query("programPhases")
      .withIndex("by_coach", (q) => q.eq("coachId", coach._id))
      .collect();
    const maxOrder = existing.reduce((m, p) => Math.max(m, p.displayOrder), -1);

    return ctx.db.insert("programPhases", {
      coachId: coach._id,
      clientId: args.clientId,
      name: args.name,
      description: args.description,
      startDate: args.startDate,
      endDate: args.endDate,
      programId: args.programId,
      mealPlanId: args.mealPlanId,
      coachNotes: args.coachNotes,
      status: args.status ?? "active",
      displayOrder: maxOrder + 1,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("programPhases"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    programId: v.optional(v.id("programs")),
    mealPlanId: v.optional(v.id("mealPlans")),
    coachNotes: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("archived"))),
    clientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoachOrAbove(ctx);
    const phase = await ctx.db.get(args.id);
    if (!phase) throw new ConvexError({ code: "NOT_FOUND", message: "Phase not found" });
    if (phase.coachId !== coach._id) throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden" });

    const { id, ...rest } = args;
    // Remove undefined values so patch doesn't overwrite with undefined
    const updates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("programPhases") },
  handler: async (ctx, args) => {
    const coach = await requireCoachOrAbove(ctx);
    const phase = await ctx.db.get(args.id);
    if (!phase) throw new ConvexError({ code: "NOT_FOUND", message: "Phase not found" });
    if (phase.coachId !== coach._id) throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden" });
    await ctx.db.delete(args.id);
  },
});

/** Reorder phases – accepts array of {id, displayOrder} */
export const reorder = mutation({
  args: {
    updates: v.array(v.object({ id: v.id("programPhases"), displayOrder: v.number() })),
  },
  handler: async (ctx, args) => {
    const coach = await requireCoachOrAbove(ctx);
    for (const u of args.updates) {
      const phase = await ctx.db.get(u.id);
      if (!phase || phase.coachId !== coach._id) continue;
      await ctx.db.patch(u.id, { displayOrder: u.displayOrder });
    }
  },
});
