// Search Foods (convex/nutrition/foodSearch.ts, used by convex/foodSearch.ts) against a stubbed Edamam:
// when a request is made, what it costs, and what the app gets back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EDAMAM_RESULTS, SEARCH_MAX_WAIT_MS, SEARCH_USER_QUOTA,
  normalizeQuery, parseEdamamFoods, searchEdamam, withoutSombreyDuplicates, sameName,
} from "../../convex/nutrition/foodSearch.ts";
import { BUCKET, WORST_CASE_PER_MINUTE, cooldown, reserve, type BucketState } from "../../convex/nutrition/edamamBudget.ts";
import type { EdamamGate } from "../../convex/nutrition/edamamLookup.ts";

// Shaped like Edamam's parser response (hints carry measures; parsed repeats a hint without them).
const CHICKEN = {
  foodId: "food_chicken_breast",
  label: "Chicken Breast",
  category: "Generic foods",
  nutrients: { ENERC_KCAL: 120, PROCNT: 22.5, FAT: 2.62, CHOCDF: 0, FIBTG: 0 },
};
const BRANDED = {
  foodId: "food_bar",
  label: "Chicken Breast",
  brand: "Acme",
  category: "Packaged foods",
  nutrients: { ENERC_KCAL: 150, PROCNT: 20, FAT: 5 }, // no CHOCDF
};
const measures = [
  { uri: "m#serving", label: "Serving", weight: 85 },
  { uri: "m#whole", label: "Whole", weight: 174, qualified: [{ qualifiers: [{ uri: "q#large", label: "large" }], weight: 200 }] },
  { uri: "m#gram", label: "Gram", weight: 1 },
  { uri: "m#ounce", label: "Ounce", weight: 28.35 },
  { uri: "m#cup", label: "Cup", weight: 140 },
  { uri: "m#ml", label: "Milliliter", weight: 1 }, // as Edamam lists it for "Chicken Fried Chicken"
];
const RESPONSE = {
  text: "chicken",
  parsed: [{ food: CHICKEN }],
  hints: [
    { food: CHICKEN, measures },
    { food: BRANDED, measures: [{ label: "Serving", weight: 100 }] },
    { food: { foodId: "food_nokcal", label: "Mystery", nutrients: {} }, measures },
    { food: { label: "No id", nutrients: { ENERC_KCAL: 10 } }, measures },
  ],
};

function stub(respond: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url);
    calls.push(u);
    return respond(u);
  }) as typeof fetch;
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function gate(allow = true) {
  const g = { acquired: 0, rateLimitedCalls: 0 };
  const gate: EdamamGate = {
    acquire: async () => { g.acquired++; return allow; },
    rateLimited: async () => { g.rateLimitedCalls++; },
  };
  return { g, gate };
}

// ─── Query rules ─────────────────────────────────────────────────────────────

test("an empty or one-character query isn't searched", () => {
  assert.equal(normalizeQuery(""), null);
  assert.equal(normalizeQuery("   "), null);
  assert.equal(normalizeQuery("a"), null);
  assert.equal(normalizeQuery(" r "), null);
  assert.equal(normalizeQuery(undefined), null);
  assert.equal(normalizeQuery(42), null);
});

test("a real query is trimmed, single-spaced and capped", () => {
  assert.equal(normalizeQuery("  chicken   breast "), "chicken breast");
  assert.equal(normalizeQuery("ok"), "ok");
  assert.equal(normalizeQuery("x".repeat(500))!.length, 80);
});

// ─── One human search ────────────────────────────────────────────────────────

test("a valid search makes exactly one Edamam request, through the gate, in logging mode", async () => {
  const calls = stub(() => json(RESPONSE));
  const { g, gate: gt } = gate();
  const r = await searchEdamam("chicken", "ID", "KEY", gt);
  assert.equal(r.status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(g.acquired, 1);
  assert.equal(calls[0].pathname, "/api/food-database/v2/parser");
  assert.equal(calls[0].searchParams.get("ingr"), "chicken");
  assert.equal(calls[0].searchParams.get("nutrition-type"), "logging");
  assert.equal(r.foods.length, 2);
});

test("no results is an ok, empty search — not an error", async () => {
  stub(() => json({ text: "zzqx", parsed: [], hints: [] }));
  const r = await searchEdamam("zzqx", "ID", "KEY", gate().gate);
  assert.deepEqual(r, { status: "ok", foods: [] });
});

test("when the shared gate refuses, Edamam isn't called", async () => {
  const calls = stub(() => json(RESPONSE));
  const r = await searchEdamam("rice", "ID", "KEY", gate(false).gate);
  assert.equal(r.status, "rate_limited");
  assert.equal(calls.length, 0);
});

test("HTTP 429 → rate_limited, reported to the shared limiter, no retry", async () => {
  const calls = stub(() => json({ message: "Too many" }, 429));
  const { g, gate: gt } = gate();
  const r = await searchEdamam("oats", "ID", "KEY", gt);
  assert.equal(r.status, "rate_limited");
  assert.equal(g.rateLimitedCalls, 1);
  assert.equal(calls.length, 1);
});

test("Edamam errors are told apart: credentials → unavailable, 5xx / network / bad JSON → error", async () => {
  stub(() => json({ message: "Unauthorized app_id = ID" }, 401));
  assert.equal((await searchEdamam("rice", "ID", "KEY", gate().gate)).status, "unavailable");
  stub(() => json({}, 503));
  assert.deepEqual(await searchEdamam("rice", "ID", "KEY", gate().gate), { status: "error", foods: [], detail: "http_503" });
  stub(() => { throw new TypeError("fetch failed"); });
  assert.equal((await searchEdamam("rice", "ID", "KEY", gate().gate)).status, "error");
  stub(() => new Response("<html>oops</html>", { status: 200 }));
  assert.equal((await searchEdamam("rice", "ID", "KEY", gate().gate)).status, "error");
});

test("credentials never appear in what the search returns", async () => {
  stub(() => json({ message: "Unauthorized app_id = SECRET_ID" }, 401));
  const r = await searchEdamam("rice", "SECRET_ID", "SECRET_KEY", gate().gate);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

test("results: deduplicated by Edamam id, per-100 g nutrition, brand kept", () => {
  const foods = parseEdamamFoods(RESPONSE);
  assert.deepEqual(foods.map((f) => f.externalId), ["food_chicken_breast", "food_bar"]);
  const [chicken, bar] = foods;
  assert.deepEqual(chicken.per100g, { calories: 120, protein: 22.5, carbs: 0, fat: 2.62 });
  assert.equal(chicken.brand, undefined);
  assert.equal(bar.brand, "Acme");
});

test("a missing macro is null (unknown), never an invented 0; no calories → not listed", () => {
  const foods = parseEdamamFoods(RESPONSE);
  assert.equal(foods[1].per100g.carbs, null);
  assert.ok(!foods.some((f) => f.name === "Mystery" || f.name === "No id"));
  // Garbage values are rejected, not passed on.
  const odd = parseEdamamFoods({ hints: [{ food: { foodId: "x", label: "Odd", nutrients: { ENERC_KCAL: 50, PROCNT: -3, FAT: "5", CHOCDF: Infinity } } }] });
  assert.deepEqual(odd[0].per100g, { calories: 50, protein: null, carbs: null, fat: null });
  assert.deepEqual(parseEdamamFoods({ hints: [{ food: { foodId: "y", label: "Bad", nutrients: { ENERC_KCAL: NaN } } }] }), []);
  assert.deepEqual(parseEdamamFoods(null), []);
  assert.deepEqual(parseEdamamFoods({ hints: "nope" }), []);
});

test("measures: Serving first, qualified sizes kept, plain units (g, oz, ml) dropped", () => {
  const [chicken] = parseEdamamFoods(RESPONSE);
  assert.deepEqual(chicken.measures, [
    { label: "Serving", grams: 85 },
    { label: "Whole", grams: 174 },
    { label: "Whole, large", grams: 200 },
    { label: "Cup", grams: 140 },
  ]);
});

test("results are capped", () => {
  const hints = Array.from({ length: 40 }, (_, i) => ({ food: { foodId: `f${i}`, label: `Food ${i}`, nutrients: { ENERC_KCAL: 100 } } }));
  assert.equal(parseEdamamFoods({ hints }).length, MAX_EDAMAM_RESULTS);
});

// ─── Deduplication ───────────────────────────────────────────────────────────

test("an Edamam generic equal to a Sombrey food isn't shown twice; a branded product still is", () => {
  const foods = parseEdamamFoods(RESPONSE);
  const shown = withoutSombreyDuplicates(foods, ["chicken  breast"]);
  assert.deepEqual(shown.map((f) => f.externalId), ["food_bar"]);
  assert.equal(withoutSombreyDuplicates(foods, ["Chicken thigh"]).length, 2);
  assert.ok(sameName("Chicken-Breast", "chicken breast"));
});

// ─── The shared limiter ──────────────────────────────────────────────────────

test("a search takes its token from the SAME bucket photo analysis uses, and waits at most 1.5 s", () => {
  const rules = { ...BUCKET, maxWaitMs: SEARCH_MAX_WAIT_MS };
  // Photo analyses have just emptied the bucket: a search doesn't queue behind them.
  const drained: BucketState = { tokens: 0, updatedAt: 0 };
  const r = reserve(drained, 0, rules);
  assert.equal(r.ok, false);
  assert.equal(r.next.tokens, 0); // and takes nothing
  // With tokens left it's immediate.
  assert.deepEqual(reserve({ tokens: 5, updatedAt: 0 }, 0, rules).ok, true);
});

test("after a 429 nobody — search included — calls Edamam for the cooldown", () => {
  const cooled = cooldown(1_000);
  assert.equal(reserve(cooled, 30_000, { ...BUCKET, maxWaitMs: SEARCH_MAX_WAIT_MS }).ok, false);
});

test("searches can't push the whole deployment past 45 Edamam hits in any minute", () => {
  // Adversarial: photo analyses and searches both hammering the one bucket.
  let state: BucketState | null = null;
  const hits: number[] = [];
  for (let now = 0; now < 300_000; now += 1_000) {
    for (let k = 0; k < 5; k++) {
      const search = k % 2 === 0;
      const r = reserve(state, now, search ? { ...BUCKET, maxWaitMs: SEARCH_MAX_WAIT_MS } : BUCKET);
      state = r.next;
      if (r.ok) hits.push(now + r.waitMs);
    }
  }
  hits.sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < hits.length; i++) {
    while (hits[i] - hits[j] >= 60_000) j++;
    best = Math.max(best, i - j + 1);
  }
  assert.ok(best <= WORST_CASE_PER_MINUTE, `${best} hits in a minute`);
});

test("one person's searching is capped well below the shared budget", () => {
  let state: BucketState | null = null;
  let ok = 0;
  for (let now = 0; now < 60_000; now += 200) { // a search every 200 ms for a minute
    const r = reserve(state, now, SEARCH_USER_QUOTA);
    state = r.next;
    if (r.ok) ok++;
  }
  assert.ok(ok <= SEARCH_USER_QUOTA.capacity + 15, `${ok}`);
  assert.ok(ok < WORST_CASE_PER_MINUTE / 2);
});
