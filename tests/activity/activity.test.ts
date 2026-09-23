import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_CATEGORIES,
  VENDOR_SPORT_TYPES,
  normalizeManualActivity,
  normalizeSombreyWorkout,
  normalizeSportPlusType,
} from "../../convex/activityTaxonomy.ts";
import {
  APP_MATCH_WINDOW_MS,
  findAppStartedMatch,
  isMalformed,
  isTimestampSuspect,
} from "../../convex/sportPlusImport.ts";

test("every one of the 180 vendor Sport+ ids maps to a Sombrey category", () => {
  const ids = Object.keys(VENDOR_SPORT_TYPES);
  assert.equal(ids.length, 180);
  for (const id of ids) {
    const entry = VENDOR_SPORT_TYPES[Number(id)];
    assert.ok((ACTIVITY_CATEGORIES as readonly string[]).includes(entry.category), `${id} → ${entry.category}`);
    assert.match(entry.key, /^[a-z0-9_]+$/);
  }
});

test("sports the product names resolve to specific activities", () => {
  assert.deepEqual(normalizeSportPlusType(29), { activityKey: "tennis", activityCategory: "racquet", displayName: "Tennis" });
  assert.equal(normalizeSportPlusType(30).activityCategory, "golf");
  assert.equal(normalizeSportPlusType(183).activityKey, "surf");
  assert.equal(normalizeSportPlusType(183).activityCategory, "water_sport");
  assert.equal(normalizeSportPlusType(88).activityKey, "strength_training");
  assert.equal(normalizeSportPlusType(88).activityCategory, "strength");
  assert.equal(normalizeSportPlusType(32).activityCategory, "team_sport");
  assert.equal(normalizeSportPlusType(31).activityKey, "basketball");
  assert.equal(normalizeSportPlusType(60).activityCategory, "hiking");
  // The vendor files Swimming (6) under "Running & Walking"; Sombrey doesn't.
  assert.equal(normalizeSportPlusType(6).activityCategory, "swimming");
  assert.equal(normalizeSportPlusType(7).activityCategory, "running");
  assert.equal(normalizeSportPlusType(22).activityCategory, "mobility");
});

test("an unknown vendor id is kept, not guessed", () => {
  const unknown = normalizeSportPlusType(999);
  assert.equal(unknown.activityKey, "sport_plus_999");
  assert.equal(unknown.activityCategory, "other");
});

test("manual and structured workouts share the same space", () => {
  assert.equal(normalizeManualActivity("run").activityCategory, "running");
  assert.equal(normalizeManualActivity("run").activityKey, normalizeSportPlusType(7).activityKey);
  assert.equal(normalizeManualActivity("swim").activityCategory, "swimming");
  assert.equal(normalizeManualActivity(undefined).activityCategory, "other");
  assert.equal(normalizeManualActivity("unexpected").activityCategory, "other");
  assert.equal(normalizeSombreyWorkout().activityCategory, "strength");
});

const now = Date.UTC(2026, 8, 24, 12, 0, 0);
const record = (over: Partial<{ sportType: number; bandStartTimeSec: number; durationSeconds: number }> = {}) => ({
  sportType: 29,
  bandStartTimeSec: now / 1000 - 3600,
  bandDurationRaw: 1800,
  durationSeconds: 1800,
  ...over,
});

test("malformed records are skipped, not repaired", () => {
  assert.equal(isMalformed(record(), now), false);
  assert.equal(isMalformed(record({ bandStartTimeSec: 0 }), now), true);
  assert.equal(isMalformed(record({ durationSeconds: 0 }), now), true);
  assert.equal(isMalformed(record({ durationSeconds: 25 * 3600 }), now), true);
  assert.equal(isMalformed(record({ bandStartTimeSec: Number.NaN }), now), true);
  assert.equal(isMalformed(record({ bandStartTimeSec: now / 1000 + 3 * 86400 }), now), true);
});

test("timing that ends in the future is flagged, never shifted", () => {
  assert.equal(isTimestampSuspect(record(), now), false);
  // A band storing local time as if UTC (e.g. +5:30) would end ~5h ahead.
  assert.equal(isTimestampSuspect(record({ bandStartTimeSec: now / 1000 + 5 * 3600 }), now), true);
  // Small clock drift is fine.
  assert.equal(isTimestampSuspect(record({ bandStartTimeSec: now / 1000 - 1800 + 300 }), now), false);
});

test("a band record completes the nearest matching app-started session", () => {
  const start = record().bandStartTimeSec * 1000;
  const candidates = [
    { id: "far", sportType: 29, startedAt: start - APP_MATCH_WINDOW_MS - 1000 },
    { id: "otherSport", sportType: 30, startedAt: start + 1000 },
    { id: "alreadyLinked", sportType: 29, startedAt: start, bandStartTimeSec: 123 },
    { id: "near", sportType: 29, startedAt: start + 20_000 },
    { id: "nearest", sportType: 29, startedAt: start - 5_000 },
  ];
  assert.equal(findAppStartedMatch(candidates, record())?.id, "nearest");
  assert.equal(findAppStartedMatch([candidates[0], candidates[1], candidates[2]], record()), undefined);
});
