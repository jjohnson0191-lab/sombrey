import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_CATEGORIES, AMBIGUOUS_VENDOR_IDS, VENDOR_SPORT_TYPES, isAmbiguousSportType, normalizeSportPlusType } from "../../convex/activityTaxonomy.ts";
import { ACTIVITY_FAMILIES, ACTIVITY_METRICS, resolvedCatalog, termsFor, unknownOverrideKeys } from "../../convex/activityFamilies.ts";
import { describeActivitiesForCoach, describeActivityForCoach } from "../../convex/activityCoach.ts";

const now = Date.UTC(2026, 8, 24, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

test("every category has a family, and every family is internally consistent", () => {
  for (const category of ACTIVITY_CATEGORIES) {
    const family = ACTIVITY_FAMILIES[category];
    assert.ok(family, category);
    assert.ok(family.primary.length > 0, category);
    for (const m of [...family.primary, ...family.secondary]) assert.ok((ACTIVITY_METRICS as readonly string[]).includes(m), `${category}: ${m}`);
    assert.equal(new Set([...family.primary, ...family.secondary]).size, family.primary.length + family.secondary.length, `${category} repeats a metric`);
  }
});

test("every resolved activity is consistent, and overrides name real activities", () => {
  assert.deepEqual(unknownOverrideKeys(), []);
  for (const a of resolvedCatalog()) {
    const all = [...a.terms.primary, ...a.terms.secondary];
    assert.equal(new Set(all).size, all.length, `${a.key} repeats a metric`);
    assert.ok(a.terms.sessionNoun.length > 0 && a.terms.performanceTitle.length > 0, a.key);
  }
});

test("the framework adapts: terminology and headline metrics differ by activity", () => {
  const golf = termsFor("golf", "golf");
  assert.equal(golf.sessionNoun, "round");
  assert.deepEqual(golf.primary.slice(0, 3), ["duration", "steps", "distance"]);
  const run = termsFor("run", "running");
  assert.equal(run.primary[0], "distance");
  assert.ok(run.primary.includes("pace"));
  assert.equal(termsFor("swim", "swimming").paceUnit, "100m");
  assert.equal(termsFor("surf", "water_sport").sessionNoun, "surf");
  assert.match(termsFor("surf", "water_sport").notMeasured ?? "", /Waves/);
  assert.equal(termsFor("spinning", "cycling").primary.includes("distance"), false); // indoor: no road distance headline
  assert.equal(termsFor("rope_skipping", "cardio").actionsLabel, "Skips");
  assert.equal(termsFor("football", "team_sport").sessionNoun, "match");
  assert.equal(termsFor("basketball", "team_sport").sessionNoun, "game");
  // Games are recorded, never framed as a workout.
  assert.equal(termsFor("international_chess", "games").primary.includes("intensity"), false);
});

test("taxonomy corrections follow the vendor header's own descriptions", () => {
  assert.equal(normalizeSportPlusType(20).activityCategory, "hiking");     // 手环爬山 — hill climbing
  assert.equal(normalizeSportPlusType(168).activityCategory, "team_sport"); // 毽球 — shuttlecock kicking, not a racquet sport
  assert.equal(normalizeSportPlusType(170).activityCategory, "leisure");    // 沙包球 — sandbag throwing game
  assert.equal(normalizeSportPlusType(216).activityCategory, "cardio");     // 漫步机 — air walker machine
  assert.equal(normalizeSportPlusType(66).activityCategory, "motorsport");
  assert.equal(normalizeSportPlusType(230).activityCategory, "games");
  assert.equal(Object.keys(VENDOR_SPORT_TYPES).length, 180);
});

test("generic band modes and unknown ids are ambiguous; specific ones are not", () => {
  for (const id of AMBIGUOUS_VENDOR_IDS) assert.ok(isAmbiguousSportType(id), String(id));
  assert.ok(isAmbiguousSportType(999));
  assert.equal(isAmbiguousSportType(29), false);
  assert.equal(isAmbiguousSportType(88), false);
  const offered = resolvedCatalog().filter((a) => a.ambiguous).map((a) => a.key);
  assert.ok(offered.includes("free_training"));
});

test("the coach hears which activity, how long, how hard — and where each figure came from", () => {
  const line = describeActivityForCoach({
    displayName: "Tennis", activityCategory: "racquet", provenance: "band_sport_plus", classificationSource: "band",
    startedAt: now - DAY, durationSeconds: 5400, durationSource: "band",
    averageHeartRate: 142, highestHeartRate: 171, heartRateSource: "band_record", calories: 540, caloriesSource: "band_record",
  }, now);
  assert.equal(line, "Tennis (racquet) — yesterday, 1 h 30 min, avg HR 142 bpm, peak 171 (band record), 540 kcal [recorded by the band]");

  const timed = describeActivityForCoach({
    displayName: "Surfing", activityCategory: "water_sport", provenance: "app_sport_plus", classificationSource: "app",
    startedAt: now - 3 * DAY, durationSeconds: 3000, durationSource: "sombrey_timer",
  }, now);
  assert.match(timed, /50 min \(timed by the app\)/);
  assert.doesNotMatch(timed, /HR/); // no heart rate without a band record

  const named = describeActivityForCoach({
    displayName: "Golf", activityCategory: "golf", provenance: "user_labelled", classificationSource: "user",
    startedAt: now, durationSeconds: 3240, averageHeartRate: 104, heartRateSource: "band_samples",
  }, now);
  assert.match(named, /calculated from band readings/);
  assert.match(named, /named by the user/);

  assert.deepEqual(describeActivitiesForCoach([], now), ["Physical activities in the last 7 days: none recorded"]);
});
