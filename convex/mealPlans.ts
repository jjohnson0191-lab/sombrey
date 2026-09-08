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
    throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
  }
  return user;
}

const mealValidator = v.object({
  id: v.string(),
  name: v.string(),
  time: v.optional(v.string()),
  displayOrder: v.number(),
  foods: v.array(v.object({
    foodId: v.id("foods"),
    servings: v.number(),
    quantityInGrams: v.optional(v.number()),
  })),
});

// ─── Macro calculation helper ─────────────────────────────────────────────────
// When a food has per-100g values AND quantityInGrams is set, use grams formula.
// Otherwise fall back to (value * servings) for backward compat with existing data.
function calcMacros(food: {
  protein: number; carbs: number; fats: number; calories: number;
  proteinPer100g?: number; carbsPer100g?: number; fatsPer100g?: number; caloriesPer100g?: number;
}, servings: number, quantityInGrams?: number) {
  const hasGrams = quantityInGrams != null && quantityInGrams > 0
    && food.caloriesPer100g != null && food.proteinPer100g != null
    && food.carbsPer100g != null && food.fatsPer100g != null;
  if (hasGrams) {
    const q = quantityInGrams;
    return {
      calories: (food.caloriesPer100g! * q) / 100,
      protein: (food.proteinPer100g! * q) / 100,
      carbs: (food.carbsPer100g! * q) / 100,
      fats: (food.fatsPer100g! * q) / 100,
    };
  }
  return {
    calories: food.calories * servings,
    protein: food.protein * servings,
    carbs: food.carbs * servings,
    fats: food.fats * servings,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** List meal plans for a user. Coaches can query any client; clients can only query themselves. */
export const listByUser = query({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuth(ctx);
    const targetUserId = args.userId ?? currentUser._id;

    // Clients can only view their own plans
    if (!hasRole(currentUser, "coach", "admin", "owner") && targetUserId !== currentUser._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    return await ctx.db
      .query("mealPlans")
      .withIndex("by_user", q => q.eq("userId", targetUserId))
      .order("desc")
      .collect();
  },
});

/** Get full meal plan with food details resolved. */
export const get = query({
  args: { id: v.id("mealPlans") },
  handler: async (ctx, args) => {
    const mealPlan = await ctx.db.get(args.id);
    if (!mealPlan) throw new ConvexError({ code: "NOT_FOUND", message: "Meal plan not found" });

    const currentUser = await requireAuth(ctx);
    if (!hasRole(currentUser, "coach", "admin", "owner") && mealPlan.userId !== currentUser._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    const mealsWithFoodDetails = await Promise.all(
      mealPlan.meals.map(async (meal) => {
        const foodsWithDetails = await Promise.all(
          meal.foods.map(async (f) => {
            const food = await ctx.db.get(f.foodId);
            const macros = calcMacros(
              { protein: food?.protein ?? 0, carbs: food?.carbs ?? 0, fats: food?.fats ?? 0, calories: food?.calories ?? 0, caloriesPer100g: food?.caloriesPer100g, proteinPer100g: food?.proteinPer100g, carbsPer100g: food?.carbsPer100g, fatsPer100g: food?.fatsPer100g },
              f.servings, f.quantityInGrams
            );
            return {
              ...f,
              foodName: food?.name ?? "Unknown",
              protein: food?.protein ?? 0,
              carbs: food?.carbs ?? 0,
              fats: food?.fats ?? 0,
              calories: food?.calories ?? 0,
              servingSize: food?.servingSize ?? "",
              servingUnit: food?.servingUnit ?? "",
              caloriesPer100g: food?.caloriesPer100g,
              proteinPer100g: food?.proteinPer100g,
              carbsPer100g: food?.carbsPer100g,
              fatsPer100g: food?.fatsPer100g,
              effectiveMacros: macros,
            };
          })
        );
        const totals = foodsWithDetails.reduce((acc, f) => ({
          calories: acc.calories + f.effectiveMacros.calories,
          protein: acc.protein + f.effectiveMacros.protein,
          carbs: acc.carbs + f.effectiveMacros.carbs,
          fats: acc.fats + f.effectiveMacros.fats,
        }), { calories: 0, protein: 0, carbs: 0, fats: 0 });
        return { ...meal, foodsWithDetails, totals };
      })
    );

    const dailyTotals = mealsWithFoodDetails.reduce((acc, meal) => ({
      calories: acc.calories + meal.totals.calories,
      protein: acc.protein + meal.totals.protein,
      carbs: acc.carbs + meal.totals.carbs,
      fats: acc.fats + meal.totals.fats,
    }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

    return { ...mealPlan, mealsWithFoodDetails, dailyTotals };
  },
});

/**
 * Get the meal plan assigned to the current client by their coach.
 * Reads from coachNutritionAssignments then resolves the full plan with food details.
 * Clients call this with no args; coaches call with userId to view a client's plan.
 */
export const getAssignedClientPlan = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const currentUser = await requireAuth(ctx);
    const targetUserId = args.userId ?? currentUser._id;

    if (!hasRole(currentUser, "coach", "admin", "owner") && targetUserId !== currentUser._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    // Look up the coach assignment for this client
    const assignment = await ctx.db
      .query("coachNutritionAssignments")
      .withIndex("by_client", q => q.eq("clientId", targetUserId))
      .first();

    // Fall back: also check if the user has their own active plan
    const planId = assignment?.mealPlanId ?? null;
    let plan = planId ? await ctx.db.get(planId) : null;

    // If no coach-assigned plan, fall back to user's own active plan
    if (!plan) {
      plan = await ctx.db
        .query("mealPlans")
        .withIndex("by_user_and_active", q => q.eq("userId", targetUserId).eq("isActive", true))
        .first();
    }

    if (!plan) return null;

    const mealsWithFoodDetails = await Promise.all(
      plan.meals.map(async (meal) => {
        const foodsWithDetails = await Promise.all(
          meal.foods.map(async (f) => {
            const food = await ctx.db.get(f.foodId);
            const macros = calcMacros(
              { protein: food?.protein ?? 0, carbs: food?.carbs ?? 0, fats: food?.fats ?? 0, calories: food?.calories ?? 0, caloriesPer100g: food?.caloriesPer100g, proteinPer100g: food?.proteinPer100g, carbsPer100g: food?.carbsPer100g, fatsPer100g: food?.fatsPer100g },
              f.servings, f.quantityInGrams
            );
            return {
              ...f,
              foodName: food?.name ?? "Unknown",
              protein: food?.protein ?? 0,
              carbs: food?.carbs ?? 0,
              fats: food?.fats ?? 0,
              calories: food?.calories ?? 0,
              servingSize: food?.servingSize ?? "",
              servingUnit: food?.servingUnit ?? "",
              caloriesPer100g: food?.caloriesPer100g,
              proteinPer100g: food?.proteinPer100g,
              carbsPer100g: food?.carbsPer100g,
              fatsPer100g: food?.fatsPer100g,
              effectiveMacros: macros,
            };
          })
        );
        const totals = foodsWithDetails.reduce((acc, f) => ({
          calories: acc.calories + f.effectiveMacros.calories,
          protein: acc.protein + f.effectiveMacros.protein,
          carbs: acc.carbs + f.effectiveMacros.carbs,
          fats: acc.fats + f.effectiveMacros.fats,
        }), { calories: 0, protein: 0, carbs: 0, fats: 0 });
        return { ...meal, foodsWithDetails, totals };
      })
    );

    const dailyTotals = mealsWithFoodDetails.reduce((acc, meal) => ({
      calories: acc.calories + meal.totals.calories,
      protein: acc.protein + meal.totals.protein,
      carbs: acc.carbs + meal.totals.carbs,
      fats: acc.fats + meal.totals.fats,
    }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

    // Merge macro targets: coach assignment overrides plan targets
    const effectiveTargets = {
      targetCalories: assignment?.targetCalories ?? plan.targetCalories,
      targetProtein: assignment?.targetProtein ?? plan.targetProtein,
      targetCarbs: assignment?.targetCarbs ?? plan.targetCarbs,
      targetFats: assignment?.targetFats ?? plan.targetFats,
      targetFiber: assignment?.targetFiber ?? plan.targetFiber,
      targetWaterMl: assignment?.targetWaterMl ?? plan.targetWaterMl,
    };

    return { ...plan, ...effectiveTargets, mealsWithFoodDetails, dailyTotals, assignmentNotes: assignment?.customNotes };
  },
});

/** Get active meal plan for a client (used by client view and coach assignment view). */
export const getActivePlan = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const currentUser = await requireAuth(ctx);
    const targetUserId = args.userId ?? currentUser._id;

    if (!hasRole(currentUser, "coach", "admin", "owner") && targetUserId !== currentUser._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    const plan = await ctx.db.query("mealPlans")
      .withIndex("by_user_and_active", q => q.eq("userId", targetUserId).eq("isActive", true))
      .first();
    if (!plan) return null;

    const mealsWithFoodDetails = await Promise.all(
      plan.meals.map(async (meal) => {
        const foodsWithDetails = await Promise.all(
          meal.foods.map(async (f) => {
            const food = await ctx.db.get(f.foodId);
            const macros = calcMacros(
              { protein: food?.protein ?? 0, carbs: food?.carbs ?? 0, fats: food?.fats ?? 0, calories: food?.calories ?? 0, caloriesPer100g: food?.caloriesPer100g, proteinPer100g: food?.proteinPer100g, carbsPer100g: food?.carbsPer100g, fatsPer100g: food?.fatsPer100g },
              f.servings, f.quantityInGrams
            );
            return {
              ...f,
              foodName: food?.name ?? "Unknown",
              protein: food?.protein ?? 0,
              carbs: food?.carbs ?? 0,
              fats: food?.fats ?? 0,
              calories: food?.calories ?? 0,
              servingSize: food?.servingSize ?? "",
              servingUnit: food?.servingUnit ?? "",
              caloriesPer100g: food?.caloriesPer100g,
              proteinPer100g: food?.proteinPer100g,
              carbsPer100g: food?.carbsPer100g,
              fatsPer100g: food?.fatsPer100g,
              effectiveMacros: macros,
            };
          })
        );
        const totals = foodsWithDetails.reduce((acc, f) => ({
          calories: acc.calories + f.effectiveMacros.calories,
          protein: acc.protein + f.effectiveMacros.protein,
          carbs: acc.carbs + f.effectiveMacros.carbs,
          fats: acc.fats + f.effectiveMacros.fats,
        }), { calories: 0, protein: 0, carbs: 0, fats: 0 });
        return { ...meal, foodsWithDetails, totals };
      })
    );

    const dailyTotals = mealsWithFoodDetails.reduce((acc, meal) => ({
      calories: acc.calories + meal.totals.calories,
      protein: acc.protein + meal.totals.protein,
      carbs: acc.carbs + meal.totals.carbs,
      fats: acc.fats + meal.totals.fats,
    }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

    return { ...plan, mealsWithFoodDetails, dailyTotals };
  },
});

// ─── Mutations ─────────────────────────────────────────────────────────────────

/** Create a new meal plan. Coaches can create for a specific client. */
export const create = mutation({
  args: {
    userId: v.optional(v.id("users")),
    name: v.string(),
    targetCalories: v.number(),
    targetProtein: v.number(),
    targetCarbs: v.number(),
    targetFats: v.number(),
    targetFiber: v.optional(v.number()),
    targetWaterMl: v.optional(v.number()),
    meals: v.array(mealValidator),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const targetUserId = args.userId ?? user._id;

    if (targetUserId !== user._id && !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Coach access required" });
    }

    // If marking as active, deactivate current plans
    if (args.isActive) {
      const existing = await ctx.db.query("mealPlans")
        .withIndex("by_user_and_active", q => q.eq("userId", targetUserId).eq("isActive", true))
        .collect();
      for (const p of existing) {
        await ctx.db.patch(p._id, { isActive: false });
      }
    }

    return await ctx.db.insert("mealPlans", {
      userId: targetUserId,
      name: args.name,
      targetCalories: args.targetCalories,
      targetProtein: args.targetProtein,
      targetCarbs: args.targetCarbs,
      targetFats: args.targetFats,
      targetFiber: args.targetFiber,
      targetWaterMl: args.targetWaterMl,
      meals: args.meals,
      isActive: args.isActive,
      createdBy: user._id,
      notes: args.notes,
    });
  },
});

/** Update an existing meal plan. */
export const update = mutation({
  args: {
    id: v.id("mealPlans"),
    name: v.optional(v.string()),
    targetCalories: v.optional(v.number()),
    targetProtein: v.optional(v.number()),
    targetCarbs: v.optional(v.number()),
    targetFats: v.optional(v.number()),
    targetFiber: v.optional(v.number()),
    targetWaterMl: v.optional(v.number()),
    meals: v.optional(v.array(mealValidator)),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const plan = await ctx.db.get(args.id);
    if (!plan) throw new ConvexError({ code: "NOT_FOUND", message: "Meal plan not found" });

    if (plan.userId !== user._id && !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not authorized to edit this plan" });
    }

    const { id, ...updates } = args;

    // If activating, deactivate other plans
    if (updates.isActive === true) {
      const existing = await ctx.db.query("mealPlans")
        .withIndex("by_user_and_active", q => q.eq("userId", plan.userId).eq("isActive", true))
        .collect();
      for (const p of existing) {
        if (p._id !== id) await ctx.db.patch(p._id, { isActive: false });
      }
    }

    await ctx.db.patch(id, updates);
  },
});

/** Delete a meal plan. */
export const remove = mutation({
  args: { id: v.id("mealPlans") },
  handler: async (ctx, args) => {
    const user = await requireCoach(ctx);
    const plan = await ctx.db.get(args.id);
    if (!plan) throw new ConvexError({ code: "NOT_FOUND", message: "Meal plan not found" });
    if (plan.createdBy !== user._id && !hasRole(user, "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not authorized" });
    }
    await ctx.db.delete(args.id);
  },
});

/** Duplicate a meal plan for same or different client. */
export const duplicate = mutation({
  args: {
    id: v.id("mealPlans"),
    targetUserId: v.optional(v.id("users")),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCoach(ctx);
    const plan = await ctx.db.get(args.id);
    if (!plan) throw new ConvexError({ code: "NOT_FOUND", message: "Meal plan not found" });

    const targetUserId = args.targetUserId ?? plan.userId;
    return await ctx.db.insert("mealPlans", {
      userId: targetUserId,
      name: args.newName ?? `${plan.name} (Copy)`,
      targetCalories: plan.targetCalories,
      targetProtein: plan.targetProtein,
      targetCarbs: plan.targetCarbs,
      targetFats: plan.targetFats,
      targetFiber: plan.targetFiber,
      targetWaterMl: plan.targetWaterMl,
      meals: plan.meals,
      isActive: false,
      createdBy: user._id,
      notes: plan.notes,
    });
  },
});

/** Set a plan as the active plan for a user (deactivates others). */
export const setActive = mutation({
  args: {
    id: v.id("mealPlans"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const plan = await ctx.db.get(args.id);
    if (!plan) throw new ConvexError({ code: "NOT_FOUND", message: "Meal plan not found" });

    if (plan.userId !== user._id && !hasRole(user, "coach", "admin", "owner")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not authorized" });
    }

    if (args.isActive) {
      const existing = await ctx.db.query("mealPlans")
        .withIndex("by_user", q => q.eq("userId", plan.userId))
        .collect();
      for (const p of existing) {
        if (p._id !== args.id && p.isActive) await ctx.db.patch(p._id, { isActive: false });
      }
    }

    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});
