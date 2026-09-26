import { test } from "node:test";
import assert from "node:assert/strict";
import { RPE_ANCHORS, RPE_SCALE_VERSION, effortPairing, ratingTarget, sessionRpeLoad, validateRpe } from "../../convex/strain/effort.ts";
import { conditionCode, dailyForecast, parseLocationforecast } from "../../convex/strain/environment.ts";
import { STRAIN_DISPLAY_ENABLED, STRAIN_FORMULA_APPROVED, relativeLabel, strainBand } from "../../convex/strain/strainScore.ts";
import { STRAIN_V1 } from "../../convex/strain/strainConfig.ts";
import { READINESS_V1, computeReadinessScore } from "../../convex/readiness/scoring.ts";
import { computeIntelligence } from "../../convex/strain/pipeline.ts";
import { heartRateProfile } from "../../convex/strain/zones.ts";
import type { SessionInput } from "../../convex/strain/sessionLoad.ts";

// ── RPE ──────────────────────────────────────────────────────────────────

test("RPE: whole numbers 1–10 only", () => {
  for (const ok of [1, 5, 10]) assert.deepEqual(validateRpe(ok), { ok: true, rpe: ok });
  for (const bad of [0, 11, -3, 5.5, NaN, "7", undefined]) assert.equal(validateRpe(bad).ok, false);
  assert.equal(RPE_SCALE_VERSION, "rpe-1");
  assert.equal(RPE_ANCHORS[1], "Very easy");
  assert.equal(RPE_ANCHORS[10], "Max effort");
});

test("RPE: one rating per physical session — a band record owned by a workout is rated on the workout", () => {
  assert.deepEqual(ratingTarget("band_activity", "b1", "w1"), { kind: "workout", id: "w1" });
  assert.deepEqual(ratingTarget("band_activity", "b1"), { kind: "band_activity", id: "b1" });
  assert.deepEqual(ratingTarget("workout", "w1"), { kind: "workout", id: "w1" });
  assert.deepEqual(ratingTarget("noticed_activity", "n1"), { kind: "noticed_activity", id: "n1" });
});

test("RPE: session-RPE load is context only; the pairing states facts, not a learned relationship", () => {
  assert.equal(sessionRpeLoad(7, 45), 315);
  assert.equal(sessionRpeLoad(undefined, 45), undefined);
  assert.equal(effortPairing(1.0, 9), "Measured load typical for you; felt hard (9/10)");
  assert.equal(effortPairing(1.8, 5), "Measured load high for you; felt moderate (5/10)");
  assert.equal(effortPairing(undefined, 5), undefined);
});

const NOW = Date.UTC(2026, 8, 26, 4, 0); // 09:30 Colombo
const profile = heartRateProfile({ restingReadings: [60], age: 30, observedPeaks: [] });
const run = (id: string, start: number, minutes: number, rpe?: number): SessionInput => ({
  id, kind: "activity", origin: "band_activity", category: "running", startMs: start, endMs: start + minutes * 60000,
  samples: Array.from({ length: minutes * 12 }, (_, i) => ({ t: start + i * 5000, bpm: 150 })), seriesTimingVerified: true, sets: [], rpe,
});

test("RPE never changes load or Strain in strain-1.0", () => {
  const a = computeIntelligence({ sessions: [run("r", NOW - 3600_000, 45)], profile, setHistory: [], zone: "Asia/Colombo", nowMs: NOW });
  const b = computeIntelligence({ sessions: [run("r", NOW - 3600_000, 45, 10)], profile, setHistory: [], zone: "Asia/Colombo", nowMs: NOW });
  assert.equal(a.today.load, b.today.load);
  assert.deepEqual(a.strain, b.strain);
  assert.equal(b.todaySessions[0].rpe, 10); // carried for context
});

// ── No scoring changes (golden values for strain-1.0 / readiness-1.0) ─────

test("scoring unchanged: Strain v1 and Readiness v1 configuration", () => {
  assert.equal(STRAIN_V1.version, "strain-1.0");
  assert.deepEqual(STRAIN_V1.weights, { cardiovascular: 0.45, resistance: 0.30, activity: 0.25 });
  assert.deepEqual(STRAIN_V1.referenceDoses, { cardiovascular: 180, resistance: 20, activity: 300 });
  assert.equal(STRAIN_V1.referenceFloor, 0.5);
  assert.equal(READINESS_V1.version, "readiness-1.0");
  assert.deepEqual(READINESS_V1.weights, { sleep: 0.40, cardiovascular: 0.30, recentLoad: 0.20, physiological: 0.10 });
});

test("scoring unchanged: golden Daily Load and Readiness", () => {
  const r = computeIntelligence({ sessions: [run("r", NOW - 3600_000, 60)], profile, setHistory: [], zone: "Asia/Colombo", nowMs: NOW });
  assert.equal(r.today.load, 1);              // 60 min zone 3 = one cardio reference dose
  const history = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, sleepMinutes: 450, restingHeartRate: 55 }));
  const rd = computeReadinessScore(history, { date: "2026-09-21", sleepMinutes: 360, restingHeartRate: 58 });
  // sleep 360/450 = 0.8 → 40 + (0.2/0.25)·40 = 72; RHR z = 3/2 = 1.5 → 100 − 20·1.0 = 80;
  // renormalized over sleep + cardiovascular: 72·(0.4/0.7) + 80·(0.3/0.7) = 75.4 → 75
  assert.equal(rd.score, 75);
});

// ── Strain presentation (labels only) ──────────────────────────────────────

test("Strain is displayed but not claimed as validated", () => {
  assert.equal(STRAIN_DISPLAY_ENABLED, true);
  assert.equal(STRAIN_FORMULA_APPROVED, false);
  assert.equal(strainBand(12), "Light");
  assert.equal(strainBand(50), "Moderate");
  assert.equal(strainBand(64), "High");
  assert.equal(strainBand(85), "Very high");
  assert.equal(relativeLabel(1), "About your usual day");
  assert.equal(relativeLabel(0.4), "Below your usual day");
  assert.equal(relativeLabel(2.5), "Well above your usual day");
});

// ── Forecast ──────────────────────────────────────────────────────────────

const entry = (iso: string, temp: number, opts: { h1?: [string, number, number?]; h6?: [string, number, number?] } = {}) => ({
  time: iso,
  data: {
    instant: { details: { air_temperature: temp, relative_humidity: 70, wind_speed: 3 } },
    ...(opts.h1 ? { next_1_hours: { summary: { symbol_code: opts.h1[0] }, details: { precipitation_amount: opts.h1[1], probability_of_precipitation: opts.h1[2] } } } : {}),
    ...(opts.h6 ? { next_6_hours: { summary: { symbol_code: opts.h6[0] }, details: { precipitation_amount: opts.h6[1], probability_of_precipitation: opts.h6[2] } } } : {}),
  },
});

test("forecast: local days, high/low, noon condition, precipitation summed once, partial today", () => {
  const series = [
    // Colombo today (UTC+5:30): 09:30, 10:30, 11:30 local — hourly with 6 h summaries too
    entry("2026-09-26T04:00:00Z", 27, { h1: ["partlycloudy_day", 0.2], h6: ["rain", 3.0] }),
    entry("2026-09-26T05:00:00Z", 29, { h1: ["partlycloudy_day", 0.3], h6: ["rain", 3.0] }),
    entry("2026-09-26T06:00:00Z", 30, { h1: ["cloudy", 0.5, 40], h6: ["rain", 3.0] }),
    // tomorrow — 6-hourly only
    entry("2026-09-27T00:00:00Z", 25, { h6: ["lightrain", 1.0, 70] }),
    entry("2026-09-27T06:00:00Z", 31, { h6: ["heavyrainandthunder", 8.0] }),
    entry("2026-09-27T12:00:00Z", 27, { h6: ["cloudy", 0.4] }),
    // a single reading the day after: dropped
    entry("2026-09-28T00:00:00Z", 26, { h6: ["clearsky_night", 0] }),
  ];
  const f = dailyForecast(series, "Asia/Colombo", NOW);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { date: "2026-09-26", highC: 30, lowC: 27, condition: "Rain", conditionCode: "rain", precipitationMm: 1, precipitationProbability: 40, partial: true });
  assert.equal(f[1].highC, 31);
  assert.equal(f[1].lowC, 25);
  assert.equal(f[1].conditionCode, "thunder");         // the period nearest local noon (11:30)
  assert.equal(f[1].precipitationMm, 9.4);
  assert.equal(f[1].precipitationProbability, 70);
  assert.equal(f[1].partial, undefined);
});

test("forecast: unavailable data yields an empty forecast, never an invented one", () => {
  assert.deepEqual(dailyForecast([], "UTC", NOW), []);
  const snap = parseLocationforecast({ properties: { timeseries: [entry("2026-09-26T04:00:00Z", 27, { h1: ["fog", 0] })] } }, NOW, "Asia/Colombo")!;
  assert.deepEqual(snap.forecast, []);
  assert.equal(snap.conditionCode, "fog");
});

test("neutral condition codes (no provider symbols reach the app)", () => {
  assert.equal(conditionCode("partlycloudy_night"), "partly_cloudy");
  assert.equal(conditionCode("fair_day"), "mostly_clear");
  assert.equal(conditionCode("lightrainshowers_day"), "light_rain");
  assert.equal(conditionCode("heavysnow"), "snow");
  assert.equal(conditionCode("rainandthunder"), "thunder");
  assert.equal(conditionCode(undefined), undefined);
});
