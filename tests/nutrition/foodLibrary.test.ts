// The Sombrey Food Library: import rules (convex/nutrition/foodLibrary.ts), the USDA FDC adapter
// (scripts/food-library/sources/usdaFdc.ts), search terms (librarySearch.ts) and logging snapshots (logEntry.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentHash, deduplicate, libraryFoodFields, preparationOf, searchNameOf, upsertAction, validateCandidate,
  type LibraryCandidate, type LibraryRecord,
} from "../../convex/nutrition/foodLibrary.ts";
import { librarySearchTerm } from "../../convex/nutrition/librarySearch.ts";
import { entryNutrition, foodSnapshot } from "../../convex/nutrition/logEntry.ts";
import { fdcCandidates, portionLabel } from "../../scripts/food-library/sources/usdaFdc.ts";

const rice: LibraryCandidate = {
  source: "usda_fdc_sr_legacy",
  sourceId: "168878",
  sourceVersion: "2018-04",
  name: "Rice, white, long-grain, regular, enriched, cooked",
  category: "Cereal Grains and Pasta",
  nutrients: { basisGrams: 100, energy: { value: 130, unit: "kcal" }, protein: 2.69, carbs: 28.2, fat: 0.28 },
  portions: [{ label: "1 cup", grams: 158 }],
  crossRef: "ndb:20045",
};
const ok = (c: LibraryCandidate): LibraryRecord => {
  const v = validateCandidate(c);
  assert.ok("record" in v, JSON.stringify(v));
  return v.record;
};
const reason = (c: LibraryCandidate) => {
  const v = validateCandidate(c);
  assert.ok("rejection" in v, "expected a rejection");
  return v.rejection.reason;
};

// ─── Normalisation ───────────────────────────────────────────────────────────

test("a valid record: per-100 g kept, name normalised for search, serving from the dataset's first portion", () => {
  const r = ok(rice);
  assert.deepEqual(r.per100g, { calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3 });
  assert.equal(r.searchName, "rice white long grain regular enriched cooked");
  assert.deepEqual(r.serving, { label: "1 cup", grams: 158 });
  assert.equal(r.preparationState, "cooked");
  assert.deepEqual(r.qualityFlags, []);
});

test("units normalise to kcal per 100 g (kJ, and a non-100 g basis)", () => {
  const kj = ok({ ...rice, nutrients: { ...rice.nutrients, energy: { value: 544, unit: "kJ" } } });
  assert.equal(kj.per100g.calories, 130);
  const per50 = ok({ ...rice, nutrients: { basisGrams: 50, energy: { value: 65, unit: "kcal" }, protein: 1.35, carbs: 14.1, fat: 0.14 } });
  assert.deepEqual(per50.per100g, { calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3 });
});

test("names: accents folded, punctuation as breaks; the display name keeps the dataset's wording", () => {
  assert.equal(searchNameOf("Crème brûlée, (restaurant)"), "creme brulee restaurant");
  assert.equal(ok({ ...rice, name: "  Rice,   white " }).name, "Rice, white");
});

test("preparation is only what the description states — never guessed", () => {
  assert.equal(preparationOf("Chicken, broilers or fryers, breast, meat only, cooked, roasted"), "roasted");
  assert.equal(preparationOf("Oats, raw"), "raw");
  assert.equal(preparationOf("Pasta, dry, enriched"), "dry");
  assert.equal(preparationOf("Nuts, almonds, dry roasted"), "roasted");
  assert.equal(preparationOf("Egg, whole, cooked, fried"), "fried");
  assert.equal(preparationOf("Banana"), undefined);
  assert.equal(preparationOf("Lentils, mature seeds, cooked, boiled, without salt"), "boiled");
});

// ─── Validation ──────────────────────────────────────────────────────────────

test("malformed and impossible records are rejected with a reason", () => {
  assert.equal(reason({ ...rice, sourceId: "" }), "missing_source_id");
  assert.equal(reason({ ...rice, name: " " }), "missing_name");
  assert.equal(reason({ ...rice, source: "scraped_site" }), "unknown_source");
  assert.equal(reason({ ...rice, sourceVersion: "" }), "missing_source_version");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, energy: undefined } }), "missing_energy");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, protein: undefined } }), "missing_protein");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, fat: NaN } }), "bad_fat");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, energy: { value: 130, unit: "cal" as "kcal" } } }), "bad_energy_unit");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, basisGrams: 0 } }), "bad_basis");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, protein: -2 } }), "negative_value");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, energy: { value: 1200, unit: "kcal" } } }), "impossible_energy");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, carbs: 120 } }), "impossible_macro");
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, protein: 50, carbs: 40, fat: 20 } }), "impossible_macro_total");
});

test("carbs slightly below zero (by-difference noise in meat and fish) → 0, flagged; clearly negative → rejected", () => {
  const chicken = ok({ ...rice, name: "Chicken, breast, meat and skin, raw", nutrients: { basisGrams: 100, energy: { value: 133, unit: "kcal" }, protein: 21.4, carbs: -0.428, fat: 4.78 } });
  assert.equal(chicken.per100g.carbs, 0);
  assert.ok(chicken.qualityFlags.includes("carbs_negative_as_zero"));
  assert.equal(reason({ ...rice, nutrients: { ...rice.nutrients, carbs: -3 } }), "negative_value");
});

test("questionable-but-plausible records are kept and flagged, not silently imported", () => {
  const sake = ok({ ...rice, name: "Alcoholic beverage, rice (sake)", nutrients: { basisGrams: 100, energy: { value: 134, unit: "kcal" }, protein: 0.5, carbs: 5, fat: 0 } });
  assert.deepEqual(sake.qualityFlags, ["energy_macro_mismatch"]);
  const badPortion = ok({ ...rice, portions: [{ label: "1 cup", grams: 158 }, { label: "1 bag", grams: -4 }, { label: "", grams: 10 }] });
  assert.ok(badPortion.qualityFlags.includes("portion_dropped"));
  assert.deepEqual(badPortion.portions, [{ label: "1 cup", grams: 158 }]);
  // Adapter flags pass through; junk flags don't.
  assert.deepEqual(ok({ ...rice, flags: ["energy_atwater_specific", "DROP TABLE"] }).qualityFlags, ["energy_atwater_specific"]);
});

test("no portions → a 100 g serving; the reference amount isn't preferred over a household measure", () => {
  assert.deepEqual(ok({ ...rice, portions: [] }).serving, { label: "100 g", grams: 100 });
  assert.deepEqual(ok({ ...rice, portions: [{ label: "Reference amount (RACC)", grams: 30 }, { label: "2 tablespoon", grams: 33.9 }] }).serving, { label: "2 tablespoon", grams: 33.9 });
  assert.deepEqual(ok({ ...rice, portions: [{ label: "Reference amount (RACC)", grams: 30 }] }).serving, { label: "Reference amount (RACC)", grams: 30 });
});

// ─── Duplicates & re-running ─────────────────────────────────────────────────

test("duplicates: same food across datasets (NDB number) keeps Foundation; same name within a dataset keeps the first", () => {
  const sr = ok(rice);
  const foundation = ok({ ...rice, source: "usda_fdc_foundation", sourceId: "2512381", sourceVersion: "2026-04-30", name: "Rice, white, long grain, cooked" });
  const sameName = ok({ ...rice, sourceId: "999999", crossRef: "ndb:1" });
  const other = ok({ ...rice, sourceId: "168880", name: "Rice, brown, cooked", crossRef: "ndb:20037" });
  const { kept, duplicates } = deduplicate([sr, sameName, other, foundation, sr]);
  assert.deepEqual(kept.map((r) => `${r.source}:${r.sourceId}`), ["usda_fdc_foundation:2512381", "usda_fdc_sr_legacy:168880"]);
  assert.equal(duplicates.filter((d) => d.by === "cross_ref").length, 1);
  // Same name as the SR record that Foundation replaced → also Foundation's.
  const copy = duplicates.find((d) => d.dropped.sourceId === "999999");
  assert.equal(copy?.by, "name");
  assert.equal(copy?.keptAs.sourceId, "2512381");
});

test("a branded product isn't merged with the generic food of the same name", () => {
  const generic = ok({ ...rice, crossRef: undefined });
  const branded = ok({ ...rice, sourceId: "b1", kind: "branded", brand: "Acme", crossRef: undefined });
  assert.equal(deduplicate([generic, branded]).kept.length, 2);
});

test("re-running an import: unchanged records aren't rewritten, changed ones are, new ones inserted", () => {
  const r = ok(rice);
  const stored = libraryFoodFields(r);
  assert.equal(upsertAction(null, r), "insert");
  assert.equal(upsertAction(stored, ok(rice)), "unchanged");
  assert.equal(upsertAction(stored, ok({ ...rice, nutrients: { ...rice.nutrients, protein: 2.8 } })), "update");
  assert.equal(upsertAction(stored, ok({ ...rice, sourceVersion: "2019-04" })), "update");
  assert.equal(contentHash(ok(rice)), contentHash(ok(rice)));
});

test("stored fields: per-serving values are per-100 g × the serving's grams, so both views agree", () => {
  const f = libraryFoodFields(ok(rice));
  assert.equal(f.servingUnit, "1 cup");
  assert.equal(f.servingGrams, 158);
  assert.equal(f.calories, 205); // 130 × 1.58
  assert.equal(f.protein, 4.3);
  assert.equal(f.caloriesPer100g, 130);
  assert.equal(f.source, "usda_fdc_sr_legacy");
  assert.equal(f.isCustom, false);
  assert.equal(f.qualityFlags, undefined);
});

// ─── The USDA FDC adapter ────────────────────────────────────────────────────

const nutrient = (id: number, amount: number, unitName = "g") => ({ nutrient: { id, unitName }, amount });

test("FDC: energy prefers 'Energy', then Atwater specific, then general — and says which", () => {
  const data = {
    FoundationFoods: [
      null,
      { fdcId: 1, description: "A", ndbNumber: 11, foodNutrients: [nutrient(1008, 100, "kcal"), nutrient(2048, 90, "kcal"), nutrient(1003, 1), nutrient(1004, 1), nutrient(1005, 20)] },
      { fdcId: 2, description: "B", foodNutrients: [nutrient(2047, 80, "kcal"), nutrient(2048, 85, "kcal"), nutrient(1003, 1), nutrient(1004, 1), nutrient(1005, 18)] },
      { fdcId: 3, description: "C", foodNutrients: [nutrient(2047, 70, "kcal"), nutrient(1003, 1), nutrient(1004, 1), nutrient(1050, 15)] },
      { fdcId: 4, description: "Salt", foodNutrients: [nutrient(1003, 0)] },
    ],
  };
  const { candidates, malformed } = fdcCandidates(data, "usda_fdc_foundation", "2026-04-30");
  assert.equal(malformed, 1);
  assert.deepEqual(candidates.map((c) => c.nutrients.energy?.value), [100, 85, 70, undefined]);
  assert.deepEqual(candidates[1].flags, ["energy_atwater_specific"]);
  assert.deepEqual(candidates[2].flags, ["energy_atwater_general", "carbs_by_summation"]);
  assert.equal(candidates[0].crossRef, "ndb:11");
  assert.equal(reason(candidates[3]), "missing_energy");
});

test("FDC portions read as household measures", () => {
  assert.equal(portionLabel({ value: 1, measureUnit: { name: "undetermined" }, modifier: "cup, chopped or diced", gramWeight: 140 }), "1 cup, chopped or diced");
  assert.equal(portionLabel({ value: 0.5, measureUnit: { name: "undetermined" }, modifier: "breast, bone and skin removed" }), "0.5 breast, bone and skin removed");
  assert.equal(portionLabel({ value: 2, measureUnit: { name: "tablespoon" }, modifier: "" }), "2 tablespoon");
  assert.equal(portionLabel({ value: 1, measureUnit: { name: "RACC" } }), "Reference amount (RACC)");
  assert.equal(portionLabel({ value: 1, measureUnit: { name: "undetermined" }, modifier: "" }), null);
  assert.throws(() => fdcCandidates({ Other: [] }, "usda_fdc_sr_legacy", "x"));
});

// ─── Search terms ────────────────────────────────────────────────────────────

test("search: normalised like the stored names; too short → nothing searched", () => {
  assert.equal(librarySearchTerm("  Chicken   BREAST, "), "chicken breast");
  assert.equal(librarySearchTerm("crème"), "creme");
  assert.equal(librarySearchTerm("a"), null);
  assert.equal(librarySearchTerm(" , "), null);
  assert.equal(librarySearchTerm(undefined), null);
  assert.equal(librarySearchTerm(Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "))!.split(" ").length, 16);
});

// ─── Logging a library food ──────────────────────────────────────────────────

const storedRice = { name: "Rice, white, cooked", servingSize: "1", servingUnit: "1 cup", calories: 205, protein: 4.3, carbs: 44.6, fats: 0.4, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28.2, fatsPer100g: 0.3 };

test("by grams: per-100 g × grams, servings 1", () => {
  const s = foodSnapshot(storedRice, { grams: 250 });
  assert.ok("snapshot" in s);
  assert.deepEqual(s.snapshot, { name: "Rice, white, cooked", portion: "250 g", calories: 325, protein: 6.8, carbs: 70.5, fats: 0.8, servings: 1 });
  const cups = foodSnapshot(storedRice, { grams: 316, portionLabel: "2 × 1 cup" });
  assert.ok("snapshot" in cups);
  assert.equal(cups.snapshot.portion, "2 × 1 cup");
  assert.equal(cups.snapshot.calories, 411);
});

test("by serving: the food's per-serving values, counted × servings in the day", () => {
  const s = foodSnapshot(storedRice, { servings: 1.5 });
  assert.ok("snapshot" in s);
  assert.equal(s.snapshot.portion, "1.5 × 1 cup");
  const n = entryNutrition({ foodId: "f", ...s.snapshot }, null);
  assert.equal(n.calories, 307.5);
  assert.ok(Math.abs(n.protein - 6.45) < 1e-9 && Math.abs(n.carbs - 66.9) < 1e-9 && Math.abs(n.fats - 0.6) < 1e-9);
});

test("invalid quantities, and grams for a food without per-100 g values, are refused", () => {
  for (const grams of [0, -1, NaN, Infinity, 5_001]) assert.ok("error" in foodSnapshot(storedRice, { grams }));
  for (const servings of [0, -1, NaN, 101]) assert.ok("error" in foodSnapshot(storedRice, { servings }));
  const manual = { name: "Coach's shake", servingSize: "1", servingUnit: "shake", calories: 300, protein: 30, carbs: 20, fats: 10 };
  assert.ok("error" in foodSnapshot(manual, { grams: 100 }));
  assert.ok("snapshot" in foodSnapshot(manual, { servings: 1 }));
});

test("history is stable: a logged entry keeps its values when the food is later edited or re-imported", () => {
  const s = foodSnapshot(storedRice, { servings: 1 });
  assert.ok("snapshot" in s);
  const entry = { foodId: "f", ...s.snapshot };
  const editedFood = { ...storedRice, calories: 999, protein: 99, carbs: 99, fats: 99 };
  assert.equal(entryNutrition(entry, editedFood).calories, 205);
  // An entry from before snapshots still follows the food (as it always did).
  assert.equal(entryNutrition({ foodId: "f", servings: 1 }, editedFood).calories, 999);
});

// ─── Scale ───────────────────────────────────────────────────────────────────

test("large dataset: 50,000 records validate, deduplicate and hash in well under a few seconds", () => {
  const t0 = performance.now();
  const records: LibraryRecord[] = [];
  for (let i = 0; i < 50_000; i++) {
    records.push(ok({ ...rice, sourceId: String(i), name: `Food number ${i % 45_000}, cooked`, crossRef: `ndb:${i % 48_000}` }));
  }
  const { kept, duplicates } = deduplicate(records);
  for (const r of kept) contentHash(r);
  const ms = performance.now() - t0;
  assert.equal(kept.length + duplicates.length, 50_000);
  assert.equal(kept.length, 45_000);
  assert.ok(ms < 5_000, `${Math.round(ms)} ms`);
});

test("an empty dataset imports nothing and reports nothing", () => {
  assert.deepEqual(fdcCandidates({ SRLegacyFoods: [] }, "usda_fdc_sr_legacy", "2018-04"), { candidates: [], malformed: 0 });
  assert.deepEqual(deduplicate([]), { kept: [], duplicates: [] });
});

// ─── Ranking ─────────────────────────────────────────────────────────────────

import { indexTerm, rankFoods, rankScore } from "../../convex/nutrition/librarySearch.ts";

test("ranking: the food itself before foods that merely mention it", () => {
  const names = ["Fat, chicken", "Chicken spread", "Soup, chicken noodle, canned", "Chicken, breast, boneless, skinless, raw", "Frankfurter, chicken"];
  const ranked = rankFoods("chicken", names.map((name) => ({ name })));
  assert.equal(ranked[0].name, "Chicken, breast, boneless, skinless, raw");
  assert.ok(ranked.findIndex((f) => f.name === "Fat, chicken") > 0);
});

test("ranking: any searched word can be the food; group leads are looked past; plurals match", () => {
  const white = rankFoods("white rice", [{ name: "Flour, rice, white, unenriched" }, { name: "Rice, white, long grain, unenriched, raw" }]);
  assert.equal(white[0].name, "Rice, white, long grain, unenriched, raw");
  const salmon = rankFoods("salmon", [{ name: "Fish oil, salmon" }, { name: "Fish, salmon, sockeye, raw" }]);
  assert.equal(salmon[0].name, "Fish, salmon, sockeye, raw");
  assert.ok(rankScore("eggs", { name: "Egg, whole, raw, fresh" }) >= 5);
  assert.ok(rankScore("banana", { name: "Bananas, raw" }) >= 5);
});

test("ranking: generic before branded and specialist categories; Foundation over SR Legacy on a tie", () => {
  const oats = rankFoods("oats", [{ name: "Cereals, QUAKER, Quick Oats, Dry" }, { name: "Oats, raw", category: "Baby Foods" }, { name: "Oats, raw" }]);
  assert.deepEqual(oats.map((f) => f.name + (f.category ? "*" : "")), ["Oats, raw", "Oats, raw*", "Cereals, QUAKER, Quick Oats, Dry"]);
  const tie = rankFoods("lentils", [{ name: "Lentils, raw", source: "usda_fdc_sr_legacy" }, { name: "Lentils, raw", source: "usda_fdc_foundation" }]);
  assert.equal(tie[0].source, "usda_fdc_foundation");
});

test("the index is also asked for singulars (it matches whole words)", () => {
  assert.equal(indexTerm("eggs"), "eggs egg");
  assert.equal(indexTerm("potatoes"), "potatoes potato potatoe");
  assert.equal(indexTerm("rice"), "rice");
  assert.equal(indexTerm("hummus"), "hummus hummu");
  assert.equal(indexTerm("grass"), "grass");
});

test("ranking 200 candidates is fast", () => {
  const cands = Array.from({ length: 200 }, (_, i) => ({ name: `Chicken, part ${i}, cooked, roasted`, category: i % 7 ? "Poultry Products" : "Fast Foods" }));
  const t0 = performance.now();
  for (let k = 0; k < 100; k++) rankFoods("chicken breast", cands);
  assert.ok(performance.now() - t0 < 1_000);
});
