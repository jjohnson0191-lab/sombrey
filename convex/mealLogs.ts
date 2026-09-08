import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
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

async function requireCoachOrSelf(ctx: QueryCtx | MutationCtx, targetUserId: string) {
  const user = await requireAuth(ctx);
  if (user._id !== targetUserId && !hasRole(user, "coach", "admin", "owner")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
  }
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Get all meal logs for a specific date (client self or coach viewing client). */
export const getMealLogsForDate = query({
  args: {
    userId: v.optional(v.id("users")),
    date: v.number(),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: import("./_generated/dataModel.js").Id<"mealLogs">;
    userId: import("./_generated/dataModel.js").Id<"users">;
    mealPlanId: import("./_generated/dataModel.js").Id<"mealPlans">;
    mealId: string;
    date: number;
    completedAt?: string;
    imageStorageId?: import("./_generated/dataModel.js").Id<"_storage">;
    imageUrl?: string | null;
    aiMacros?: { calories: number; protein: number; carbs: number; fats: number; description?: string };
    clientMacros?: { calories: number; protein: number; carbs: number; fats: number };
    isCompleted: boolean;
    notes?: string;
    _creationTime: number;
  }>> => {
    const currentUser = await requireAuth(ctx);
    const targetUserId = args.userId ?? currentUser._id;
    await requireCoachOrSelf(ctx, targetUserId);

    const logs = await ctx.db
      .query("mealLogs")
      .withIndex("by_user_and_date", q => q.eq("userId", targetUserId).eq("date", args.date))
      .collect();

    return await Promise.all(logs.map(async (log) => {
      const imageUrl = log.imageStorageId ? await ctx.storage.getUrl(log.imageStorageId) : null;
      return { ...log, imageUrl };
    }));
  },
});

/** Get daily nutrition summary comparing logged macros vs plan targets. */
export const getDailyNutritionSummary = query({
  args: {
    userId: v.optional(v.id("users")),
    date: v.number(),
  },
  handler: async (ctx, args): Promise<{
    targetCalories: number;
    targetProtein: number;
    targetCarbs: number;
    targetFats: number;
    consumedCalories: number;
    consumedProtein: number;
    consumedCarbs: number;
    consumedFats: number;
    mealsCompleted: number;
    totalMeals: number;
    adherencePct: number;
  } | null> => {
    const currentUser = await requireAuth(ctx);
    const targetUserId = args.userId ?? currentUser._id;
    await requireCoachOrSelf(ctx, targetUserId);

    // Get active meal plan for targets
    const plan = await ctx.db
      .query("mealPlans")
      .withIndex("by_user_and_active", q => q.eq("userId", targetUserId).eq("isActive", true))
      .first();
    if (!plan) return null;

    // Get meal logs for date
    const logs = await ctx.db
      .query("mealLogs")
      .withIndex("by_user_and_date", q => q.eq("userId", targetUserId).eq("date", args.date))
      .collect();

    // Sum consumed macros from completed logs (prefer clientMacros over aiMacros)
    let consumedCalories = 0, consumedProtein = 0, consumedCarbs = 0, consumedFats = 0;
    const completedLogs = logs.filter(l => l.isCompleted);
    for (const log of completedLogs) {
      const macros = log.clientMacros ?? log.aiMacros;
      if (macros) {
        consumedCalories += macros.calories;
        consumedProtein += macros.protein;
        consumedCarbs += macros.carbs;
        consumedFats += macros.fats;
      }
    }

    const mealsCompleted = completedLogs.length;
    const totalMeals = plan.meals.length;
    const adherencePct = totalMeals > 0 ? Math.round((mealsCompleted / totalMeals) * 100) : 0;

    return {
      targetCalories: plan.targetCalories,
      targetProtein: plan.targetProtein,
      targetCarbs: plan.targetCarbs,
      targetFats: plan.targetFats,
      consumedCalories,
      consumedProtein,
      consumedCarbs,
      consumedFats,
      mealsCompleted,
      totalMeals,
      adherencePct,
    };
  },
});

// ─── Mutations ─────────────────────────────────────────────────────────────────

/** Generate upload URL for meal photo. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Log or update a meal entry (upsert by userId+date+mealId). */
export const logMeal = mutation({
  args: {
    mealPlanId: v.id("mealPlans"),
    mealId: v.string(),
    date: v.number(),
    imageStorageId: v.optional(v.id("_storage")),
    clientMacros: v.optional(v.object({
      calories: v.number(),
      protein: v.number(),
      carbs: v.number(),
      fats: v.number(),
    })),
    notes: v.optional(v.string()),
    isCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const existing = await ctx.db
      .query("mealLogs")
      .withIndex("by_user_date_meal", q =>
        q.eq("userId", user._id).eq("date", args.date).eq("mealId", args.mealId)
      )
      .first();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.imageStorageId !== undefined) updates.imageStorageId = args.imageStorageId;
      if (args.clientMacros !== undefined) updates.clientMacros = args.clientMacros;
      if (args.notes !== undefined) updates.notes = args.notes;
      if (args.isCompleted !== undefined) {
        updates.isCompleted = args.isCompleted;
        if (args.isCompleted && !existing.completedAt) {
          updates.completedAt = new Date().toISOString();
        }
      }
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    return await ctx.db.insert("mealLogs", {
      userId: user._id,
      mealPlanId: args.mealPlanId,
      mealId: args.mealId,
      date: args.date,
      imageStorageId: args.imageStorageId,
      clientMacros: args.clientMacros,
      notes: args.notes,
      isCompleted: args.isCompleted ?? false,
      completedAt: args.isCompleted ? new Date().toISOString() : undefined,
    });
  },
});

/** Store AI macro analysis results on a meal log. Internal - called from action. */
export const storeAiMacros = internalMutation({
  args: {
    mealLogId: v.id("mealLogs"),
    aiMacros: v.object({
      calories: v.number(),
      protein: v.number(),
      carbs: v.number(),
      fats: v.number(),
      description: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.mealLogId, { aiMacros: args.aiMacros });
  },
});

