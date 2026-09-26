import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandClockEvidence, bandStartInstant, chooseZone, localDayKey, localDayKeyDaysAgo, normalizeBandStart,
  offsetMinutes, startOfLocalDay, startOfLocalWeek, wallClockToInstant,
} from "../../convex/strain/time.ts";
import { addClockEvidence, findAppStartedMatchAnyBasis, isTimestampSuspect } from "../../convex/sportPlusImport.ts";
import { bandBounds } from "../../convex/workoutBand.ts";

const H = 3600_000;

test("UTC and fixed offsets", () => {
  const t = Date.UTC(2026, 8, 26, 23, 30);
  assert.equal(localDayKey(t, "UTC"), "2026-09-26");
  assert.equal(localDayKey(t, 0), "2026-09-26");
  assert.equal(localDayKey(t, 330), "2026-09-27");
});

test("Colombo (+5:30): the local day starts at 18:30 UTC the day before", () => {
  const z = "Asia/Colombo";
  assert.equal(offsetMinutes(Date.UTC(2026, 8, 26), z), 330);
  assert.equal(localDayKey(Date.UTC(2026, 8, 26, 18, 29), z), "2026-09-26");
  assert.equal(localDayKey(Date.UTC(2026, 8, 26, 18, 30), z), "2026-09-27");
  assert.equal(startOfLocalDay(Date.UTC(2026, 8, 27, 3), z), Date.UTC(2026, 8, 26, 18, 30));
});

test("midnight boundary: 23:59:59 and 00:00:00 local are different days", () => {
  const z = "Europe/London";
  const midnight = wallClockToInstant(2026, 7, 1, 0, 0, 0, z);
  assert.equal(localDayKey(midnight - 1000, z), "2026-06-30");
  assert.equal(localDayKey(midnight, z), "2026-07-01");
});

test("DST spring forward (New York, 8 Mar 2026): a 23-hour day is still one day", () => {
  const z = "America/New_York";
  const start = startOfLocalDay(Date.UTC(2026, 2, 8, 12), z);
  const next = startOfLocalDay(start + 30 * H, z);
  assert.equal(next - start, 23 * H);
  assert.equal(offsetMinutes(Date.UTC(2026, 2, 8, 6), z), -300);
  assert.equal(offsetMinutes(Date.UTC(2026, 2, 8, 8), z), -240);
  assert.equal(localDayKeyDaysAgo(Date.UTC(2026, 2, 9, 4, 30), 1, z), "2026-03-08"); // 00:30 local on the 9th
});

test("DST fall back (New York, 1 Nov 2026): a 25-hour day; the repeated hour resolves to the first", () => {
  const z = "America/New_York";
  const start = startOfLocalDay(Date.UTC(2026, 10, 1, 12), z);
  const next = startOfLocalDay(start + 26 * H, z);
  assert.equal(next - start, 25 * H);
  const oneThirty = wallClockToInstant(2026, 11, 1, 1, 30, 0, z);
  assert.equal(oneThirty, Date.UTC(2026, 10, 1, 5, 30)); // EDT reading
});

test("weeks start on local Monday, across DST", () => {
  const z = "America/New_York";
  const monday = startOfLocalWeek(Date.UTC(2026, 2, 11, 15), z); // Wed after spring forward
  assert.equal(localDayKey(monday, z), "2026-03-09");
  assert.equal(new Date(monday).getUTCHours(), 4); // 00:00 EDT
});

test("zone choice: the phone's zone, then the stored one, then an old offset, then UTC — never the band", () => {
  assert.equal(chooseZone("Asia/Colombo", "Europe/London", 60), "Asia/Colombo");
  assert.equal(chooseZone("Not/AZone", "Europe/London"), "Europe/London");
  assert.equal(chooseZone(undefined, undefined, 330), 330);
  assert.equal(chooseZone(), "UTC");
});

// ── Band timestamps ────────────────────────────────────────────────────────

const COLOMBO = "Asia/Colombo";
// A session at 07:00 Colombo time on 26 Sep 2026 = 01:30 UTC.
const TRUE_START = Date.UTC(2026, 8, 26, 1, 30);
const RAW_EPOCH = TRUE_START / 1000;                            // band stores true epoch
const RAW_LOCAL = Date.UTC(2026, 8, 26, 7, 0) / 1000;           // band stores local wall clock as if UTC

test("both readings of a raw band start", () => {
  assert.equal(bandStartInstant(RAW_EPOCH, "epoch_utc", COLOMBO), TRUE_START);
  assert.equal(bandStartInstant(RAW_LOCAL, "local_wall_clock", COLOMBO), TRUE_START);
});

test("normalization: calibrated basis wins", () => {
  const r = normalizeBandStart(RAW_LOCAL, 1800, COLOMBO, TRUE_START + 3 * H, "local_wall_clock");
  assert.deepEqual(r, { instant: TRUE_START, basis: "local_wall_clock", how: "calibrated" });
});

test("normalization: a local-clock record that would end in the future is read as local (inferred)", () => {
  const now = TRUE_START + 1 * H; // 1 h after the true start; the epoch reading is 5.5 h ahead
  const r = normalizeBandStart(RAW_LOCAL, 1800, COLOMBO, now);
  assert.equal(r.basis, "local_wall_clock");
  assert.equal(r.how, "inferred");
  assert.equal(r.instant, TRUE_START);
});

test("normalization: otherwise the epoch reading is assumed (and said so)", () => {
  const r = normalizeBandStart(RAW_EPOCH, 1800, COLOMBO, TRUE_START + 10 * H);
  assert.deepEqual(r, { instant: TRUE_START, basis: "epoch_utc", how: "assumed" });
});

test("an incorrect band clock is flagged, never silently shifted", () => {
  const record = { sportType: 1, bandStartTimeSec: RAW_LOCAL, bandDurationRaw: 1800, durationSeconds: 1800 };
  const now = TRUE_START + 1 * H;
  assert.equal(isTimestampSuspect(record, now), true);                     // epoch reading: in the future
  assert.equal(isTimestampSuspect(record, now, TRUE_START), false);         // normalized reading: fine
});

test("clock evidence from app-started sessions", () => {
  assert.equal(bandClockEvidence(RAW_LOCAL, TRUE_START + 20_000, COLOMBO), "local_wall_clock");
  assert.equal(bandClockEvidence(RAW_EPOCH, TRUE_START + 20_000, COLOMBO), "epoch_utc");
  assert.equal(bandClockEvidence(RAW_EPOCH, TRUE_START + 20_000, "UTC"), "ambiguous"); // UTC users can't tell
  assert.equal(bandClockEvidence(RAW_EPOCH, TRUE_START + 3 * H, COLOMBO), "none");
});

test("the basis settles after two agreeing sessions and none disagreeing", () => {
  let s = addClockEvidence(undefined, "local_wall_clock", 1);
  assert.equal(s.basis, undefined);
  s = addClockEvidence(s.evidence, "ambiguous", 2);
  assert.equal(s.basis, undefined);
  s = addClockEvidence(s.evidence, "local_wall_clock", 3);
  assert.equal(s.basis, "local_wall_clock");
  const conflicted = addClockEvidence(s.evidence, "epoch_utc", 4);
  assert.equal(conflicted.basis, undefined); // disagreement → not settled
});

test("an app-started row matches the band record under either reading", () => {
  const rows = [{ sportType: 1, startedAt: TRUE_START + 10_000, bandStartTimeSec: undefined }];
  const m = findAppStartedMatchAnyBasis(rows, { sportType: 1, bandStartTimeSec: RAW_LOCAL, bandDurationRaw: 1800, durationSeconds: 1800 }, COLOMBO);
  assert.equal(m?.evidence, "local_wall_clock");
  const none = findAppStartedMatchAnyBasis(rows, { sportType: 2, bandStartTimeSec: RAW_LOCAL, bandDurationRaw: 1800, durationSeconds: 1800 }, COLOMBO);
  assert.equal(none, undefined);
});

test("workout band bounds use the normalized band start", () => {
  const b = bandBounds({ startedAt: TRUE_START, bandStartTimeSec: RAW_LOCAL, bandStartedAt: TRUE_START, durationSeconds: 1800, summarySource: "band_record" });
  assert.deepEqual(b, { start: TRUE_START, end: TRUE_START + 1800_000 });
});
