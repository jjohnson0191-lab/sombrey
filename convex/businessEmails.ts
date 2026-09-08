/**
 * Business Email Composer — queries and mutations.
 * V8 runtime (no Node). Sending is delegated to the Node action in
 * convex/emails/businessEmailSend.ts via ctx.scheduler.runAfter.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// ─── Shared folder type ───────────────────────────────────────────────────────

const folderValidator = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("draft"),
  v.literal("archived"),
  v.literal("deleted"),
);

const categoryValidator = v.union(
  v.literal("general"),
  v.literal("partnerships"),
  v.literal("sponsors"),
  v.literal("vendors"),
  v.literal("app_store"),
  v.literal("legal"),
);

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireOwnerOrAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not signed in" });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  const roles = user.roles ?? (user.role ? [user.role] : []);
  if (!roles.includes("owner") && !roles.includes("admin")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Owner or admin access required" });
  }
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** List emails in a folder (newest first). */
export const listByFolder = query({
  args: {
    folder: folderValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    authorId: string;
    folder: string;
    category: string;
    toAddresses: string[];
    ccAddresses?: string[];
    subject: string;
    body: string;
    isRead: boolean;
    isInbound?: boolean;
    fromAddress?: string;
    fromName?: string;
    sentAt?: string;
    createdAt: string;
    updatedAt: string;
    parentEmailId?: string;
    threadId?: string;
    _creationTime: number;
  }>> => {
    const user = await requireOwnerOrAdmin(ctx);
    const limit = args.limit ?? 50;
    const rows = await ctx.db
      .query("businessEmails")
      .withIndex("by_author_and_folder", (q) =>
        q.eq("authorId", user._id).eq("folder", args.folder),
      )
      .order("desc")
      .take(limit);
    return rows.map((r) => ({
      ...r,
      _id: r._id as string,
      authorId: r.authorId as string,
      parentEmailId: r.parentEmailId as string | undefined,
      threadId: r.threadId as string | undefined,
    }));
  },
});

/** Search emails by subject/body/sender/recipient. */
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    folder: string;
    category: string;
    toAddresses: string[];
    subject: string;
    body: string;
    isRead: boolean;
    isInbound?: boolean;
    fromAddress?: string;
    fromName?: string;
    sentAt?: string;
    createdAt: string;
    _creationTime: number;
  }>> => {
    const user = await requireOwnerOrAdmin(ctx);
    if (!args.q.trim()) return [];
    const lower = args.q.toLowerCase();
    const all = await ctx.db
      .query("businessEmails")
      .withIndex("by_author", (q) => q.eq("authorId", user._id))
      .order("desc")
      .take(500);
    return all
      .filter(
        (e) =>
          e.folder !== "deleted" &&
          (e.subject.toLowerCase().includes(lower) ||
            e.body.toLowerCase().includes(lower) ||
            e.toAddresses.some((t) => t.toLowerCase().includes(lower)) ||
            (e.fromAddress ?? "").toLowerCase().includes(lower) ||
            (e.fromName ?? "").toLowerCase().includes(lower)),
      )
      .slice(0, 50)
      .map((r) => ({ ...r, _id: r._id as string }));
  },
});

/** Get a single email by ID. */
export const getById = query({
  args: { id: v.id("businessEmails") },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const email = await ctx.db.get(args.id);
    if (!email) return null;
    if (email.authorId !== user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }
    return email;
  },
});

/** Get all emails in a thread (root = threadId). */
export const getThread = query({
  args: { threadId: v.id("businessEmails") },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const emails = await ctx.db
      .query("businessEmails")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .take(100);
    return emails.filter((e) => e.authorId === user._id);
  },
});

/** Count drafts for the badge in the sidebar. */
export const countDrafts = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return 0;
    const roles = user.roles ?? (user.role ? [user.role] : []);
    if (!roles.includes("owner") && !roles.includes("admin")) return 0;
    const drafts = await ctx.db
      .query("businessEmails")
      .withIndex("by_author_and_folder", (q) =>
        q.eq("authorId", user._id).eq("folder", "draft"),
      )
      .take(99);
    return drafts.length;
  },
});

/** Count unread inbox emails for the badge. */
export const countUnreadInbox = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return 0;
    const roles = user.roles ?? (user.role ? [user.role] : []);
    if (!roles.includes("owner") && !roles.includes("admin")) return 0;
    const inbox = await ctx.db
      .query("businessEmails")
      .withIndex("by_author_and_folder", (q) =>
        q.eq("authorId", user._id).eq("folder", "inbox"),
      )
      .take(200);
    return inbox.filter((e) => !e.isRead).length;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Save a draft. Returns the email ID. */
export const saveDraft = mutation({
  args: {
    id: v.optional(v.id("businessEmails")),
    toAddresses: v.array(v.string()),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    category: categoryValidator,
    parentEmailId: v.optional(v.id("businessEmails")),
    threadId: v.optional(v.id("businessEmails")),
  },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const now = new Date().toISOString();

    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.authorId !== user._id) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Draft not found" });
      }
      await ctx.db.patch(args.id, {
        toAddresses: args.toAddresses,
        ccAddresses: args.ccAddresses,
        bccAddresses: args.bccAddresses,
        subject: args.subject,
        body: args.body,
        category: args.category,
        updatedAt: now,
      });
      return args.id;
    }

    return await ctx.db.insert("businessEmails", {
      authorId: user._id,
      folder: "draft",
      category: args.category,
      toAddresses: args.toAddresses,
      ccAddresses: args.ccAddresses,
      bccAddresses: args.bccAddresses,
      subject: args.subject,
      body: args.body,
      parentEmailId: args.parentEmailId,
      threadId: args.threadId,
      isRead: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Send an email: inserts as "sent" and schedules the Mailgun Node action. */
export const sendEmail = mutation({
  args: {
    draftId: v.optional(v.id("businessEmails")),
    toAddresses: v.array(v.string()),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    category: categoryValidator,
    parentEmailId: v.optional(v.id("businessEmails")),
    threadId: v.optional(v.id("businessEmails")),
  },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const now = new Date().toISOString();

    // Delete draft if sending from one
    if (args.draftId) {
      const draft = await ctx.db.get(args.draftId);
      if (draft && draft.authorId === user._id) {
        await ctx.db.delete(args.draftId);
      }
    }

    const sentId = await ctx.db.insert("businessEmails", {
      authorId: user._id,
      folder: "sent",
      category: args.category,
      toAddresses: args.toAddresses,
      ccAddresses: args.ccAddresses,
      bccAddresses: args.bccAddresses,
      subject: args.subject,
      body: args.body,
      parentEmailId: args.parentEmailId,
      threadId: args.threadId,
      isRead: true,
      sentAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Self-thread: if no parent, threadId = self
    if (!args.threadId) {
      await ctx.db.patch(sentId, { threadId: sentId });
    }

    await ctx.scheduler.runAfter(0, internal.emails.businessEmailSend.sendBusinessEmail, {
      toAddresses: args.toAddresses,
      ccAddresses: args.ccAddresses ?? [],
      bccAddresses: args.bccAddresses ?? [],
      subject: args.subject,
      body: args.body,
      sentEmailId: sentId,
    });

    return sentId;
  },
});

/** Mark email as read/unread. */
export const markRead = mutation({
  args: { id: v.id("businessEmails"), isRead: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const email = await ctx.db.get(args.id);
    if (!email || email.authorId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Email not found" });
    }
    await ctx.db.patch(args.id, { isRead: args.isRead, updatedAt: new Date().toISOString() });
  },
});

/** Move email to a folder. */
export const moveToFolder = mutation({
  args: { id: v.id("businessEmails"), folder: folderValidator },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const email = await ctx.db.get(args.id);
    if (!email || email.authorId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Email not found" });
    }
    await ctx.db.patch(args.id, { folder: args.folder, updatedAt: new Date().toISOString() });
  },
});

/** Permanently delete an email. */
export const permanentlyDelete = mutation({
  args: { id: v.id("businessEmails") },
  handler: async (ctx, args) => {
    const user = await requireOwnerOrAdmin(ctx);
    const email = await ctx.db.get(args.id);
    if (!email || email.authorId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Email not found" });
    }
    await ctx.db.delete(args.id);
  },
});

// ─── Internal mutations ───────────────────────────────────────────────────────

/** Patch mailgunMessageId after a successful send. */
export const patchMessageId = internalMutation({
  args: { id: v.id("businessEmails"), mailgunMessageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { mailgunMessageId: args.mailgunMessageId });
  },
});

/**
 * Store an inbound email received from the Mailgun webhook.
 * Called by the HTTP action in convex/http.ts.
 * Deduplication: if a message with the same Mailgun Message-ID already exists, skip.
 * The email is stored under the owner's account (first user with owner role).
 */
export const storeInbound = internalMutation({
  args: {
    fromAddress: v.string(),
    fromName: v.string(),
    toAddresses: v.array(v.string()),
    subject: v.string(),
    body: v.string(),            // plain-text body
    mailgunMessageId: v.string(),
    receivedAt: v.string(),      // ISO 8601 UTC
  },
  handler: async (ctx, args) => {
    // Deduplication check
    const existing = await ctx.db
      .query("businessEmails")
      .withIndex("by_mailgun_msgid", (q) => q.eq("mailgunMessageId", args.mailgunMessageId))
      .first();
    if (existing) return existing._id;

    // Find the owner account to attach the email to
    const allUsers = await ctx.db.query("users").take(200);
    const owner = allUsers.find((u) => {
      const roles = u.roles ?? (u.role ? [u.role] : []);
      return roles.includes("owner");
    });
    if (!owner) {
      console.warn("[storeInbound] No owner account found — dropping inbound email");
      return null;
    }

    const now = new Date().toISOString();
    const id = await ctx.db.insert("businessEmails", {
      authorId: owner._id,
      folder: "inbox",
      category: "general",
      toAddresses: args.toAddresses,
      subject: args.subject,
      body: args.body,
      isRead: false,
      isInbound: true,
      fromAddress: args.fromAddress,
      fromName: args.fromName,
      mailgunMessageId: args.mailgunMessageId,
      sentAt: args.receivedAt,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});
