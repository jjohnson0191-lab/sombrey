import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server.d.ts";

async function getUserFromCtx(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "Not authenticated", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
  return user;
}

export const listPosts = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const results = await ctx.db
      .query("communityPosts")
      .order("desc")
      .paginate(args.paginationOpts);

    let currentUserId: Id<"users"> | null = null;
    if (identity) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
        .unique();
      currentUserId = user?._id ?? null;
    }

    const page = await Promise.all(
      results.page.map(async (post) => {
        const author = await ctx.db.get(post.userId);
        let isLiked = false;
        if (currentUserId) {
          const uid = currentUserId;
          const like = await ctx.db
            .query("postLikes")
            .withIndex("by_post_and_user", (q) => q.eq("postId", post._id).eq("userId", uid))
            .unique();
          isLiked = !!like;
        }
        return {
          ...post,
          authorName: author?.name ?? "Anonymous",
          isLiked,
        };
      })
    );

    return { ...results, page };
  },
});

export const createPost = mutation({
  args: {
    content: v.string(),
    type: v.union(
      v.literal("general"),
      v.literal("achievement"),
      v.literal("workout"),
      v.literal("nutrition"),
      v.literal("progress")
    ),
    workoutData: v.optional(v.object({
      workoutName: v.string(),
      duration: v.number(),
      exerciseCount: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromCtx(ctx);
    return await ctx.db.insert("communityPosts", {
      userId: user._id,
      content: args.content,
      type: args.type,
      likesCount: 0,
      commentsCount: 0,
      workoutData: args.workoutData,
    });
  },
});

export const toggleLike = mutation({
  args: { postId: v.id("communityPosts") },
  handler: async (ctx, args) => {
    const user = await getUserFromCtx(ctx);

    const existing = await ctx.db
      .query("postLikes")
      .withIndex("by_post_and_user", (q) => q.eq("postId", args.postId).eq("userId", user._id))
      .unique();

    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError({ message: "Post not found", code: "NOT_FOUND" });

    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(args.postId, { likesCount: Math.max(0, post.likesCount - 1) });
    } else {
      await ctx.db.insert("postLikes", { postId: args.postId, userId: user._id });
      await ctx.db.patch(args.postId, { likesCount: post.likesCount + 1 });
    }
  },
});

export const listComments = query({
  args: { postId: v.id("communityPosts") },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("postComments")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .order("asc")
      .take(50);

    return await Promise.all(
      comments.map(async (comment) => {
        const author = await ctx.db.get(comment.userId);
        return { ...comment, authorName: author?.name ?? "Anonymous" };
      })
    );
  },
});

export const addComment = mutation({
  args: {
    postId: v.id("communityPosts"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromCtx(ctx);

    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError({ message: "Post not found", code: "NOT_FOUND" });

    await ctx.db.insert("postComments", {
      postId: args.postId,
      userId: user._id,
      content: args.content,
    });
    await ctx.db.patch(args.postId, { commentsCount: post.commentsCount + 1 });
  },
});

export const deletePost = mutation({
  args: { postId: v.id("communityPosts") },
  handler: async (ctx, args) => {
    const user = await getUserFromCtx(ctx);

    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError({ message: "Post not found", code: "NOT_FOUND" });
    if (post.userId !== user._id) throw new ConvexError({ message: "Forbidden", code: "FORBIDDEN" });

    const likes = await ctx.db.query("postLikes").withIndex("by_post", (q) => q.eq("postId", args.postId)).collect();
    for (const like of likes) await ctx.db.delete(like._id);
    const comments = await ctx.db.query("postComments").withIndex("by_post", (q) => q.eq("postId", args.postId)).collect();
    for (const comment of comments) await ctx.db.delete(comment._id);

    await ctx.db.delete(args.postId);
  },
});
