import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_KCAL_PER_MINUTE, bandBounds, findSessionRecordedDuring, resolveWorkoutCalories, resolveWorkoutHeartRate, resolveWorkoutTiming,
  type BandSession,
} from "../../convex/workoutBand.ts";

const MIN = 60 * 1000;
const t0 = Date.UTC(2026, 8, 24, 18, 40); // app "Start workout" pressed 18:40
const app = { startedAt: t0, completedAt: t0 + 52 * MIN, durationSeconds: 50 * 60 };

const bandRecord = (over: Partial<BandSession> = {}): BandSession => ({
  startedAt: t0,                              // merged app row keeps the app's start
  bandStartTimeSec: (t0 + 2 * MIN) / 1000,    // band began recording 18:42
  durationSeconds: 49 * 60,                   // band says 49 min
  summarySource: "band_record",
  calories: 342,
  averageHeartRate: 138,
  lowestHeartRate: 92,
  highestHeartRate: 161,
  recordSource: "app",
  ...over,
});

// ── Timing ────────────────────────────────────────────────────────────────

test("the band's own start/end override the app's button presses", () => {
  const t = resolveWorkoutTiming(app, bandRecord());
  assert.equal(t.startedAt, t0 + 2 * MIN);
  assert.equal(t.endedAt, t0 + 51 * MIN);
  assert.equal(t.durationSeconds, 49 * 60);
  assert.equal(t.startTimeSource, "band");
  assert.equal(t.endTimeSource, "band");
});

test("Sombrey's timing is used when the band has no usable record", () => {
  for (const band of [
    undefined,
    bandRecord({ summarySource: "live_final_tick" }),          // no full record yet
    bandRecord({ timestampSuspect: true }),                     // flagged time
    bandRecord({ bandStartTimeSec: undefined }),
    bandRecord({ durationSeconds: 0 }),
    bandRecord({ bandStartTimeSec: (t0 + 8 * 60 * MIN) / 1000 }), // band clock 8 h off (unverified time zone)
  ]) {
    const t = resolveWorkoutTiming(app, band);
    assert.equal(t.startTimeSource, "sombrey");
    assert.equal(t.startedAt, t0);
    assert.equal(t.endedAt, t0 + 52 * MIN);
    assert.equal(t.durationSeconds, 50 * 60); // pauses excluded, as the app measured
  }
});

test("without an app duration, Sombrey timing spans start to finish", () => {
  const t = resolveWorkoutTiming({ startedAt: t0, completedAt: t0 + 30 * MIN }, undefined);
  assert.equal(t.durationSeconds, 30 * 60);
});

// ── Calories ──────────────────────────────────────────────────────────────

test("band calories are taken as stored kcal — never converted again", () => {
  assert.deepEqual(resolveWorkoutCalories(bandRecord(), 49 * 60), { calories: 342, caloriesSource: "band_record" });
  // The live figure (already converted once from the band's raw cal on the phone).
  assert.deepEqual(resolveWorkoutCalories(bandRecord({ summarySource: "live_final_tick", calories: 187.6 }), 30 * 60), { calories: 188, caloriesSource: "band_live" });
});

test("missing or implausible calories stay unavailable — never estimated", () => {
  assert.equal(resolveWorkoutCalories(undefined, 3000), undefined);
  assert.equal(resolveWorkoutCalories(bandRecord({ calories: undefined }), 3000), undefined);
  assert.equal(resolveWorkoutCalories(bandRecord({ calories: 0 }), 3000), undefined);
  // The old unit bug (raw cal shown as kcal): 30,040 "kcal" in 50 min is not a reading.
  assert.equal(resolveWorkoutCalories(bandRecord({ calories: 30040 }), 50 * 60), undefined);
  assert.ok(342 / 49 < MAX_KCAL_PER_MINUTE);
});

// ── Heart rate ────────────────────────────────────────────────────────────

test("heart-rate statistics come only from the band's full record", () => {
  assert.deepEqual(resolveWorkoutHeartRate(bandRecord()), { averageHeartRate: 138, lowestHeartRate: 92, highestHeartRate: 161, heartRateSource: "band_record" });
  assert.equal(resolveWorkoutHeartRate(bandRecord({ summarySource: "live_final_tick" })), undefined);
  assert.equal(resolveWorkoutHeartRate(bandRecord({ averageHeartRate: 0 })), undefined);
  assert.equal(resolveWorkoutHeartRate(undefined), undefined);
});

// ── Association ───────────────────────────────────────────────────────────

test("a session started on the band during the workout attaches; unrelated ones don't", () => {
  const during = bandRecord({ recordSource: "band" });
  const earlierRun = bandRecord({ recordSource: "band", bandStartTimeSec: (t0 - 3 * 60 * MIN) / 1000, durationSeconds: 40 * 60 });
  const tooLong = bandRecord({ recordSource: "band", durationSeconds: 3 * 60 * 60 }); // ends 2 h after the workout
  const appStarted = bandRecord({ recordSource: "app" });                               // belongs to its own workout via the id
  const noRecord = bandRecord({ recordSource: "band", summarySource: "live_final_tick" });
  assert.equal(findSessionRecordedDuring(app, [earlierRun, tooLong, appStarted, noRecord, during]), during);
  assert.equal(findSessionRecordedDuring(app, [earlierRun, tooLong, appStarted, noRecord]), undefined);
});

test("the nearest start wins when two band sessions fit", () => {
  const a = bandRecord({ recordSource: "band", bandStartTimeSec: (t0 + 6 * MIN) / 1000, durationSeconds: 45 * 60 });
  const b = bandRecord({ recordSource: "band", bandStartTimeSec: (t0 + 1 * MIN) / 1000, durationSeconds: 50 * 60 });
  assert.equal(findSessionRecordedDuring(app, [a, b]), b);
});

test("band bounds need a full, unsuspected record", () => {
  assert.deepEqual(bandBounds(bandRecord()), { start: t0 + 2 * MIN, end: t0 + 51 * MIN });
  assert.equal(bandBounds(bandRecord({ timestampSuspect: true })), undefined);
});
