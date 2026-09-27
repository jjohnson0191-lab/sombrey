// A nutrition log entry (convex/nutritionLogs.ts) is one of:
//   • a Sombrey-owned food: `foodId` + `servings`, and — from the Food Library
//     on — a snapshot of its name and nutrition taken when the user confirmed,
//     so editing or re-importing the food later never rewrites history.
//     (Entries logged before snapshots existed are still read from `foods`.)
//   • an external snapshot (Search Foods › Edamam): the nutrition the user
//     confirmed, for the whole portion, kept on the entry itself so the day
//     still adds up, displays and can be removed without asking Edamam again.
//     Only what the log needs is kept: name, portion, kcal/protein/carbs/fat,
//     the provider and its food id — never the Edamam response.
//
// A snapshot's calories/protein/carbs/fats are per ONE of the entry's
// `servings` (an external or gram-based entry has servings = 1), so the day's
// contribution is always snapshot × servings — the same arithmetic the web
// app already does with getByDate's per-serving values.
//
// Pure — no I/O — so the rules are tested directly (tests/nutrition).

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export const EXTERNAL_SOURCES = ["edamam"] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

/** The stored snapshot (on the nutritionLogs entry, `servings` = 1). */
export type ExternalSnapshot = {
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  source: ExternalSource;
  externalId: string;
};

/** What the app sends when the user confirms an Edamam food. Nutrition comes
 * as Edamam's per-100 g values and the portion as grams; the server does the
 * scaling, so the logged numbers are always consistent with each other. */
export type ExternalConfirmation = {
  name: string;
  externalId: string;
  portion: string;
  grams: number;
  per100g: { calories: number; protein?: number | null; carbs?: number | null; fat?: number | null };
};

export const MAX_PORTION_GRAMS = 5_000;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Per-100 g nutrition × grams — the same scaling the app previews. A macro
 * Edamam didn't give counts as 0 (the app says so before confirming). */
export function scalePer100g(per100g: ExternalConfirmation["per100g"], grams: number) {
  const f = grams / 100;
  const part = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v * f : 0);
  return { calories: Math.round(part(per100g.calories)), protein: r1(part(per100g.protein)), carbs: r1(part(per100g.carbs)), fats: r1(part(per100g.fat)) };
}

/** A confirmation → the snapshot to store, or why it can't be logged. Rejects
 * anything that would put NaN/Infinity/negative or implausible values in a log. */
export function buildExternalSnapshot(c: ExternalConfirmation, source: ExternalSource = "edamam"): { snapshot: ExternalSnapshot } | { error: string } {
  const name = typeof c.name === "string" ? c.name.trim() : "";
  if (!name || name.length > 120) return { error: "The food needs a name." };
  const externalId = typeof c.externalId === "string" ? c.externalId.trim() : "";
  if (!externalId || externalId.length > 120) return { error: "Unknown food." };
  const portion = typeof c.portion === "string" ? c.portion.trim() : "";
  if (!portion || portion.length > 60) return { error: "Choose a portion." };
  if (typeof c.grams !== "number" || !Number.isFinite(c.grams) || c.grams <= 0 || c.grams > MAX_PORTION_GRAMS) {
    return { error: `The portion must be between 0 and ${MAX_PORTION_GRAMS} g.` };
  }
  const p = c.per100g;
  if (!p || typeof p.calories !== "number" || !Number.isFinite(p.calories) || p.calories < 0 || p.calories > 1_000) {
    return { error: "This food has no usable calorie value." };
  }
  for (const v of [p.protein, p.carbs, p.fat]) {
    if (v !== null && v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)) {
      return { error: "This food's nutrition values aren't usable." };
    }
  }
  return { snapshot: { name, portion, ...scalePer100g(p, c.grams), source, externalId } };
}

/** The shape every entry has in the log (schema: nutritionLogs.foods). */
export type LogEntryLike = {
  foodId?: unknown;
  servings: number;
  source?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
};
type FoodLike = { calories: number; protein: number; carbs: number; fats: number };

/** What one entry adds to the day. A snapshot carries its own nutrition
 * (whatever the food row says now); an older entry without one is the food's
 * per-serving values × servings; a food that no longer exists adds nothing. */
export function entryNutrition(entry: LogEntryLike, food: FoodLike | null): FoodLike {
  if (entry.calories !== undefined) {
    const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v * entry.servings : 0);
    return { calories: n(entry.calories), protein: n(entry.protein), carbs: n(entry.carbs), fats: n(entry.fats) };
  }
  if (!food) return { calories: 0, protein: 0, carbs: 0, fats: 0 };
  return { calories: food.calories * entry.servings, protein: food.protein * entry.servings, carbs: food.carbs * entry.servings, fats: food.fats * entry.servings };
}

/** A client-made entry id (idempotency key): the app keeps one per
 * confirmation, so a retried or double-tapped confirm logs once. */
export function validEntryId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

// ─── Sombrey foods ────────────────────────────────────────────────────────────

type FoodForLog = FoodLike & {
  name: string;
  servingSize: string;
  servingUnit: string;
  caloriesPer100g?: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatsPer100g?: number;
};

export type FoodSnapshot = { name: string; portion: string; calories: number; protein: number; carbs: number; fats: number; servings: number };

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** The snapshot for a Sombrey food at confirmation:
 *   • by servings — the food's per-serving values, × servings in the day;
 *   • by grams — its per-100 g values × grams (servings = 1). Only a food with
 *     all four per-100 g values can be logged by grams; nothing is estimated.
 * `portionLabel` is the app's wording for a household measure ("2 × cup").
 */
export function foodSnapshot(food: FoodForLog, q: { servings: number } | { grams: number; portionLabel?: string }): { snapshot: FoodSnapshot } | { error: string } {
  if ("grams" in q) {
    if (typeof q.grams !== "number" || !Number.isFinite(q.grams) || q.grams <= 0 || q.grams > MAX_PORTION_GRAMS) {
      return { error: `The portion must be between 0 and ${MAX_PORTION_GRAMS} g.` };
    }
    const p = [food.caloriesPer100g, food.proteinPer100g, food.carbsPer100g, food.fatsPer100g];
    if (p.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0)) return { error: "This food has no per-100 g values — log it by serving." };
    const scaled = scalePer100g({ calories: food.caloriesPer100g!, protein: food.proteinPer100g, carbs: food.carbsPer100g, fat: food.fatsPer100g }, q.grams);
    const label = typeof q.portionLabel === "string" && q.portionLabel.trim() && q.portionLabel.trim().length <= 60 ? q.portionLabel.trim() : `${fmt(q.grams)} g`;
    return { snapshot: { name: food.name, portion: label, ...scaled, servings: 1 } };
  }
  if (typeof q.servings !== "number" || !Number.isFinite(q.servings) || q.servings <= 0 || q.servings > 100) {
    return { error: "Servings must be between 0 and 100." };
  }
  const unit = food.servingSize.trim() === "1" || !food.servingSize.trim() ? food.servingUnit : `${food.servingSize} ${food.servingUnit}`;
  return {
    snapshot: {
      name: food.name,
      portion: `${fmt(q.servings)} × ${unit}`.slice(0, 60),
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fats: food.fats,
      servings: q.servings,
    },
  };
}
