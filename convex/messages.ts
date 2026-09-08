import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";
import { hasRole, primaryRole } from "./lib/roles.js";

async function getAuthUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

// List all conversations for the current user (last message per conversation partner)
export const listConversations = query({
  args: {},
  handler: async (ctx): Promise<{
    partnerId: Id<"users">;
    partnerName: string;
    partnerRole: string;
    lastMessage: string;
    lastMessageTime: number;
    unreadCount: number;
  }[]> => {
    const user = await getAuthUser(ctx);

    const sent = await ctx.db
      .query("messages")
      .withIndex("by_sender", (q) => q.eq("senderId", user._id))
      .collect();
    const received = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => q.eq("recipientId", user._id))
      .collect();

    const partnerIds = new Set<Id<"users">>();
    for (const m of sent) partnerIds.add(m.recipientId);
    for (const m of received) partnerIds.add(m.senderId);

    const conversations = await Promise.all(
      Array.from(partnerIds).map(async (partnerId) => {
        const partner = await ctx.db.get(partnerId);
        if (!partner) return null;

        const allMessages = [...sent, ...received].filter(
          (m) =>
            (m.senderId === user._id && m.recipientId === partnerId) ||
            (m.senderId === partnerId && m.recipientId === user._id)
        );
        allMessages.sort((a, b) => b._creationTime - a._creationTime);

        const last = allMessages[0];
        const unreadCount = allMessages.filter(
          (m) => m.senderId === partnerId && !m.read
        ).length;

        return {
          partnerId,
          partnerName: partner.name ?? "Unknown",
          partnerRole: primaryRole(partner),
          lastMessage: last?.content ?? "",
          lastMessageTime: last?._creationTime ?? 0,
          unreadCount,
        };
      })
    );

    return conversations
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  },
});

// Get all messages between current user and a specific partner
export const getConversation = query({
  args: { partnerId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"messages">[]> => {
    const user = await getAuthUser(ctx);

    const sent = await ctx.db
      .query("messages")
      .withIndex("by_sender", (q) => q.eq("senderId", user._id))
      .collect();
    const received = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => q.eq("recipientId", user._id))
      .collect();

    const allMessages = [...sent, ...received].filter(
      (m) =>
        (m.senderId === user._id && m.recipientId === args.partnerId) ||
        (m.senderId === args.partnerId && m.recipientId === user._id)
    );

    allMessages.sort((a, b) => a._creationTime - b._creationTime);
    return allMessages;
  },
});

// Send a text message
export const send = mutation({
  args: {
    recipientId: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient) throw new ConvexError({ code: "NOT_FOUND", message: "Recipient not found" });

    // Clients may only message their assigned coach
    if (!hasRole(user, "coach", "admin", "owner")) {
      if (user.coachId !== args.recipientId) {
        throw new ConvexError({ code: "FORBIDDEN", message: "You can only message your assigned coach" });
      }
    }

    return ctx.db.insert("messages", {
      senderId: user._id,
      recipientId: args.recipientId,
      content: args.content,
      type: "text",
      read: false,
    });
  },
});

// Mark all messages from a partner as read
export const markRead = mutation({
  args: { partnerId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);

    const received = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => q.eq("recipientId", user._id))
      .collect();

    const unread = received.filter(
      (m) => m.senderId === args.partnerId && !m.read
    );

    await Promise.all(unread.map((m) => ctx.db.patch(m._id, { read: true })));
  },
});

// Get a user by ID — only returns users you are allowed to message
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    const user = await getAuthUser(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) return null;

    // Coach/admin can look up anyone; clients may only look up their assigned coach
    if (hasRole(user, "coach", "admin", "owner")) return target;
    if (user.coachId === args.userId) return target;
    if (args.userId === user._id) return target;
    return null;
  },
});

// Get all users the current user can message
export const getMessageableUsers = query({
  args: {},
  handler: async (ctx): Promise<{ _id: Id<"users">; name: string; role: string }[]> => {
    const user = await getAuthUser(ctx);

    if (hasRole(user, "coach", "admin")) {
      const clients = await ctx.db
        .query("users")
        .withIndex("by_coach", (q) => q.eq("coachId", user._id))
        .collect();
      return clients.map((c) => ({ _id: c._id, name: c.name ?? "Client", role: primaryRole(c) }));
    } else {
      if (!user.coachId) return [];
      const coach = await ctx.db.get(user.coachId);
      if (!coach) return [];
      // coach is Doc<"users"> since coachId is Id<"users">
      const coachUser = coach as Doc<"users">;
      return [{ _id: coachUser._id, name: coachUser.name ?? "Coach", role: primaryRole(coachUser) }];
    }
  },
});
