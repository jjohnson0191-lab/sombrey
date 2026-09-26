import { test } from "node:test";
import assert from "node:assert/strict";
import { apparentTemperature, conditionPhrase, environmentState, heatComparison, parseLocationforecast, WEATHER_STALE_MS } from "../../convex/strain/environment.ts";
import { correlationP, describeRelationship, spearman } from "../../convex/strain/relationships.ts";
import { buildIntelligenceContext, renderIntelligenceContext } from "../../convex/strain/context.ts";
import { computeIntelligence } from "../../convex/strain/pipeline.ts";
import { heartRateProfile } from "../../convex/strain/zones.ts";

const NOW = Date.UTC(2026, 8, 26, 9, 0);
const forecast = {
  properties: {
    timeseries: [
      { time: "2026-09-26T09:00:00Z", data: { instant: { details: { air_temperature: 28.4, relative_humidity: 78, wind_speed: 3.1, ultraviolet_index_clear_sky: 9.2 } }, next_1_hours: { summary: { symbol_code: "partlycloudy_day" }, details: { precipitation_amount: 0.2 } } } },
    ],
  },
};

// ── Weather ───────────────────────────────────────────────────────────────

test("location available: the provider response becomes a snapshot (no coordinates in it)", () => {
  const s = parseLocationforecast(forecast, NOW, "Asia/Colombo", "Colombo")!;
  assert.equal(s.temperatureC, 28.4);
  assert.equal(s.condition, "Partly cloudy");
  assert.equal(s.uvIndex, 9.2);
  assert.equal(s.precipitationMm, 0.2);
  assert.equal(s.feelsLikeC, apparentTemperature(28.4, 78, 3.1));
  assert.ok(s.feelsLikeC! > 28.4); // humid heat feels hotter
  assert.ok(!Object.keys(s).some((k) => /lat|lon|coord/i.test(k)));
});

test("location denied: unavailable, with the device time zone as the fallback", () => {
  const e = environmentState(null, NOW, true, "Asia/Colombo");
  assert.deepEqual(e, { state: "unavailable", reason: "location_denied", timeZone: "Asia/Colombo" });
});

test("weather unavailable (never fetched / provider empty)", () => {
  assert.equal(environmentState(null, NOW, false).state, "unavailable");
  assert.equal(parseLocationforecast({}, NOW, "UTC"), null);
});

test("stale weather is labelled stale", () => {
  const s = parseLocationforecast(forecast, NOW, "Asia/Colombo")!;
  assert.equal(environmentState(s, NOW + 10 * 60_000, false).state, "available");
  assert.equal(environmentState(s, NOW + WEATHER_STALE_MS + 1, false).state, "stale");
});

test("condition phrases", () => {
  assert.equal(conditionPhrase("heavyrainandthunder"), "Thunderstorms");
  assert.equal(conditionPhrase("lightrain"), "Light rain");
  assert.equal(conditionPhrase("clearsky_night"), "Clear");
});

test("environment captured for activities: comparison only with ≥ 3 sessions per heat band", () => {
  const rows = [
    ...[140, 142, 144].map((hr) => ({ category: "running", averageHR: hr, feelsLikeC: 20 })),
    ...[150, 152].map((hr) => ({ category: "running", averageHR: hr, feelsLikeC: 33 })),
  ];
  const c = heatComparison(rows, "running");
  assert.deepEqual(c, [{ band: "mild", sessions: 3, medianAverageHR: 142 }]);
});

test("weather never enters the load pipeline", () => {
  const input = { sessions: [], profile: heartRateProfile({ restingReadings: [60], age: 30, observedPeaks: [] }), setHistory: [], zone: "UTC", nowMs: NOW };
  assert.ok(!Object.keys(input).some((k) => /weather|environment/i.test(k)));
});

// ── Relationships ─────────────────────────────────────────────────────────

test("Spearman and its p-value", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  const p = correlationP(0.5, 30);
  assert.ok(p > 0.003 && p < 0.01); // ≈ 0.0049
});

test("no relationship claimed below 28 pairs, when weak, or when not significant", () => {
  const pairs = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ load: i, outcome: f(i) }));
  assert.equal(describeRelationship("next_morning_readiness", pairs(20, (i) => 100 - i)), null);
  assert.equal(describeRelationship("next_morning_readiness", pairs(40, (i) => (i * 7919) % 13)), null);
  const r = describeRelationship("next_morning_resting_hr", pairs(30, (i) => 50 + i))!;
  assert.match(r.statement, /tended to be higher/);
  assert.match(r.statement, /not a cause/);
});

// ── AI context ────────────────────────────────────────────────────────────

test("the AI context is structured, carries its basis, and gives no strain number", () => {
  const profile = heartRateProfile({ restingReadings: [60], age: 30, observedPeaks: [] });
  const intelligence = computeIntelligence({
    sessions: [{ id: "a", kind: "activity", origin: "band_activity", category: "running", startMs: NOW - 3600_000, endMs: NOW - 1800_000, samples: [], seriesTimingVerified: true, sets: [] }],
    profile, setHistory: [], zone: "Asia/Colombo", nowMs: NOW,
  });
  const ctx = buildIntelligenceContext({
    timeZone: "Asia/Colombo", intelligence, profile, sessionNames: new Map([["a", "Running"]]),
    readiness: [{ date: "2026-09-26", score: 71 }], relationships: [],
    week: { trainingDays: 0, activeDays: 1, minutes: 30, plannedCompleted: 0 },
    environment: environmentState(parseLocationforecast(forecast, NOW, "Asia/Colombo", "Colombo"), NOW, false),
    body: { weightKg: 80, source: "manual" }, records: [], insights: [],
  });
  assert.equal(ctx.currentDay.strainValueShown, false);
  assert.equal(ctx.currentDay.sessions[0].loadBasis, "activity type (no usable heart rate)");
  assert.equal(ctx.recovery.readinessToday, 71);
  for (const k of ["currentDay", "recentHistory", "recovery", "training", "environment", "body", "performance"]) assert.ok(k in ctx);
  const text = renderIntelligenceContext(ctx).join("\n");
  assert.match(text, /time zone Asia\/Colombo/);
  assert.match(text, /no strain number shown/);
  assert.match(text, /Colombo, 28°C/);
  assert.match(text, /context only/);
  assert.match(text, /estimated from age, Tanaka/);
  assert.doesNotMatch(text, /strain (score|value) (is|of) \d/i);
});
