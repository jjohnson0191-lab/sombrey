import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { hasRole } from "./lib/roles.js";
import { MEAL_TYPES, buildExternalSnapshot, entryNutrition, foodSnapshot, validEntryId, type ExternalSnapshot, type FoodSnapshot } from "./nutrition/logEntry";

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
      // Where the targets below come from. "none" means the user has no
      // targets yet and the numbers are only the legacy web defaults —
      // clients must not present them as the user's own targets.
      targetsSource: macroTargets ? "ai_plan" : "none",
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

    // Get food details. An external snapshot (Search Foods › Edamam) carries
    // its own name and nutrition — displayed without asking the provider.
    const foodsWithDetails = await Promise.all(
      log.foods.map(async (f) => {
        // A snapshot (every entry logged from the Food Library on, and every
        // Edamam entry): the values confirmed then, per serving.
        if (f.calories !== undefined) {
          return {
            ...f,
            foodName: f.name || "Unknown",
            protein: f.protein ?? 0,
            carbs: f.carbs ?? 0,
            fats: f.fats ?? 0,
            calories: f.calories ?? 0,
          };
        }
        const food = f.foodId ? await ctx.db.get(f.foodId) : null;
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
    // Optional idempotency key (the native app sends one per confirmation):
    // an entry already logged with it isn't logged again.
    entryId: v.optional(v.string()),
    // Optional: log by weight (the food's per-100 g values × grams; servings
    // is then 1). `portion` is the app's label for a household measure.
    grams: v.optional(v.number()),
    portion: v.optional(v.string()),
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

    if (args.entryId !== undefined && !validEntryId(args.entryId)) {
      throw new ConvexError({ code: "INVALID", message: "Invalid entry id" });
    }
    // Macros: by serving, the food's per-serving values × servings; by grams,
    // its per-100 g values × grams. Either way a snapshot is stored.
    const checked = foodSnapshot(food, args.grams !== undefined ? { grams: args.grams, portionLabel: args.portion } : { servings: args.servings });
    if ("error" in checked) throw new ConvexError({ code: "INVALID", message: checked.error });
    return appendEntry(ctx, targetUserId, args.date, args.mealType, args.entryId, { food, snapshot: checked.snapshot });
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
      // A snapshot counts its own values; a deleted food record adds nothing.
      const food = entry.foodId ? await ctx.db.get(entry.foodId) : null;
      const n = entryNutrition(entry, food);
      totalCalories += n.calories;
      totalProtein += n.protein;
      totalCarbs += n.carbs;
      totalFats += n.fats;
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



/** Search Foods › an Edamam food the user confirmed: logged as a snapshot
 * on the day's log (convex/nutrition/logEntry.ts) — never copied into
 * `foods`. The server scales Edamam's per-100 g values by the grams, so the
 * logged numbers are consistent. Idempotent on `entryId`. */
export const logExternalFood = mutation({
  args: {
    date: v.number(),
    mealType: v.string(),
    entryId: v.string(),
    name: v.string(),
    externalId: v.string(),
    portion: v.string(),
    grams: v.number(),
    per100g: v.object({
      calories: v.number(),
      protein: v.union(v.number(), v.null()),
      carbs: v.union(v.number(), v.null()),
      fat: v.union(v.number(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    if (!validEntryId(args.entryId)) throw new ConvexError({ code: "INVALID", message: "Invalid entry id" });
    if (!(MEAL_TYPES as readonly string[]).includes(args.mealType)) throw new ConvexError({ code: "INVALID", message: "Unknown meal" });
    if (!Number.isFinite(args.date)) throw new ConvexError({ code: "INVALID", message: "Invalid date" });
    const built = buildExternalSnapshot(args);
    if ("error" in built) throw new ConvexError({ code: "INVALID", message: built.error });
    const logId = await appendEntry(ctx, user._id, args.date, args.mealType, args.entryId, { snapshot: built.snapshot });
    return { logId, calories: built.snapshot.calories, protein: built.snapshot.protein, carbs: built.snapshot.carbs, fats: built.snapshot.fats };
  },
});

/** Appends one food to the user's day log (creating the day if needed) and
 * updates the day's totals — the single path every logged food takes
 * (search, and the AI Macro Calculator's confirmed meal). */
export async function appendNutritionEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  date: number,
  food: Doc<"foods">,
  servings: number,
  mealType: string,
  entryId?: string,
): Promise<Id<"nutritionLogs">> {
  const checked = foodSnapshot(food, { servings });
  if ("error" in checked) throw new ConvexError({ code: "INVALID", message: checked.error });
  return appendEntry(ctx, userId, date, mealType, entryId, { food, snapshot: checked.snapshot });
}

/** The one append: a Sombrey food × servings, or an external snapshot.
 * With a caller-supplied `entryId` it's idempotent — an entry already on
 * the day with that id is not appended again. */
async function appendEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  date: number,
  mealType: string,
  givenEntryId: string | undefined,
  item: { food: Doc<"foods">; snapshot: FoodSnapshot } | { snapshot: ExternalSnapshot },
): Promise<Id<"nutritionLogs">> {
  // A stable entry ID so removal does not rely on array position.
  const entryId = givenEntryId ?? crypto.randomUUID();
  const entry = "food" in item
    ? { foodId: item.food._id, ...item.snapshot, mealType, entryId }
    : { ...item.snapshot, servings: 1, mealType, entryId };
  const n = entryNutrition(entry, null);
  const existingLog = await ctx.db
    .query("nutritionLogs")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date))
    .first();
  if (existingLog) {
    if (givenEntryId !== undefined && existingLog.foods.some((f) => f.entryId === givenEntryId)) return existingLog._id;
    await ctx.db.patch(existingLog._id, {
      foods: [...existingLog.foods, entry],
      totalProtein: existingLog.totalProtein + n.protein,
      totalCarbs: existingLog.totalCarbs + n.carbs,
      totalFats: existingLog.totalFats + n.fats,
      totalCalories: existingLog.totalCalories + n.calories,
    });
    return existingLog._id;
  }
  return await ctx.db.insert("nutritionLogs", {
    userId,
    date,
    foods: [entry],
    totalProtein: n.protein,
    totalCarbs: n.carbs,
    totalFats: n.fats,
    totalCalories: n.calories,
  });
}
