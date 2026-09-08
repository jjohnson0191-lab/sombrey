import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";

/**
 * Returns today's nutrition progress: calories/protein consumed vs AI plan targets,
 * plus meal completion counts from coach-assigned meal plan (mealLogs).
 */
export const getTodayProgress = query({
  args: {
    // #7 — local-midnight timestamp for the user's current calendar day.
    // Pass startOfDay(new Date()).getTime() from the frontend to ensure the
    // query reads the correct local date rather than UTC midnight.
    localDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    // #7 — prefer the frontend-supplied local date; fall back to UTC midnight for
    // callers that don't yet pass the argument.
    const todayUTC = args.localDate ??
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

    // Get AI plan for macro targets
    const aiPlan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    const macroTargets = aiPlan?.status === "ready" ? aiPlan.macroTargets : null;

    // AI plan meals count
    const totalMealsInPlan = aiPlan?.status === "ready" ? (aiPlan.meals?.length ?? 0) : 0;

    // Get today's nutrition log for tracked macros
    const nutritionLog = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", todayUTC))
      .first();

    // Get coach meal plan completion
    const activeMealPlan = await ctx.db
      .query("mealPlans")
      .withIndex("by_user_and_active", (q) => q.eq("userId", user._id).eq("isActive", true))
      .first();

    let totalMealsToday = 0;
    let mealsCompleted = 0;

    if (activeMealPlan) {
      totalMealsToday = activeMealPlan.meals.length;
      // Count completed meal logs for today
      const mealLogsToday = await ctx.db
        .query("mealLogs")
        .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).eq("date", todayUTC))
        .collect();
      mealsCompleted = mealLogsToday.filter((ml) => ml.isCompleted).length;
    } else if (totalMealsInPlan > 0) {
      // Use AI plan meals count; completion tracked via nutritionLogs mealType entries
      totalMealsToday = totalMealsInPlan;
      const uniqueMealTypes = new Set(nutritionLog?.foods.map((f) => f.mealType) ?? []);
      // Consider a meal "started" if any food is logged for it
      mealsCompleted = uniqueMealTypes.size;
    }

    return {
      caloriesConsumed: Math.round(nutritionLog?.totalCalories ?? 0),
      proteinConsumed: Math.round(nutritionLog?.totalProtein ?? 0),
      carbsConsumed: Math.round(nutritionLog?.totalCarbs ?? 0),
      fatsConsumed: Math.round(nutritionLog?.totalFats ?? 0),
      caloriesTarget: macroTargets?.calories ?? 2500,
      proteinTarget: macroTargets?.protein ?? 180,
      carbsTarget: macroTargets?.carbs ?? 250,
      fatsTarget: macroTargets?.fats ?? 70,
      totalMealsToday,
      mealsCompleted,
    };
  },
});

export const getByDate = query({
  args: { 
    userId: v.optional(v.id("users")),
    date: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    const targetUserId = args.userId ?? currentUser._id;

    // Authorization: clients can only read their own logs; coaches/admins can read any client's log
    if (targetUserId !== currentUser._id && !hasRole(currentUser, "coach", "admin", "owner", "assistant_coach")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    const log = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => 
        q.eq("userId", targetUserId).eq("date", args.date)
      )
      .first();

    if (!log) {
      return null;
    }

    // Get food details
    const foodsWithDetails = await Promise.all(
      log.foods.map(async (f) => {
        const food = await ctx.db.get(f.foodId);
        return {
          ...f,
          foodName: food?.name || "Unknown",
          protein: food?.protein || 0,
          carbs: food?.carbs || 0,
          fats: food?.fats || 0,
          calories: food?.calories || 0,
        };
      })
    );

    return {
      ...log,
      foodsWithDetails,
    };
  },
});

export const logFood = mutation({
  args: {
    userId: v.optional(v.id("users")),
    date: v.number(),
    foodId: v.id("foods"),
    servings: v.number(),
    mealType: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    const targetUserId = args.userId ?? currentUser._id;

    // Authorization: clients can only log food for themselves; coaches/admins can log for a client
    if (targetUserId !== currentUser._id && !hasRole(currentUser, "coach", "admin", "owner", "assistant_coach")) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    }

    // Get food details to calculate macros
    const food = await ctx.db.get(args.foodId);
    if (!food) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Food not found",
      });
    }

    // Macros: food.protein/carbs/fats/calories are per-serving values; multiply by
    // the number of servings consumed. (The per-100g fields are used only by the
    // coach meal-plan system which applies its own ×(grams/100) formula.)
    const protein = food.protein * args.servings;
    const carbs = food.carbs * args.servings;
    const fats = food.fats * args.servings;
    const calories = food.calories * args.servings;

    // #8 — generate a stable entry ID so removal does not rely on array position.
    const entryId = crypto.randomUUID();

    // Check if log exists for this date
    const existingLog = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => 
        q.eq("userId", targetUserId).eq("date", args.date)
      )
      .first();

    if (existingLog) {
      // Update existing log
      await ctx.db.patch(existingLog._id, {
        foods: [
          ...existingLog.foods,
          {
            foodId: args.foodId,
            servings: args.servings,
            mealType: args.mealType,
            entryId,
          },
        ],
        totalProtein: existingLog.totalProtein + protein,
        totalCarbs: existingLog.totalCarbs + carbs,
        totalFats: existingLog.totalFats + fats,
        totalCalories: existingLog.totalCalories + calories,
      });
      return existingLog._id;
    } else {
      // Create new log
      return await ctx.db.insert("nutritionLogs", {
        userId: targetUserId,
        date: args.date,
        foods: [{
          foodId: args.foodId,
          servings: args.servings,
          mealType: args.mealType,
          entryId,
        }],
        totalProtein: protein,
        totalCarbs: carbs,
        totalFats: fats,
        totalCalories: calories,
      });
    }
  },
});

export const removeFood = mutation({
  args: {
    date: v.number(),
    // #8 — prefer stable entryId; foodIndex is kept for backward compatibility with
    // existing log entries that were created before entryId was added.
    entryId: v.optional(v.string()),
    foodIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    const log = await ctx.db
      .query("nutritionLogs")
      .withIndex("by_user_and_date", (q) => 
        q.eq("userId", currentUser._id).eq("date", args.date)
      )
      .first();

    if (!log) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Nutrition log not found",
      });
    }

    // #8 — resolve the target entry by stable entryId when available.
    let targetIndex: number;
    if (args.entryId != null) {
      targetIndex = log.foods.findIndex((f) => f.entryId === args.entryId);
      if (targetIndex === -1) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Food entry not found" });
      }
    } else if (args.foodIndex != null) {
      // Legacy path: old entries have no entryId; use index as fallback.
      targetIndex = args.foodIndex;
    } else {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Must provide entryId or foodIndex" });
    }

    const foodToRemove = log.foods[targetIndex];
    if (!foodToRemove) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Food entry not found",
      });
    }

    const newFoods = log.foods.filter((_, i) => i !== targetIndex);

    // #6 — recompute totals from remaining entries using current food DB values.
    // Subtracting using re-fetched food data is still subject to drift if the food
    // record was edited since it was logged. A full recompute from the remaining
    // entries is the only way to guarantee totals stay accurate.
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFats = 0;

    for (const entry of newFoods) {
      const food = await ctx.db.get(entry.foodId);
      if (food) {
        totalCalories += food.calories * entry.servings;
        totalProtein += food.protein * entry.servings;
        totalCarbs += food.carbs * entry.servings;
        totalFats += food.fats * entry.servings;
      }
      // If the food record was deleted, omit its contribution from totals.
    }

    await ctx.db.patch(log._id, {
      foods: newFoods,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFats,
    });
  },
});


