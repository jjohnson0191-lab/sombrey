import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

// ─── Helper ───────────────────────────────────────────────────────────────────

async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
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

export const getCart = query({
  args: {},
  handler: async (ctx): Promise<Array<Doc<"cartItems"> & { product: Doc<"storeProducts"> | null }>> => {
    try {
      const user = await requireAuthUser(ctx);
      const items = await ctx.db
        .query("cartItems")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      return Promise.all(
        items.map(async (item) => ({
          ...item,
          product: await ctx.db.get(item.productId),
        }))
      );
    } catch {
      return [];
    }
  },
});

export const getCartCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    try {
      const user = await requireAuthUser(ctx);
      const items = await ctx.db
        .query("cartItems")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      return items.reduce((sum, item) => sum + item.quantity, 0);
    } catch {
      return 0;
    }
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const addToCart = mutation({
  args: {
    productId: v.id("storeProducts"),
    variantId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const product = await ctx.db.get(args.productId);
    if (!product || !product.active) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Product not available" });
    }

    // Server-side out-of-stock guard
    if (product.stockQuantity !== undefined && product.stockQuantity !== null && product.stockQuantity <= 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Product is out of stock" });
    }

    const variant = product.variants.find((v) => v.id === args.variantId);
    if (!variant) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Variant not found" });
    }

    // Check if item already in cart
    const existing = await ctx.db
      .query("cartItems")
      .withIndex("by_user_product_variant", (q) =>
        q.eq("userId", user._id).eq("productId", args.productId).eq("variantId", args.variantId)
      )
      .unique();

    if (existing) {
      const newQty = existing.quantity + 1;
      if (product.stockQuantity !== undefined && product.stockQuantity !== null && newQty > product.stockQuantity) {
        throw new ConvexError({ code: "BAD_REQUEST", message: `Only ${product.stockQuantity} units available` });
      }
      await ctx.db.patch(existing._id, {
        quantity: newQty,
        priceAtAdd: variant.price,
      });
    } else {
      await ctx.db.insert("cartItems", {
        userId: user._id,
        productId: args.productId,
        variantId: args.variantId,
        variantName: variant.name,
        quantity: 1,
        priceAtAdd: variant.price,
      });
    }
  },
});

export const updateCartQuantity = mutation({
  args: {
    cartItemId: v.id("cartItems"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const item = await ctx.db.get(args.cartItemId);
    if (!item || item.userId !== user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your cart item" });
    }

    if (args.quantity <= 0) {
      await ctx.db.delete(args.cartItemId);
      return;
    }

    const product = await ctx.db.get(item.productId);
    if (product && product.stockQuantity !== undefined && product.stockQuantity !== null) {
      if (args.quantity > product.stockQuantity) {
        throw new ConvexError({ code: "BAD_REQUEST", message: `Only ${product.stockQuantity} units available` });
      }
    }

    // Refresh price from current variant on every update
    const variant = product?.variants.find((v) => v.id === item.variantId);
    await ctx.db.patch(args.cartItemId, {
      quantity: args.quantity,
      priceAtAdd: variant?.price ?? item.priceAtAdd,
    });
  },
});

export const removeFromCart = mutation({
  args: { cartItemId: v.id("cartItems") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const item = await ctx.db.get(args.cartItemId);
    if (!item || item.userId !== user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your cart item" });
    }
    await ctx.db.delete(args.cartItemId);
  },
});

export const clearCart = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const items = await ctx.db
      .query("cartItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    await Promise.all(items.map((item) => ctx.db.delete(item._id)));
  },
});
