import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hasRole } from "./lib/roles.js";

const TIER_VALIDATOR = v.union(
  v.literal("free"),
  v.literal("premium"),
  v.literal("coaching_client"),
  v.literal("self_guided"),
  v.literal("semi_guided"),
  v.literal("full_guided"),
);

// ─── Queries ──────────────────────────────────────────────────────────────────

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    const payments = await ctx.db
      .query("offlinePayments")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();

    return Promise.all(
      payments.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return { ...p, userName: user?.name, userEmail: user?.email };
      }),
    );
  },
});

export const listAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    const payments = await ctx.db
      .query("offlinePayments")
      .order("desc")
      .take(args.limit ?? 100);

    return Promise.all(
      payments.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        let confirmedByName: string | undefined;
        if (p.confirmedBy) {
          const confirmer = await ctx.db.get(p.confirmedBy);
          confirmedByName = confirmer?.name ?? confirmer?.email;
        }
        return { ...p, userName: user?.name, userEmail: user?.email, confirmedByName };
      }),
    );
  },
});

export const listForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    return ctx.db
      .query("offlinePayments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Owner creates a pending offline payment record on behalf of a client */
export const createOfflinePayment = mutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    currency: v.string(),
    method: v.union(v.literal("bank_transfer"), v.literal("cash"), v.literal("other")),
    referenceNote: v.optional(v.string()),
    tier: TIER_VALIDATOR,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const paymentId = await ctx.db.insert("offlinePayments", {
      userId: args.userId,
      amount: args.amount,
      currency: args.currency,
      method: args.method,
      referenceNote: args.referenceNote,
      tier: args.tier,
      status: "pending",
      createdAt: new Date().toISOString(),
      notes: args.notes,
    });

    // Set user payment status to pending
    await ctx.db.patch(args.userId, { paymentStatus: "pending" });

    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: identity.email,
      targetId: args.userId,
      targetEmail: target.email,
      action: "offline_payment_created",
      details: `Created ${args.method} payment of $${(args.amount / 100).toFixed(2)} for tier ${args.tier}${args.referenceNote ? ` (ref: ${args.referenceNote})` : ""}`,
      timestamp: new Date().toISOString(),
    });

    return paymentId;
  },
});

/** Owner confirms receipt of payment, activates the subscription tier */
export const confirmOfflinePayment = mutation({
  args: {
    paymentId: v.id("offlinePayments"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError({ code: "NOT_FOUND", message: "Payment not found" });
    if (payment.status !== "pending") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Payment is not pending" });
    }

    const target = await ctx.db.get(payment.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    await ctx.db.patch(args.paymentId, {
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      confirmedBy: actor._id,
      ...(args.notes ? { notes: args.notes } : {}),
    });

    // Activate subscription tier
    await ctx.db.patch(payment.userId, {
      subscriptionTier: payment.tier,
      paymentStatus: "active",
    });

    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: identity.email,
      targetId: payment.userId,
      targetEmail: target.email,
      action: "offline_payment_confirmed",
      details: `Confirmed ${payment.method} payment — activated ${payment.tier} tier`,
      timestamp: new Date().toISOString(),
    });
  },
});

/** Owner rejects/cancels a pending offline payment */
export const rejectOfflinePayment = mutation({
  args: {
    paymentId: v.id("offlinePayments"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError({ code: "NOT_FOUND", message: "Payment not found" });
    if (payment.status !== "pending") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Only pending payments can be rejected" });
    }

    const target = await ctx.db.get(payment.userId);

    await ctx.db.patch(args.paymentId, {
      status: "rejected",
      confirmedBy: actor._id,
      confirmedAt: new Date().toISOString(),
      ...(args.notes ? { notes: args.notes } : {}),
    });

    // Mark user payment status as suspended (payment was expected but rejected)
    await ctx.db.patch(payment.userId, { paymentStatus: "suspended" });

    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: identity.email,
      targetId: payment.userId,
      targetEmail: target?.email,
      action: "offline_payment_rejected",
      details: `Rejected ${payment.method} payment — subscription suspended${args.notes ? `: ${args.notes}` : ""}`,
      timestamp: new Date().toISOString(),
    });
  },
});

/** Owner manually updates a user's payment status (e.g. suspend or re-activate) */
export const setUserPaymentStatus = mutation({
  args: {
    userId: v.id("users"),
    paymentStatus: v.union(v.literal("active"), v.literal("pending"), v.literal("suspended")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Owner access required" });
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    await ctx.db.patch(args.userId, { paymentStatus: args.paymentStatus });

    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: identity.email,
      targetId: args.userId,
      targetEmail: target.email,
      action: "payment_status_changed",
      details: `Payment status set to "${args.paymentStatus}"${args.notes ? `: ${args.notes}` : ""}`,
      timestamp: new Date().toISOString(),
    });
  },
});
