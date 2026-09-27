// The real lookup (nutrition/edamamLookup.ts, used by ai/cameraAnalysis.ts) against a stubbed Edamam: how many
// hits a photo costs, and that matching quality is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EdamamSession, lookupAll, type EdamamGate } from "../../convex/nutrition/edamamLookup.ts";
import type { IdentifiedFood } from "../../convex/nutrition/foodMatch.ts";

type Entry = [label: string, kcal: number];
// Candidate sets as Edamam actually returned them for these queries (2026-09-27).
const EDAMAM: Record<string, Entry[]> = {
  "cooked pasta": [["Cooked Pasta", 158], ["Cooked Pasta Lasagna", 158], ["No Cook Pasta Sauce", 205]],
  "boiled pasta": [["Pasta", 371], ["No Boil Pasta Bake", 154], ["Egg Pasta", 384], ["Cooked Pasta", 158]],
  "cooked rice": [["Cooked Rice", 130], ["Rice Cooked", 130]],
  "grilled chicken breast": [["Grilled Chicken Breast", 165], ["Cooked Chicken Breast", 165]],
  "steamed broccoli": [["Broccoli", 34], ["Steamed Broccoli", 48]],
  "olive oil": [["Olive Oil", 884]],
  "parmesan cheese": [["Parmesan Cheese", 392]],
  "tomato sauce": [["Tomato Sauce", 24]],
  "cooked ground beef": [["Ground Beef", 254], ["90% Ground Beef", 176]],
  "ground beef, cooked": [["Ground Beef", 254]],
  "roasted potatoes": [["Potato", 77], ["Roasted Potatoes", 106]],
  "boiled lentils": [["Lentil", 352], ["Boiled Lentil", 116]],
  "salmon": [["Salmon", 208]],
  "avocado": [["Avocado", 160]],
  "bread": [["Bread", 274]],
  "cooked quinoa": [["Cooked Quinoa", 120]],
  "banana": [["Bananas, Raw", 89]],
};

function stub() {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("ingr")!);
    calls.push(q);
    const hits = (EDAMAM[q] ?? []).map(([label, kcal]) => ({ food: { label, category: "Generic foods", nutrients: { ENERC_KCAL: kcal, PROCNT: 1, CHOCDF: 1, FAT: 1 } } }));
    return new Response(JSON.stringify({ parsed: [], hints: hits }), { status: 200 });
  }) as typeof fetch;
  return calls;
}
const openGate: EdamamGate = { acquire: async () => true, rateLimited: async () => {} };
const f = (foodName: string, preparationState: IdentifiedFood["preparationState"], grams = 100): IdentifiedFood => ({ foodName, preparationState, grams, confidence: "high" });

test("cooked spaghetti still matches cooked pasta — in one hit", async () => {
  const calls = stub();
  const [pasta] = await lookupAll([f("pasta", "cooked", 600)], new EdamamSession("id", "key", openGate));
  assert.equal(pasta.matchedFood, "Cooked Pasta");
  assert.equal(pasta.calories, 948);
  assert.deepEqual(calls, ["cooked pasta"]);
});

test("Edamam dropping the cooking word is still handled from the first response", async () => {
  const calls = stub();
  const items = await lookupAll([f("pasta", "boiled"), f("broccoli", "steamed"), f("potatoes", "roasted"), f("lentils", "boiled")], new EdamamSession("id", "key", openGate));
  assert.deepEqual(items.map((i) => i.matchedFood), ["Cooked Pasta", "Steamed Broccoli", "Roasted Potatoes", "Boiled Lentil"]);
  assert.equal(calls.length, 4); // no fallbacks needed
});

test("a 14-food photo: one hit per distinct food, duplicates shared, fallback only where needed", async () => {
  const calls = stub();
  const foods = [
    f("pasta", "cooked"), f("pasta", "cooked"), f("rice", "cooked"), f("chicken breast", "grilled"), f("broccoli", "steamed"),
    f("olive oil", "unknown"), f("parmesan cheese", "unknown"), f("tomato sauce", "unknown"), f("ground beef", "cooked"),
    f("potatoes", "roasted"), f("salmon", "unknown"), f("avocado", "unknown"), f("bread", "unknown"), f("quinoa", "cooked"),
  ];
  const session = new EdamamSession("id", "key", openGate);
  const items = await lookupAll(foods, session);
  // 13 distinct primaries + 1 fallback (ground beef has no cooked entry in the first set).
  assert.equal(calls.length, 14);
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(session.budget.hits <= 20);
  assert.equal(items.filter((i) => i.edamamMatched).length, 14);
  assert.equal(items[8].matchedFood, "Ground Beef");
  assert.equal(items[8].preparationMatched, false);
});

test("the worst case is capped: a 30-food photo can't exceed the per-analysis budget", async () => {
  const calls = stub();
  const foods = Array.from({ length: 30 }, (_, i) => f(`food number ${i}`, "grilled"));
  const session = new EdamamSession("id", "key", openGate);
  const items = await lookupAll(foods, session);
  assert.equal(calls.length, 20);
  assert.ok(items.filter((i) => i.lookupIssue === "budget").length >= 10);
  assert.ok(items.every((i) => i.edamamMatched === false)); // nothing invented
});

test("when the gate refuses, nothing is called and the item says why (never a silent 0)", async () => {
  const calls = stub();
  const closed: EdamamGate = { acquire: async () => false, rateLimited: async () => {} };
  const [item] = await lookupAll([f("pasta", "cooked")], new EdamamSession("id", "key", closed));
  assert.equal(calls.length, 0);
  assert.equal(item.edamamMatched, false);
  assert.equal(item.lookupIssue, "rate_limited");
});

test("a 429 from Edamam trips the shared cooldown and isn't retried", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => { calls.push(url); return new Response("<html>429</html>", { status: 429 }); }) as typeof fetch;
  let tripped = 0;
  const gate: EdamamGate = { acquire: async () => tripped === 0, rateLimited: async () => { tripped++; } };
  const items = await lookupAll([f("pasta", "cooked"), f("rice", "cooked")], new EdamamSession("id", "key", gate));
  assert.ok(tripped >= 1);
  assert.ok(calls.length <= 2);                 // no retries, no fallbacks after a 429
  assert.ok(items.every((i) => i.lookupIssue === "rate_limited"));
});
