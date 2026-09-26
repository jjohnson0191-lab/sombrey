import { test } from "node:test";
import assert from "node:assert/strict";
import { type ProgressSession, type ProgressSet, type WeightEntry, DAY_MS, dayKey, startOfLocalWeek } from "../../convex/progress/model.ts";
import { CURRENT_STRAIN_ENGINE, STRAIN_SIGNALS, dailyLoad, strainDay, type StrainEngine } from "../../convex/progress/strainEngine.ts";
import { baselineEntry, bodySummary, isPlausibleWeightKg } from "../../convex/progress/body.ts";
import { comparePeriods } from "../../convex/progress/baseline.ts";
import { activityPerformance, availableRanges, estimatedOneRepMax, workoutPerformance } from "../../convex/progress/performance.ts";
import { consistency } from "../../convex/progress/consistency.ts";
import { personalRecords } from "../../convex/progress/records.ts";
import { milestones } from "../../convex/progress/milestones.ts";
import { loadRecovery, pearson } from "../../convex/progress/loadRecovery.ts";
import { youVsYou } from "../../convex/progress/youVsYou.ts";
import { describeProgressForCoach } from "../../convex/progress/coachContext.ts";

const NOW = Date.UTC(2026, 8, 26, 18, 0); // Saturday 26 Sep 2026, 18:00 UTC
const TZ = 0;
const names = (k: string) => ({ run: "Running", tennis: "Tennis", golf: "Golf", swim: "Swimming" } as Record<string, string>)[k] ?? k;

let n = 0;
const workout = (daysAgo: number, over: Partial<ProgressSession> = {}): ProgressSession => ({
  id: `w${n++}`, kind: "workout", origin: "sombrey_workout", name: "Session", startedAt: NOW - daysAgo * DAY_MS - 60 * 60 * 1000,
  durationSeconds: 3000, durationSource: "sombrey", ...over,
});
const activity = (daysAgo: number, key: string, category: string, over: Partial<ProgressSession> = {}): ProgressSession => ({
  id: `a${n++}`, kind: "activity", origin: "band_activity", name: names(key), startedAt: NOW - daysAgo * DAY_MS - 2 * 60 * 60 * 1000,
  durationSeconds: 3600, durationSource: "band_record", activityKey: key, activityCategory: category, ...over,
});
const set = (workoutId: string, daysAgo: number, name: string, reps: number, weightKg?: number): ProgressSet => ({
  workoutId, exerciseId: name.toLowerCase().replace(/ /g, "_"), exerciseName: name, reps, weightKg, completedAt: NOW - daysAgo * DAY_MS - 60 * 60 * 1000,
});

// ── Strain engine ─────────────────────────────────────────────────────────

test("no strain score exists: the current engine never returns a number", () => {
  assert.equal(CURRENT_STRAIN_ENGINE.validated, false);
  const day = strainDay([workout(0), activity(0, "tennis", "racquet")], NOW, TZ);
  assert.deepEqual(day.score, { state: "no_formula" });
  assert.equal(day.load.sessionCount, 2);
  assert.equal(day.load.activeMinutes, 110);
  assert.ok(day.context.includes("Not enough data to establish your baseline."));
  assert.ok(STRAIN_SIGNALS.available.length > 0 && STRAIN_SIGNALS.missing.length > 0);
});

test("a future formula plugs in without changing the day's shape", () => {
  const fake: StrainEngine = { id: "test", version: "1", validated: true, score: (i) => ({ state: "scored", value: i.sessions.length, scaleMax: 21 }) };
  const day = strainDay([workout(0)], NOW, TZ, fake);
  assert.deepEqual(day.score, { state: "scored", value: 1, scaleMax: 21 });
});

test("daily load context comes only from the data", () => {
  const history = Array.from({ length: 20 }, (_, i) => workout(i + 1, { durationSeconds: 1800 })); // 30 min/day for 20 days
  const today = [workout(0, { durationSeconds: 5400 })];
  const day = strainDay([...history, ...today], NOW, TZ);
  assert.equal(day.usualActiveMinutes, 30);
  assert.ok(day.context.includes("Above your usual daily load."));
  assert.ok(day.context.includes("Your highest-load day this week."));
  assert.equal(day.week.length, 7);
  const rest = strainDay(history, NOW, TZ);
  assert.equal(rest.load.sessionCount, 0);
  assert.equal(rest.context.length, 0); // nothing said about a day with nothing recorded
});

test("load counts band-recorded minutes separately", () => {
  const load = dailyLoad("2026-09-26", [workout(0, { heartRateSource: "band_record" }), activity(0, "golf", "golf", { heartRateSource: undefined, caloriesSource: undefined })]);
  assert.equal(load.bandRecordedMinutes, 50);
  assert.equal(load.workoutMinutes, 50);
  assert.equal(load.activityMinutes, 60);
});

// ── Body ──────────────────────────────────────────────────────────────────

const weights: WeightEntry[] = [
  { id: "1", date: NOW - 100 * DAY_MS, weightKg: 84.8, source: "manual" },
  { id: "2", date: NOW - 40 * DAY_MS, weightKg: 83.6, source: "manual" },
  { id: "3", date: NOW - 1 * DAY_MS, weightKg: 82.4, source: "scanner" },
];

test("body weight: latest, baseline options and change", () => {
  const first = bodySummary(weights, "first", NOW);
  assert.equal(first.latest?.weightKg, 82.4);
  assert.equal(first.latest?.source, "scanner"); // provenance kept
  assert.equal(first.changeKg, -2.4);
  assert.equal(bodySummary(weights, "30d", NOW).changeKg, -1.2);
  assert.equal(bodySummary(weights, "90d", NOW).changeKg, -2.4);
  assert.equal(baselineEntry(weights.slice(2), "30d", NOW), undefined); // no entry that old → no baseline, never interpolated
});

test("body weight: empty and single-entry states", () => {
  assert.equal(bodySummary([], "first", NOW).latest, undefined);
  const one = bodySummary([weights[2]], "first", NOW);
  assert.equal(one.latest?.weightKg, 82.4);
  assert.equal(one.changeKg, undefined); // nothing to compare against itself
  assert.ok(isPlausibleWeightKg(82.4) && !isPlausibleWeightKg(0) && !isPlausibleWeightKg(824));
});

// ── Baselines ─────────────────────────────────────────────────────────────

test("comparisons need enough points and a meaningful change", () => {
  assert.equal(comparePeriods([10, 11], [9, 9, 9]), undefined);          // too few current
  assert.equal(comparePeriods([10, 10, 10], [10, 10, 10.2]), undefined); // too small a change
  assert.equal(Math.round(comparePeriods([11, 12, 13], [10, 10, 10])!.change * 100), 20);
});

// ── Performance ───────────────────────────────────────────────────────────

test("workout performance: all workouts and one exercise, no invented zeros", () => {
  const ws = [workout(20), workout(10), workout(2, { calories: 342, caloriesSource: "band_record", averageHeartRate: 138, heartRateSource: "band_record" })];
  const sets = [
    set(ws[0].id, 20, "Barbell Full Squat", 5, 100), set(ws[0].id, 20, "Barbell Full Squat", 5, 100),
    set(ws[1].id, 10, "Barbell Full Squat", 5, 105),
    set(ws[2].id, 2, "Barbell Full Squat", 5, 110), set(ws[2].id, 2, "Pull-Up", 8),
  ];
  const all = workoutPerformance(ws, sets, "all", "calories", "30d", NOW, TZ);
  assert.equal(all.subjects[0].id, "all");
  assert.deepEqual(all.metrics.map((m) => m.key), ["duration", "volume", "sets", "calories", "heart_rate"]);
  assert.equal(all.points.length, 1); // only the workout that recorded calories
  assert.equal(all.points[0].source, "band_record");
  const squat = workoutPerformance(ws, sets, "barbell_full_squat", "top_weight", "30d", NOW, TZ);
  assert.deepEqual(squat.points.map((p) => p.value), [100, 105, 110]);
  assert.equal(squat.stats?.high, 110);
  const e1rm = workoutPerformance(ws, sets, "barbell_full_squat", "estimated_1rm", "30d", NOW, TZ);
  assert.equal(e1rm.metric?.estimated, true);
  assert.equal(Math.round(e1rm.points[2].value), 128);
  const pullup = workoutPerformance(ws, sets, "pull-up", undefined, "30d", NOW, TZ);
  assert.deepEqual(pullup.metrics.map((m) => m.key), ["reps"]); // no weight metrics for a bodyweight exercise
  assert.equal(estimatedOneRepMax(100, 15), undefined);
});

test("activity performance adapts to the activity's own metrics", () => {
  const runs = [0, 5, 12, 20].map((d, i) => activity(d, "run", "running", { distanceMeters: 5000 + i * 500, averageSpeed: 3 + i * 0.1, movementSource: "band_record" }));
  const tennis = [1, 8].map((d) => activity(d, "tennis", "racquet", { averageHeartRate: 140, heartRateSource: "band_record" }));
  const run = activityPerformance([...runs, ...tennis], "run", undefined, "30d", NOW, names);
  assert.deepEqual(run.subjects.map((s) => s.id), ["run", "tennis"]);
  assert.ok(run.metrics.map((m) => m.key).includes("distance"));
  assert.ok(run.metrics.map((m) => m.key).includes("pace"));
  assert.ok(!run.metrics.map((m) => m.key).includes("heart_rate")); // no run recorded heart rate
  const t = activityPerformance([...runs, ...tennis], "tennis", undefined, "30d", NOW, names);
  assert.deepEqual(t.metrics.map((m) => m.key), ["duration", "heart_rate"]);
  assert.ok(!t.metrics.some((m) => m.key === "distance"));
});

test("ranges are offered only where the data reaches", () => {
  const recent = [1, 3, 5].map((d) => ({ t: NOW - d * DAY_MS, value: 1, source: "band_record" as const }));
  assert.deepEqual(availableRanges(recent, NOW), ["7d"]);
  const longer = [...recent, { t: NOW - 60 * DAY_MS, value: 1, source: "band_record" as const }, { t: NOW - 45 * DAY_MS, value: 1, source: "band_record" as const }];
  assert.deepEqual(availableRanges(longer, NOW), ["7d", "30d", "90d"]);
  assert.deepEqual(availableRanges([], NOW), []);
});

// ── Consistency ───────────────────────────────────────────────────────────

test("consistency: this week's real days against the usual week", () => {
  const monday = startOfLocalWeek(NOW, TZ);
  assert.equal(new Date(monday).getUTCDay(), 1);
  const thisWeek = [workout(0), workout(2, { fromPlan: true }), activity(1, "tennis", "racquet")];
  const earlier = [8, 10, 15, 17, 22, 24, 29].map((d) => workout(d));
  const c = consistency([...thisWeek, ...earlier], NOW, TZ, 3);
  assert.equal(c.thisWeek.trainingDays, 2);
  assert.equal(c.thisWeek.activeDays, 3);
  assert.equal(c.thisWeek.plannedCompleted, 1);
  assert.equal(c.thisWeek.plannedScheduled, 3);
  assert.equal(c.thisWeek.days.filter((d) => d.isFuture).length, 1); // Sunday still ahead
  assert.equal(c.thisWeek.restDays, 3);
  assert.equal(c.usualTrainingDays, 2);
  const fresh = consistency(thisWeek, NOW, TZ);
  assert.equal(fresh.usualTrainingDays, undefined); // not enough weeks to say
  assert.equal(fresh.thisWeek.plannedScheduled, undefined);
});

// ── Records ───────────────────────────────────────────────────────────────

test("records come from the data, with the previous record and source", () => {
  const w = [workout(30), workout(15), workout(3)];
  const sets = [set(w[0].id, 30, "Barbell Full Squat", 5, 100), set(w[1].id, 15, "Barbell Full Squat", 8, 105), set(w[2].id, 3, "Barbell Full Squat", 5, 110)];
  const runs = [activity(40, "run", "running", { distanceMeters: 8000, averageSpeed: 3.0 }), activity(2, "run", "running", { distanceMeters: 10000, averageSpeed: 3.2 })];
  const recs = personalRecords([...w, ...runs], sets, NOW, names);
  const squat = recs.find((r) => r.id.endsWith("heaviest"))!;
  assert.equal(squat.display, "110 kg × 5");
  assert.equal(squat.previous?.display, "105 kg × 8");
  assert.equal(squat.isNew, true);
  assert.equal(squat.source, "manual");
  assert.ok(recs.some((r) => r.subject === "Running" && r.metric === "Longest distance" && r.display === "10.00 km"));
  assert.ok(recs.some((r) => r.metric === "Fastest average pace"));
});

test("a single occurrence is not a record, and missing metrics make none", () => {
  const w = [workout(3)];
  assert.deepEqual(personalRecords(w, [set(w[0].id, 3, "Bench", 5, 60)], NOW, names), []);
  const tennis = [activity(3, "tennis", "racquet"), activity(10, "tennis", "racquet", { durationSeconds: 5400 })];
  const recs = personalRecords(tennis, [], NOW, names);
  assert.deepEqual(recs.map((r) => r.metric), ["Longest session"]); // no distance/pace for tennis
});

// ── Milestones ────────────────────────────────────────────────────────────

test("milestones are dated to the session that crossed them", () => {
  const ws = Array.from({ length: 10 }, (_, i) => workout(40 - i * 3));
  const ms = milestones(ws, TZ);
  assert.ok(ms.some((m) => m.title === "First workout" && m.achievedAt === ws[0].startedAt));
  assert.ok(ms.some((m) => m.title === "10 workouts" && m.achievedAt === ws[9].startedAt));
  assert.ok(!ms.some((m) => m.title === "25 workouts"));
  assert.deepEqual(milestones([], TZ), []);
  const consistent = [0, 2, 7, 9, 14, 16, 21, 23].map((d) => workout(d + 1));
  assert.ok(milestones(consistent, TZ).some((m) => m.id === "consistent-month"));
});

// ── Load & recovery ───────────────────────────────────────────────────────

test("load and next-morning readiness pair up; no relationship claimed without enough days", () => {
  const readiness = Array.from({ length: 10 }, (_, i) => ({ date: dayKey(NOW - i * DAY_MS, TZ), score: 70 + i }));
  const lr = loadRecovery([workout(1)], readiness, NOW, TZ, 7);
  assert.equal(lr.days.length, 7);
  assert.equal(lr.days[5].activeMinutes, 50);
  assert.equal(lr.days[5].nextMorningReadiness, 70);
  assert.equal(lr.relationship, undefined);
});

test("a relationship is stated only when strong across enough paired days", () => {
  const sessions: ProgressSession[] = [];
  const readiness = [];
  for (let d = 0; d <= 40; d++) {
    const heavy = d % 2 === 0;
    if (d >= 1) sessions.push(workout(d, { durationSeconds: heavy ? 5400 : 1200 }));
    readiness.push({ date: dayKey(NOW - d * DAY_MS, TZ), score: (d + 1) % 2 === 0 ? 60 : 80 });
  }
  const lr = loadRecovery(sessions, readiness, NOW, TZ, 7);
  assert.ok(lr.pairedDays >= 21);
  assert.match(lr.relationship?.statement ?? "", /lower readiness/);
  assert.equal(pearson([1, 2], [1, 2]), undefined);
});

// ── You vs you ────────────────────────────────────────────────────────────

test("you-vs-you insights appear only when both periods support them", () => {
  const cur = [2, 5, 9, 13, 20, 26].map((d) => workout(d));
  const prev = [35, 45, 55].map((d) => workout(d));
  const out = youVsYou([...cur, ...prev], [], weights, NOW, names);
  assert.ok(out.some((i) => i.id === "training-frequency" && /100% higher/.test(i.text)));
  assert.ok(out.every((i) => i.basis.length > 0));
  assert.ok(out.some((i) => i.id === "weight"));
  assert.deepEqual(youVsYou([workout(2)], [], [], NOW, names), []);
});

// ── AI Coach context ──────────────────────────────────────────────────────

test("the coach receives structured facts with their basis — and no invented strain", () => {
  const sessions = [workout(0), activity(1, "tennis", "racquet")];
  const lines = describeProgressForCoach({
    strain: strainDay(sessions, NOW, TZ),
    consistency: consistency(sessions, NOW, TZ),
    records: [], milestones: milestones(sessions, TZ), insights: [],
    body: bodySummary(weights, "first", NOW),
    loadRecovery: loadRecovery(sessions, [], NOW, TZ, 7),
  });
  const text = lines.join("\n");
  assert.match(text, /no validated strain score exists yet/);
  assert.match(text, /Body weight: 82.4 kg \(scanner/);
  assert.match(text, /This week: 1 training days, 2 active days/);
  assert.match(text, /Milestone: First/);
});
