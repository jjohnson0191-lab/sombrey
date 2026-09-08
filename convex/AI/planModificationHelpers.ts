// V8 runtime — internal queries and mutations for plan modification proposals

import { internalQuery, internalMutation, mutation, query } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.d.ts";

// ── Internal query: get the user's current ready plan (used by chatAndDetect) ──

export const getCurrentPlanInfo = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    planId: Id<"aiGeneratedPlans">;
    plan: Doc<"aiGeneratedPlans">;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    if (!user) return null;

    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (!plan || plan.status !== "ready") return null;

    return { planId: plan._id, plan };
  },
});

// ── Internal mutation: persist the proposed change ────────────────────────────

export const createProposal = internalMutation({
  args: {
    planId: v.id("aiGeneratedPlans"),
    changeType: v.union(
      v.literal("meal_substitution"),
      v.literal("exercise_substitution"),
      v.literal("macro_update"),
      v.literal("workout_split_change"),
      v.literal("general_update")
    ),
    description: v.string(),
    beforeSummary: v.string(),
    afterSummary: v.string(),
    patch: v.string(), // JSON-serialised partial plan
  },
  handler: async (ctx, args): Promise<Id<"planModifications">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const now = new Date().toISOString();

    const proposalId = await ctx.db.insert("planModifications", {
      userId: user._id,
      planId: args.planId,
      changeType: args.changeType,
      description: args.description,
      beforeSummary: args.beforeSummary,
      afterSummary: args.afterSummary,
      patch: args.patch,
      status: "pending_approval",
      createdAt: now,
    });

    return proposalId;
  },
});

// ── Public mutation: user approves a proposed change ─────────────────────────

export const approveChange = mutation({
  args: { proposalId: v.id("planModifications") },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new ConvexError({ code: "NOT_FOUND", message: "Proposal not found" });
    if (proposal.userId !== user._id)
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your proposal" });
    if (proposal.status !== "pending_approval")
      throw new ConvexError({ code: "BAD_REQUEST", message: "Proposal already resolved" });

    // Parse and apply the patch to the plan
    const patch = JSON.parse(proposal.patch) as Partial<Doc<"aiGeneratedPlans">>;

    // Remove any system fields that should not be patched
    const { _id, _creationTime, userId, generatedAt, status, ...safePatch } =
      patch as Partial<Doc<"aiGeneratedPlans">>;
    void _id; void _creationTime; void userId; void generatedAt; void status;

    await ctx.db.patch(proposal.planId, safePatch);

    const now = new Date().toISOString();
    await ctx.db.patch(args.proposalId, { status: "approved", resolvedAt: now });
  },
});

// ── Public mutation: user rejects a proposed change ──────────────────────────

export const rejectChange = mutation({
  args: { proposalId: v.id("planModifications") },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new ConvexError({ code: "NOT_FOUND", message: "Proposal not found" });
    if (proposal.userId !== user._id)
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your proposal" });
    if (proposal.status !== "pending_approval")
      throw new ConvexError({ code: "BAD_REQUEST", message: "Proposal already resolved" });

    const now = new Date().toISOString();
    await ctx.db.patch(args.proposalId, { status: "rejected", resolvedAt: now });
  },
});

// ── Public query: list modification history for the current user ──────────────

export const listMyModifications = internalQuery({
  args: { planId: v.id("aiGeneratedPlans") },
  handler: async (ctx, args): Promise<Doc<"planModifications">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return ctx.db
      .query("planModifications")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .order("desc")
      .take(50);
  },
});

/**
 * #15 — Public query: look up the status of a list of proposal IDs.
 * Used by AiCoachChat to show up-to-date approve/reject state on reloaded
 * messages without duplicating proposal data on the message document itself.
 * Authorization: only proposals belonging to the authenticated user are returned.
 */
export const getProposalStatuses = query({
  args: { proposalIds: v.array(v.id("planModifications")) },
  handler: async (ctx, args): Promise<Record<string, "pending_approval" | "approved" | "rejected">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {};

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return {};

    const result: Record<string, "pending_approval" | "approved" | "rejected"> = {};
    for (const id of args.proposalIds) {
      const doc = await ctx.db.get(id);
      // Ownership check — skip proposals that don't belong to this user
      if (doc && doc.userId === user._id) {
        result[id] = doc.status;
      }
    }
    return result;
  },
});
