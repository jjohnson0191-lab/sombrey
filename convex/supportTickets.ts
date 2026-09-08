import { ConvexError, v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getUserRoles } from "./lib/roles.js";
import type { Id } from "./_generated/dataModel.d.ts";

// ─── Submit a new support ticket ─────────────────────────────────────────────

export const submitTicket = mutation({
  args: {
    subject: v.string(),
    message: v.string(),
    deviceInfo: v.optional(v.string()),
    appVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"supportTickets">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    if (!user.email) throw new ConvexError({ code: "BAD_REQUEST", message: "No email on account" });

    const subject = args.subject.trim();
    const message = args.message.trim();
    if (subject.length === 0) throw new ConvexError({ code: "BAD_REQUEST", message: "Subject is required" });
    if (message.length === 0) throw new ConvexError({ code: "BAD_REQUEST", message: "Message is required" });
    if (message.length > 3000) throw new ConvexError({ code: "BAD_REQUEST", message: "Message is too long (max 3000 characters)" });

    // Rate limit: max 3 tickets per user per calendar day
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(todayStr).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    const recentTickets = await ctx.db
      .query("supportTickets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), new Date(todayStart).toISOString()),
          q.lt(q.field("createdAt"), new Date(todayEnd).toISOString()),
        ),
      )
      .collect();
    if (recentTickets.length >= 3) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "You've submitted too many tickets today. Please try again tomorrow." });
    }

    const now = new Date().toISOString();
    const ticketId = await ctx.db.insert("supportTickets", {
      userId: user._id,
      userEmail: user.email,
      userName: user.name,
      subscriptionTier: user.subscriptionTier,
      subject,
      message,
      deviceInfo: args.deviceInfo,
      appVersion: args.appVersion,
      status: "open",
      createdAt: now,
      replies: [],
    });

    // Send confirmation email to user
    await ctx.scheduler.runAfter(0, internal.emails.support.sendSupportConfirmation, {
      toEmail: user.email,
      name: user.name ?? "Athlete",
      ticketId,
      subject,
      message,
    });

    // Notify owner/admin — find the owner user
    const ownerUser = await ctx.db
      .query("users")
      .filter((q) =>
        q.or(
          q.eq(q.field("role"), "owner"),
          // also check roles array — filter() can't inspect arrays, but we can
          // find by role field as fallback (legacy single-role)
        ),
      )
      .first();

    if (ownerUser?.email) {
      await ctx.scheduler.runAfter(0, internal.emails.support.sendAdminNewTicketNotification, {
        adminEmail: ownerUser.email,
        ticketId,
        userName: user.name ?? "Unknown",
        userEmail: user.email,
        subscriptionTier: user.subscriptionTier,
        subject,
        message,
        deviceInfo: args.deviceInfo,
      });
    }

    return ticketId;
  },
});

// ─── Get my tickets (user-facing) ────────────────────────────────────────────

export const getMyTickets = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];
    return await ctx.db
      .query("supportTickets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(20);
  },
});

// ─── Admin: list all tickets ──────────────────────────────────────────────────

export const listAllTickets = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("replied"), v.literal("closed"))),
  },
  handler: async (ctx, { status }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor) return [];
    const roles = getUserRoles(actor);
    if (!roles.includes("owner") && !roles.includes("admin")) return [];

    if (status) {
      return await ctx.db
        .query("supportTickets")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("supportTickets")
      .order("desc")
      .take(100);
  },
});

// ─── Admin: reply to ticket ───────────────────────────────────────────────────

export const replyToTicket = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    message: v.string(),
  },
  handler: async (ctx, { ticketId, message }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor) throw new ConvexError({ code: "NOT_FOUND", message: "Actor not found" });
    const roles = getUserRoles(actor);
    if (!roles.includes("owner") && !roles.includes("admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }

    const ticket = await ctx.db.get(ticketId);
    if (!ticket) throw new ConvexError({ code: "NOT_FOUND", message: "Ticket not found" });
    const trimmed = message.trim();
    if (!trimmed) throw new ConvexError({ code: "BAD_REQUEST", message: "Reply cannot be empty" });

    const now = new Date().toISOString();
    await ctx.db.patch(ticketId, {
      status: "replied",
      repliedAt: now,
      replies: [
        ...ticket.replies,
        {
          adminId: actor._id,
          adminName: actor.name,
          message: trimmed,
          sentAt: now,
        },
      ],
    });

    // Send reply email to user
    await ctx.scheduler.runAfter(0, internal.emails.support.sendSupportReply, {
      toEmail: ticket.userEmail,
      name: ticket.userName ?? "Athlete",
      ticketId,
      subject: ticket.subject,
      replyMessage: trimmed,
      adminName: actor.name ?? "GOAT WALK Support",
    });
  },
});

// ─── Admin: close ticket ──────────────────────────────────────────────────────

export const closeTicket = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    const roles = getUserRoles(actor);
    if (!roles.includes("owner") && !roles.includes("admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    await ctx.db.patch(ticketId, { status: "closed", closedAt: new Date().toISOString() });
  },
});

// ─── Admin: reopen ticket ─────────────────────────────────────────────────────

export const reopenTicket = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!actor) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    const roles = getUserRoles(actor);
    if (!roles.includes("owner") && !roles.includes("admin")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    await ctx.db.patch(ticketId, { status: "open", closedAt: undefined });
  },
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

export const getTicketById = internalQuery({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, { ticketId }) => ctx.db.get(ticketId),
});
