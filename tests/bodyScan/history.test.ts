// Sombrey Body Scan, Phase 5F — release gate, provenance, scan summaries, proportion trends
// (convex/bodyScan/history.ts). SYNTHETIC data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_TREND_POINTS, RELEASED_MEASUREMENTS, buildTrends, compositionProvenance, isReleased, measurementProvenance, scanSummary, type TrendScan,
} from "../../convex/bodyScan/history.ts";
import type { Measurement } from "../../convex/bodyScan/measurements.ts";
import type { CompositionResult } from "../../convex/bodyScan/composition.ts";

const m = (name: string, status: Measurement["status"], value?: number, uncertainty?: number): Measurement =>
  ({ name, kind: "length", status, unit: "cm", confidence: 0.5, method: "x", reasons: [], ...(value !== undefined ? { value } : {}), ...(uncertainty !== undefined ? { uncertainty } : {}) });
const comp = (over: Partial<CompositionResult>): CompositionResult => ({
  name: "bmi", model: "bmi.recorded", modelVersion: "1", modelKind: "equation", validationStatus: "calculated_from_recorded_values", status: "calculated",
  value: 25.6, uncertaintyComponents: { measurement: null, model: null, unquantified: [] }, displayable: true, population: "", reasons: [], ...over,
});

test("release gate: nothing has passed validation — so nothing is 'measured'", () => {
  assert.deepEqual(RELEASED_MEASUREMENTS, {});
  assert.equal(isReleased("m2", "height"), false);
  assert.equal(measurementProvenance("m2", m("waistCircumference", "available", 84, 2)), "experimental", "even an 'available' value is experimental until released");
  assert.equal(measurementProvenance("m2", m("height", "low_confidence", 175, 8)), "experimental");
  assert.equal(measurementProvenance("m2", m("height", "unavailable")), "not_available");
});

test("provenance: BMI from recorded values is 'calculated'; composition estimates are experimental", () => {
  assert.equal(compositionProvenance(comp({})), "calculated");
  assert.equal(compositionProvenance(comp({ name: "bodyFatPercent", model: "rfm", validationStatus: "experimental", status: "estimate", value: 22 })), "experimental");
  assert.equal(compositionProvenance(comp({ status: "unavailable", value: undefined })), "not_available");
});

test("scan summary: what a history row can honestly say", () => {
  const s = scanSummary({
    viewQualities: [0.95, 0.88, 0.91], depthSource: "truedepth",
    measurements: { methodVersion: "m2", measurements: [m("height", "low_confidence", 175, 8), m("shoulderWidth", "available", 44, 2), m("waistToHeight", "available", 0.47, 0.01), m("chestCircumference", "unavailable")] },
    composition: { results: [comp({}), comp({ name: "bodyFatPercent", model: "rfm", validationStatus: "experimental", status: "estimate", value: 22, displayable: false })] },
    mdcValidated: false,
  });
  assert.equal(s.captureQuality, 0.88);
  assert.deepEqual(s.measured, []);
  assert.deepEqual(s.experimental, ["shoulderWidth"], "only available, shown measurements — never low-confidence ones or ratios");
  assert.deepEqual(s.bmi, { value: 25.6, displayable: true });
  assert.equal(s.composition, "experimental");
  assert.equal(s.changeDetection, "possible_only");
  const unprocessed = scanSummary({ viewQualities: [], depthSource: "none", measurements: null, composition: null, mdcValidated: false });
  assert.deepEqual([unprocessed.processed, unprocessed.captureQuality, unprocessed.bmi, unprocessed.composition], [false, null, null, "not_available"]);
});

const scan = (at: number, whtr?: number, over: Partial<TrendScan> = {}): TrendScan => ({
  scanId: `s${at}`, at, protocolVersion: "5a.2", methodVersion: "m2",
  measurements: whtr === undefined ? [m("waistToHeight", "unavailable")] : [{ ...m("waistToHeight", "available", whtr, 0.02), kind: "ratio", unit: "ratio" }],
  ...over,
});

test("trends: shown only from enough comparable scans, oldest → newest", () => {
  const t = buildTrends([scan(3, 0.47), scan(1, 0.49), scan(2, 0.48)]).find((x) => x.name === "waistToHeight")!;
  assert.equal(t.shown, true);
  assert.deepEqual(t.points.map((p) => [p.at, p.value, p.uncertainty]), [[1, 0.49, 0.02], [2, 0.48, 0.02], [3, 0.47, 0.02]]);
  const two = buildTrends([scan(1, 0.49), scan(2, 0.48)]).find((x) => x.name === "waistToHeight")!;
  assert.deepEqual([two.shown, two.reason], [false, "not_enough_comparable_scans"]);
  assert.equal(MIN_TREND_POINTS, 3);
});

test("trends: never mix methods or protocols; skip unavailable values", () => {
  const scans = [scan(1, 0.49, { methodVersion: "m1" }), scan(2, 0.48, { protocolVersion: "5a.1" }), scan(3, undefined), scan(4, 0.47), scan(5, 0.46)];
  const t = buildTrends(scans).find((x) => x.name === "waistToHeight")!;
  assert.deepEqual(t.points.map((p) => p.at), [4, 5]);
  assert.equal(t.shown, false);
  assert.equal(t.methodVersion, "m2");
  assert.deepEqual(buildTrends([]).map((x) => x.reason), ["no_scans", "no_scans", "no_scans", "no_scans", "no_scans"]);
});
