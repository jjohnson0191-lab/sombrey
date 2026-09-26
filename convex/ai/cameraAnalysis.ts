"use node";
/**
 * Camera AI Macro Calculator
 *
 * Server-side action only — never exposes GEMINI_API_KEY, EDAMAM_APP_ID,
 * or EDAMAM_APP_KEY to the frontend.
 *
 * Workflow:
 *   1. Fetch the meal photo from Convex storage.
 *   2. Send image to Gemini Vision to identify foods + estimate grams.
 *   3. Look up each food in Edamam Food Database for per-100g nutrition.
 *   4. Scale nutrition by estimated grams and return results.
 */
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v, ConvexError } from "convex/values";

// ─── Internal types ───────────────────────────────────────────────────────────

type GeminiFoodItem = {
  foodName: string;
  grams: number;
  preparation?: string;
};

type EdamamNutrients = {
  ENERC_KCAL?: number;
  PROCNT?: number;
  CHOCDF?: number;
  FAT?: number;
};

// ─── Public return types ──────────────────────────────────────────────────────

export type AnalyzedFoodItem = {
  foodName: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  edamamMatched: boolean;
};

type AnalyzeResult = {
  success: boolean;
  items: AnalyzedFoodItem[];
  error?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function lookupEdamam(
  foodName: string,
  preparation: string | undefined,
  grams: number,
  appId: string,
  appKey: string,
): Promise<{ calories: number; protein: number; carbs: number; fat: number; matched: boolean }> {
  const query = preparation ? `${preparation} ${foodName}` : foodName;
  const url =
    `https://api.edamam.com/api/food-database/v2/parser` +
    `?ingr=${encodeURIComponent(query)}` +
    `&app_id=${appId}&app_key=${appKey}` +
    `&nutrition-type=cooking`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return { calories: 0, protein: 0, carbs: 0, fat: 0, matched: false };

    const data = await resp.json() as Record<string, unknown>;
    const hints = data.hints as Array<Record<string, unknown>> | undefined;
    if (!hints || hints.length === 0) return { calories: 0, protein: 0, carbs: 0, fat: 0, matched: false };

    const food = (hints[0] as Record<string, unknown>).food as Record<string, unknown>;
    const nutrients = food.nutrients as EdamamNutrients | undefined;
    if (!nutrients) return { calories: 0, protein: 0, carbs: 0, fat: 0, matched: false };

    // Edamam returns per-100g values; scale by estimated grams
    const factor = grams / 100;
    return {
      calories: Math.round((nutrients.ENERC_KCAL ?? 0) * factor),
      protein: Math.round((nutrients.PROCNT ?? 0) * factor * 10) / 10,
      carbs: Math.round((nutrients.CHOCDF ?? 0) * factor * 10) / 10,
      fat: Math.round((nutrients.FAT ?? 0) * factor * 10) / 10,
      matched: true,
    };
  } catch {
    // Edamam lookup failed — caller will display zeros for user to edit
    return { calories: 0, protein: 0, carbs: 0, fat: 0, matched: false };
  }
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
For each item, estimate the portion weight in grams using visual cues such as plate size,
typical serving amounts, and visible volume.

Return ONLY a valid JSON array — no markdown, no code fences, no extra text.
Example: [{"foodName":"grilled chicken breast","grams":150},{"foodName":"white rice","grams":200,"preparation":"cooked"}]

Rules:
- foodName: simple common English name (good for a nutrition database search)
- grams: integer weight estimate of the visible portion
- preparation: optional (grilled, fried, boiled, raw, baked, steamed, etc.)
- Include ALL visible foods including sauces, dressings, and sides
- If you cannot identify any food, return exactly: []`;

    const geminiPayload = {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: { temperature: 0.1 },
    };

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_VISION_MODEL ?? "gemini-3.5-flash-lite"}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      },
    );

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
    let foodItems: GeminiFoodItem[] = [];
    try {
      const candidates = geminiData.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      const text = (parts?.[0]?.text as string | undefined)?.trim() ?? "";

      if (!text) return { success: false, items: [], error: "No response from vision API." };

      // Strip markdown code fences if Gemini adds them despite instructions
      const jsonText = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(jsonText) as unknown;
      if (!Array.isArray(parsed)) {
        return { success: false, items: [], error: "Unexpected response format from vision API." };
      }
      foodItems = parsed as GeminiFoodItem[];
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

    // ── 4. Parallel Edamam lookups ────────────────────────────────────────────
    const nutritionResults = await Promise.all(
      foodItems.map(item =>
        lookupEdamam(item.foodName, item.preparation, item.grams, edamamAppId, edamamAppKey),
      ),
    );

    const items: AnalyzedFoodItem[] = foodItems.map((item, i) => ({
      foodName: item.foodName,
      grams: item.grams,
      calories: nutritionResults[i].calories,
      protein: nutritionResults[i].protein,
      carbs: nutritionResults[i].carbs,
      fat: nutritionResults[i].fat,
      edamamMatched: nutritionResults[i].matched,
    }));

    return { success: true, items };
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
      })),
    });
  },
});
