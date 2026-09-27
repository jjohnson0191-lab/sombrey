// USDA FoodData Central (Foundation Foods, SR Legacy) → LibraryCandidates.
// Data: https://fdc.nal.usda.gov/download-datasets — CC0 1.0 (public domain);
// USDA asks that FoodData Central be credited as the source.
//
// Values are taken as FDC states them (per 100 g of the food as described);
// nothing is estimated. Which of FDC's definitions was used is recorded as a
// flag so the choice is visible, not silent.

import type { LibraryCandidate } from "../../../convex/nutrition/foodLibrary.ts";

// FDC nutrient ids.
const ENERGY_KCAL = 1008;           // "Energy" (kcal) — SR Legacy, some Foundation
const ENERGY_ATWATER_SPECIFIC = 2048; // Foundation: food-specific Atwater factors
const ENERGY_ATWATER_GENERAL = 2047;  // Foundation: 4/4/9
const ENERGY_KJ = 1062;
const PROTEIN = 1003;
const FAT = 1004;
const CARBS_BY_DIFFERENCE = 1005;
const CARBS_BY_SUMMATION = 1050;

type FdcNutrient = { nutrient?: { id?: number; unitName?: string }; amount?: number };
type FdcPortion = { value?: number; amount?: number; modifier?: string; gramWeight?: number; measureUnit?: { name?: string } };
type FdcFood = {
  fdcId?: number;
  description?: string;
  ndbNumber?: number | string;
  foodCategory?: { description?: string };
  foodNutrients?: FdcNutrient[];
  foodPortions?: FdcPortion[];
};

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

/** A portion's label in plain words: "1 cup", "0.5 breast, bone and skin
 * removed", "Reference amount (RACC)". */
export function portionLabel(p: FdcPortion): string | null {
  const unit = (p.measureUnit?.name ?? "").trim();
  const modifier = (p.modifier ?? "").trim();
  const count = typeof p.value === "number" && p.value > 0 ? p.value : typeof p.amount === "number" && p.amount > 0 ? p.amount : 1;
  if (unit === "RACC") return "Reference amount (RACC)";
  if (!unit || unit === "undetermined") return modifier ? `${fmt(count)} ${modifier}` : null;
  return modifier ? `${fmt(count)} ${unit}, ${modifier}` : `${fmt(count)} ${unit}`;
}

export function fdcCandidates(data: unknown, source: "usda_fdc_foundation" | "usda_fdc_sr_legacy", sourceVersion: string): { candidates: LibraryCandidate[]; malformed: number } {
  const root = data as Record<string, unknown>;
  const list = (root?.FoundationFoods ?? root?.SRLegacyFoods) as unknown[] | undefined;
  if (!Array.isArray(list)) throw new Error("Not an FDC Foundation / SR Legacy JSON file");
  const candidates: LibraryCandidate[] = [];
  let malformed = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") { malformed++; continue; }
    const f = item as FdcFood;
    const byId = new Map<number, FdcNutrient>();
    for (const n of f.foodNutrients ?? []) {
      const id = n?.nutrient?.id;
      if (typeof id === "number" && typeof n.amount === "number") byId.set(id, n);
    }
    const flags: string[] = [];
    let energy: LibraryCandidate["nutrients"]["energy"];
    const kcal = byId.get(ENERGY_KCAL) ?? byId.get(ENERGY_ATWATER_SPECIFIC) ?? byId.get(ENERGY_ATWATER_GENERAL);
    if (kcal) {
      const unit = (kcal.nutrient?.unitName ?? "").toLowerCase();
      if (unit === "kcal") energy = { value: kcal.amount!, unit: "kcal" };
      if (kcal === byId.get(ENERGY_ATWATER_SPECIFIC) && !byId.has(ENERGY_KCAL)) flags.push("energy_atwater_specific");
      if (kcal === byId.get(ENERGY_ATWATER_GENERAL) && !byId.has(ENERGY_KCAL) && !byId.has(ENERGY_ATWATER_SPECIFIC)) flags.push("energy_atwater_general");
    }
    if (!energy && byId.get(ENERGY_KJ)?.nutrient?.unitName?.toLowerCase() === "kj") {
      energy = { value: byId.get(ENERGY_KJ)!.amount!, unit: "kJ" };
      flags.push("energy_from_kj");
    }
    let carbs = byId.get(CARBS_BY_DIFFERENCE)?.amount;
    if (carbs === undefined && byId.has(CARBS_BY_SUMMATION)) {
      carbs = byId.get(CARBS_BY_SUMMATION)!.amount;
      flags.push("carbs_by_summation");
    }
    candidates.push({
      source,
      sourceId: f.fdcId !== undefined ? String(f.fdcId) : "",
      sourceVersion,
      name: typeof f.description === "string" ? f.description : "",
      category: f.foodCategory?.description,
      kind: "generic",
      nutrients: {
        basisGrams: 100, // FDC Foundation / SR Legacy values are per 100 g
        energy,
        protein: byId.get(PROTEIN)?.amount,
        carbs,
        fat: byId.get(FAT)?.amount,
      },
      portions: (f.foodPortions ?? []).flatMap((p) => {
        const label = p ? portionLabel(p) : null;
        return label && typeof p.gramWeight === "number" ? [{ label, grams: p.gramWeight }] : [];
      }),
      crossRef: f.ndbNumber !== undefined && f.ndbNumber !== null && String(f.ndbNumber).trim() ? `ndb:${String(f.ndbNumber).trim()}` : undefined,
      flags,
    });
  }
  return { candidates, malformed };
}
