import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hasRole } from "./lib/roles.js";

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Coach/admin/owner: list coaching subscriptions. Coaches see only their clients. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "coach", "admin", "owner")) return [];

    let subs;
    if (hasRole(actor, "owner") || hasRole(actor, "admin")) {
      subs = await ctx.db.query("coachingSubscriptions").collect();
    } else {
      subs = await ctx.db
        .query("coachingSubscriptions")
        .withIndex("by_coach", (q) => q.eq("coachId", actor._id))
        .collect();
    }

    return Promise.all(
      subs.map(async (sub) => {
        const client = await ctx.db.get(sub.clientId);
        const coach = await ctx.db.get(sub.coachId);
        const avatarUrl = client?.avatarStorageId
          ? await ctx.storage.getUrl(client.avatarStorageId)
          : null;
        return {
          ...sub,
          clientName: client?.name ?? client?.email ?? "Unknown",
          clientEmail: client?.email,
          clientAvatarUrl: avatarUrl,
          coachName: coach?.name ?? coach?.email ?? "Unknown",
        };
      })
    );
  },
});

/** Get the coaching subscription for a specific client. */
export const getForClient = query({
  args: { clientId: v.id("users") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "coach", "admin", "owner")) return null;

    return ctx.db
      .query("coachingSubscriptions")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .first();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Coach/admin/owner: create a coaching subscription for a client. */
export const create = mutation({
  args: {
    clientId: v.id("users"),
    monthlyPriceCents: v.number(),
    currency: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only coaches, admins, and owners can create coaching subscriptions" });
    }

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "NOT_FOUND", message: "Client not found" });

    // Cancel any existing active subscription for this client
    const existing = await ctx.db
      .query("coachingSubscriptions")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .first();
    if (existing && existing.status === "active") {
      await ctx.db.patch(existing._id, { status: "cancelled", updatedAt: new Date().toISOString() });
    }

    const now = new Date().toISOString();
    // Determine coachId: if actor is coach, use actor; otherwise use client's assigned coach or actor
    const coachId = hasRole(actor, "owner") || hasRole(actor, "admin")
      ? (client.coachId ?? actor._id)
      : actor._id;

    const subId = await ctx.db.insert("coachingSubscriptions", {
      clientId: args.clientId,
      coachId,
      monthlyPriceCents: args.monthlyPriceCents,
      currency: args.currency ?? "USD",
      status: "active",
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
      createdBy: actor._id,
    });

    // Set client's subscription tier to coaching_client
    await ctx.db.patch(args.clientId, {
      subscriptionTier: "coaching_client",
      coachingPriceCents: args.monthlyPriceCents,
    });

    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: actor.email,
      targetId: args.clientId,
      targetEmail: client.email,
      action: "coaching_subscription_created",
      details: `Coaching subscription created at $${(args.monthlyPriceCents / 100).toFixed(2)}/month`,
      timestamp: now,
    });

    return subId;
  },
});

/** Coach/admin/owner: update a coaching subscription's price or notes. */
export const update = mutation({
  args: {
    subscriptionId: v.id("coachingSubscriptions"),
    monthlyPriceCents: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("cancelled"))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Insufficient permissions" });
    }

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new ConvexError({ code: "NOT_FOUND", message: "Coaching subscription not found" });

    const now = new Date().toISOString();
    const updates: {
      updatedAt: string;
      monthlyPriceCents?: number;
      status?: "active" | "paused" | "cancelled";
      notes?: string;
    } = { updatedAt: now };

    if (args.monthlyPriceCents !== undefined) updates.monthlyPriceCents = args.monthlyPriceCents;
    if (args.status !== undefined) updates.status = args.status;
    if (args.notes !== undefined) updates.notes = args.notes;

    await ctx.db.patch(args.subscriptionId, updates);

    // Sync client's tier if status changes
    if (args.status !== undefined) {
      const newTier = args.status === "active" ? "coaching_client" as const : "free" as const;
      await ctx.db.patch(sub.clientId, { subscriptionTier: newTier });
    }

    // Sync coaching price on user record
    if (args.monthlyPriceCents !== undefined) {
      await ctx.db.patch(sub.clientId, { coachingPriceCents: args.monthlyPriceCents });
    }

    const client = await ctx.db.get(sub.clientId);
    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: actor.email,
      targetId: sub.clientId,
      targetEmail: client?.email,
      action: "coaching_subscription_updated",
      details: `Updated: ${JSON.stringify({ status: args.status, monthlyPriceCents: args.monthlyPriceCents })}`,
      timestamp: now,
    });
  },
});

/** Coach/admin/owner: cancel a coaching subscription. */
export const cancel = mutation({
  args: { subscriptionId: v.id("coachingSubscriptions") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor || !hasRole(actor, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Insufficient permissions" });
    }

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new ConvexError({ code: "NOT_FOUND", message: "Subscription not found" });

    const now = new Date().toISOString();
    await ctx.db.patch(args.subscriptionId, { status: "cancelled", updatedAt: now });
    await ctx.db.patch(sub.clientId, { subscriptionTier: "free" });

    const client = await ctx.db.get(sub.clientId);
    await ctx.db.insert("auditLogs", {
      actorId: actor._id,
      actorEmail: actor.email,
      targetId: sub.clientId,
      targetEmail: client?.email,
      action: "coaching_subscription_cancelled",
      details: "Coaching subscription cancelled — client downgraded to free",
      timestamp: now,
    });
  },
});
