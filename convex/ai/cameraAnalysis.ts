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
import { v, ConvexError } from "convex/values";
import {
  CONFIDENCE_LEVELS, PREPARATION_STATES, chooseCandidate, matchQueries, parseIdentifiedFoods, scaleCandidate,
  type Candidate, type Confidence, type IdentifiedFood, type MatchChoice, type PreparationState,
} from "../nutrition/foodMatch";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnalyzedFoodItem = {
  foodName: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  edamamMatched: boolean;
  /** As Gemini saw it (controlled set), and how sure it was. */
  preparationState: PreparationState;
  confidence: Confidence;
  /** The Edamam entry the nutrition came from. */
  matchedFood?: string;
  /** That entry's label states the preparation (see nutrition/foodMatch.ts). */
  preparationMatched: boolean;
  /** The state was unknown and a staple was matched as cooked. */
  preparationAssumed: boolean;
};

type AnalyzeResult = {
  success: boolean;
  items: AnalyzedFoodItem[];
  error?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** One Edamam parser query → its candidates (`parsed` first, then hints). */
async function edamamCandidates(query: string, appId: string, appKey: string): Promise<{ candidates: Candidate[]; failure?: string }> {
  const url =
    `https://api.edamam.com/api/food-database/v2/parser` +
    `?ingr=${encodeURIComponent(query)}` +
    `&app_id=${appId}&app_key=${appKey}` +
    `&nutrition-type=cooking`;
  try {
    const resp = await fetch(url);
    // The HTTP status (never the key) is kept so a failing provider is
    // diagnosable instead of silently reading as "no match".
    if (!resp.ok) {
      // Edamam's own reason (credentials never included: the app id is
      // redacted from the echo, the key isn't in responses).
      const raw = (await resp.text().catch(() => "")).split(appId).join("[app_id]");
      let message = "";
      try { message = String((JSON.parse(raw) as { message?: unknown }).message ?? "").slice(0, 120); } catch { /* HTML error page */ }
      return { candidates: [], failure: `http_${resp.status}${message ? ` ${message}` : ""}` };
    }
    const data = await resp.json() as { parsed?: Array<{ food?: unknown }>; hints?: Array<{ food?: unknown }> };
    const candidates: Candidate[] = [];
    for (const entry of [...(data.parsed ?? []), ...(data.hints ?? [])]) {
      const food = entry.food as { label?: unknown; category?: unknown; nutrients?: Record<string, unknown> } | undefined;
      const n = food?.nutrients;
      if (typeof food?.label !== "string" || !n || typeof n.ENERC_KCAL !== "number") continue;
      candidates.push({
        label: food.label,
        category: typeof food.category === "string" ? food.category : undefined,
        kcal: n.ENERC_KCAL,
        protein: Number(n.PROCNT ?? 0),
        carbs: Number(n.CHOCDF ?? 0),
        fat: Number(n.FAT ?? 0),
      });
    }
    return candidates.length ? { candidates } : { candidates, failure: "no_hints" };
  } catch {
    return { candidates: [], failure: "network" };
  }
}

/** Nutrition for one identified food, matched on identity AND preparation
 * state (nutrition/foodMatch.ts). Queries run most-specific first and stop
 * at the first entry whose label states the right preparation; an entry
 * that contradicts it is never used — no match beats a wrong one. */
async function lookupNutrition(food: IdentifiedFood, appId: string, appKey: string): Promise<AnalyzedFoodItem & { failure?: string }> {
  const plan = matchQueries(food);
  const pool: Candidate[] = [];
  const failures: string[] = [];
  let choice: MatchChoice | null = null;
  for (const query of plan.queries) {
    const r = await edamamCandidates(query, appId, appKey);
    if (r.failure) failures.push(r.failure);
    if (r.failure?.startsWith("http_") || r.failure === "network") break; // provider down: don't hammer it
    pool.push(...r.candidates);
    choice = chooseCandidate(plan.name, plan.state, pool);
    if (choice && (choice.preparationMatched || plan.state === "unknown")) break;
  }
  const base = {
    foodName: food.foodName,
    grams: food.grams,
    preparationState: food.preparationState,
    confidence: food.confidence,
    preparationAssumed: plan.assumed,
  };
  if (!choice) {
    return { ...base, calories: 0, protein: 0, carbs: 0, fat: 0, edamamMatched: false, preparationMatched: false, failure: failures[0] ?? "no_safe_match" };
  }
  return { ...base, ...scaleCandidate(choice.candidate, food.grams), edamamMatched: true, matchedFood: choice.candidate.label, preparationMatched: choice.preparationMatched };
}

// ─── Action ───────────────────────────────────────────────────────────────────

/** The analysis itself — shared by the legacy public action and the
 * owner-checked Nutrition flow below. Sends the image to Google Gemini
 * (food identification + gram estimates) and each food NAME to Edamam
 * (nutrition per portion). Nothing else about the user is sent. */
export async function analyzeImageAtUrl(imageUrl: string, geminiKey: string, edamamAppId: string, edamamAppKey: string): Promise<AnalyzeResult> {
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

    // ── 4. Edamam lookups (parallel across foods) ─────────────────────────────
    const items = await Promise.all(foodItems.map((item) => lookupNutrition(item, edamamAppId, edamamAppKey)));

    // Foods recognised but NO nutrition found for any of them: not an
    // estimate of 0 kcal — an honest failure, with the provider's reason.
    if (!items.some((r) => r.edamamMatched)) {
      const reasons = [...new Set(items.map((r) => r.failure ?? "unknown"))].join(",");
      console.log(`analyzeImageAtUrl: nutrition lookup failed for all ${foodItems.length} items (${reasons})`);
      return { success: false, items: [], error: `nutrition_unavailable:${reasons}` };
    }

    return { success: true, items: items.map(({ failure: _f, ...item }) => item) };
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
    return analyzeImageAtUrl(imageUrl, geminiKey, edamamAppId, edamamAppKey);
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
          ? await analyzeImageAtUrl(imageUrl, geminiKey, edamamAppId, edamamAppKey)
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
      })),
    });
  },
});
