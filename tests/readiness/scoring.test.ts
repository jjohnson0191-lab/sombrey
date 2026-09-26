import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READINESS_V1,
  computeReadinessScore,
  confidenceBand,
  confidenceLevel,
  deriveSleepSignal,
  median,
  medianAbsoluteDeviation,
  overnightRestingHR,
  scoreBand,
  scoreRecentLoad,
  sleepMidpointAfterNoon,
  type DailyAggregate,
  type RecentLoadInput,
} from "../../convex/readiness/scoring.ts";
import type { LoadDay } from "../../convex/strain/rollingLoad.ts";
import { rollingLoad } from "../../convex/strain/rollingLoad.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

const date = (i: number) => {
  const d = new Date(Date.UTC(2026, 8, 1 + i));
  return d.toISOString().slice(0, 10);
};
/** n prior nights of steady data, then today (index n). */
function history(n: number, f: (i: number) => Partial<DailyAggregate> = () => ({ sleepMinutes: 450, sleepMidpoint: 900, restingHeartRate: 55, spo2: 97, skinTemperature: 33.5 })): DailyAggregate[] {
  return Array.from({ length: n }, (_, i) => ({ date: date(i), ...f(i) }));
}
const today = (n: number, over: Partial<DailyAggregate> = {}): DailyAggregate => ({ date: date(n), ...over });
const loadDays = (loads: (number | null)[]): (LoadDay & { confidence?: string })[] =>
  loads.map((l, i) => l === null
    ? { date: date(i), load: 0, status: "no_data" as const }
    : { date: date(i), load: l, status: l > 0 ? "measured" as const : "rest" as const, confidence: "MODERATE_CONFIDENCE" });
const recent = (loads: (number | null)[], reference = 1): RecentLoadInput => {
  const days = loadDays(loads);
  return { reference, days, rolling: rollingLoad([...days, { date: "today", load: 0, status: "in_progress" }], reference) };
};
const full = { sleepMinutes: 450, sleepMidpoint: 900, restingHeartRate: 55, spo2: 97, skinTemperature: 33.5 };

// ── Methodology ────────────────────────────────────────────────────────────

test("Readiness v1 weights are versioned and total 100%", () => {
  const w = READINESS_V1.weights;
  assert.equal(Math.round((w.sleep + w.cardiovascular + w.recentLoad + w.physiological) * 1000), 1000);
  assert.equal(READINESS_V1.version, "readiness-1.0");
  assert.equal(computeReadinessScore(history(20), today(20, full)).version, "readiness-1.0");
});

test("median/MAD", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(medianAbsoluteDeviation([1, 2, 3, 4, 5]), 1);
});

// ── Cold start & baseline ────────────────────────────────────────────────

test("cold start: nothing → NOT_ENOUGH_DATA, no number", () => {
  const r = computeReadinessScore([], today(0));
  assert.equal(r.score, null);
  assert.equal(r.state, "NOT_ENOUGH_DATA");
  assert.equal(r.confidenceLevel, "INSUFFICIENT");
});

test("cold start: one night of sleep → a score, BUILDING_BASELINE, labelled population bridge", () => {
  const r = computeReadinessScore([], today(0, { sleepMinutes: 440 }));
  assert.notEqual(r.score, null);
  assert.equal(r.state, "BUILDING_BASELINE");
  const sleep = r.components.find((c) => c.metric === "sleep")!;
  assert.equal(sleep.personal, false);
  assert.match(sleep.description, /7-hour reference/);
});

test("baseline: resting HR joins only after 5 prior nights", () => {
  assert.equal(computeReadinessScore(history(4), today(4, full)).components.find((c) => c.metric === "cardiovascular")!.included, false);
  assert.equal(computeReadinessScore(history(5), today(5, full)).components.find((c) => c.metric === "cardiovascular")!.included, true);
});

test("established baseline with full data → READY and high confidence", () => {
  const r = computeReadinessScore(history(28), today(28, full), recent(Array(28).fill(1)));
  assert.equal(r.state, "READY");
  assert.equal(r.confidenceLevel, "HIGH");
  assert.equal(r.score, 100);
});

// ── Domain weighting ──────────────────────────────────────────────────────

test("sleep weighting: short sleep lowers the score by its 40% share", () => {
  const base = computeReadinessScore(history(28), today(28, full), recent(Array(28).fill(1)));
  const short = computeReadinessScore(history(28), today(28, { ...full, sleepMinutes: 270 }), recent(Array(28).fill(1)));
  const sleep = short.components.find((c) => c.metric === "sleep")!;
  assert.ok(sleep.subScore! < 60);
  assert.equal(base.score! - short.score!, Math.round((100 - sleep.subScore!) * 0.4));
});

test("sleep regularity: irregular timing lowers the sleep domain", () => {
  const regular = computeReadinessScore(history(28), today(28, full));
  const irregular = computeReadinessScore(history(28, (i) => ({ ...full, sleepMidpoint: i % 2 ? 780 : 1020 })), today(28, full));
  const s = (x: typeof regular) => x.components.find((c) => c.metric === "sleep")!.subScore!;
  assert.ok(s(irregular) < s(regular));
  assert.match(irregular.components.find((c) => c.metric === "sleep")!.description, /irregular/);
});

test("cardiovascular weighting: elevated resting HR lowers the score; a lower one is not penalized", () => {
  const up = computeReadinessScore(history(28), today(28, { ...full, restingHeartRate: 63 }), recent(Array(28).fill(1)));
  const down = computeReadinessScore(history(28), today(28, { ...full, restingHeartRate: 49 }), recent(Array(28).fill(1)));
  const cv = (x: typeof up) => x.components.find((c) => c.metric === "cardiovascular")!;
  assert.ok(cv(up).subScore! < 50);
  assert.equal(cv(down).subScore, 100);
  assert.match(cv(up).description, /above your baseline/);
});

test("physiological weighting: an SpO2 drop or temperature deviation lowers it; normal = 100", () => {
  const h = history(28, (i) => ({ ...full, spo2: 97 + (i % 2 ? 0.5 : -0.5), skinTemperature: 33.5 + (i % 2 ? 0.1 : -0.1) }));
  const normal = computeReadinessScore(h, today(28, full)).components.find((c) => c.metric === "physiological")!;
  const off = computeReadinessScore(h, today(28, { ...full, spo2: 93, skinTemperature: 34.8 })).components.find((c) => c.metric === "physiological")!;
  assert.equal(normal.subScore, 100);
  assert.ok(off.subScore! < 60);
});

// ── Missing data & renormalization ────────────────────────────────────────

test("missing sleep: excluded and renormalized — never scored as poor", () => {
  const r = computeReadinessScore(history(28), today(28, { restingHeartRate: 55, spo2: 97, skinTemperature: 33.5 }), recent(Array(28).fill(1)));
  const sleep = r.components.find((c) => c.metric === "sleep")!;
  assert.equal(sleep.included, false);
  assert.equal(sleep.subScore, undefined);
  assert.equal(r.score, 100);                                   // the other domains are all fine
  const total = r.components.reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);                        // renormalized
  assert.ok(r.confidence < computeReadinessScore(history(28), today(28, full), recent(Array(28).fill(1))).confidence); // but less confident
});

test("missing HR: cardiovascular excluded, others renormalized", () => {
  const r = computeReadinessScore(history(28), today(28, { ...full, restingHeartRate: undefined }));
  assert.equal(r.components.find((c) => c.metric === "cardiovascular")!.included, false);
  assert.notEqual(r.score, null);
});

test("missing physiology: excluded, not zero", () => {
  const r = computeReadinessScore(history(28), today(28, { sleepMinutes: 450, restingHeartRate: 55 }));
  assert.equal(r.components.find((c) => c.metric === "physiological")!.included, false);
  assert.equal(r.score, 100);
});

test("load and physiology alone cannot make a readiness score", () => {
  const r = computeReadinessScore(history(28), today(28, { spo2: 97, skinTemperature: 33.5 }), recent(Array(28).fill(1)));
  assert.equal(r.score, null);
  assert.equal(r.state, "NOT_ENOUGH_DATA");
});

// ── Recent load (yesterday's Strain enters here) ─────────────────────────

test("recent load: typical or light load and rest are never penalized", () => {
  assert.equal(scoreRecentLoad(recent([1, 1, 1, 1, 1, 1, 1])).subScore, 100);
  assert.equal(scoreRecentLoad(recent([1, 1, 1, 1, 0, 0, 0])).subScore, 100);
});

test("recent load: yesterday's heavy day lowers the domain — within its 20% share, never a subtraction", () => {
  const heavy = scoreRecentLoad(recent([1, 1, 1, 1, 1, 1, 3]));
  assert.ok(heavy.subScore! < 100 && heavy.subScore! >= READINESS_V1.recentLoad.floor);
  assert.equal(heavy.detail!.yesterdayRelative, 3);
  const withLoad = computeReadinessScore(history(28), today(28, full), recent([...Array(27).fill(1), 3]));
  const without = computeReadinessScore(history(28), today(28, full), recent(Array(28).fill(1)));
  assert.equal(without.score! - withLoad.score!, Math.round((100 - withLoad.components.find((c) => c.metric === "recentLoad")!.subScore!) * 0.2));
});

test("recent load: yesterday weighs more than three days ago", () => {
  const y = scoreRecentLoad(recent([1, 1, 1, 1, 1, 1, 3])).subScore!;
  const d3 = scoreRecentLoad(recent([1, 1, 1, 1, 3, 1, 1])).subScore!;
  assert.ok(y < d3);
});

test("recent load: repeated high-load days lower it further", () => {
  const single = scoreRecentLoad(recent([1, 1, 1, 1, 1, 1, 1.6])).subScore!;
  const repeated = scoreRecentLoad(recent([1, 1, 1, 1.6, 1.6, 1.6, 1.6])).subScore!;
  assert.ok(repeated < single);
  assert.match(scoreRecentLoad(recent([1, 1, 1, 1.6, 1.6, 1.6, 1.6])).description, /4 high-load days in a row/);
});

test("recent load: no baseline → excluded (BUILDING), not guessed", () => {
  const r = scoreRecentLoad({ reference: undefined, days: loadDays([1, 1, 1]) });
  assert.equal(r.included, false);
  assert.match(r.description, /baseline still building/);
});

test("recent load: unknown days are excluded, never counted as zero", () => {
  const allUnknown = scoreRecentLoad(recent([1, 1, 1, 1, null, null, null]));
  assert.equal(allUnknown.included, false);
  const partly = scoreRecentLoad(recent([1, 1, 1, 1, 3, null, null])); // only day-3 known: 3× → penalized, lower confidence
  assert.ok(partly.subScore! < 100);
  assert.ok(partly.confidence < scoreRecentLoad(recent([1, 1, 1, 1, 3, 1, 1])).confidence);
});

// ── Inputs, confidence, bands ────────────────────────────────────────────

test("overnight resting HR: band reading first; else sustained low of the sleep window; never a daytime minimum", () => {
  assert.deepEqual(overnightRestingHR([52, 54], [70, 48]), { value: 53, source: "band_resting" });
  // 8 readings → lowest 3 = [41, 56, 57]; their median ignores the 41-bpm artifact.
  assert.deepEqual(overnightRestingHR([], [60, 58, 57, 56, 62, 64, 59, 41]), { value: 56, source: "sleep_window" });
  assert.deepEqual(overnightRestingHR([], [60, 58]), { source: "none" });
});

test("sleep midpoint is measured from local noon (no midnight wrap)", () => {
  // 23:00 → 07:00 in Colombo: midpoint 03:00 local = 900 min after noon.
  const start = Date.UTC(2026, 8, 25, 17, 30), end = Date.UTC(2026, 8, 26, 1, 30);
  assert.equal(sleepMidpointAfterNoon(start, end, "Asia/Colombo"), 900);
});

test("confidence levels and bands", () => {
  assert.equal(confidenceLevel(0.8), "HIGH");
  assert.equal(confidenceLevel(0.5), "MODERATE");
  assert.equal(confidenceLevel(0.3), "LOW");
  assert.equal(confidenceLevel(0.1), "INSUFFICIENT");
  assert.equal(confidenceBand(0.5), "Moderate");
  assert.equal(scoreBand(90), "Highly Ready");
  assert.equal(scoreBand(30), "Low Readiness");
});

test("deterministic and bounded", () => {
  const h = history(28, (i) => ({ ...full, sleepMinutes: 300 + (i * 37) % 200, restingHeartRate: 50 + (i * 7) % 12 }));
  const a = computeReadinessScore(h, today(28, { ...full, restingHeartRate: 90, sleepMinutes: 60 }), recent([5, 5, 5, 5, 5, 5, 5]));
  const b = computeReadinessScore(h, today(28, { ...full, restingHeartRate: 90, sleepMinutes: 60 }), recent([5, 5, 5, 5, 5, 5, 5]));
  assert.deepEqual(a, b);
  assert.ok(a.score! >= 0 && a.score! <= 100);
});

test("deriveSleepSignal keeps its confidence floor", () => {
  assert.equal(deriveSleepSignal(undefined), "unavailable");
  assert.equal(deriveSleepSignal({ subScore: 95, confidence: 0.2 }), "insufficient");
  assert.equal(deriveSleepSignal({ subScore: 95, confidence: 0.8 }), "good");
  assert.equal(deriveSleepSignal({ subScore: 30, confidence: 0.8 }), "poor");
});
