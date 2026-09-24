import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WorkoutXProvider, mapWorkoutXExercise, mapWorkoutXPage } from "../../convex/exerciseProviders/workoutx.ts";
import { ProviderUnavailableError, type ExerciseProvider, type ProviderExercise } from "../../convex/exerciseProvider.ts";
import {
  buildSearchText, cleanInstructions, describeExerciseForCoach, displayCase, muscleGroupFor, normalizeProviderExercise, providerBodyPartFor,
} from "../../convex/exerciseNormalization.ts";
import { isFresh, monthKey, monthlyBudget, pageSizeFor, queryKey, toDetail, toSummary } from "../../convex/exerciseLibraryPolicy.ts";

// Provider-shaped fixtures (the documented WorkoutX record format) for
// several kinds of exercise. Test data only — nothing here ships.
const raw = (over: Record<string, unknown>) => ({
  secondaryMuscles: [], instructions: [], ...over,
});
const FIXTURES = {
  squat: raw({ id: "0043", name: "barbell full squat", bodyPart: "Upper Legs", target: "Glutes", equipment: "Barbell",
    secondaryMuscles: ["Quadriceps", "Hamstrings", "Calves", "Core"], instructions: ["1. Stand with feet shoulder-width apart.", "2. Lower your body."],
    difficulty: "intermediate", mechanic: "compound", force: "push", category: "strength", met: 5 }),
  bench: raw({ id: "0025", name: "Barbell Bench Press", bodyPart: "Chest", target: "Pectorals", equipment: "Barbell",
    secondaryMuscles: ["Triceps", "Shoulders"], difficulty: "intermediate", mechanic: "compound" }),
  deadlift: raw({ id: "0032", name: "barbell deadlift", bodyPart: "Upper Legs", target: "Glutes", equipment: "Barbell",
    secondaryMuscles: ["Hamstrings", "Lower Back"] }),
  pullUp: raw({ id: "0652", name: "pull-up", bodyPart: "Back", target: "Lats", equipment: "Body Weight", secondaryMuscles: ["Biceps", "Forearms"] }),
  curl: raw({ id: "0294", name: "dumbbell biceps curl", bodyPart: "Upper Arms", target: "Biceps", equipment: "Dumbbell", secondaryMuscles: ["Forearms"] }),
  lunge: raw({ id: "0336", name: "dumbbell lunge", bodyPart: "Upper Legs", target: "Glutes", equipment: "Dumbbell", secondaryMuscles: ["Quadriceps", "Hamstrings"] }),
  row: raw({ id: "0027", name: "barbell bent over row", bodyPart: "Back", target: "Upper Back", equipment: "Barbell", secondaryMuscles: ["Biceps"] }),
  machine: raw({ id: "0739", name: "sled 45° leg press", bodyPart: "Upper Legs", target: "Glutes", equipment: "Sled Machine", secondaryMuscles: ["Quadriceps"] }),
};

// ── Adapter mapping ────────────────────────────────────────────────────────

test("every kind of exercise maps to the neutral provider shape", () => {
  for (const [kind, fixture] of Object.entries(FIXTURES)) {
    const mapped = mapWorkoutXExercise(fixture);
    assert.ok(mapped, kind);
    assert.equal(mapped!.externalId, fixture.id);
    assert.ok(mapped!.name.length > 0);
  }
});

test("malformed records are skipped and counted, never guessed", () => {
  assert.equal(mapWorkoutXExercise(null), null);
  assert.equal(mapWorkoutXExercise({ name: "No id" }), null);
  assert.equal(mapWorkoutXExercise({ id: "1" }), null);
  assert.equal(mapWorkoutXExercise({ id: "1", name: "   " }), null);
  const page = mapWorkoutXPage([FIXTURES.squat, { name: "broken" }, 42, FIXTURES.squat, FIXTURES.bench]);
  assert.equal(page.exercises.length, 2); // duplicate id dropped
  assert.equal(page.malformed, 2);
  assert.deepEqual(mapWorkoutXPage("<html>error</html>"), { exercises: [], malformed: 0, total: 0 });
  const odd = mapWorkoutXExercise({ id: 7, name: "Numeric id", secondaryMuscles: "not a list", met: "abc", instructions: [1, "", " Step "] });
  assert.equal(odd?.externalId, "7");
  assert.deepEqual(odd?.secondaryMuscles, []);
  assert.equal(odd?.met, undefined);
  assert.deepEqual(odd?.instructions, ["Step"]);
});

test("both response envelopes are read, with the total", () => {
  assert.equal(mapWorkoutXPage([FIXTURES.curl]).exercises.length, 1);
  const env = mapWorkoutXPage({ total: 312, count: 1, data: [FIXTURES.curl] });
  assert.equal(env.total, 312);
  assert.equal(env.exercises[0].externalId, "0294");
});

// ── Adapter behaviour (fake fetch) ─────────────────────────────────────────

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(respond: (url: string) => { status: number; body?: unknown; plan?: string; contentType?: string }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const r = respond(url);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (n: string) => (n === "X-WorkoutX-Plan" ? r.plan ?? null : n === "Content-Type" ? r.contentType ?? "application/json" : null) },
      json: async () => r.body,
      arrayBuffer: async () => new ArrayBuffer(8),
    };
  };
  return { fetch, calls };
}

test("queries route to the endpoint every plan supports, key in a header only", async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: [FIXTURES.squat], plan: "free" }));
  const p = new WorkoutXProvider("wx_secret", fetch);
  await p.search({ name: "squat", limit: 10, offset: 0 });
  await p.search({ bodyPart: "upper legs", limit: 10, offset: 20 });
  await p.search({ equipment: "dumbbell", limit: 10, offset: 0 });
  await p.search({ limit: 10, offset: 0 });
  await p.search({ bodyPart: "chest", equipment: "barbell", limit: 10, offset: 0 });
  assert.match(calls[0].url, /\/v1\/exercises\/name\/squat\?limit=10&offset=0$/);
  assert.match(calls[1].url, /\/v1\/exercises\/bodyPart\/upper%20legs\?limit=10&offset=20$/);
  assert.match(calls[2].url, /\/v1\/exercises\/equipment\/dumbbell/);
  assert.match(calls[3].url, /\/v1\/exercises\?limit=10&offset=0$/);
  assert.match(calls[4].url, /\/v1\/exercises\/search\?/); // combined filters (plan-gated)
  for (const c of calls) {
    assert.equal(c.headers["X-WorkoutX-Key"], "wx_secret");
    assert.doesNotMatch(c.url, /wx_secret|api-key/);
  }
});

test("the account's plan is learned from responses; free-plan media is branded", async () => {
  const free = new WorkoutXProvider("k", fakeFetch(() => ({ status: 200, body: [], plan: "free" })).fetch);
  assert.equal(free.account(), undefined);
  await free.search({ name: "curl", limit: 10, offset: 0 });
  assert.deepEqual(free.account(), { plan: "free", mediaBranded: true });
  const pro = new WorkoutXProvider("k", fakeFetch(() => ({ status: 200, body: [], plan: "Pro" })).fetch);
  await pro.search({ name: "curl", limit: 10, offset: 0 });
  assert.deepEqual(pro.account(), { plan: "pro", mediaBranded: false });
});

test("failures become typed, provider-neutral errors", async () => {
  const cases: [number, string][] = [[429, "rate_limited"], [403, "forbidden"], [401, "forbidden"], [500, "failed"]];
  for (const [status, kind] of cases) {
    const p = new WorkoutXProvider("k", fakeFetch(() => ({ status })).fetch);
    await assert.rejects(p.search({ name: "x", limit: 10, offset: 0 }), (e: unknown) => e instanceof ProviderUnavailableError && e.kind === kind && !/workoutx/i.test(e.message));
  }
  const missing = new WorkoutXProvider("k", fakeFetch(() => ({ status: 404 })).fetch);
  assert.equal(await missing.get("9999"), null);
  const offline = new WorkoutXProvider("k", async () => { throw new Error("offline"); });
  await assert.rejects(offline.search({ limit: 10, offset: 0 }), (e: unknown) => e instanceof ProviderUnavailableError && e.kind === "failed");
  const notImage = new WorkoutXProvider("k", fakeFetch(() => ({ status: 200, contentType: "text/html" })).fetch);
  await assert.rejects(notImage.media("0001"), ProviderUnavailableError);
});

// ── Normalization ──────────────────────────────────────────────────────────

const norm = (f: Record<string, unknown>) => normalizeProviderExercise(mapWorkoutXExercise(f)!);

test("each exercise type becomes a Sombrey exercise in Sombrey's terms", () => {
  const squat = norm(FIXTURES.squat);
  assert.equal(squat.name, "Barbell Full Squat");
  assert.equal(squat.muscleGroup, "legs");
  assert.deepEqual(squat.primaryMuscles, ["Glutes"]);
  assert.deepEqual(squat.instructions, ["Stand with feet shoulder-width apart.", "Lower your body."]);
  assert.equal(squat.difficulty, "intermediate");
  assert.equal(squat.mechanic, "compound");
  assert.equal(squat.primaryEquipment, "barbell");
  assert.equal(norm(FIXTURES.bench).muscleGroup, "chest");
  assert.equal(norm(FIXTURES.deadlift).muscleGroup, "legs");
  assert.equal(norm(FIXTURES.pullUp).muscleGroup, "back");
  assert.equal(norm(FIXTURES.pullUp).name, "Pull-Up");
  assert.equal(norm(FIXTURES.curl).muscleGroup, "arms");
  assert.equal(norm(FIXTURES.lunge).muscleGroup, "legs");
  assert.equal(norm(FIXTURES.row).muscleGroup, "back");
  assert.equal(norm(FIXTURES.machine).equipment[0], "Sled Machine");
});

test("missing fields stay missing — nothing is invented", () => {
  const bare = norm({ id: "1", name: "Mystery Move" });
  assert.equal(bare.description, "");        // no made-up description
  assert.equal(bare.muscleGroup, "other");   // unknown body part is not guessed
  assert.deepEqual(bare.primaryMuscles, []);
  assert.deepEqual(bare.equipment, []);
  assert.equal(bare.difficulty, undefined);
  assert.equal(bare.category, undefined);
  assert.equal(bare.met, undefined);
  // Values outside Sombrey's vocabulary are dropped, not coerced.
  assert.equal(norm({ id: "2", name: "X", difficulty: "expert", mechanic: "hybrid" }).difficulty, undefined);
  // A primary muscle is never repeated as secondary.
  assert.deepEqual(norm({ id: "3", name: "Y", target: "Biceps", secondaryMuscles: ["biceps", "Forearms", "Forearms"] }).secondaryMuscles, ["Forearms"]);
});

test("casing and numbering are cleaned, deliberate casing kept", () => {
  assert.equal(displayCase("dumbbell biceps curl"), "Dumbbell Biceps Curl");
  assert.equal(displayCase("3/4 Sit-up"), "3/4 Sit-up");
  assert.equal(displayCase("EZ Barbell Curl"), "EZ Barbell Curl");
  assert.deepEqual(cleanInstructions(["Step 1: Grip the bar", "2) Pull", "", "  Lower  slowly "]), ["Grip the bar", "Pull", "Lower slowly"]);
  assert.equal(muscleGroupFor(undefined, "Lats"), "back");
  assert.equal(muscleGroupFor("neck", undefined), "other");
});

test("search text covers names, muscles, equipment, body part and synonyms", () => {
  const pull = norm(FIXTURES.pullUp).searchText;
  for (const word of ["pull-up", "pull up", "pullup", "lats", "latissimus", "body weight", "bodyweight", "biceps", "back"]) {
    assert.ok(pull.includes(word), word);
  }
  const curl = norm(FIXTURES.curl).searchText;
  assert.ok(curl.includes("db") && curl.includes("dumbbell"));
  assert.ok(buildSearchText(["Quads"]).includes("quadriceps"));
});

test("Sombrey filters translate to provider vocabulary only where one exists", () => {
  assert.equal(providerBodyPartFor("legs"), "upper legs");
  assert.equal(providerBodyPartFor("core"), "waist");
  assert.equal(providerBodyPartFor("other"), undefined);
  assert.equal(providerBodyPartFor(undefined), undefined);
});

// ── Provider abstraction ───────────────────────────────────────────────────

test("any provider implementing the interface feeds the same library", async () => {
  const records: ProviderExercise[] = [{ externalId: "a1", name: "cable row", bodyPart: "back", target: "upper back", secondaryMuscles: [], equipment: "cable", instructions: [] }];
  const other: ExerciseProvider = {
    id: "another_provider",
    search: async () => ({ exercises: records, malformed: 0 }),
    get: async () => records[0],
    similar: async () => ({ exercises: [], malformed: 0 }),
    alternatives: async () => ({ exercises: [], malformed: 0 }),
    media: async () => ({ bytes: new ArrayBuffer(0), contentType: "image/gif" }),
    account: () => ({ mediaBranded: false }),
  };
  const page = await other.search({ limit: 10, offset: 0 });
  const fields = normalizeProviderExercise(page.exercises[0]);
  assert.equal(fields.name, "Cable Row");
  assert.equal(fields.muscleGroup, "back");
});

// ── Policy: caching, budget, what the app may see ──────────────────────────

test("budget and page size follow the provider plan", () => {
  assert.equal(monthlyBudget(undefined), 450);
  assert.equal(monthlyBudget("free"), 450);
  assert.equal(monthlyBudget("pro"), 9000);
  assert.equal(monthlyBudget("pro", 100), 100);
  assert.equal(pageSizeFor("free"), 10);
  assert.equal(pageSizeFor("basic"), 25);
  assert.equal(monthKey(Date.UTC(2026, 8, 24)), "2026-09");
});

test("the same query is one cache entry; freshness is a TTL", () => {
  assert.equal(queryKey({ name: " Bench  Press", offset: 0, limit: 10 }), queryKey({ name: "bench press", offset: 0, limit: 10 }));
  assert.notEqual(queryKey({ name: "bench", offset: 0, limit: 10 }), queryKey({ name: "bench", offset: 10, limit: 10 }));
  const now = Date.UTC(2026, 8, 24);
  assert.equal(isFresh(undefined, 1000, now), false);
  assert.equal(isFresh(now - 500, 1000, now), true);
  assert.equal(isFresh(now - 1500, 1000, now), false);
});

test("the app never receives provider provenance", () => {
  const stored = {
    _id: "e1", ...norm(FIXTURES.bench), cues: [],
    sourceProvider: "workoutx", sourceId: "0025", sourceSyncedAt: 1, gifUrl: "https://x/v1/gifs/0025.gif?api-key=wx_secret",
    workoutxId: "0025", wxBodyPart: "Chest", wxTarget: "Pectorals", mediaStatus: "cached", mediaStorageId: "s1",
  };
  for (const shape of [toSummary(stored), toDetail(stored)]) {
    const json = JSON.stringify(shape);
    assert.doesNotMatch(json, /workoutx|wx_secret|api-key|sourceProvider|sourceId|gifUrl|0025/i);
  }
  assert.equal(toSummary(stored).hasMedia, true);
});

test("the coach hears exercises in Sombrey's terms", () => {
  const e = norm(FIXTURES.squat);
  const line = describeExerciseForCoach({ name: e.name, primaryMuscles: e.primaryMuscles, secondaryMuscles: e.secondaryMuscles, equipment: e.equipment, difficulty: e.difficulty, mechanic: e.mechanic });
  assert.equal(line, "Barbell Full Squat — primary: Glutes; secondary: Quadriceps, Hamstrings, Calves, Core; equipment: Barbell; intermediate; compound");
  assert.doesNotMatch(line, /workoutx/i);
});

// ── Branding: no provider in anything a user can see ───────────────────────

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? swiftFiles(path) : name.endsWith(".swift") ? [path] : [];
  });
}

test("no consumer-facing string in the iOS app names or hints at the provider", () => {
  const root = new URL("../../apps/ios/Sombrey", import.meta.url).pathname;
  const forbidden = /workout\s?x|powered by|third[- ]party|external provider|exercise provider|\bAPI\b/i;
  const offenders: string[] = [];
  for (const file of swiftFiles(root)) {
    // Developer-only diagnostics (DEBUG builds) may name internals.
    if (/Diagnostics/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const [, literal] of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
      if (forbidden.test(literal)) offenders.push(`${file.replace(root, "")}: "${literal}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("errors the app can receive from the library never name the provider", () => {
  for (const file of ["../../convex/exerciseLibrary.ts", "../../convex/workoutx.ts", "../../convex/exercises.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const [, message] of source.matchAll(/message:\s*"([^"]*)"/g)) {
      assert.doesNotMatch(message, /workout\s?x/i, `${file}: ${message}`);
    }
  }
});
