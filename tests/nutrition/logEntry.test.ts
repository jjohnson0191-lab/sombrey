// Nutrition log entries (convex/nutrition/logEntry.ts, used by convex/nutritionLogs.ts):
// Sombrey-owned foods and Edamam snapshots in the same day log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExternalSnapshot, entryNutrition, scalePer100g, validEntryId, type ExternalConfirmation } from "../../convex/nutrition/logEntry.ts";

const chicken: ExternalConfirmation = {
  name: "Chicken Breast",
  externalId: "food_chicken_breast",
  portion: "150 g",
  grams: 150,
  per100g: { calories: 120, protein: 22.5, carbs: 0, fat: 2.62 },
};

test("grams scale Edamam's per-100 g values", () => {
  assert.deepEqual(scalePer100g(chicken.per100g, 150), { calories: 180, protein: 33.8, carbs: 0, fats: 3.9 });
  assert.deepEqual(scalePer100g(chicken.per100g, 100), { calories: 120, protein: 22.5, carbs: 0, fats: 2.6 });
});

test("a serving is its gram weight × count — the same scaling", () => {
  // 2 × "Serving" (85 g) = 170 g
  const r = buildExternalSnapshot({ ...chicken, portion: "2 × Serving", grams: 2 * 85 });
  assert.ok("snapshot" in r);
  assert.equal(r.snapshot.calories, 204);
  assert.equal(r.snapshot.protein, 38.3);
});

test("the snapshot holds only what the log needs", () => {
  const r = buildExternalSnapshot(chicken);
  assert.ok("snapshot" in r);
  assert.deepEqual(Object.keys(r.snapshot).sort(), ["calories", "carbs", "externalId", "fats", "name", "portion", "protein", "source"]);
  assert.equal(r.snapshot.source, "edamam");
});

test("a macro Edamam didn't give counts as 0, not NaN", () => {
  const r = buildExternalSnapshot({ ...chicken, per100g: { calories: 150, protein: 20, carbs: null, fat: undefined } });
  assert.ok("snapshot" in r);
  assert.equal(r.snapshot.carbs, 0);
  assert.equal(r.snapshot.fats, 0);
  assert.equal(r.snapshot.calories, 225);
});

test("invalid quantities can't produce NaN, Infinity or negative values", () => {
  for (const grams of [0, -5, NaN, Infinity, 5_001, "100" as unknown as number]) {
    assert.ok("error" in buildExternalSnapshot({ ...chicken, grams }), `grams ${grams}`);
  }
});

test("unusable nutrition or identity is refused", () => {
  assert.ok("error" in buildExternalSnapshot({ ...chicken, per100g: { calories: NaN } }));
  assert.ok("error" in buildExternalSnapshot({ ...chicken, per100g: { calories: -1 } }));
  assert.ok("error" in buildExternalSnapshot({ ...chicken, per100g: { calories: 5000 } }));
  assert.ok("error" in buildExternalSnapshot({ ...chicken, per100g: { calories: 100, protein: 250 } }));
  assert.ok("error" in buildExternalSnapshot({ ...chicken, name: "  " }));
  assert.ok("error" in buildExternalSnapshot({ ...chicken, externalId: "" }));
  assert.ok("error" in buildExternalSnapshot({ ...chicken, portion: "" }));
});

test("a snapshot adds its own values to the day; a Sombrey food adds per-serving × servings", () => {
  const r = buildExternalSnapshot(chicken);
  assert.ok("snapshot" in r);
  assert.deepEqual(entryNutrition({ ...r.snapshot, servings: 1 }, null), { calories: 180, protein: 33.8, carbs: 0, fats: 3.9 });
  const rice = { calories: 200, protein: 4, carbs: 44, fats: 0.5 };
  assert.deepEqual(entryNutrition({ foodId: "f1", servings: 1.5 }, rice), { calories: 300, protein: 6, carbs: 66, fats: 0.75 });
  // A deleted Sombrey food adds nothing (as before).
  assert.deepEqual(entryNutrition({ foodId: "gone", servings: 2 }, null), { calories: 0, protein: 0, carbs: 0, fats: 0 });
  // A snapshot never reads a food record, even if one were passed.
  assert.deepEqual(entryNutrition({ ...r.snapshot, servings: 1 }, rice).calories, 180);
});

test("removing an entry: recomputing from what's left gives the right totals", () => {
  const snap = buildExternalSnapshot(chicken);
  assert.ok("snapshot" in snap);
  const rice = { calories: 200, protein: 4, carbs: 44, fats: 0.5 };
  const day = [
    { entry: { foodId: "rice", servings: 1 }, food: rice },
    { entry: { ...snap.snapshot, servings: 1 }, food: null },
  ];
  const total = (xs: typeof day) => xs.reduce((s, x) => s + entryNutrition(x.entry, x.food).calories, 0);
  assert.equal(total(day), 380);
  assert.equal(total(day.slice(0, 1)), 200); // Edamam entry removed
  assert.equal(total(day.slice(1)), 180);    // Sombrey entry removed
});

test("entry ids (idempotency keys) must look like ids", () => {
  assert.ok(validEntryId("3F2504E0-4F89-11D3-9A0C-0305E82C3301"));
  assert.ok(!validEntryId("short"));
  assert.ok(!validEntryId("has spaces in it!"));
  assert.ok(!validEntryId(undefined));
});
