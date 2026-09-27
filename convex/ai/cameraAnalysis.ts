"use node";
/**
 * Camera AI Macro Calculator
 *
 * Server-side action only — never exposes GEMINI_API_KEY, EDAMAM_APP_ID,
 * or EDAMAM_APP_KEY to the frontend.
 *
 * Workflow:
 *   1. Fetch the meal photo from Convex storage.
 *   2. Send image to Gemini Vision: each food's identity, preparation state,
 *      served weight and confidence (structured output).
 *   3. Look up each food in the Edamam Food Database, matched on identity
 *      AND preparation state (nutrition/foodMatch.ts) — per-100g nutrition.
 *   4. Scale nutrition by served grams and return results.
 */
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { EdamamSession, lookupAll, type AnalyzedFoodItem, type EdamamGate } from "../nutrition/edamamLookup";
import { v, ConvexError } from "convex/values";
import { CONFIDENCE_LEVELS, PREPARATION_STATES, parseIdentifiedFoods, type IdentifiedFood } from "../nutrition/foodMatch";

// ─── Types ──────────────────────────────────────────────────────────────────

type AnalyzeResult = {
  success: boolean;
  items: AnalyzedFoodItem[];
  error?: string;
};

// ─── Action ───────────────────────────────────────────────────────────────────

/** The analysis itself — shared by the legacy public action and the
 * owner-checked Nutrition flow below. Sends the image to Google Gemini
 * (food identification + gram estimates) and each food NAME to Edamam
 * (nutrition per portion). Nothing else about the user is sent. */
export async function analyzeImageAtUrl(imageUrl: string, geminiKey: string, edamamAppId: string, edamamAppKey: string, gate: EdamamGate): Promise<AnalyzeResult> {
    // ── 1. Get image from Convex storage ─────────────────────────────────────

    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) return { success: false, items: [], error: "Could not retrieve image." };

    const imageBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");
    const rawMime = imageResp.headers.get("content-type") ?? "image/jpeg";
    const imageMimeType = rawMime.split(";")[0].trim();

    // ── 2. Call Gemini Vision ─────────────────────────────────────────────────
    const prompt = `Analyze this meal photo. Identify every distinct food item visible.

For each item give, as SEPARATE facts:
- foodName: the food's identity only — a simple common English name good for a nutrition database search ("pasta", "white rice", "chicken breast"). Do not put the cooking method in the name.
- preparationState: one of ${PREPARATION_STATES.join(", ")}.
  • "dry" = uncooked grain/pasta/legume/oats as sold; "raw" = uncooked meat, fish, egg, vegetable or fruit.
  • Use the specific method (fried, grilled, boiled, steamed, baked, roasted) when it is visible; "cooked" when it is clearly cooked but the method isn't clear.
  • Pasta, rice, noodles, oats/porridge, grains, beans and lentils served on a plate or in a bowl as part of a meal are cooked unless they are visibly dry (in a packet, jar or measuring cup).
  • Use "unknown" when the state genuinely cannot be determined. Never guess.
- estimatedWeightGrams: integer weight of the portion as it is SERVED in the photo (cooked weight for cooked food), using plate size, typical servings and visible volume.
- confidence: high, medium or low — how sure you are of the identity, state and weight together.

Include ALL visible foods, including sauces, dressings, oils and sides. If you cannot identify any food, return an empty array.`;

    const itemSchema = {
      type: "OBJECT",
      properties: {
        foodName: { type: "STRING" },
        preparationState: { type: "STRING", enum: [...PREPARATION_STATES] },
        estimatedWeightGrams: { type: "INTEGER" },
        confidence: { type: "STRING", enum: [...CONFIDENCE_LEVELS] },
      },
      required: ["foodName", "preparationState", "estimatedWeightGrams", "confidence"],
      propertyOrdering: ["foodName", "preparationState", "estimatedWeightGrams", "confidence"],
    };
    const callGemini = (structured: boolean) => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_VISION_MODEL ?? "gemini-3.5-flash-lite"}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: structured ? prompt : `${prompt}\n\nReturn ONLY a JSON array of {foodName, preparationState, estimatedWeightGrams, confidence} — no markdown, no extra text.` },
              { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
            ],
          }],
          generationConfig: structured
            ? { temperature: 0.1, responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: itemSchema } }
            : { temperature: 0.1 },
        }),
      },
    );

    // Structured output (the enum is enforced by Gemini); a model that
    // rejects the schema falls back to the same prompt as plain JSON.
    let geminiResp = await callGemini(true);
    if (geminiResp.status === 400) geminiResp = await callGemini(false);

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      return {
        success: false,
        items: [],
        error: `Vision API error (${geminiResp.status}): ${errText.slice(0, 150)}`,
      };
    }

    const geminiData = await geminiResp.json() as Record<string, unknown>;

    // ── 3. Parse Gemini JSON ──────────────────────────────────────────────────
    let foodItems: IdentifiedFood[] = [];
    try {
      const candidates = geminiData.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      const text = (parts?.[0]?.text as string | undefined)?.trim() ?? "";

      if (!text) return { success: false, items: [], error: "No response from vision API." };
      foodItems = parseIdentifiedFoods(text);
    } catch {
      return { success: false, items: [], error: "Failed to parse vision API response." };
    }

    if (foodItems.length === 0) {
      return {
        success: true,
        items: [],
        error: "No food items detected. Try a clearer photo or enter macros manually.",
      };
    }

    // ── 4. Edamam lookups (budgeted, deduplicated, rate-limited) ──────────────
    const session = new EdamamSession(edamamAppId, edamamAppKey, gate);
    const items = await lookupAll(foodItems, session);
    console.log(`analyzeImageAtUrl: ${foodItems.length} foods, ${session.budget.hits} Edamam hits`);

    // Foods recognised but NO nutrition found for any of them: not an
    // estimate of 0 kcal — an honest failure, with the provider's reason.
    if (!items.some((r) => r.edamamMatched)) {
      const reasons = [...new Set(items.map((r) => r.lookupIssue ?? "unknown"))].join(",");
      console.log(`analyzeImageAtUrl: nutrition lookup failed for all ${foodItems.length} items (${reasons})`);
      return { success: false, items: [], error: `nutrition_unavailable:${reasons}` };
    }

    return { success: true, items };
}

/** The gate backed by the deployment-wide limiter. */
function edamamGate(ctx: ActionCtx): EdamamGate {
  return {
    acquire: async () => {
      const r = await ctx.runMutation(internal.edamamLimiter.reserveHit, {});
      if (!r.ok) return false;
      if (r.waitMs > 0) await new Promise((res) => setTimeout(res, r.waitMs));
      return true;
    },
    rateLimited: async () => { await ctx.runMutation(internal.edamamLimiter.rateLimited, {}); },
  };
}

export const analyzeMealPhoto = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<AnalyzeResult> => {
    // Legacy entry point (web). The native flow uses `analyzeMealPhotoLog`,
    // which checks the photo belongs to the caller.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    }
    const geminiKey = process.env.GEMINI_API_KEY;
    const edamamAppId = process.env.EDAMAM_APP_ID;
    const edamamAppKey = process.env.EDAMAM_APP_KEY;
    if (!geminiKey || !edamamAppId || !edamamAppKey) {
      return { success: false, items: [], error: "Missing API credentials — please try again later or contact support." };
    }
    const imageUrl = await ctx.storage.getUrl(args.storageId);
    if (!imageUrl) return { success: false, items: [], error: "Image not found in storage." };
    return analyzeImageAtUrl(imageUrl, geminiKey, edamamAppId, edamamAppKey, edamamGate(ctx));
  },
});

/** Native Nutrition › AI Macro Calculator: analyses the photo of a
 * `mealPhotoLogs` row the caller created (ownership recorded at upload,
 * `mealPhotos:startAnalysis`), stores the result on that row and deletes
 * the photo — it isn't kept once analysed. */
export const analyzeMealPhotoLog = internalAction({
  args: { id: v.id("mealPhotoLogs") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(internal.mealPhotos.forAnalysis, { id: args.id });
    if (!row || !row.storageId) return;
    const geminiKey = process.env.GEMINI_API_KEY;
    const edamamAppId = process.env.EDAMAM_APP_ID;
    const edamamAppKey = process.env.EDAMAM_APP_KEY;
    let result: AnalyzeResult;
    if (!geminiKey || !edamamAppId || !edamamAppKey) {
      result = { success: false, items: [], error: "not_configured" };
    } else {
      const imageUrl = await ctx.storage.getUrl(row.storageId);
      try {
        result = imageUrl
          ? await analyzeImageAtUrl(imageUrl, geminiKey, edamamAppId, edamamAppKey, edamamGate(ctx))
          : { success: false, items: [], error: "Image not found." };
      } catch {
        result = { success: false, items: [], error: "Analysis failed." };
      }
    }
    await ctx.runMutation(internal.mealPhotos.storeAnalysis, {
      id: args.id,
      success: result.success,
      error: result.error,
      items: result.items.map((i) => ({
        foodName: i.foodName.slice(0, 80),
        grams: Math.max(0, Math.round(i.grams)),
        calories: Math.max(0, Math.round(i.calories)),
        protein: Math.max(0, Math.round(i.protein * 10) / 10),
        carbs: Math.max(0, Math.round(i.carbs * 10) / 10),
        fat: Math.max(0, Math.round(i.fat * 10) / 10),
        matched: i.edamamMatched,
        preparationState: i.preparationState,
        confidence: i.confidence,
        matchedFood: i.matchedFood?.slice(0, 120),
        preparationMatched: i.preparationMatched,
        preparationAssumed: i.preparationAssumed,
        lookupIssue: i.lookupIssue,
      })),
    });
  },
});
