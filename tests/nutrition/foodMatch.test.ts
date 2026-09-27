import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCandidate, matchQueries, normalizePreparation, parseIdentifiedFoods, scaleCandidate, type Candidate } from "../../convex/nutrition/foodMatch.ts";

// Candidates as Edamam's Food Database actually returned them (parser
// `parsed` + first hints, kcal per 100 g), captured 2026-09-27.
const G = "Generic foods", P = "Packaged foods", F = "Fast foods";
const c = (label: string, kcal: number, category = G): Candidate => ({ label, kcal, category, protein: 0, carbs: 0, fat: 0 });

const pastaBare = [c("Pasta", 371), c("Pasta Lasagna", 371), c("Pasta al Ceppo", 371), c("Corn Pasta", 357), c("Fresh Pasta", 288), c("Egg Pasta", 384)];
const pastaCooked = [c("Cooked Pasta", 158), c("Cooked Pasta Lasagna", 158), c("No Cook Pasta Sauce", 205), c("Cooked Pasta, Cavatappi", 100, P), c("Cooked Pasta, Spaghetti", 167, P)];
const boiledPasta = [c("Pasta", 371), c("No Boil Pasta Bake", 154), c("Egg Pasta", 384), c("Corn Pasta", 357), c("Fresh Pasta", 288), c("Cooked Pasta", 158)];

const pick = (name: string, state: Parameters<typeof chooseCandidate>[1], cands: Candidate[]) => chooseCandidate(name, state, cands)?.candidate.label ?? null;

test("cooked pasta never matches the dry entry — the 600 g ≈ 2,226 kcal case", () => {
  assert.equal(pick("pasta", "cooked", [...pastaCooked, ...pastaBare]), "Cooked Pasta");
  // Edamam drops "boiled": its first answer is dry Pasta; the cooked entry further down is used.
  assert.equal(pick("pasta", "boiled", boiledPasta), "Cooked Pasta");
  // Only dry candidates available: no match rather than a dry value.
  assert.equal(pick("pasta", "cooked", pastaBare), null);
  const m = chooseCandidate("pasta", "cooked", pastaCooked)!;
  assert.equal(scaleCandidate(m.candidate, 600).calories, 948);
  assert.ok(m.preparationMatched);
});

test("dry pasta matches the dry entry, never a cooked one", () => {
  assert.equal(pick("pasta", "dry", [...pastaCooked, ...pastaBare]), "Pasta");
});

test("rice, oats, beans, lentils: the state decides the entry", () => {
  const rice = [c("Rice", 360), c("White Rice", 360), c("Cooked Rice", 130), c("Rice Cooked", 130), c("Rice Pudding With Cooked Rice", 162), c("Publix, Pre-Cooked Rice", 352, P)];
  assert.equal(pick("rice", "cooked", rice), "Cooked Rice");
  assert.equal(pick("rice", "dry", rice), "Rice");
  const oats = [c("Oats", 389), c("Cooked Oats", 71), c("Cooked Rolled Oats", 71), c("Cooked Oatmeal", 71), c("Quick Cooking Oats", 375, P)];
  assert.equal(pick("oats", "cooked", oats), "Cooked Oats");
  assert.equal(pick("rolled oats", "dry", [c("Rolled Oat", 371), c("Cooked Rolled Oats", 71)]), "Rolled Oat");
  const beans = [c("Black Beans", 341), c("Canned Black Beans", 91), c("Cooked Black Beans", 132), c("Black Bean Sauce, Black Bean", 167, P)];
  assert.equal(pick("black beans", "cooked", beans), "Cooked Black Beans");
  assert.equal(pick("black beans", "dry", beans), "Black Beans");
  const lentils = [c("Lentil", 352), c("Lentils, Raw", 352), c("Boiled Lentil", 116), c("Lentils, Mature Seeds, Cooked, Boiled, With Salt", 114)];
  assert.equal(pick("lentils", "boiled", lentils), "Boiled Lentil");
  assert.equal(pick("lentils", "raw", lentils), "Lentils, Raw"); // the label that says so ranks first
});

test("a packaged 'pre-cooked' product with dry energy density is not cooked food", () => {
  assert.equal(pick("couscous", "cooked", [c("Pre-Cooked Couscous", 367, P), c("Couscous, Cooked", 112)]), "Couscous, Cooked");
  assert.equal(pick("couscous", "cooked", [c("Pre-Cooked Couscous", 367, P)]), null);
});

test("cooking method: grilled vs fried, boiled vs fried, raw vs cooked vegetables", () => {
  const chicken = [c("Chicken Breast", 120), c("Grilled Chicken Breast", 165), c("Fried Chicken Breast", 303), c("Cooked Chicken Breast", 165), c("Pan Fried Chicken Breast", 165)];
  assert.equal(pick("chicken breast", "grilled", chicken), "Grilled Chicken Breast");
  assert.equal(pick("chicken breast", "fried", chicken), "Fried Chicken Breast");
  assert.equal(pick("chicken breast", "raw", chicken), "Chicken Breast");
  // Grilled asked, only fried/raw on offer: neither is used.
  assert.equal(pick("chicken breast", "grilled", [c("Fried Chicken Breast", 303), c("Chicken Breast, Raw", 120)]), null);
  const potato = [c("Potato", 77), c("Boiled Potatoes", 79), c("Fried Potatoes", 116), c("Roasted Potatoes", 106)];
  assert.equal(pick("potatoes", "boiled", potato), "Boiled Potatoes");
  assert.equal(pick("potatoes", "fried", potato), "Fried Potatoes");
  assert.equal(pick("potatoes", "roasted", potato), "Roasted Potatoes");
  const egg = [c("Egg", 143), c("Egg, Whole, Raw, Fresh", 143), c("Fried Egg", 196), c("Boiled Egg", 155)];
  assert.equal(pick("egg", "fried", egg), "Fried Egg");
  assert.equal(pick("french fries", "fried", [c("Air Fried French Fries", 124), c("Oven Fried French Fries", 150), c("French Fries", 312)]), "French Fries");
  assert.equal(pick("egg", "boiled", egg), "Boiled Egg");
  const broccoli = [c("Broccoli", 34), c("Broccoli, Raw", 34), c("Steamed Broccoli", 48), c("Steamed Broccoli", 29, F)];
  assert.equal(pick("broccoli", "steamed", broccoli), "Steamed Broccoli");
  assert.equal(pick("broccoli", "raw", broccoli), "Broccoli, Raw");
});

test("a non-staple with a known state falls back to the plain entry, marked as not state-matched", () => {
  const m = chooseCandidate("ground beef", "cooked", [c("Ground Beef", 254), c("90% Ground Beef", 176)])!;
  assert.equal(m.candidate.label, "Ground Beef");
  assert.equal(m.preparationMatched, false);
});

test("a different dish is never the food", () => {
  assert.equal(pick("pasta", "cooked", [c("No Cook Pasta Sauce", 205), c("Rice Pudding With Cooked Rice", 162)]), null);
  assert.equal(pick("egg", "fried", [c("Fried Egg Taco", 170), c("Fried Egg Blt", 253)]), null);
});

test("at most two queries, a known state always in the first; unknown staples matched as cooked and marked assumed", () => {
  assert.deepEqual(matchQueries({ foodName: "pasta", preparationState: "cooked" }), { name: "pasta", queries: ["cooked pasta", "pasta, cooked"], state: "cooked", assumed: false });
  assert.deepEqual(matchQueries({ foodName: "pasta", preparationState: "boiled" }).queries, ["boiled pasta", "cooked pasta"]);
  assert.deepEqual(matchQueries({ foodName: "oats", preparationState: "dry" }).queries, ["oats", "dry oats"]);
  assert.deepEqual(matchQueries({ foodName: "broccoli", preparationState: "raw" }).queries, ["broccoli", "raw broccoli"]);
  const u = matchQueries({ foodName: "rice", preparationState: "unknown" });
  assert.equal(u.state, "cooked");
  assert.equal(u.assumed, true);
  // Unknown non-staple: one query, nothing assumed, nothing forced.
  assert.deepEqual(matchQueries({ foodName: "salmon", preparationState: "unknown" }), { name: "salmon", queries: ["salmon"], state: "unknown", assumed: false });
  // State folded into the name is used once, and the specific one wins.
  assert.deepEqual(matchQueries({ foodName: "fried rice", preparationState: "cooked" }), { name: "rice", queries: ["fried rice", "cooked rice"], state: "fried", assumed: false });
  assert.equal(matchQueries({ foodName: "cooked rice", preparationState: "unknown" }).assumed, false);
  for (const s of ["raw", "dry", "cooked", "fried", "baked", "grilled", "boiled", "steamed", "roasted", "unknown"] as const) {
    assert.ok(matchQueries({ foodName: "chicken breast", preparationState: s }).queries.length <= 2, s);
  }
});

test("preparation wording is normalised, never guessed", () => {
  assert.equal(normalizePreparation("Grilled"), "grilled");
  assert.equal(normalizePreparation("pan-fried"), "fried");
  assert.equal(normalizePreparation("uncooked"), "dry");
  assert.equal(normalizePreparation("marinated"), "unknown");
  assert.equal(normalizePreparation(undefined), "unknown");
});

test("Gemini output: structured shape, older shape, and junk", () => {
  assert.deepEqual(parseIdentifiedFoods('[{"foodName":"pasta","preparationState":"cooked","estimatedWeightGrams":600,"confidence":"high"}]'),
    [{ foodName: "pasta", preparationState: "cooked", grams: 600, confidence: "high" }]);
  assert.deepEqual(parseIdentifiedFoods('```json\n[{"foodName":"white rice","grams":200,"preparation":"cooked"}]\n```'),
    [{ foodName: "white rice", preparationState: "cooked", grams: 200, confidence: "medium" }]);
  assert.deepEqual(parseIdentifiedFoods('[{"foodName":"","grams":10},{"foodName":"x","grams":-1},{"foodName":"sauce","estimatedWeightGrams":30,"preparationState":"marinated"}]'),
    [{ foodName: "sauce", preparationState: "unknown", grams: 30, confidence: "medium" }]);
  assert.deepEqual(parseIdentifiedFoods("[]"), []);
  assert.throws(() => parseIdentifiedFoods('{"foodName":"x"}'));
});
