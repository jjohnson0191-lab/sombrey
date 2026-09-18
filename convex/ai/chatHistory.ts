// V8 runtime — queries and mutations only, no "use node"

/**
 * AI Coach chat history — backend persistence layer.
 *
 * Design decisions:
 * - One persistent thread per user (no multi-conversation management).
 * - User messages are saved immediately before the AI call so they survive
 *   network failures.  AI replies are only saved on success — failed responses
 *   are never persisted.
 * - Each caller can only access their own messages (ownership enforced server-side).
 * - proposalId links an assistant message to a planModification document so the
 *   UI can re-render the approval card after a reload.
 */

import { mutation, query } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel.js";

// ─── Helper: resolve authenticated user ───────────────────────────────────────

async function getAuthedUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Load the current user's chat history in chronological order.
 * Returns an empty array if no messages exist yet.
 * Authorization: enforced server-side — only the authenticated user's own
 * messages are ever returned. There is no way to specify a different user.
 */
export const getHistory = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthedUser(ctx);

    const rows = await ctx.db
      .query("aiChatMessages")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc") // chronological — oldest first
      .collect();

    return rows.map((r) => ({
      _id: r._id,
      role: r.role,
      content: r.content,
      proposalId: r.proposalId ?? null,
      _creationTime: r._creationTime,
    }));
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Persist a user message.  Called before the AI action so it survives failures. */
export const saveUserMessage = mutation({
  args: { content: v.string() },
  handler: async (ctx, args): Promise<Id<"aiChatMessages">> => {
    const user = await getAuthedUser(ctx);
    return ctx.db.insert("aiChatMessages", {
      userId: user._id,
      role: "user",
      content: args.content,
    });
  },
});

/** Persist a successful AI reply (only called after the AI action succeeds). */
export const saveAssistantMessage = mutation({
  args: {
    content: v.string(),
    proposalId: v.optional(v.id("planModifications")),
  },
  handler: async (ctx, args): Promise<Id<"aiChatMessages">> => {
    const user = await getAuthedUser(ctx);
    return ctx.db.insert("aiChatMessages", {
      userId: user._id,
      role: "assistant",
      content: args.content,
      proposalId: args.proposalId,
    });
  },
});

/** Update the status of a proposal card rendered inside a specific message. */
export const updateProposalStatus = mutation({
  args: {
    messageId: v.id("aiChatMessages"),
    // We don't store status on the message itself — this is a no-op stub kept
    // for forward compatibility; the actual status lives on the planModification.
    // The UI re-reads proposal status from the planModification document directly.
  },
  handler: async (ctx, args): Promise<void> => {
    // Ownership check — silently ignore if the message doesn't belong to the caller.
    const user = await getAuthedUser(ctx);
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.userId !== user._id) return;
    // Nothing to update here; proposalId is immutable once set.
  },
});

/** Clear the chat history for the current user (e.g. "New conversation" button). */
export const clearHistory = mutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const user = await getAuthedUser(ctx);
    const rows = await ctx.db
      .query("aiChatMessages")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});
