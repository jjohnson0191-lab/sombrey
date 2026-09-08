import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";
import type { QueryCtx, MutationCtx } from "./_generated/server.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db.query("users").withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

async function requireCoach(ctx: QueryCtx | MutationCtx) {
  const user = await requireAuth(ctx);
  if (!hasRole(user, "coach", "admin", "owner")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Coach or admin access required" });
  }
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    searchTerm: v.optional(v.string()),
    category: v.optional(v.string()),
    isCustom: v.optional(v.boolean()),
    sortBy: v.optional(v.union(
      v.literal("name_asc"),
      v.literal("name_desc"),
      v.literal("created_desc"),
      v.literal("modified_desc"),
    )),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    let foods = await ctx.db.query("foods").collect();

    // Filter archived unless explicitly requested
    if (!args.includeArchived) {
      foods = foods.filter(f => !f.isArchived);
    }

    // Filter by search term
    if (args.searchTerm && args.searchTerm.length > 0) {
      const term = args.searchTerm.toLowerCase();
      foods = foods.filter(f => f.name.toLowerCase().includes(term));
    }

    // Filter by category
    if (args.category) {
      foods = foods.filter(f => f.category === args.category);
    }

    // Filter by custom flag
    if (args.isCustom !== undefined) {
      if (args.isCustom && identity) {
        const user = await ctx.db.query("users").withIndex("by_token", q => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
        foods = foods.filter(f => (f.isCustom && f.createdBy === user?._id) || !f.isCustom);
      } else if (!args.isCustom) {
        foods = foods.filter(f => !f.isCustom);
      }
    }

    // Sort
    const sortBy = args.sortBy ?? "name_asc";
    foods.sort((a, b) => {
      switch (sortBy) {
        case "name_asc": return a.name.localeCompare(b.name);
        case "name_desc": return b.name.localeCompare(a.name);
        case "created_desc": return (b.createdAt ?? b._creationTime.toString()).localeCompare(a.createdAt ?? a._creationTime.toString());
        case "modified_desc": return (b.lastModifiedAt ?? b.createdAt ?? "").localeCompare(a.lastModifiedAt ?? a.createdAt ?? "");
        default: return 0;
      }
    });

    return foods;
  },
});

export const get = query({
  args: { id: v.id("foods") },
  handler: async (ctx, args) => {
    const food = await ctx.db.get(args.id);
    if (!food) throw new ConvexError({ code: "NOT_FOUND", message: "Food not found" });
    return food;
  },
});

/** Get distinct categories for filter UI */
export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const foods = await ctx.db.query("foods").collect();
    const cats = new Set<string>();
    for (const f of foods) {
      if (f.category) cats.add(f.category);
    }
    return Array.from(cats).sort();
  },
});

/** Check if a food is used in any meal plan (for delete warning). */
export const checkUsageInPlans = query({
  args: { foodId: v.id("foods") },
  handler: async (ctx, args) => {
    const plans = await ctx.db.query("mealPlans").collect();
    const usedIn: Array<{ planId: string; planName: string }> = [];
    for (const plan of plans) {
      for (const meal of plan.meals) {
        if (meal.foods.some(f => f.foodId === args.foodId)) {
          usedIn.push({ planId: plan._id, planName: plan.name });
          break;
        }
      }
    }
    return { usedIn, count: usedIn.length };
  },
});

// ─── Mutations ─────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    protein: v.number(),
    carbs: v.number(),
    fats: v.number(),
    calories: v.number(),
    servingSize: v.string(),
    servingUnit: v.string(),
    category: v.optional(v.string()),
    isCustom: v.boolean(),
    // Per-100g values for automatic macro recalculation
    caloriesPer100g: v.optional(v.number()),
    proteinPer100g: v.optional(v.number()),
    carbsPer100g: v.optional(v.number()),
    fatsPer100g: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const now = new Date().toISOString();
    return await ctx.db.insert("foods", {
      ...args,
      createdBy: user._id,
      createdAt: now,
      lastModifiedBy: user._id,
      lastModifiedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("foods"),
    name: v.optional(v.string()),
    protein: v.optional(v.number()),
    carbs: v.optional(v.number()),
    fats: v.optional(v.number()),
    calories: v.optional(v.number()),
    servingSize: v.optional(v.string()),
    servingUnit: v.optional(v.string()),
    category: v.optional(v.string()),
    // Per-100g values for automatic macro recalculation
    caloriesPer100g: v.optional(v.number()),
    proteinPer100g: v.optional(v.number()),
    carbsPer100g: v.optional(v.number()),
    fatsPer100g: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCoach(ctx);
    const food = await ctx.db.get(args.id);
    if (!food) throw new ConvexError({ code: "NOT_FOUND", message: "Food not found" });
    const { id, ...updates } = args;
    await ctx.db.patch(id, { ...updates, lastModifiedBy: user._id, lastModifiedAt: new Date().toISOString() });
  },
});

export const duplicate = mutation({
  args: {
    id: v.id("foods"),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCoach(ctx);
    const food = await ctx.db.get(args.id);
    if (!food) throw new ConvexError({ code: "NOT_FOUND", message: "Food not found" });
    const now = new Date().toISOString();
    return await ctx.db.insert("foods", {
      name: args.newName ?? `${food.name} (Copy)`,
      protein: food.protein,
      carbs: food.carbs,
      fats: food.fats,
      calories: food.calories,
      servingSize: food.servingSize,
      servingUnit: food.servingUnit,
      category: food.category,
      isCustom: true,
      createdBy: user._id,
      createdAt: now,
      lastModifiedBy: user._id,
      lastModifiedAt: now,
    });
  },
});

export const archive = mutation({
  args: { id: v.id("foods") },
  handler: async (ctx, args) => {
    const user = await requireCoach(ctx);
    const food = await ctx.db.get(args.id);
    if (!food) throw new ConvexError({ code: "NOT_FOUND", message: "Food not found" });
    await ctx.db.patch(args.id, {
      isArchived: true,
      lastModifiedBy: user._id,
      lastModifiedAt: new Date().toISOString(),
    });
  },
});

export const unarchive = mutation({
  args: { id: v.id("foods") },
  handler: async (ctx, args) => {
    const user = await requireCoach(ctx);
    const food = await ctx.db.get(args.id);
    if (!food) throw new ConvexError({ code: "NOT_FOUND", message: "Food not found" });
    await ctx.db.patch(args.id, {
      isArchived: false,
      lastModifiedBy: user._id,
      lastModifiedAt: new Date().toISOString(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("foods") },
  handler: async (ctx, args) => {
    await requireCoach(ctx);
    const food = await ctx.db.get(args.id);
    if (!food) throw new ConvexError({ code: "NOT_FOUND", message: "Food not found" });
    await ctx.db.delete(args.id);
  },
});
