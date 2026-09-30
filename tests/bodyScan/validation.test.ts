// Sombrey Body Scan, Phase 5D — validation & calibration analysis (convex/bodyScan/validation.ts)
// and scan-to-scan alignment (features.ts align.1, measurements.ts compareMeasurements).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_N, accuracy, buildReport, calibration, measurementReport, normaliseTruth, observations, operatingCurve, pointError,
  quantile, repeatability, toCsv, truthFor, validateTag, type ScanTag, type TaggedScan, type Truth, type TruthInput,
} from "../../convex/bodyScan/validation.ts";
import { alignScans, type AlignmentInput } from "../../convex/bodyScan/features.ts";
import { compareMeasurements, type Measurement, type MeasurementSet } from "../../convex/bodyScan/measurements.ts";

const NOW = Date.UTC(2026, 8, 30, 9, 0, 0);
const near = (a: number, b: number, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ─── Ground truth ────────────────────────────────────────────────────────────

const truthIn = (over: Partial<TruthInput> = {}): TruthInput => ({
  subjectCode: "S01", measuredAt: NOW - 60_000, measurement: "height", value: 178, unit: "cm",
  protocol: "stadiometer_barefoot", operator: "assistant", repeat: 1, ...over,
});

test("ground truth: unit conversion to cm / kg", () => {
  const inch = normaliseTruth(truthIn({ value: 70, unit: "in" }), NOW);
  assert.ok(inch.ok && inch.truth.value === 177.8 && inch.truth.unit === "cm");
  const mm = normaliseTruth(truthIn({ value: 1778, unit: "mm" }), NOW);
  assert.ok(mm.ok && mm.truth.value === 177.8);
  const lb = normaliseTruth(truthIn({ measurement: "weight", value: 180, unit: "lb", protocol: "scale_calibrated_morning" }), NOW);
  assert.ok(lb.ok && lb.truth.value === 81.65 && lb.truth.unit === "kg");
  const waist = normaliseTruth(truthIn({ measurement: "waist", value: 84.5, protocol: "tape_isak_style" }), NOW);
  assert.ok(waist.ok && waist.truth.value === 84.5);
});

test("ground truth: invalid entries are refused, never stored", () => {
  const bad: Array<[Partial<TruthInput>, RegExp]> = [
    [{ value: 17.8 }, /Implausible/],                                  // cm typed as dm
    [{ value: -178 }, /positive/],
    [{ value: NaN }, /positive/],
    [{ unit: "kg" }, /Unit/],                                          // mass unit for a length
    [{ measurement: "weight", unit: "cm", protocol: "scale_calibrated_morning" }, /Unit/],
    [{ measurement: "fatMass" }, /Unknown measurement/],
    [{ measurement: "bodyFat", value: 22, unit: "%", protocol: "dxa_whole_body", operator: "self" }, /clinician/],   // DXA is never self-reported
    [{ measurement: "bodyFat", value: 22, unit: "%", protocol: "tape_isak_style", operator: "clinician" }, /doesn't apply/],
    [{ measurement: "bodyFat", value: 95, unit: "%", protocol: "dxa_whole_body", operator: "clinician" }, /Implausible/],
    [{ protocol: "tape_isak_style" }, /doesn't apply/],                // a tape protocol for height
    [{ measurement: "waist", protocol: "stadiometer_barefoot", value: 84 }, /doesn't apply/],
    [{ subjectCode: "John Smith" }, /Subject code/],                   // no names
    [{ subjectCode: "jane" }, /Subject code/],
    [{ repeat: 0 }, /Repeat/], [{ repeat: 1.5 }, /Repeat/],
    [{ operator: "someone" }, /operator/],
    [{ measuredAt: NOW + 86_400_000 }, /date/],
  ];
  for (const [over, why] of bad) {
    const r = normaliseTruth(truthIn(over), NOW);
    assert.ok(!r.ok && why.test(r.error), `${JSON.stringify(over)} → ${JSON.stringify(r)}`);
  }
});

test("scan tags: controlled vocabulary only", () => {
  const tag: ScanTag = { subjectCode: "S01", session: "2026-09-30-a", repeat: "A", distanceM: 1.5, phoneHeight: "waist", lighting: "bright", clothing: "minimal", pose: "ideal" };
  assert.equal(validateTag(tag), null);
  assert.ok(validateTag({ ...tag, repeat: "Z" }));
  assert.ok(validateTag({ ...tag, distanceM: 9 }));
  assert.ok(validateTag({ ...tag, lighting: "candle" }));
  assert.ok(validateTag({ ...tag, session: "a b" }));
  assert.ok(validateTag({ ...tag, subjectCode: "Mary" }));
});

// ─── Statistics ──────────────────────────────────────────────────────────────

test("errors: absolute, signed (bias) and percentage", () => {
  assert.deepEqual(pointError({ scanner: 181, truth: 178 }), { absolute: 3, signed: 3, absolutePercent: 1.69 });
  assert.deepEqual(pointError({ scanner: 80, truth: 84 }), { absolute: 4, signed: -4, absolutePercent: 4.76 });
});

test("accuracy: MAE, median, RMSE, bias, SD, 95 % limits of agreement, MAPE", () => {
  const a = accuracy([101, 99, 102, 98].map((scanner) => ({ scanner, truth: 100 })))!;
  assert.equal(a.n, 4);
  assert.equal(a.pilot, true);
  assert.equal(a.mae, 1.5);
  assert.equal(a.medianAbsolute, 1.5);
  assert.equal(a.rmse, 1.58);
  assert.equal(a.meanBias, 0);
  assert.equal(a.sdError, 1.83);
  assert.deepEqual(a.limitsOfAgreement, [-3.58, 3.58]);
  assert.equal(a.mape, 1.5);
  const biased = accuracy([103, 104, 105].map((scanner) => ({ scanner, truth: 100 })))!;
  assert.equal(biased.meanBias, 4, "a systematic over-read shows as bias, not as noise");
  assert.equal(biased.sdError, 1);
});

test("accuracy: too few results → null, never a statistic from 1–2 points", () => {
  assert.equal(accuracy([]), null);
  assert.equal(accuracy([{ scanner: 1, truth: 1 }, { scanner: 2, truth: 2 }]), null);
  assert.equal(MIN_N.accuracy, 3);
});

test("repeatability: within-subject SD, CV and MDC95", () => {
  const r = repeatability([{ subject: "S01", values: [80, 82] }, { subject: "S02", values: [90, 91, 92] }])!;
  assert.equal(r.df, 3);
  near(r.withinSd, 1.155, 0.001);
  near(r.cvPercent, 1.33);
  near(r.mdc95, 3.2);
  assert.equal(r.icc, null, "ICC needs ≥ 5 subjects");
  assert.equal(repeatability([{ subject: "S01", values: [80, 82] }]), null, "one degree of freedom isn't enough");
  assert.equal(repeatability([{ subject: "S01", values: [80] }, { subject: "S02", values: [90] }]), null, "no repeats, no repeatability");
});

test("repeatability: ICC(1,1) once enough subjects exist", () => {
  const groups = [70, 80, 90, 100, 110].map((m, i) => ({ subject: `S0${i + 1}`, values: [m - 1, m + 1] }));
  const r = repeatability(groups)!;
  assert.equal(r.icc, 0.992);   // (500 − 2) / (500 + 2)
  near(r.withinSd, Math.SQRT2, 0.001);
});

test("calibration: coverage of the stated ±95 % range", () => {
  const errs = [0.5, 1, 1.5, 2.5, 0.2, 0.3, 3, 1, 1, 0.1];
  const c = calibration(errs.map((e) => ({ scanner: 100 + e, truth: 100, uncertainty: 2 })))!;
  assert.equal(c.coverage, 0.8);
  assert.equal(c.verdict, "consistent_with_95", "10 results can't show a miscalibration of this size");
  assert.equal(c.suggestedRangeMultiplier, 1.39);
  const narrow = calibration(Array.from({ length: 30 }, () => ({ scanner: 103, truth: 100, uncertainty: 1 })))!;
  assert.equal(narrow.verdict, "ranges_too_narrow");
  assert.equal(narrow.suggestedRangeMultiplier, 3);
  const wide = calibration(Array.from({ length: 200 }, () => ({ scanner: 100.1, truth: 100, uncertainty: 5 })))!;
  assert.equal(wide.verdict, "ranges_too_wide");
  assert.equal(calibration([{ scanner: 1, truth: 1, uncertainty: 1 }]), null);
});

test("threshold operating curve: what each 'available' threshold would let through", () => {
  const pts = [
    { scanner: 100, truth: 101, uncertainty: 2 },   // 2 % range
    { scanner: 100, truth: 99, uncertainty: 2 },
    { scanner: 100, truth: 100.5, uncertainty: 2.5 },
    { scanner: 100, truth: 110, uncertainty: 8 },   // 8 % range, badly off
  ];
  const [tight, loose] = operatingCurve(pts, [0.025, 0.1]);
  assert.deepEqual(tight, { maxRelativeRange: 0.025, passing: 3, passShare: 0.75, mae: 0.83, coverage: null });
  assert.equal(loose.passing, 4);
  assert.equal(loose.mae, 3.13, "loosening the threshold lets the bad result through");
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

// ─── The report ──────────────────────────────────────────────────────────────

const item = (name: string, status: Measurement["status"], value?: number, uncertainty?: number): Measurement =>
  ({ name, kind: "length", status, unit: "cm", confidence: 0.5, method: "x", reasons: [], ...(value !== undefined ? { value, uncertainty } : {}) });
const set = (height?: number, waist?: number, ok = true): TaggedScan["measurements"] => ({
  methodVersion: "m1", scale: { source: "truedepth", ok, views: ["front"], reasons: ok ? [] : ["front:sparse_depth"] },
  measurements: [
    height === undefined ? item("height", "unavailable") : item("height", "low_confidence", height, 4.5),
    waist === undefined ? item("waistCircumference", "unavailable") : item("waistCircumference", "available", waist, 5),
    item("weight", "unavailable"),
  ],
} as Pick<MeasurementSet, "methodVersion" | "measurements" | "scale">);
const tag = (repeat: string, over: Partial<ScanTag> = {}): ScanTag => ({ subjectCode: "S01", session: "d1", repeat, distanceM: 1.5, phoneHeight: "waist", lighting: "bright", clothing: "minimal", pose: "ideal", ...over });
const scan = (id: string, t: ScanTag, m: TaggedScan["measurements"], depthSource = "truedepth"): TaggedScan =>
  ({ scanId: id, createdAt: NOW, deviceModel: "iPhone16,1", depthSource, tag: t, measurements: m });
const truth = (measurement: Truth["measurement"], value: number, repeat = 1, subjectCode = "S01", at = NOW - 3_600_000): Truth =>
  ({ subjectCode, measuredAt: at, measurement, value, unit: measurement === "weight" ? "kg" : "cm", protocol: "x", operator: "assistant", repeat });

test("truth: repeats are averaged; another subject's or another day's never used", () => {
  const ts = [truth("height", 177.8), truth("height", 178.2, 2), truth("height", 150, 1, "S02"), truth("height", 160, 1, "S01", NOW - 10 * 86_400_000)];
  assert.deepEqual(truthFor(ts, "S01", "height", NOW), { value: 178, repeats: 2, operatorSd: 0.28 });
  assert.equal(truthFor(ts, "S03", "height", NOW), null);
});

test("observations: missing and unprocessed measurements are counted, never given an error", () => {
  const scans = [scan("a", tag("A"), set(180, 86)), scan("b", tag("B"), set(undefined, undefined, false)), scan("c", tag("C"), null)];
  const obs = observations(scans, [truth("height", 178), truth("waist", 84)]);
  const h = obs.filter((o) => o.measurement === "height");
  assert.deepEqual(h.map((o) => o.status), ["low_confidence", "unavailable", "not_processed"]);
  assert.deepEqual(h[0].error, { absolute: 2, signed: 2, absolutePercent: 1.12 });
  assert.equal(h[1].error, null);
  assert.equal(h[2].error, null);
  const w = obs.find((o) => o.measurement === "weight")!;
  assert.equal(w.truth, null, "no weight truth recorded");
});

test("report: per-measurement accuracy, available-only accuracy, repeatability, A/B and A–C differences", () => {
  const scans = [
    scan("a", tag("A"), set(180, 86)), scan("b", tag("B"), set(181, 85)), scan("c", tag("C"), set(183, 88)),
    scan("d", tag("A", { session: "d2" }), set(179, 84)), scan("e", tag("B", { session: "d2" }), set(179.5, 85)),
  ];
  const truths = [truth("height", 178), truth("waist", 84), truth("waist", 84.4, 2)];
  const { report, observations: obs } = buildReport(scans, truths);
  const h = report.measurements.find((m) => m.measurement === "height")!;
  assert.equal(h.scans, 5);
  assert.deepEqual(h.statusCounts, { low_confidence: 5 });
  assert.equal(h.accuracyAll?.n, 5);
  assert.equal(h.accuracyAll?.meanBias, 2.5);   // (2 + 3 + 5 + 1 + 1.5) / 5
  assert.equal(h.accuracyAvailable, null, "none of the heights was 'available'");
  assert.equal(h.immediateRepeatMeanAbsDiff, 0.75);  // |180−181|, |179−179.5|
  assert.equal(h.repositionMeanAbsDiff, 2.5);        // |180−183|, |181−183|
  assert.ok(h.repeatability, "A/B/C of d1 and A/B of d2 give 3 degrees of freedom");
  assert.equal(h.repeatability!.pilot, true);
  const w = report.measurements.find((m) => m.measurement === "waist")!;
  assert.equal(w.accuracyAvailable?.n, 5);
  assert.equal(w.truthOperatorSd, null, "one day, one subject, two tape repeats → df 1: too few");
  assert.equal(report.pilot, true);
  assert.ok(report.notes[0].startsWith("Pilot validation"));
  assert.equal(obs.length, 5 * 10);
  assert.equal(report.subjects, 1);
});

test("report: factor breakdowns (depth source, distance, …) and scale failure reasons", () => {
  const scans = [
    scan("a", tag("A", { distanceM: 1.0 }), set(179, 84)), scan("b", tag("B", { distanceM: 1.0 }), set(178, 85)), scan("c", tag("C", { distanceM: 1.0 }), set(177, 84)),
    scan("d", tag("A", { distanceM: 2.0 }), set(undefined, undefined, false)), scan("e", tag("B", { distanceM: 2.0 }), set(undefined, undefined, false)),
    scan("f", tag("A", { session: "n" }), set(undefined, undefined, false), "none"),
  ];
  const { report } = buildReport(scans, [truth("height", 178), truth("waist", 84)]);
  const dist = report.factors.distanceM;
  assert.deepEqual(dist.map((l) => [l.level, l.scans, l.metricScaleShare]), [["1.0", 3, 1], ["1.5", 1, 0], ["2.0", 2, 0]]);
  assert.equal(dist[0].heightMae, 0.67);
  assert.equal(dist[2].heightMae, null, "no values at 2 m → no error statistic, not zero");
  assert.deepEqual(report.factors.depthSource.map((l) => l.level), ["none", "truedepth"]);
  assert.deepEqual(report.scaleFailureReasons, { "front:sparse_depth": 3 });
});

test("csv export: one row per scan × measurement, escaped, no names", () => {
  const { observations: obs } = buildReport([scan("a", tag("A"), set(180, 86))], [truth("height", 178)]);
  const csv = toCsv(obs).split("\n");
  assert.equal(csv.length, 1 + 10);
  assert.ok(csv[0].startsWith("scanId,subject,session,repeat,measurement,status,scanner"));
  assert.ok(csv.some((l) => l.startsWith("a,S01,d1,A,height,low_confidence,180,4.5")));
});

test("history: the analysis never changes stored results", () => {
  const m = set(180, 86);
  const before = JSON.stringify(m);
  buildReport([scan("a", tag("A"), m)], [truth("height", 170)]);
  assert.equal(JSON.stringify(m), before);
  const r = measurementReport(observations([scan("a", tag("A"), m)], []), "height", []);
  assert.equal(r.accuracyAll, null, "no ground truth → no accuracy");
});

// ─── Alignment & change detection ────────────────────────────────────────────

const align = (over: Partial<AlignmentInput["views"][number]> = {}, top: Partial<AlignmentInput> = {}): AlignmentInput => ({
  depthSource: "truedepth", protocolVersion: "5a.2",
  views: [{ view: "front", bodySpan: 0.78, pitchDegrees: 6, heightFraction: 0.86, ratios: { shoulderTiltDeg: 0.5, hipTiltDeg: -0.3, armToTorso: 1.1 }, ...over }],
  ...top,
});

test("alignment: comparable scans pass; distance, tilt, pose and source differences are named", () => {
  assert.deepEqual(alignScans(align(), align({ bodySpan: 0.8 })).reasons, []);
  assert.deepEqual(alignScans(align(), align({ bodySpan: 0.6 })).reasons, ["front:distance_differs"]);
  assert.deepEqual(alignScans(align(), align({ pitchDegrees: 18 })).reasons, ["front:tilt_differs"]);
  assert.deepEqual(alignScans(align(), align({ ratios: { shoulderTiltDeg: 7, hipTiltDeg: 0, armToTorso: 1.1 } })).reasons, ["front:pose_differs"]);
  assert.deepEqual(alignScans(align(), align({}, { depthSource: "lidar" })).reasons, ["depth_source_differs"]);
  const a = alignScans(align(), align({ bodySpan: 0.8 }));
  assert.equal(a.method, "align.1");
  assert.equal(a.deltas.front.bodySpan, 0.02);
});

test("change detection: a difference below the MDC is noise; misaligned scans aren't compared", () => {
  const ms = (waist: number): Pick<MeasurementSet, "methodVersion" | "measurements" | "scale"> => ({
    methodVersion: "m1", scale: { source: "truedepth", ok: true, views: ["front"], reasons: [] },
    measurements: [item("waistCircumference", "available", waist, 1)],
  });
  const plain = compareMeasurements(ms(84), ms(86));
  assert.ok(plain.comparable && plain.changes[0].exceedsNoise, "2 cm > √2 cm combined range");
  const withMdc = compareMeasurements(ms(84), ms(86), { mdc: { waistCircumference: 3.2 } });
  assert.ok(withMdc.comparable && !withMdc.changes[0].exceedsNoise && withMdc.changes[0].mdc === 3.2, "below the MDC it's noise");
  const misaligned = compareMeasurements(ms(84), ms(86), { alignment: { comparable: false, reasons: ["front:pose_differs"] } });
  assert.deepEqual(misaligned, { comparable: false, reasons: ["alignment:front:pose_differs"] });
});

test("5E: DXA body fat is ground truth for the composition layer's internal estimate", () => {
  const dxa = normaliseTruth(truthIn({ measurement: "bodyFat", value: 21.4, unit: "%", protocol: "dxa_whole_body", operator: "clinician" }), NOW);
  assert.ok(dxa.ok && dxa.truth.unit === "%" && dxa.truth.value === 21.4);
  const withComposition: TaggedScan = {
    ...scan("a", tag("A"), set(180, 86)),
    composition: { compositionVersion: "c1", results: [{
      name: "bodyFatPercent", model: "rfm", modelVersion: "0", modelKind: "equation", validationStatus: "experimental", status: "estimate",
      value: 24.1, low: 15.7, high: 32.5, uncertainty: 8.4, uncertaintyComponents: { measurement: 1.6, model: 8.2, unquantified: [] },
      displayable: false, population: "", reasons: [],
    }] },
  };
  const bf = observations([withComposition], [truth("bodyFat" as Truth["measurement"], 21.4)]).find((o) => o.measurement === "bodyFat")!;
  assert.deepEqual([bf.status, bf.scanner, bf.uncertainty, bf.truth], ["estimate", 24.1, 8.4, 21.4]);
  assert.deepEqual(bf.error, { absolute: 2.7, signed: 2.7, absolutePercent: 12.62 });
  const none = observations([scan("b", tag("A"), set(180, 86))], []).find((o) => o.measurement === "bodyFat")!;
  assert.equal(none.status, "not_processed");
});
