import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeReadinessScore,
  median,
  medianAbsoluteDeviation,
  scoreBand,
  confidenceBand,
  type DailyAggregate,
} from "../../convex/readiness/scoring.ts";

function day(date: string, overrides: Partial<DailyAggregate> = {}): DailyAggregate {
  return { date, trainingMinutes: 0, ...overrides };
}

test("median/MAD — pure statistics", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), undefined);
  assert.equal(medianAbsoluteDeviation([1, 2, 3, 4, 5]), 1);
});

test("cold start: zero history produces null score, not a fabricated number", () => {
  const result = computeReadinessScore([], day("2026-01-01"));
  assert.equal(result.score, null);
  assert.equal(result.confidence, 0);
  assert.ok(result.missingInputs.length > 0);
  for (const c of result.components) assert.equal(c.subScore, undefined);
});

test("cold start: a single day of sleep data alone produces a real score", () => {
  const today = day("2026-01-01", { sleepMinutes: 440 });
  const result = computeReadinessScore([], today);
  assert.notEqual(result.score, null);
  assert.ok(result.score! >= 0 && result.score! <= 100);
  // Only sleep is active — its weight must be renormalized to 100%, not left at its base 35%.
  const sleepComponent = result.components.find((c) => c.metric === "sleep")!;
  assert.equal(sleepComponent.weight, 1);
  assert.ok(result.confidence < 0.5, "confidence should be low on day one");
});

test("missing metrics are excluded, never substituted with a fabricated value", () => {
  const result = computeReadinessScore([], day("2026-01-01", { sleepMinutes: 400 }));
  const hrComponent = result.components.find((c) => c.metric === "cardiovascular")!;
  assert.equal(hrComponent.included, false);
  assert.equal(hrComponent.subScore, undefined);
  assert.ok(result.missingInputs.some((m) => m.toLowerCase().includes("heart rate")));
});

test("baseline creation: resting HR component activates only after 3+ days of history", () => {
  const twoNights = [day("2026-01-01", { restingHeartRate: 58 }), day("2026-01-02", { restingHeartRate: 59 })];
  const notEnough = computeReadinessScore(twoNights, day("2026-01-03", { restingHeartRate: 58, sleepMinutes: 420 }));
  assert.equal(notEnough.components.find((c) => c.metric === "cardiovascular")!.included, false);

  const threeNights = [...twoNights, day("2026-01-03", { restingHeartRate: 60 })];
  const enough = computeReadinessScore(threeNights, day("2026-01-04", { restingHeartRate: 58, sleepMinutes: 420 }));
  assert.equal(enough.components.find((c) => c.metric === "cardiovascular")!.included, true);
});

test("baseline adaptation: elevated resting HR versus a stable baseline lowers the cardiovascular sub-score", () => {
  const stableHistory = Array.from({ length: 14 }, (_, i) => day(`2026-01-${String(i + 1).padStart(2, "0")}`, { restingHeartRate: 58, sleepMinutes: 430 }));
  const normalDay = computeReadinessScore(stableHistory, day("2026-01-15", { restingHeartRate: 58, sleepMinutes: 430 }));
  const elevatedDay = computeReadinessScore(stableHistory, day("2026-01-15", { restingHeartRate: 72, sleepMinutes: 430 }));

  const normalHR = normalDay.components.find((c) => c.metric === "cardiovascular")!.subScore!;
  const elevatedHR = elevatedDay.components.find((c) => c.metric === "cardiovascular")!.subScore!;
  assert.ok(elevatedHR < normalHR, "an elevated HR day must score lower than a normal day against the same baseline");
});

test("baseline adapts gradually: one abnormal night does not collapse the sleep baseline", () => {
  const goodNights = Array.from({ length: 13 }, (_, i) => day(`2026-01-${String(i + 1).padStart(2, "0")}`, { sleepMinutes: 440 }));
  const oneBadNight = [...goodNights, day("2026-01-14", { sleepMinutes: 200 })];
  // The next day, sleeping a normal 440 minutes should still score well —
  // the single bad night shouldn't have dragged the rolling median down much.
  const result = computeReadinessScore(oneBadNight, day("2026-01-15", { sleepMinutes: 440 }));
  const sleepScore = result.components.find((c) => c.metric === "sleep")!.subScore!;
  assert.ok(sleepScore >= 90, `expected a normal night to still score well after one bad night, got ${sleepScore}`);
});

test("incomplete sleep: sleeping well below personal baseline lowers the sleep sub-score", () => {
  const history = Array.from({ length: 14 }, (_, i) => day(`2026-01-${String(i + 1).padStart(2, "0")}`, { sleepMinutes: 450 }));
  const short = computeReadinessScore(history, day("2026-01-15", { sleepMinutes: 240 }));
  const full = computeReadinessScore(history, day("2026-01-15", { sleepMinutes: 450 }));
  const shortScore = short.components.find((c) => c.metric === "sleep")!.subScore!;
  const fullScore = full.components.find((c) => c.metric === "sleep")!.subScore!;
  assert.ok(shortScore < fullScore);
});

test("training load: a sharp acute spike over chronic load lowers the training-load sub-score", () => {
  const chronicHistory = Array.from({ length: 28 }, (_, i) => day(`2026-01-${String(i + 1).padStart(2, "0")}`, { trainingMinutes: 30 }));
  const spikeDay = day("2026-01-29", { trainingMinutes: 120 });
  const normalDay = day("2026-01-29", { trainingMinutes: 30 });

  const spike = computeReadinessScore(chronicHistory, spikeDay);
  const normal = computeReadinessScore(chronicHistory, normalDay);
  const spikeScore = spike.components.find((c) => c.metric === "trainingLoad")!.subScore!;
  const normalScore = normal.components.find((c) => c.metric === "trainingLoad")!.subScore!;
  assert.ok(spikeScore < normalScore);
});

test("abnormal readings: extreme resting HR deviation still bounds the sub-score to [0,100]", () => {
  const history = Array.from({ length: 14 }, (_, i) => day(`2026-01-${String(i + 1).padStart(2, "0")}`, { restingHeartRate: 55 }));
  const extreme = computeReadinessScore(history, day("2026-01-15", { restingHeartRate: 220, sleepMinutes: 420 }));
  const hr = extreme.components.find((c) => c.metric === "cardiovascular")!.subScore!;
  assert.ok(hr >= 0 && hr <= 100);
});

test("score is always within [0, 100] across a range of synthetic inputs", () => {
  const scenarios: DailyAggregate[] = [
    day("d", { sleepMinutes: 0, restingHeartRate: 40, trainingMinutes: 0 }),
    day("d", { sleepMinutes: 900, restingHeartRate: 200, trainingMinutes: 500 }),
    day("d", { sleepMinutes: 420, restingHeartRate: 60, spo2: 98, skinTemperature: 36.5, trainingMinutes: 45 }),
  ];
  const history = Array.from({ length: 20 }, (_, i) =>
    day(`h${i}`, { sleepMinutes: 420, restingHeartRate: 60, spo2: 98, skinTemperature: 36.5, trainingMinutes: 30 }),
  );
  for (const scenario of scenarios) {
    const result = computeReadinessScore(history, scenario);
    if (result.score !== null) {
      assert.ok(result.score >= 0 && result.score <= 100, `score out of bounds: ${result.score}`);
    }
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});

test("confidence increases as personal history accumulates (same daily values, more days)", () => {
  const makeHistory = (days: number) =>
    Array.from({ length: days }, (_, i) => day(`h${i}`, { sleepMinutes: 430, restingHeartRate: 58, trainingMinutes: 30 }));
  const today = day("today", { sleepMinutes: 430, restingHeartRate: 58, trainingMinutes: 30 });

  const shortHistory = computeReadinessScore(makeHistory(3), today);
  const longHistory = computeReadinessScore(makeHistory(25), today);
  assert.ok(longHistory.confidence > shortHistory.confidence);
});

test("deterministic: identical inputs always produce identical output", () => {
  const history = Array.from({ length: 10 }, (_, i) => day(`h${i}`, { sleepMinutes: 410, restingHeartRate: 61, trainingMinutes: 20 }));
  const today = day("today", { sleepMinutes: 405, restingHeartRate: 63, trainingMinutes: 40 });
  const a = computeReadinessScore(history, today);
  const b = computeReadinessScore(history, today);
  assert.deepEqual(a, b);
});

test("no fabricated metrics: a component never reports a sub-score without being marked included", () => {
  const result = computeReadinessScore([], day("d", { sleepMinutes: 400 }));
  for (const c of result.components) {
    if (c.subScore !== undefined) assert.equal(c.included, true);
    if (!c.included) assert.equal(c.subScore, undefined);
  }
});

test("score/confidence bands cover the full range with non-medical wording", () => {
  assert.equal(scoreBand(95), "Highly Ready");
  assert.equal(scoreBand(75), "Ready");
  assert.equal(scoreBand(60), "Moderate");
  assert.equal(scoreBand(45), "Caution");
  assert.equal(scoreBand(10), "Low Readiness");
  assert.equal(confidenceBand(0.9), "High");
  assert.equal(confidenceBand(0.5), "Improving");
  assert.equal(confidenceBand(0.1), "Building baseline");
  for (const label of [scoreBand(50), confidenceBand(0.5)]) {
    assert.ok(!/medical|diagnos|clinical/i.test(label));
  }
});
