import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIVITY_CATEGORIES, ACTIVITY_GROUPS, VENDOR_SPORT_TYPES, activityCatalog } from "../../convex/activityTaxonomy.ts";
import { ageFromDateOfBirth, estimatedMaxHeartRate, intensityFor } from "../../convex/activityIntensity.ts";
import { summarizeActivity, usageOf } from "../../convex/activityProfile.ts";
import { DETECTION, detectActiveWindows, restingBaseline } from "../../convex/activityDetection.ts";
import { CATALOG_SWIFT_PATH, renderCatalogSwift } from "../../scripts/generate-activity-catalog.ts";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const now = Date.UTC(2026, 8, 24, 12, 0, 0);

// ── Catalog ───────────────────────────────────────────────────────────────

test("every category belongs to exactly one browsing group", () => {
  for (const category of ACTIVITY_CATEGORIES) {
    const owners = ACTIVITY_GROUPS.filter((g) => (g.categories as string[]).includes(category));
    assert.equal(owners.length, 1, category);
  }
});

test("the catalog offers each activity once, startable with a real vendor mode", () => {
  const catalog = activityCatalog();
  const keys = catalog.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const a of catalog) {
    assert.ok(VENDOR_SPORT_TYPES[a.vendorSportType], `${a.key} → ${a.vendorSportType}`);
    assert.equal(VENDOR_SPORT_TYPES[a.vendorSportType].key, a.key, a.key);
  }
  const tennis = catalog.find((a) => a.key === "tennis");
  assert.deepEqual(tennis, { key: "tennis", name: "Tennis", category: "racquet", group: "racquet", vendorSportType: 29 });
  // Shared keys start the outdoor mode (adds the phone's route) and carry the activity-level name.
  assert.equal(catalog.find((a) => a.key === "run")?.vendorSportType, 1);
  assert.equal(catalog.find((a) => a.key === "run")?.name, "Running");
  // The vendor's catch-all extension isn't offered.
  assert.equal(catalog.find((a) => a.vendorSportType === 10086), undefined);
});

test("consumer names replace the vendor's garbled labels", () => {
  const names = activityCatalog().map((a) => a.name);
  for (const garbled of ["Pickering", "Puck", "Skis", "B M X", "A T V", "Ski Orientserlng", "Door Kick"]) {
    assert.ok(!names.includes(garbled), garbled);
  }
  assert.ok(names.includes("Pickleball"));
  assert.ok(names.includes("Surfing"));
});

test("the iOS catalog is generated from the current taxonomy", () => {
  assert.equal(readFileSync(CATALOG_SWIFT_PATH, "utf8"), renderCatalogSwift(),
    "run: node --experimental-strip-types scripts/generate-activity-catalog.ts");
});

// ── Intensity ─────────────────────────────────────────────────────────────

test("age comes from a real date of birth only", () => {
  assert.equal(ageFromDateOfBirth("1990-09-25", now), 35); // birthday tomorrow
  assert.equal(ageFromDateOfBirth("1990-09-24", now), 36);
  assert.equal(ageFromDateOfBirth(undefined, now), undefined);
  assert.equal(ageFromDateOfBirth("not a date", now), undefined);
  assert.equal(ageFromDateOfBirth("2024-01-01", now), undefined); // implausible
});

test("intensity needs both a heart rate and an estimate", () => {
  const max = estimatedMaxHeartRate(40); // 180
  assert.equal(max, 180);
  assert.deepEqual(intensityFor(142, max), { zone: 3, label: "Moderate", percentOfMax: 79 });
  assert.equal(intensityFor(150, max)?.label, "Hard");
  assert.equal(intensityFor(80, max), undefined); // below zone 1
  assert.equal(intensityFor(142, undefined), undefined);
  assert.equal(intensityFor(undefined, max), undefined);
  assert.equal(intensityFor(0, max), undefined);
});

// ── Profile ───────────────────────────────────────────────────────────────

test("averages use only sessions that measured the value", () => {
  const summary = summarizeActivity([
    { startedAt: now - 1 * DAY, durationSeconds: 3480, averageHeartRate: 142 },
    { startedAt: now - 3 * DAY, durationSeconds: 3060 },               // no band heart-rate record
    { startedAt: now - 40 * DAY, durationSeconds: 4380, averageHeartRate: 138, steps: 0 },
  ], now);
  assert.equal(summary.sessionCount, 3);
  assert.equal(summary.lastStartedAt, now - 1 * DAY);
  assert.deepEqual(summary.averageHeartRate, { value: 140, sessions: 2 });
  assert.deepEqual(summary.averageDurationSeconds, { value: 3640, sessions: 3 });
  assert.equal(summary.averageSteps, undefined); // a zero is not a measurement
  assert.equal(summary.sessionsLast30Days, 2);
  assert.equal(summary.sessionsPrevious30Days, 1);
});

test("an activity never done has no averages", () => {
  const summary = summarizeActivity([], now);
  assert.equal(summary.sessionCount, 0);
  assert.equal(summary.averageHeartRate, undefined);
  assert.equal(summary.lastStartedAt, undefined);
});

test("usage counts per activity, most recent first", () => {
  const usage = usageOf([
    { activityKey: "tennis", startedAt: now - 5 * DAY },
    { activityKey: "golf", startedAt: now - 1 * DAY },
    { activityKey: "tennis", startedAt: now - 2 * DAY },
  ]);
  assert.deepEqual(usage, [
    { activityKey: "tennis", count: 2, lastStartedAt: now - 2 * DAY },
    { activityKey: "golf", count: 1, lastStartedAt: now - 1 * DAY },
  ].sort((a, b) => b.lastStartedAt - a.lastStartedAt));
});

// ── Detection ─────────────────────────────────────────────────────────────

const series = (from: number, minutes: number, stepMin: number, bpm: number) =>
  Array.from({ length: Math.floor(minutes / stepMin) + 1 }, (_, i) => ({ recordedAt: from + i * stepMin * MIN, bpm }));

test("no baseline, no detection", () => {
  assert.equal(restingBaseline([], [70, 72]), undefined);
  assert.deepEqual(detectActiveWindows(series(now, 60, 5, 150), undefined, []), []);
});

test("baseline prefers the band's resting readings", () => {
  assert.equal(restingBaseline([58, 62, 60], []), 60);
  const all = Array.from({ length: 100 }, (_, i) => 50 + i);
  assert.equal(restingBaseline([], all), 60);
});

test("a sustained elevated period is noticed; a short one is not", () => {
  const start = now - 3 * 60 * MIN;
  const samples = [...series(start - 60 * MIN, 55, 5, 64), ...series(start, 54, 3, 140), ...series(start + 60 * MIN, 30, 5, 66)];
  const windows = detectActiveWindows(samples, 60, []);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].startedAt, start);
  assert.equal(windows[0].endedAt, start + 54 * MIN);
  assert.equal(windows[0].averageHeartRate, 140);

  const short = detectActiveWindows(series(start, 12, 3, 140), 60, []);
  assert.deepEqual(short, []);
});

test("a short break doesn't split a period; sparse readings don't form one", () => {
  const start = now - 5 * 60 * MIN;
  const withBreak = [...series(start, 15, 3, 135), { recordedAt: start + 21 * MIN, bpm: 70 }, ...series(start + 24 * MIN, 15, 3, 138)];
  const windows = detectActiveWindows(withBreak, 60, []);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].endedAt - windows[0].startedAt, 39 * MIN);

  const sparse = series(start, 120, 30, 140); // one reading every 30 min
  assert.deepEqual(detectActiveWindows(sparse, 60, []), []);
  assert.ok(DETECTION.maxGapMs < 30 * MIN);
});

test("recorded activities, workouts, sleep and past answers are never re-asked", () => {
  const start = now - 3 * 60 * MIN;
  const samples = series(start, 45, 3, 140);
  assert.equal(detectActiveWindows(samples, 60, []).length, 1);
  assert.deepEqual(detectActiveWindows(samples, 60, [{ startedAt: start + 10 * MIN, endedAt: start + 20 * MIN }]), []);
});

test("a high resting baseline raises the bar; the floor holds for a low one", () => {
  const samples = series(now - 2 * 60 * MIN, 40, 4, 95);
  assert.equal(detectActiveWindows(samples, 60, []).length, 1); // 95 ≥ max(85, 90)
  assert.deepEqual(detectActiveWindows(samples, 75, []), []);   // needs 100
  assert.deepEqual(detectActiveWindows(series(now - 2 * 60 * MIN, 40, 4, 88), 50, []), []); // under the 90 floor
});
