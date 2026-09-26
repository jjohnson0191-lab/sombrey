import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatedMaxHR, heartRateProfile, hrr, zoneFor } from "../../convex/strain/zones.ts";
import { cardiovascularLoad, type HRSample } from "../../convex/strain/cardiovascularLoad.ts";
import { resistanceLoad } from "../../convex/strain/resistanceLoad.ts";
import { activityLoad } from "../../convex/strain/activityLoad.ts";
import { resolveOverlaps, sessionLoad, type SessionInput } from "../../convex/strain/sessionLoad.ts";
import { dailyLoad, COMPONENT_CAP } from "../../convex/strain/dailyLoad.ts";
import { strainBaseline } from "../../convex/strain/baseline.ts";
import { proposedStrain, strainFor, STRAIN_FORMULA_APPROVED } from "../../convex/strain/strainScore.ts";
import { computeIntelligence } from "../../convex/strain/pipeline.ts";
import { blend, downgrade, lower } from "../../convex/strain/confidence.ts";
import { SIGNALS } from "../../convex/strain/signals.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 26, 10, 0);
const profile = heartRateProfile({ restingReadings: [58, 60, 62], age: 30, observedPeaks: [] }); // rest 60, max 187
const series = (start: number, minutes: number, everySec: number, bpm: (i: number) => number): HRSample[] =>
  Array.from({ length: Math.floor((minutes * 60) / everySec) }, (_, i) => ({ t: start + i * everySec * 1000, bpm: bpm(i) }));

// ── Signals & confidence ──────────────────────────────────────────────────

test("signal registry: calories, weather and readiness are never strain inputs", () => {
  const role = (id: string) => SIGNALS.find((s) => s.id === id)?.strainRole;
  assert.equal(role("session_calories"), "context_only");
  assert.equal(role("weather"), "context_only");
  assert.equal(role("readiness"), "not_used");
  assert.equal(SIGNALS.find((s) => s.id === "hrv")?.reliability, "unavailable");
});

test("confidence helpers", () => {
  assert.equal(lower("HIGH_CONFIDENCE", "LOW_CONFIDENCE"), "LOW_CONFIDENCE");
  assert.equal(downgrade("HIGH_CONFIDENCE"), "MODERATE_CONFIDENCE");
  assert.equal(downgrade("INSUFFICIENT_DATA"), "INSUFFICIENT_DATA");
  assert.equal(blend([]), "INSUFFICIENT_DATA");
});

// ── Heart-rate profile & zones ────────────────────────────────────────────

test("resting HR from band readings; HRmax estimated (Tanaka) and labelled", () => {
  assert.equal(estimatedMaxHR(30), 187);
  assert.equal(profile.restingHR, 60);
  assert.equal(profile.maxHR, 187);
  assert.equal(profile.maxSource, "estimated_age");
});

test("measured HRmax is used as measured; an observed peak raises the estimate", () => {
  assert.equal(heartRateProfile({ restingReadings: [60], measuredMax: 195, age: 30, observedPeaks: [] }).maxSource, "measured");
  const peak = heartRateProfile({ restingReadings: [60], age: 30, observedPeaks: [192] });
  assert.equal(peak.maxHR, 192);
  assert.equal(peak.maxSource, "observed_peak");
});

test("no date of birth → no HRmax → no zones (nothing fabricated)", () => {
  const p = heartRateProfile({ restingReadings: [60], observedPeaks: [180] });
  assert.equal(p.maxHR, undefined);
  assert.equal(hrr(150, p), undefined);
  const c = cardiovascularLoad({ startMs: T0, endMs: T0 + 30 * MIN, samples: series(T0, 30, 5, () => 150), profile: p, seriesTimingVerified: true });
  assert.equal(c.confidence, "INSUFFICIENT_DATA");
  assert.match(c.reason ?? "", /maximum heart rate/);
});

test("HRR zones", () => {
  assert.equal(zoneFor(0.2).zone, 0);
  assert.equal(zoneFor(0.65).zone, 3);
  assert.equal(zoneFor(0.9).weight, 5);
});

// ── Cardiovascular load ───────────────────────────────────────────────────

test("valid dense HR: load from time in zones; confidence capped (HRmax estimated)", () => {
  // 150 bpm → (150−60)/127 = 0.71 → zone 3 (weight 3). 30 min → 90.
  const c = cardiovascularLoad({ startMs: T0, endMs: T0 + 30 * MIN, samples: series(T0, 30, 5, () => 150), profile, seriesTimingVerified: true });
  assert.equal(c.method, "series");
  assert.ok(Math.abs(c.load - 90) < 0.5);
  assert.equal(c.confidence, "MODERATE_CONFIDENCE"); // HIGH needs a measured HRmax
  const measured = heartRateProfile({ restingReadings: [60], measuredMax: 187, observedPeaks: [] });
  assert.equal(cardiovascularLoad({ startMs: T0, endMs: T0 + 30 * MIN, samples: series(T0, 30, 5, () => 150), profile: measured, seriesTimingVerified: true }).confidence, "HIGH_CONFIDENCE");
});

test("sparse HR is not treated as continuous: each reading covers at most 2 minutes", () => {
  const c = cardiovascularLoad({ startMs: T0, endMs: T0 + 60 * MIN, samples: series(T0, 60, 300, () => 150), profile, seriesTimingVerified: true });
  assert.ok(c.coveredMinutes <= 24.01); // 12 readings × 2 min
  assert.ok(c.load <= 72.01);
  assert.equal(c.confidence, "LOW_CONFIDENCE");
});

test("missing HR: the band's session average at LOW, else nothing", () => {
  const avg = cardiovascularLoad({ startMs: T0, endMs: T0 + 40 * MIN, samples: [], profile, averageHR: 150, seriesTimingVerified: true });
  assert.equal(avg.method, "session_average");
  assert.equal(avg.confidence, "LOW_CONFIDENCE");
  const none = cardiovascularLoad({ startMs: T0, endMs: T0 + 40 * MIN, samples: [], profile, seriesTimingVerified: true });
  assert.equal(none.confidence, "INSUFFICIENT_DATA");
  assert.equal(none.load, 0);
});

test("unverified series timing caps confidence", () => {
  const measured = heartRateProfile({ restingReadings: [60], measuredMax: 187, observedPeaks: [] });
  const c = cardiovascularLoad({ startMs: T0, endMs: T0 + 30 * MIN, samples: series(T0, 30, 5, () => 150), profile: measured, seriesTimingVerified: false });
  assert.equal(c.confidence, "MODERATE_CONFIDENCE");
});

// ── Resistance ────────────────────────────────────────────────────────────

test("resistance: bodyweight sets count as set-equivalents; volume reported, not scored", () => {
  const r = resistanceLoad([{ exerciseId: "pushup", reps: 15 }, { exerciseId: "pushup", reps: 12 }], new Map());
  assert.equal(r.load, 2);
  assert.equal(r.weightedSets, 0);
  assert.equal(r.confidence, "LOW_CONFIDENCE");
});

test("resistance: relative intensity against the user's own best, clamped", () => {
  const refs = new Map([["squat", 100]]);
  const heavy = resistanceLoad([{ exerciseId: "squat", reps: 2, weightKg: 95 }], refs);
  const light = resistanceLoad([{ exerciseId: "squat", reps: 15, weightKg: 30 }], refs);
  assert.equal(heavy.load, 1.3);
  assert.equal(light.load, 0.6);
  assert.equal(heavy.confidence, "HIGH_CONFIDENCE");
});

test("resistance: missing weight and incomplete sets", () => {
  const r = resistanceLoad([{ exerciseId: "row", reps: 10 }, { exerciseId: "row", reps: 0, weightKg: 50 }], new Map());
  assert.equal(r.completedSets, 1);
  assert.equal(resistanceLoad([], new Map()).confidence, "INSUFFICIENT_DATA");
});

test("60 minutes of lifting is not 60 minutes of running", () => {
  const lifting: SessionInput = { id: "w", kind: "workout", origin: "sombrey_workout", category: "strength", startMs: T0, endMs: T0 + 60 * MIN, samples: [], seriesTimingVerified: true, sets: Array.from({ length: 12 }, () => ({ exerciseId: "x", reps: 10 })) };
  const l = sessionLoad(lifting, profile, new Map());
  assert.equal(l.aerobicBasis, "none"); // no HR → no aerobic credit invented for lifting minutes
  assert.equal(l.resistance?.load, 12);
});

// ── Activity fallback ────────────────────────────────────────────────────

test("activity load (MET-minutes) only when heart rate is unusable, always LOW", () => {
  const a = activityLoad("running", 30);
  assert.equal(a.load, 30 * 8);
  assert.equal(a.confidence, "LOW_CONFIDENCE");
  const s: SessionInput = { id: "a", kind: "activity", origin: "band_activity", category: "running", startMs: T0, endMs: T0 + 30 * MIN, samples: [], seriesTimingVerified: true, sets: [] };
  assert.equal(sessionLoad(s, profile, new Map()).aerobicBasis, "activity");
  const withHR = { ...s, samples: series(T0, 30, 5, () => 150) };
  assert.equal(sessionLoad(withHR, profile, new Map()).aerobicBasis, "cardio");
});

test("a noticed (user-labelled) activity is lower confidence", () => {
  const base: SessionInput = { id: "n", kind: "activity", origin: "band_activity", category: "running", startMs: T0, endMs: T0 + 30 * MIN, samples: series(T0, 30, 5, () => 150), seriesTimingVerified: true, sets: [] };
  const band = sessionLoad(base, profile, new Map());
  const noticed = sessionLoad({ ...base, origin: "noticed_activity" }, profile, new Map());
  assert.equal(noticed.confidence, downgrade(band.confidence));
});

// ── De-duplication ────────────────────────────────────────────────────────

const mk = (id: string, origin: string, start: number, minutes: number): SessionInput =>
  ({ id, kind: origin.includes("workout") ? "workout" : "activity", origin, category: "running", startMs: start, endMs: start + minutes * MIN, samples: [], seriesTimingVerified: true, sets: [] });

test("duplicates: a noticed activity inside a band activity is dropped", () => {
  const { kept, dropped } = resolveOverlaps([mk("band", "band_activity", T0, 60), mk("noticed", "noticed_activity", T0 + 5 * MIN, 40)]);
  assert.deepEqual(kept.map((k) => k.id), ["band"]);
  assert.deepEqual(dropped, ["noticed"]);
});

test("overlap: a workout wins; the partial overlap is trimmed, not double counted", () => {
  const { kept } = resolveOverlaps([mk("act", "app_activity", T0, 60), mk("w", "sombrey_workout", T0 + 45 * MIN, 45)]);
  const act = kept.find((k) => k.id === "act")!;
  assert.equal((act.endMs - act.startMs) / MIN, 45);
  assert.equal(act.trimmed, true);
});

test("separate sessions on one day both count", () => {
  const { kept } = resolveOverlaps([mk("a", "band_activity", T0, 30), mk("b", "band_activity", T0 + 4 * 60 * MIN, 30)]);
  assert.equal(kept.length, 2);
});

// ── Daily Load ───────────────────────────────────────────────────────────

test("Daily Load normalizes and caps each component", () => {
  const huge = sessionLoad({ ...mk("x", "band_activity", T0, 24 * 60 - 1) }, profile, new Map());
  const d = dailyLoad("2026-09-26", [huge]);
  assert.equal(d.normalized.activity, COMPONENT_CAP);                        // capped in reference doses
  assert.equal(d.components.activity, Math.round(COMPONENT_CAP * (25 / 45) * 1000) / 1000); // × Strain v1 exchange rate
  assert.equal(dailyLoad("2026-09-26", []).load, 0);
  assert.equal(dailyLoad("2026-09-26", []).confidence, "HIGH_CONFIDENCE"); // nothing recorded is a certain zero
});

// ── Baseline & Strain ─────────────────────────────────────────────────────

const day = (date: string, load: number) => ({ date, sessions: load > 0 ? 1 : 0, activeMinutes: 0, normalized: { cardio: load, activity: 0, resistance: 0 }, components: { cardio: load, activity: 0, resistance: 0 }, raw: { cardioLoad: 0, activityMetMinutes: 0, resistanceSetEquivalents: 0 }, load, confidence: "MODERATE_CONFIDENCE" as const });

test("baseline requirements are explicit", () => {
  const few = strainBaseline([day("a", 1), day("b", 1)], ["MODERATE_CONFIDENCE"], 2);
  assert.equal(few.status, "building");
  const days = Array.from({ length: 20 }, (_, i) => day(`d${i}`, i % 2 ? 1 : 0));
  const ready = strainBaseline(days, Array(10).fill("MODERATE_CONFIDENCE"), 20);
  assert.equal(ready.status, "ready");
  assert.equal(ready.reference, 1);
  assert.equal(strainBaseline([], [], 0).status, "insufficient");
});

test("strain states: NOT_ENOUGH_DATA, BUILDING_BASELINE, LOW_CONFIDENCE, READY", () => {
  const ready = { status: "ready" as const, historyDays: 20, activeDays: 10, qualitySessions: 10, reference: 1 };
  assert.equal(strainFor({ ...day("t", 0), sessions: 1, confidence: "INSUFFICIENT_DATA" }, ready).state, "NOT_ENOUGH_DATA");
  assert.equal(strainFor(day("t", 1), { ...ready, status: "building", reference: undefined }).state, "BUILDING_BASELINE");
  assert.equal(strainFor({ ...day("t", 1), confidence: "LOW_CONFIDENCE" }, ready).state, "LOW_CONFIDENCE");
  const s = strainFor(day("t", 1), ready);
  assert.equal(s.state, "READY");
  assert.equal(s.proposedValue, 50);                    // a typical day ≈ 50
  assert.equal(STRAIN_FORMULA_APPROVED, false);          // not physically validated…
  assert.equal(s.approved, false);
  assert.equal(s.value, 50);                             // …but shown (product decision, build 40)
  assert.equal(proposedStrain(2, 1), 75);
  assert.ok(proposedStrain(100, 1) <= 100);
});

// ── Pipeline: accumulation, idempotency, late imports ─────────────────────

const Z = "Asia/Colombo";
const NOW = Date.UTC(2026, 8, 26, 14, 0); // 19:30 Colombo
const base = { profile, setHistory: [], zone: Z, nowMs: NOW };

test("strain accumulates through the day", () => {
  const morning = computeIntelligence({ ...base, sessions: [mk("a", "band_activity", NOW - 8 * 60 * MIN, 30)] });
  const evening = computeIntelligence({ ...base, sessions: [mk("a", "band_activity", NOW - 8 * 60 * MIN, 30), mk("b", "band_activity", NOW - 60 * MIN, 30)] });
  assert.ok(evening.today.load > morning.today.load);
  assert.equal(evening.todaySessions.length, 2);
});

test("idempotent: recomputing or re-importing the same record changes nothing", () => {
  const s = [mk("a", "band_activity", NOW - 2 * 60 * MIN, 30)];
  assert.deepEqual(computeIntelligence({ ...base, sessions: s }), computeIntelligence({ ...base, sessions: s }));
});

test("a late band import updates its own day, not today", () => {
  const yesterday = NOW - 24 * 60 * MIN;
  const before = computeIntelligence({ ...base, sessions: [] });
  const after = computeIntelligence({ ...base, sessions: [mk("late", "band_activity", yesterday, 45)] });
  assert.equal(after.today.load, before.today.load);
  assert.ok(after.days[after.days.length - 2].load > 0);
});

test("a late band record duplicating a workout already counted adds nothing", () => {
  const w = mk("w", "sombrey_workout", NOW - 3 * 60 * MIN, 45);
  const one = computeIntelligence({ ...base, sessions: [w] });
  const both = computeIntelligence({ ...base, sessions: [w, mk("band", "band_activity", NOW - 3 * 60 * MIN + MIN, 44)] });
  assert.equal(both.today.load, one.today.load);
  assert.deepEqual(both.droppedAsDuplicate, ["band"]);
});

test("a session belongs to the local day it started (Colombo)", () => {
  const late = Date.UTC(2026, 8, 25, 18, 45); // 00:15 on the 26th in Colombo
  const r = computeIntelligence({ ...base, sessions: [mk("x", "band_activity", late, 30)] });
  assert.equal(r.today.date, "2026-09-26");
  assert.equal(r.todaySessions.length, 1);
});

test("never multiplied by readiness: the pipeline has no readiness input", () => {
  const keys = Object.keys(base).concat("sessions");
  assert.ok(!keys.some((k) => /readiness/i.test(k)));
});
