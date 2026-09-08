import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { hasRole } from "./lib/roles.js";

// ─── Helper to assert admin role ──────────────────────────────────────────────

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  if (!user || !hasRole(user, "admin", "store_manager")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admin or Store Manager access required" });
  }

  return user;
}

// ─── Inventory helpers ─────────────────────────────────────────────────────────

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function getStockStatus(product: Doc<"storeProducts">): "in_stock" | "low_stock" | "out_of_stock" {
  if (product.stockQuantity === undefined || product.stockQuantity === null) return "in_stock";
  const threshold = product.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  if (product.stockQuantity <= 0) return "out_of_stock";
  if (product.stockQuantity <= threshold) return "low_stock";
  return "in_stock";
}

// ─── Public Queries ───────────────────────────────────────────────────────────

export const listActive = query({
  args: {},
  handler: async (ctx): Promise<Doc<"storeProducts">[]> => {
    return ctx.db
      .query("storeProducts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .order("asc")
      .collect();
  },
});

export const listFeatured = query({
  args: {},
  handler: async (ctx): Promise<Doc<"storeProducts">[]> => {
    return ctx.db
      .query("storeProducts")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .order("asc")
      .collect();
  },
});

// ─── Admin Queries ────────────────────────────────────────────────────────────

export const listAll = query({
  args: {},
  handler: async (ctx): Promise<Doc<"storeProducts">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user || !hasRole(user, "admin", "store_manager")) return [];

    return ctx.db
      .query("storeProducts")
      .withIndex("by_display_order", (q) => q.gte("displayOrder", 0))
      .order("asc")
      .collect();
  },
});

// ─── Admin Mutations ──────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    productId: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    imageUrl: v.string(),
    badge: v.optional(v.string()),
    featured: v.boolean(),
    active: v.boolean(),
    displayOrder: v.number(),
    variants: v.array(v.object({
      id: v.string(),
      name: v.string(),
      price: v.number(),
    })),
    stockQuantity: v.optional(v.number()),
    lowStockThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return ctx.db.insert("storeProducts", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("storeProducts"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    badge: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
    displayOrder: v.optional(v.number()),
    stockQuantity: v.optional(v.number()),
    lowStockThreshold: v.optional(v.number()),
    variants: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      price: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("storeProducts") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.id);
  },
});

export const reorder = mutation({
  args: {
    id: v.id("storeProducts"),
    displayOrder: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { displayOrder: args.displayOrder });
  },
});

// ─── Inventory Mutations ──────────────────────────────────────────────────────

export const adjustStock = mutation({
  args: {
    id: v.id("storeProducts"),
    changeAmount: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const product = await ctx.db.get(args.id);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "Product not found" });

    const previous = product.stockQuantity ?? 0;
    const newQty = Math.max(0, previous + args.changeAmount);
    await ctx.db.patch(args.id, { stockQuantity: newQty });
    await ctx.db.insert("inventoryLogs", {
      productId: args.id,
      userId: user._id,
      userName: user.name ?? "Unknown",
      changeAmount: args.changeAmount,
      previousQuantity: previous,
      newQuantity: newQty,
      reason: args.reason,
    });
    return newQty;
  },
});

export const setStock = mutation({
  args: {
    id: v.id("storeProducts"),
    stockQuantity: v.number(),
    lowStockThreshold: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const product = await ctx.db.get(args.id);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "Product not found" });

    const previous = product.stockQuantity ?? 0;
    const newQty = Math.max(0, args.stockQuantity);
    const patchData: { stockQuantity: number; lowStockThreshold?: number } = { stockQuantity: newQty };
    if (args.lowStockThreshold !== undefined) patchData.lowStockThreshold = args.lowStockThreshold;
    await ctx.db.patch(args.id, patchData);
    await ctx.db.insert("inventoryLogs", {
      productId: args.id,
      userId: user._id,
      userName: user.name ?? "Unknown",
      changeAmount: newQty - previous,
      previousQuantity: previous,
      newQuantity: newQty,
      reason: args.reason ?? "Manual stock set",
    });
    return newQty;
  },
});

// ─── Inventory Queries ────────────────────────────────────────────────────────

export const getInventoryLogs = query({
  args: { productId: v.id("storeProducts") },
  handler: async (ctx, args): Promise<Doc<"inventoryLogs">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user || !hasRole(user, "admin", "store_manager")) return [];
    return ctx.db
      .query("inventoryLogs")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .order("desc")
      .take(50);
  },
});
