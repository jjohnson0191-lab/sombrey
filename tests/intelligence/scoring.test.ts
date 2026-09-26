import { test } from "node:test";
import assert from "node:assert/strict";
import { STRAIN_V1, exchangeRates, METHODOLOGY_CHANGELOG } from "../../convex/strain/strainConfig.ts";
import { rollingLoad, dayStatus, HIGH_LOAD_MULTIPLE, type LoadDay } from "../../convex/strain/rollingLoad.ts";
import { computeIntelligence } from "../../convex/strain/pipeline.ts";
import { proposedStrain, strainReference } from "../../convex/strain/strainScore.ts";
import { heartRateProfile } from "../../convex/strain/zones.ts";
import type { SessionInput } from "../../convex/strain/sessionLoad.ts";
import { SIGNALS } from "../../convex/strain/signals.ts";
import { buildIntelligenceContext, renderIntelligenceContext } from "../../convex/strain/context.ts";
import { environmentState } from "../../convex/strain/environment.ts";
import { computeReadinessScore } from "../../convex/readiness/scoring.ts";
import { localDayKey } from "../../convex/strain/time.ts";

const MIN = 60_000, H = 60 * MIN, DAY = 24 * H;
const Z = "Asia/Colombo";
const NOW = Date.UTC(2026, 8, 26, 14, 0); // 19:30 local
const profile = heartRateProfile({ restingReadings: [60], age: 30, observedPeaks: [] }); // 60 / 187
const hr = (start: number, minutes: number, bpm: number) => Array.from({ length: minutes * 12 }, (_, i) => ({ t: start + i * 5000, bpm }));
const run = (id: string, start: number, minutes: number, bpm = 150, origin = "band_activity"): SessionInput =>
  ({ id, kind: "activity", origin, category: "running", startMs: start, endMs: start + minutes * MIN, samples: hr(start, minutes, bpm), seriesTimingVerified: true, sets: [] });
const lift = (id: string, start: number, sets: number, weightKg?: number): SessionInput =>
  ({ id, kind: "workout", origin: "sombrey_workout", category: "strength", startMs: start, endMs: start + 50 * MIN, samples: [], seriesTimingVerified: true, sets: Array.from({ length: sets }, () => ({ exerciseId: "squat", reps: 8, weightKg })) });
const base = { profile, setHistory: [], zone: Z, nowMs: NOW };
const daysAgo = (n: number, hour = 7) => NOW - n * DAY - (NOW % DAY) + (hour - 5.5) * H; // local `hour` n days ago (approx.)
/** A steady history: one 45-min zone-3 run every other day for `n` days. */
const steady = (n: number) => Array.from({ length: n }, (_, i) => i + 1).filter((d) => d % 2 === 1).map((d) => run(`h${d}`, daysAgo(d), 45));
const allWorn = (n: number) => new Set(Array.from({ length: n + 2 }, (_, i) => localDayKey(NOW - i * DAY, Z)));

// ── Strain v1 configuration ──────────────────────────────────────────────

test("Strain v1 weights are versioned, sum to 100%, and act as exchange rates", () => {
  const w = STRAIN_V1.weights;
  assert.equal(Math.round((w.cardiovascular + w.resistance + w.activity) * 100), 100);
  assert.equal(STRAIN_V1.version, "strain-1.0");
  const r = exchangeRates();
  assert.equal(r.cardiovascular, 1);
  assert.ok(Math.abs(r.resistance - 30 / 45) < 1e-9);
  assert.ok(METHODOLOGY_CHANGELOG.some((c) => c.version === "strain-1.0") && METHODOLOGY_CHANGELOG.some((c) => c.version === "readiness-1.0"));
});

test("additive: a mixed day carries more load than either session alone (no dilution)", () => {
  const cardioOnly = computeIntelligence({ ...base, sessions: [run("r", daysAgo(0, 7), 45)] }).today.load;
  const liftOnly = computeIntelligence({ ...base, sessions: [lift("l", daysAgo(0, 17), 12, 60)] }).today.load;
  const mixed = computeIntelligence({ ...base, sessions: [run("r", daysAgo(0, 7), 45), lift("l", daysAgo(0, 17), 12, 60)] }).today;
  assert.ok(Math.abs(mixed.load - (cardioOnly + liftOnly)) < 0.002);
  assert.ok(mixed.components.cardio > 0 && mixed.components.resistance > 0);
});

test("multiple sessions accumulate; components keep their provenance", () => {
  const t = computeIntelligence({ ...base, sessions: [run("a", daysAgo(0, 6), 30), run("b", daysAgo(0, 12), 30)] }).today;
  assert.equal(t.sessions, 2);
  assert.equal(t.raw.cardioLoad, 180); // 2 × 30 min × zone 3
  assert.equal(t.components.cardio, 1);
});

test("missing resistance data: sets without weight still count (bodyweight), sessions without sets add no resistance", () => {
  const bw = computeIntelligence({ ...base, sessions: [lift("l", daysAgo(0, 17), 10)] }).today;
  assert.ok(bw.components.resistance > 0);
  const none = computeIntelligence({ ...base, sessions: [lift("l", daysAgo(0, 17), 0)] }).today;
  assert.equal(none.components.resistance, 0);
});

test("steps are never a load input (no double count of walking + steps)", () => {
  const steps = SIGNALS.find((s) => s.id === "steps_daily")!;
  assert.equal(steps.strainRole, "context_only");
});

// ── Normalization ────────────────────────────────────────────────────────

test("normalization: a typical day ≈ 50, saturating below 100; reference floored", () => {
  assert.equal(proposedStrain(1, 1), 50);
  assert.equal(proposedStrain(3, 1), 88);
  assert.ok(proposedStrain(12, 1) <= 100);
  assert.equal(strainReference(0.1), STRAIN_V1.referenceFloor);
  assert.equal(proposedStrain(0.5, 0.1), 50); // a near-sedentary usual day doesn't make half a session look extreme
});

test("strain baseline: cold start → BUILDING_BASELINE; established history → a value", () => {
  assert.equal(computeIntelligence({ ...base, sessions: [run("t", daysAgo(0), 45)] }).strain.state, "BUILDING_BASELINE");
  const r = computeIntelligence({ ...base, sessions: [...steady(28), run("t", daysAgo(0), 45)], wearableDays: allWorn(30) });
  assert.equal(r.baseline.status, "ready");
  assert.equal(r.strain.proposedValue, 50); // today = the typical training day
  assert.equal(r.strain.value, undefined);   // display-gated until physical validation
});

// ── Recent history ───────────────────────────────────────────────────────

const ld = (loads: (number | null)[]): LoadDay[] => [
  ...loads.map((l, i) => l === null ? { date: `d${i}`, load: 0, status: "no_data" as const } : { date: `d${i}`, load: l, status: l > 0 ? "measured" as const : "rest" as const }),
  { date: "today", load: 0, status: "in_progress" as const },
];

test("rolling windows: yesterday, 3, 7, 14, 28 days", () => {
  const r = rollingLoad(ld(Array.from({ length: 28 }, (_, i) => (i % 2 ? 1 : 0))), 1);
  assert.equal(r.windows.d1.days, 1);
  assert.equal(r.windows.d7.knownDays, 7);
  assert.equal(r.windows.d28.total, 14);
  assert.equal(r.windows.d28.activeDays, 14);
  assert.equal(r.windows.d7.highest, 1);
  assert.equal(r.windows.d7.lowest, 0);
  assert.equal(r.yesterday?.relative, 1);
});

test("missing days are not zero: no_data days are excluded and reported", () => {
  const r = rollingLoad(ld([1, 1, 1, 1, null, null, null]), 1);
  assert.equal(r.windows.d7.knownDays, 4);
  assert.equal(r.windows.d7.unknownDays, 3);
  assert.equal(r.windows.d7.averagePerKnownDay, 1); // not 4/7
  assert.equal(r.windows.d3.knownDays, 0);
  assert.equal(r.yesterday?.relative, undefined);
});

test("day status: measured, incomplete, rest, no data, in progress", () => {
  const d = (sessions: number, load: number, confidence: string) => ({ date: "x", sessions, activeMinutes: 0, normalized: { cardio: 0, activity: 0, resistance: 0 }, components: { cardio: 0, activity: 0, resistance: 0 }, raw: { cardioLoad: 0, activityMetMinutes: 0, resistanceSetEquivalents: 0 }, load, confidence } as any);
  assert.equal(dayStatus(d(1, 1, "MODERATE_CONFIDENCE"), true, false), "measured");
  assert.equal(dayStatus(d(1, 0, "INSUFFICIENT_DATA"), true, false), "incomplete");
  assert.equal(dayStatus(d(0, 0, "HIGH_CONFIDENCE"), true, false), "rest");
  assert.equal(dayStatus(d(0, 0, "HIGH_CONFIDENCE"), false, false), "no_data");
  assert.equal(dayStatus(d(1, 1, "HIGH_CONFIDENCE"), true, true), "in_progress");
});

test("load distribution: same weekly total, different pattern (monotony, high-load streaks)", () => {
  const even = rollingLoad(ld([1, 1, 1, 1, 1, 1.1, 0.9]), 0.5);
  const spiky = rollingLoad(ld([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 5.8]), 0.5);
  assert.equal(even.windows.d7.total, spiky.windows.d7.total);
  assert.ok(even.monotony7! > spiky.monotony7!);            // Foster: repetitive high load is more monotonous
  assert.equal(even.consecutiveHighLoadDays, 7);            // every day ≥ 1.5 × 0.5
  assert.equal(spiky.consecutiveHighLoadDays, 1);
  assert.equal(HIGH_LOAD_MULTIPLE, 1.5);
});

test("trend compares the last 7 with the previous 7 known days", () => {
  assert.equal(rollingLoad(ld([...Array(7).fill(0.5), ...Array(7).fill(1)]), 1).trend, "rising");
  assert.equal(rollingLoad(ld([...Array(7).fill(1), ...Array(7).fill(1)]), 1).trend, "steady");
  assert.equal(rollingLoad(ld([...Array(7).fill(1), ...Array(7).fill(0.4)]), 1).trend, "falling");
});

test("a no-data day never gets Strain 0", () => {
  const r = computeIntelligence({ ...base, sessions: [run("t", daysAgo(0), 45)], wearableDays: new Set() });
  const y = r.loadDays[r.loadDays.length - 2];
  assert.equal(y.status, "no_data");
  assert.equal(r.yesterdayStrain?.state, "NOT_ENOUGH_DATA");
  assert.equal(r.yesterdayStrain?.proposedValue, undefined);
});

// ── Late import recalculation (idempotent) ──────────────────────────────

test("late import: yesterday's load, Strain, rolling windows and today's readiness recent-load all update — once", () => {
  const worn = allWorn(30);
  const before = computeIntelligence({ ...base, sessions: steady(28).filter((s) => s.id !== "h1"), wearableDays: worn });
  const late = run("late", daysAgo(1, 18), 90, 165);
  const after = computeIntelligence({ ...base, sessions: [...steady(28).filter((s) => s.id !== "h1"), late], wearableDays: worn });
  const again = computeIntelligence({ ...base, sessions: [...steady(28).filter((s) => s.id !== "h1"), late, late], wearableDays: worn }); // imported twice
  const y = (r: typeof before) => r.days[r.days.length - 2];
  assert.equal(y(before).load, 0);
  assert.ok(y(after).load > 0);
  assert.equal(y(again).load, y(after).load);                         // duplicate import adds nothing
  assert.ok(after.rolling.windows.d7.total > before.rolling.windows.d7.total);
  assert.ok((after.yesterdayStrain?.proposedValue ?? 0) > (before.yesterdayStrain?.proposedValue ?? 0));
  const rd = (r: typeof before) => computeReadinessScore([], { date: "2026-09-26", sleepMinutes: 450 },
    { reference: r.baseline.reference, days: r.loadDays.slice(0, -1), rolling: r.rolling }).components.find((c) => c.metric === "recentLoad")!;
  assert.ok(rd(after).subScore! < rd(before).subScore!);
});

// ── De-duplication ──────────────────────────────────────────────────────

test("workout + its Sport+ record: counted once", () => {
  const w = { ...run("w", daysAgo(0, 7), 45), origin: "sombrey_workout", kind: "workout" as const };
  const r = computeIntelligence({ ...base, sessions: [w, run("band", daysAgo(0, 7) + MIN, 44)] });
  assert.equal(r.todaySessions.length, 1);
  assert.deepEqual(r.droppedAsDuplicate, ["band"]);
});

test("manual workout + band activity at the same time: the workout wins", () => {
  const manual = { ...run("m", daysAgo(0, 7), 45), origin: "manual_workout", kind: "workout" as const, samples: [] };
  const r = computeIntelligence({ ...base, sessions: [run("band", daysAgo(0, 7), 45), manual] });
  assert.deepEqual(r.todaySessions.map((s) => s.id), ["m"]);
});

test("duplicate Sport+ rows and a late merge do not double count", () => {
  const a = run("a", daysAgo(0, 7), 45);
  const r = computeIntelligence({ ...base, sessions: [a, { ...a, id: "a2" }] });
  assert.equal(r.todaySessions.length, 1);
});

// ── Time ────────────────────────────────────────────────────────────────

test("a session crossing local midnight belongs to the day it started", () => {
  const start = Date.UTC(2026, 8, 24, 18, 0); // 23:30 on the 24th in Colombo
  const r = computeIntelligence({ ...base, sessions: [run("x", start, 60)] });
  assert.equal(r.days.find((d) => d.date === "2026-09-24")!.sessions, 1);
  assert.equal(r.days.find((d) => d.date === "2026-09-25")!.sessions, 0);
});

test("time-zone change: days are regrouped in the current zone, deterministically", () => {
  const s = [run("x", Date.UTC(2026, 8, 25, 20, 0), 30)]; // 25th 20:00 UTC
  const colombo = computeIntelligence({ ...base, sessions: s, zone: "Asia/Colombo" });   // 26th 01:30 local
  const london = computeIntelligence({ ...base, sessions: s, zone: "Europe/London" });   // 25th 21:00 local
  assert.equal(colombo.days.find((d) => d.date === "2026-09-26")!.sessions, 1);
  assert.equal(london.days.find((d) => d.date === "2026-09-25")!.sessions, 1);
});

// ── AI context ──────────────────────────────────────────────────────────

test("AI context: today, yesterday, rolling load, baseline, readiness, confidence — each session once", () => {
  const w = { ...run("w", daysAgo(0, 7), 45), origin: "sombrey_workout", kind: "workout" as const };
  const intelligence = computeIntelligence({ ...base, sessions: [...steady(28), w, run("band", daysAgo(0, 7) + MIN, 44)], wearableDays: allWorn(30) });
  const ctx = buildIntelligenceContext({
    timeZone: Z, intelligence, profile, sessionNames: new Map([["w", "Morning run"], ["band", "Running"]]),
    readiness: [], relationships: [], week: { trainingDays: 1, activeDays: 4, minutes: 180, plannedCompleted: 0 },
    environment: environmentState(null, NOW, false), body: {}, records: [], insights: [],
    readinessToday: { date: intelligence.today.date, score: 78, state: "READY", confidenceLevel: "MODERATE", version: "readiness-1.0",
      domains: [{ metric: "sleep", subScore: 90, weight: 0.4, confidence: 0.8, description: "Sleep met your usual need" }] },
  });
  const text = renderIntelligenceContext(ctx).join("\n");
  assert.match(text, /Load today: .* = 1× your typical training day/);
  assert.match(text, /Yesterday \(/);
  assert.match(text, /7 days: \d+\/7 days known/);
  assert.match(text, /28 days:/);
  assert.match(text, /Personal reference day: [\d.]+ load units/);
  assert.match(text, /Sombrey Readiness \(readiness-1.0, .*\): 78; state ready; confidence moderate/);
  assert.match(text, /sleep: 90\/100 at 40% weight/);
  assert.match(text, /never combined/);
  assert.equal((text.match(/Morning run/g) ?? []).length, 1);
  assert.doesNotMatch(text, /Running \(activity\)/);   // the duplicate band record is not listed
  assert.equal(ctx.currentDay.strainValueShown, false);
});
