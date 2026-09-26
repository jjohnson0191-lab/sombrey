// Nutrition › AI Macro Calculator — the native photo-to-meal flow.
//
//   generateUploadUrl → (app uploads the photo)
//   startAnalysis     → records the photo as the caller's (ownership) and
//                       schedules the analysis (ai/cameraAnalysis.ts)
//   get               → live status/result for the app (no polling loop)
//   confirm           → the user's reviewed values become a real logged meal
//                       through the normal nutrition path — idempotent
//   discard           → the user cancelled
//
// PRIVACY: the photo goes to Google Gemini (food identification, portion
// estimate) and food NAMES to Edamam (nutrition) — the providers already
// used by this codebase, only when their keys are configured. The photo is
// deleted from storage as soon as it's analysed (or discarded) and is never
// returned by any query. Nothing is logged to nutrition without the user's
// explicit confirmation.

import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { appendNutritionEntry } from "./nutritionLogs";
import { PHOTO_MEAL_CATEGORY } from "./foods";
import { analysisReason, photoMealTotals, validateConfirmedMeal } from "./nutrition/photoMeal";

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

async function ownRow(ctx: QueryCtx | MutationCtx, userId: Id<"users">, id: Id<"mealPhotoLogs">) {
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
  return row;
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Records the just-uploaded photo as the caller's and starts the analysis. */
export const startAnalysis = mutation({
  args: { storageId: v.id("_storage"), localDate: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw new ConvexError({ code: "NOT_FOUND", message: "Photo not found" });
    if ((meta.contentType ?? "").split("/")[0] !== "image" || meta.size > 8_000_000) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError({ code: "INVALID", message: "Not a usable photo" });
    }
    const id = await ctx.db.insert("mealPhotoLogs", {
      userId: user._id,
      storageId: args.storageId,
      loggedDate: args.localDate,
      loggedAt: Date.now(),
      aiStatus: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.ai.cameraAnalysis.analyzeMealPhotoLog, { id });
    return id;
  },
});

export const forAnalysis = internalQuery({
  args: { id: v.id("mealPhotoLogs") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.aiStatus !== "pending") return null;
    return { storageId: row.storageId };
  },
});

const itemValidator = v.object({
  foodName: v.string(),
  grams: v.number(),
  calories: v.number(),
  protein: v.number(),
  carbs: v.number(),
  fat: v.number(),
  matched: v.boolean(),
});

/** Stores the analysis and deletes the photo — it isn't kept. */
export const storeAnalysis = internalMutation({
  args: { id: v.id("mealPhotoLogs"), success: v.boolean(), error: v.optional(v.string()), items: v.array(itemValidator) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    if (row.storageId) await ctx.storage.delete(row.storageId);
    const found = args.success && args.items.length > 0;
    const totals = photoMealTotals(args.items);
    await ctx.db.patch(args.id, {
      storageId: undefined,
      aiStatus: found ? "done" : "error",
      aiItems: args.items,
      aiError: found ? undefined : (args.error ?? "no_food"),
      aiCalories: found ? totals.calories : undefined,
      aiProtein: found ? totals.protein : undefined,
      aiCarbs: found ? totals.carbs : undefined,
      aiFats: found ? totals.fat : undefined,
      description: found ? args.items.map((i) => i.foodName).join(", ").slice(0, 120) : undefined,
    });
  },
});

/** The live status and estimate for the app. Never includes the photo. */
export const get = query({
  args: { id: v.id("mealPhotoLogs") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id) return null;
    const reason = analysisReason(row.aiError);
    return {
      id: row._id,
      status: row.aiStatus,
      reason,
      items: row.aiItems ?? [],
      calories: row.aiCalories,
      protein: row.aiProtein,
      carbs: row.aiCarbs,
      fat: row.aiFats,
      suggestedName: row.description,
      confirmed: row.confirmedAt !== undefined,
    };
  },
});

/** The user reviewed the estimate: their values become a real logged meal
 * (their own custom food + today's nutrition log). Idempotent — confirming
 * twice never logs twice. */
export const confirm = mutation({
  args: {
    id: v.id("mealPhotoLogs"),
    name: v.string(),
    mealType: v.string(),
    date: v.number(),        // the nutrition day key the app uses (NutritionDate)
    calories: v.number(),
    protein: v.number(),
    carbs: v.number(),
    fat: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ownRow(ctx, user._id, args.id);
    if (row.confirmedAt !== undefined && row.loggedFoodId) return { foodId: row.loggedFoodId, alreadyLogged: true };
    const problem = validateConfirmedMeal(args);
    if (problem) throw new ConvexError({ code: "INVALID", message: problem });
    const now = new Date().toISOString();
    const foodId = await ctx.db.insert("foods", {
      name: args.name.trim(),
      calories: Math.round(args.calories),
      protein: Math.round(args.protein * 10) / 10,
      carbs: Math.round(args.carbs * 10) / 10,
      fats: Math.round(args.fat * 10) / 10,
      servingSize: "1",
      servingUnit: "meal",
      category: PHOTO_MEAL_CATEGORY,
      isCustom: true,
      createdBy: user._id,
      createdAt: now,
    });
    const food = (await ctx.db.get(foodId))!;
    await appendNutritionEntry(ctx, user._id, args.date, food, 1, args.mealType);
    await ctx.db.patch(args.id, {
      confirmedAt: Date.now(),
      loggedFoodId: foodId,
      mealType: args.mealType,
      manualCalories: Math.round(args.calories),
      manualProtein: args.protein,
      manualCarbs: args.carbs,
      manualFats: args.fat,
    });
    return { foodId, alreadyLogged: false };
  },
});

/** Cancelled: the analysis record (and photo, if still there) is removed. */
export const discard = mutation({
  args: { id: v.id("mealPhotoLogs") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id || row.confirmedAt !== undefined) return;
    if (row.storageId) await ctx.storage.delete(row.storageId);
    await ctx.db.delete(args.id);
  },
});
