import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { hasRole } from "./lib/roles.js";

type SubscriptionTier = "free" | "premium" | "coaching_client" | "self_guided" | "semi_guided" | "full_guided";

// ─── Shared: generate invite token ───────────────────────────────────────────

function generateToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ─── Owner: create and send a coach invite ────────────────────────────────────

export const createCoachInvite = mutation({
  args: {
    email: v.string(),
    appUrl: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const owner = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!owner || !hasRole(owner, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can send invites" });
    }

    const existing = await ctx.db
      .query("coachInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: "A pending invite already exists for this email" });
    }

    const token = generateToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const inviteId = await ctx.db.insert("coachInvites", {
      email: args.email.toLowerCase(),
      token,
      invitedBy: owner._id,
      inviteType: "coach",
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    });

    await ctx.db.insert("auditLogs", {
      actorId: owner._id,
      actorEmail: owner.email,
      action: "coach_invite_sent",
      details: `Coach invite sent to ${args.email}`,
      timestamp: now.toISOString(),
    });

    await ctx.scheduler.runAfter(0, internal.emails.invites.sendCoachInviteEmail, {
      inviteId,
      toEmail: args.email.toLowerCase(),
      ownerName: owner.name ?? "GOAT WALK",
      token,
      appUrl: args.appUrl,
    });

    return inviteId;
  },
});

// ─── Owner/Admin: list active coaches (for dropdown) ─────────────────────────

export const listCoaches = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const caller = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!caller || (!hasRole(caller, "owner") && !hasRole(caller, "admin"))) return [];

    const allUsers = await ctx.db.query("users").collect();
    return allUsers
      .filter((u) => hasRole(u, "coach") && !u.disabled)
      .map((u) => ({ _id: u._id, name: u.name, email: u.email }));
  },
});

// ─── Owner: create and send a client invite ───────────────────────────────────

export const createClientInvite = mutation({
  args: {
    email: v.string(),
    clientName: v.optional(v.string()),
    subscriptionTier: v.union(
      v.literal("free"),
      v.literal("premium"),
      v.literal("coaching_client"),
      v.literal("self_guided"),
      v.literal("semi_guided"),
      v.literal("full_guided")
    ),
    assignedCoachId: v.id("users"),
    billingMethod: v.union(v.literal("stripe"), v.literal("bank_transfer")),
    appUrl: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const owner = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!owner || !hasRole(owner, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can invite clients" });
    }

    // Verify the assigned coach exists and has the coach role
    const coach = await ctx.db.get(args.assignedCoachId);
    if (!coach || !hasRole(coach, "coach")) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Selected user is not a Coach" });
    }

    const existing = await ctx.db
      .query("coachInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: "A pending invite already exists for this email" });
    }

    const token = generateToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const inviteId = await ctx.db.insert("coachInvites", {
      email: args.email.toLowerCase(),
      token,
      invitedBy: owner._id,
      inviteType: "client",
      clientName: args.clientName,
      subscriptionTier: args.subscriptionTier,
      assignedCoachId: args.assignedCoachId,
      billingMethod: args.billingMethod,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    });

    await ctx.db.insert("auditLogs", {
      actorId: owner._id,
      actorEmail: owner.email,
      action: "client_invite_sent",
      details: `Client invite sent to ${args.email} (tier: ${args.subscriptionTier}, coach: ${coach.name ?? coach.email ?? args.assignedCoachId}, billing: ${args.billingMethod})`,
      timestamp: now.toISOString(),
    });

    await ctx.scheduler.runAfter(0, internal.emails.invites.sendClientInviteEmail, {
      inviteId,
      toEmail: args.email.toLowerCase(),
      clientName: args.clientName ?? args.email,
      ownerName: owner.name ?? "GOAT WALK",
      subscriptionTier: args.subscriptionTier,
      token,
      appUrl: args.appUrl,
    });

    return inviteId;
  },
});

// ─── Owner: list all invites ──────────────────────────────────────────────────

export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const owner = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!owner || !hasRole(owner, "owner")) return [];

    const invites = await ctx.db
      .query("coachInvites")
      .withIndex("by_status")
      .order("desc")
      .take(200);

    const now = new Date().toISOString();
    return invites.map((inv) => ({
      ...inv,
      status:
        inv.status === "pending" && inv.expiresAt < now ? "expired" : inv.status,
    }));
  },
});

// ─── Owner: revoke a pending invite ──────────────────────────────────────────

export const revokeInvite = mutation({
  args: { inviteId: v.id("coachInvites") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const owner = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!owner || !hasRole(owner, "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only the owner can revoke invites" });
    }

    await ctx.db.delete(args.inviteId);
  },
});

// ─── Public: look up an invite by token ──────────────────────────────────────

export const getInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("coachInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!invite) return null;

    const now = new Date().toISOString();
    const effectiveStatus =
      invite.status === "pending" && invite.expiresAt < now ? "expired" : invite.status;

    return { ...invite, status: effectiveStatus };
  },
});

// ─── Authenticated: accept an invite ─────────────────────────────────────────

export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Must be signed in to accept invite" });

    const invite = await ctx.db
      .query("coachInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invite) throw new ConvexError({ code: "NOT_FOUND", message: "Invite not found" });
    if (invite.status === "accepted") throw new ConvexError({ code: "CONFLICT", message: "This invite has already been used" });

    const now = new Date().toISOString();
    if (invite.status === "expired" || invite.expiresAt < now) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "This invite has expired. Ask the owner to send a new one." });
    }

    const userEmail = identity.email?.toLowerCase();
    if (userEmail && userEmail !== invite.email) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: `This invite was sent to ${invite.email}. Please sign in with that email address.`,
      });
    }

    const isClientInvite = invite.inviteType === "client";
    const assignedRole = isClientInvite ? "client" : "coach";
    const assignedTier: SubscriptionTier = isClientInvite
      ? (invite.subscriptionTier ?? "free")
      : "free";

    type AppRole = "client" | "coach" | "assistant_coach" | "store_manager" | "admin" | "owner";

    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) {
      const newUserData: {
        tokenIdentifier: string;
        name?: string;
        email?: string;
        roles: AppRole[];
        subscriptionTier: SubscriptionTier;
        onboardingCompleted: boolean;
        coachId?: typeof invite.assignedCoachId;
      } = {
        tokenIdentifier: identity.tokenIdentifier,
        name: invite.clientName ?? identity.name,
        email: identity.email,
        roles: [assignedRole],
        subscriptionTier: assignedTier,
        onboardingCompleted: false,
      };
      if (isClientInvite && invite.assignedCoachId) {
        newUserData.coachId = invite.assignedCoachId;
      }
      const userId = await ctx.db.insert("users", newUserData);
      user = await ctx.db.get(userId);
    } else {
      const currentRoles: AppRole[] = (user.roles as AppRole[] | undefined) ?? [(user.role as AppRole | undefined) ?? "client"];
      const newRoles: AppRole[] = currentRoles.includes(assignedRole)
        ? currentRoles
        : [...currentRoles, assignedRole];
      const updates: { roles?: AppRole[]; subscriptionTier?: SubscriptionTier; coachId?: typeof invite.assignedCoachId } = {};
      if (newRoles.length !== currentRoles.length) {
        updates.roles = newRoles;
      }
      // Only update tier if this is a client invite
      if (isClientInvite && invite.subscriptionTier) {
        updates.subscriptionTier = invite.subscriptionTier;
      }
      // Link to assigned coach
      if (isClientInvite && invite.assignedCoachId) {
        updates.coachId = invite.assignedCoachId;
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(user._id, updates);
      }
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorId: user!._id,
      actorEmail: user?.email,
      action: isClientInvite ? "client_invite_accepted" : "coach_invite_accepted",
      details: isClientInvite
        ? `Client role + ${assignedTier} tier assigned via invite to ${invite.email}${invite.assignedCoachId ? ` (coach linked)` : ""}`
        : `Coach role assigned via invite to ${invite.email}`,
      timestamp: now,
    });
  },
});

// ─── Internal: mark expired invites ──────────────────────────────────────────

export const expireStaleInvites = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date().toISOString();
    const pending = await ctx.db
      .query("coachInvites")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    for (const inv of pending) {
      if (inv.expiresAt < now) {
        await ctx.db.patch(inv._id, { status: "expired" });
      }
    }
  },
});
