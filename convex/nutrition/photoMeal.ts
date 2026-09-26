// Pure rules for the AI Macro Calculator (convex/mealPhotos.ts).

export type PhotoMealItem = { foodName: string; grams: number; calories: number; protein: number; carbs: number; fat: number; matched: boolean };

/** Totals of the analysed items (the starting point the user reviews). */
export function photoMealTotals(items: PhotoMealItem[]) {
  const sum = (k: "calories" | "protein" | "carbs" | "fat") => Math.round(items.reduce((s, i) => s + i[k], 0) * 10) / 10;
  return { calories: Math.round(sum("calories")), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") };
}

/** What the user confirms must be a real, plausible meal. */
export function validateConfirmedMeal(m: { name: string; calories: number; protein: number; carbs: number; fat: number }): string | null {
  const name = m.name.trim();
  if (name.length === 0 || name.length > 80) return "Give the meal a name (up to 80 characters).";
  for (const [label, value, max] of [["Calories", m.calories, 5000], ["Protein", m.protein, 500], ["Carbs", m.carbs, 800], ["Fat", m.fat, 400]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > max) return `${label} must be between 0 and ${max}.`;
  }
  return null;
}

/** Why an analysis produced no estimate, in the app's terms. */
export function analysisReason(aiError: string | undefined): "not_configured" | "no_food" | "failed" | undefined {
  if (!aiError) return undefined;
  if (aiError === "not_configured") return "not_configured";
  if (aiError === "no_food" || aiError.startsWith("No food")) return "no_food";
  return "failed";
}
