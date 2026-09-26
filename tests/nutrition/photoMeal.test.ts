import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisReason, photoMealTotals, validateConfirmedMeal } from "../../convex/nutrition/photoMeal.ts";

const item = (calories: number, protein: number, carbs: number, fat: number) => ({ foodName: "x", grams: 100, calories, protein, carbs, fat, matched: true });

test("totals of the analysed items are the reviewable starting point", () => {
  assert.deepEqual(photoMealTotals([item(250, 30.25, 0, 12.1), item(200, 4, 44.6, 0.4)]), { calories: 450, protein: 34.3, carbs: 44.6, fat: 12.5 });
  assert.deepEqual(photoMealTotals([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
});

test("a confirmed meal must be named and plausible", () => {
  assert.equal(validateConfirmedMeal({ name: "Chicken rice bowl", calories: 650, protein: 42, carbs: 70, fat: 18 }), null);
  assert.match(validateConfirmedMeal({ name: "  ", calories: 650, protein: 42, carbs: 70, fat: 18 })!, /name/);
  assert.match(validateConfirmedMeal({ name: "x".repeat(81), calories: 1, protein: 1, carbs: 1, fat: 1 })!, /80/);
  assert.match(validateConfirmedMeal({ name: "Bowl", calories: -1, protein: 0, carbs: 0, fat: 0 })!, /Calories/);
  assert.match(validateConfirmedMeal({ name: "Bowl", calories: 100, protein: 600, carbs: 0, fat: 0 })!, /Protein/);
  assert.match(validateConfirmedMeal({ name: "Bowl", calories: Number.NaN, protein: 0, carbs: 0, fat: 0 })!, /Calories/);
});

test("analysis failures are distinguished for the app", () => {
  assert.equal(analysisReason(undefined), undefined);
  assert.equal(analysisReason("not_configured"), "not_configured");
  assert.equal(analysisReason("No food items detected. Try a clearer photo or enter macros manually."), "no_food");
  assert.equal(analysisReason("Vision API error (500): …"), "failed");
});
