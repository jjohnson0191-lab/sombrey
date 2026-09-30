// Sombrey Body Scan, Phase 5C — the metric measurement engine (convex/bodyScan/measurements.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABLE_MAX_REL, MEASUREMENT_METHOD_VERSION, compareMeasurements, computeMeasurements, ellipsePerimeter,
  evidenceProblems, scaleFor, viewHeight, type Measurement, type MeasurementSet,
} from "../../convex/bodyScan/measurements.ts";
import { PROFILE_SAMPLES, validateFeatureSet, type FeatureSet, type FeatureView, type ScaleEvidence } from "../../convex/bodyScan/features.ts";

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0);

// A synthetic 1.75 m person. Widths/depths are ÷ silhouette height, as the phone stores them.
const H = 1.75;
const FRONT_W = { shoulder: 0.25, chest: 0.19, waist: 0.17, hip: 0.2, thighLeft: 0.09, thighRight: 0.09, calfLeft: 0.06, calfRight: 0.06, upperArmLeft: 0.055, upperArmRight: 0.055 };
const SIDE_D = { chestDepth: 0.135, waistDepth: 0.125, hipDepth: 0.14, thighDepth: 0.1, calfDepth: 0.065 };
const D_MEAN = (0.135 + 0.125 + 0.14) / 3;

/** Evidence exactly consistent with the geometry: the camera is `zMid` from the
 * body's mid-plane; the measured torso surface is δ = ½·d·H in front of it. */
function consistentEvidence(view: string, zMid = 1.3, over: Partial<ScaleEvidence> = {}, heightM = H, dMean = D_MEAN): ScaleEvidence {
  const delta = 0.5 * dMean * heightM;
  const zS = zMid - delta;
  return {
    view, depthWidth: 480, depthHeight: 640, focalPx: 505, intrinsics: "calibration", accuracy: "absolute", filtered: false,
    samples: 2000, validFraction: 0.95, distanceM: zS, planeTiltDeg: 5, residualM: 0.01, surfaceHeightM: (heightM * zS) / zMid, ...over,
  };
}

const silhouette = { maskWidth: 384, maskHeight: 512, top: 0.05, bottom: 0.95, left: 0.3, right: 0.7, heightFraction: 0.9, areaPerHeight2: 0.11, mainComponentFraction: 0.97, keypointAgreement: 1 };
const view = (v: string, over: Partial<FeatureView> = {}): FeatureView => ({
  view: v, imageWidth: 1536, imageHeight: 2048, processingMs: 300, keypoints: [], silhouette,
  widths: v === "side" ? { ...SIDE_D } : { ...FRONT_W },
  ratios: v === "side" ? {} : { waistToHip: 0.85, shoulderToWaist: 1.47, torsoToHeight: 0.3, legToHeight: 0.47 },
  quality: { framing: 1 }, issues: [], ...over,
});

function features(over: Partial<FeatureSet> = {}): FeatureSet {
  return {
    cvVersion: "5c.1", processedAt: NOW - 1000,
    processing: { deviceModel: "iPhone16,1", osVersion: "iOS 26.0", appVersion: "1.0 (50)", components: ["vision.personSegmentation.accurate"] },
    scale: { kind: "truedepth", evidence: [consistentEvidence("front"), consistentEvidence("back")] },
    views: [view("front"), view("side"), view("back")],
    multiView: { ratios: {}, consistency: {} },
    quality: { overallScore: 0.9, framing: 1, pose: 0.9, lighting: 0.9, segmentation: 0.95, motion: 1, multiViewConsistency: 0.95 },
    ...over,
  };
}
const get = (s: MeasurementSet, name: string): Measurement => {
  const m = s.measurements.find((x) => x.name === name);
  assert.ok(m, `missing ${name}`);
  return m;
};

// ─── Geometry ────────────────────────────────────────────────────────────────

test("the synthetic feature sets are valid stored features", () => {
  assert.equal(validateFeatureSet(features(), NOW), null);
  assert.equal(validateFeatureSet(features({ scale: { kind: "none" } }), NOW), null);
});

test("height: recovered exactly from consistent depth geometry (mid-plane correction)", () => {
  for (const z of [0.9, 1.3, 1.8]) {
    const h = viewHeight(consistentEvidence("front", z), D_MEAN, 460);
    assert.ok(h.ok);
    if (h.ok) assert.ok(Math.abs(h.heightM - H) < 1e-9, `z=${z}: ${h.heightM}`);
  }
  // Without the correction the surface projection alone under-reads the height.
  assert.ok(consistentEvidence("front").surfaceHeightM < H - 0.1);
  const s = scaleFor(features());
  assert.ok(s.ok);
  if (s.ok) {
    assert.ok(Math.abs(s.heightM - H) < 1e-9);
    assert.deepEqual(s.views, ["front", "back"]);
  }
});

test("widths and depths: scale-free value × height", () => {
  const m = computeMeasurements(features());
  assert.equal(get(m, "shoulderWidth").value, 43.8); // 0.25 × 175
  assert.equal(get(m, "waistDepth").value, 21.9);    // 0.125 × 175
  assert.equal(get(m, "thighWidth").value, 15.8);    // mean(0.09, 0.09) × 175
  assert.equal(get(m, "torsoLength").value, 52.5);
  assert.equal(get(m, "legLength").value, 82.3);
});

test("circumference: an ellipse from front width + side depth — not width × π", () => {
  const m = computeMeasurements(features());
  const waist = get(m, "waistCircumference");
  const expected = ellipsePerimeter(0.17 / 2, 0.125 / 2) * 175;
  assert.ok(Math.abs(waist.value! - expected) < 0.06, `${waist.value} vs ${expected}`);
  assert.ok(waist.value! < Math.PI * 0.17 * 175 - 5, "width × π would overstate a deeper-than-wide… or wider-than-deep section");
  assert.ok(Math.abs(ellipsePerimeter(1, 1) - 2 * Math.PI) < 1e-12, "a circle's perimeter");
  assert.ok(Math.abs(ellipsePerimeter(2, 1) - 9.688448) < 1e-4, "Ramanujan, a=2 b=1");
  assert.equal(waist.method, "front_side_ellipse");
  assert.equal(get(m, "upperArmCircumference").status, "unavailable", "no side depth for the arm");
  assert.deepEqual(get(m, "upperArmCircumference").reasons, ["no_side_depth_for_arm"]);
});

test("volume: stacked ellipses from the profiles, ÷ H³ scale-free and × H³ in litres", () => {
  const prof = (x: number) => Array.from({ length: PROFILE_SAMPLES }, () => x);
  const f = features({ views: [view("front", { profile: prof(0.1) }), view("side", { profile: prof(0.1) }), view("back")] });
  const m = computeMeasurements(f);
  const index = (Math.PI / 4) * 0.01;
  assert.equal(get(m, "volumeIndex").value, Math.round(index * 1000) / 1000);
  assert.ok(Math.abs(get(m, "trunkLegVolume").value! - Math.round(index * H ** 3 * 1000 * 10) / 10) < 1e-9);
  assert.equal(get(computeMeasurements(features()), "trunkLegVolume").status, "unavailable", "no profiles (5b.1-style views)");
});

// ─── Scale ───────────────────────────────────────────────────────────────────

test("no scale: nothing metric, only scale-free proportions", () => {
  const m = computeMeasurements(features({ scale: { kind: "none" } }));
  for (const x of m.measurements) {
    if (x.unit === "ratio") continue;
    assert.equal(x.status, "unavailable", x.name);
    assert.equal(x.value, undefined, `${x.name} must carry no number`);
  }
  assert.ok(get(m, "height").reasons.includes("no_metric_scale"));
  assert.equal(get(m, "waistToHip").status, "available");
  assert.equal(get(m, "waistToHip").value, 0.85);
  assert.ok(get(m, "waistToHeight").value! > 0.4 && get(m, "waistToHeight").value! < 0.5, "waist girth ÷ height needs no scale");
  assert.equal(m.scale.ok, false);
});

test("scale: low-quality evidence is refused, with the reason", () => {
  const bad: Array<[Partial<ScaleEvidence>, string]> = [
    [{ accuracy: "relative" }, "relative_depth"],
    [{ validFraction: 0.3 }, "sparse_depth"],
    [{ samples: 40 }, "few_depth_samples"],
    [{ residualM: 0.09 }, "uneven_depth"],
    [{ planeTiltDeg: 50 }, "body_plane_tilted"],
  ];
  for (const [over, reason] of bad) {
    assert.deepEqual(evidenceProblems(consistentEvidence("front", 1.3, over), "truedepth"), [reason]);
    const s = scaleFor(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front", 1.3, over)] } }));
    assert.equal(s.ok, false);
    assert.ok(s.reasons.includes(`front:${reason}`), JSON.stringify(s.reasons));
  }
  assert.deepEqual(evidenceProblems(consistentEvidence("front", 3.2), "truedepth"), ["distance_out_of_range"]);
  assert.deepEqual(evidenceProblems(consistentEvidence("front", 3.2), "lidar"), [], "LiDAR's range covers 3 m");
  assert.deepEqual(evidenceProblems(consistentEvidence("front", 4.5), "lidar"), ["distance_out_of_range"]);
  assert.deepEqual(evidenceProblems(consistentEvidence("front"), "arkit_metric"), ["unsupported_scale_source"], "no priors → no metric values");
});

test("scale: one bad view doesn't sink a good one; both bad → none", () => {
  const s = scaleFor(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front"), consistentEvidence("back", 1.3, { validFraction: 0.2 })] } }));
  assert.ok(s.ok);
  if (s.ok) { assert.deepEqual(s.views, ["front"]); assert.deepEqual(s.reasons, ["back:sparse_depth"]); }
  const none = computeMeasurements(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front", 1.3, { validFraction: 0.2 })] } }));
  assert.equal(get(none, "height").status, "unavailable");
  assert.equal(get(none, "waistCircumference").value, undefined);
});

test("scale: front and back must agree", () => {
  const s = scaleFor(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front"), consistentEvidence("back", 1.3, {}, 1.95)] } }));
  assert.equal(s.ok, false);
  assert.ok(s.reasons.includes("front_back_height_disagree"));
});

test("scale: the side view's evidence is never used for height", () => {
  const s = scaleFor(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("side")] } }));
  assert.equal(s.ok, false);
});

test("scale: without side-view depth the mid-plane can't be placed → no scale", () => {
  const s = scaleFor(features({ views: [view("front"), view("side", { widths: {} }), view("back")] }));
  assert.deepEqual(s, { ok: false, source: "truedepth", reasons: ["no_side_depth"] });
});

test("scale: impossible geometry and implausible results are unavailable, never clamped", () => {
  const g = viewHeight(consistentEvidence("front", 1.3, { distanceM: 0.45, surfaceHeightM: 3.9 }), 0.4, 460);
  assert.deepEqual(g, { ok: false, reasons: ["implausible_geometry"] });
  const tall = computeMeasurements(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front", 1.6, {}, 2.9)] } }));
  const h = get(tall, "height");
  assert.equal(h.status, "unavailable");
  assert.ok(h.reasons.includes("implausible_value"));
  assert.equal(h.value, undefined);
});

test("LiDAR: the same geometry, a flatter error curve with distance", () => {
  const at = (kind: "truedepth" | "lidar", z: number) =>
    get(computeMeasurements(features({ scale: { kind, evidence: [consistentEvidence("front", z)] } })), "height");
  const td = at("truedepth", 2.2), li = at("lidar", 2.2);
  assert.equal(li.value, 175);
  assert.ok(li.uncertainty! < td.uncertainty!);
  assert.equal(at("lidar", 3.5).status, "low_confidence", "in range for LiDAR…");
  assert.equal(at("truedepth", 3.5).status, "unavailable", "…but not for TrueDepth");
  const m = computeMeasurements(features({ scale: { kind: "lidar", evidence: [consistentEvidence("front")] } }));
  assert.equal(m.scale.source, "lidar");
  assert.equal(m.scale.ok, true);
});

test("an unknown metric source produces no metric values", () => {
  const m = computeMeasurements(features({ scale: { kind: "arkit_metric", evidence: [consistentEvidence("front")] } }));
  assert.equal(get(m, "height").status, "unavailable");
  assert.ok(get(m, "height").reasons.includes("front:unsupported_scale_source"));
});

// ─── Confidence ──────────────────────────────────────────────────────────────

test("confidence: with today's priors, height and circumferences are low-confidence at ~1.3 m; widths may be shown", () => {
  const m = computeMeasurements(features());
  const h = get(m, "height");
  assert.equal(h.status, "low_confidence");
  assert.ok(h.reasons.includes("uncertainty_too_high"));
  assert.ok(h.uncertainty! / h.value! > AVAILABLE_MAX_REL.height);
  assert.equal(get(m, "waistCircumference").status, "low_confidence");
  assert.equal(get(m, "shoulderWidth").status, "available");
  for (const x of m.measurements) {
    assert.ok(x.confidence >= 0 && x.confidence <= 1, x.name);
    if (x.value !== undefined && x.unit !== "ratio") assert.ok((x.uncertainty ?? 0) > 0, `${x.name} has a range`);
  }
});

test("confidence: uncertainty grows with distance", () => {
  const near = get(computeMeasurements(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front", 1.0)] } })), "height");
  const far = get(computeMeasurements(features({ scale: { kind: "truedepth", evidence: [consistentEvidence("front", 2.2)] } })), "height");
  assert.ok(far.uncertainty! > near.uncertainty!);
  assert.ok(far.confidence < near.confidence);
});

test("confidence: a poor capture is never 'available'", () => {
  const m = computeMeasurements(features({ quality: { ...features().quality, overallScore: 0.4 } }));
  assert.equal(get(m, "shoulderWidth").status, "low_confidence");
  assert.ok(get(m, "shoulderWidth").reasons.includes("capture_quality_low"));
});

test("validation: inconsistent front/side geometry and missing views", () => {
  const m = computeMeasurements(features({ views: [view("front", { widths: { ...FRONT_W, waist: 0.4 } }), view("side"), view("back")] }));
  assert.deepEqual(get(m, "waistCircumference").reasons, ["inconsistent_front_side"]);
  const touching = computeMeasurements(features({ views: [view("front", { widths: { shoulder: 0.25, chest: 0.19, waist: 0.17, hip: 0.2 }, issues: ["legs_touching"] }), view("side"), view("back")] }));
  assert.ok(get(touching, "thighCircumference").reasons.includes("legs_touching"));
  const noSide = computeMeasurements(features({ views: [view("front"), view("back")] }));
  assert.equal(get(noSide, "hipCircumference").status, "unavailable");
});

test("weight and BMI are never estimated from images; body fat doesn't exist in the measurement layer", () => {
  const m = computeMeasurements(features());
  assert.deepEqual(get(m, "weight"), { name: "weight", kind: "mass", status: "unavailable", unit: "kg", confidence: 0, method: "none", reasons: ["not_estimated_from_images"] });
  assert.equal(get(m, "bmi").status, "unavailable");
  assert.ok(!m.measurements.some((x) => /fat|rfm/i.test(x.name)));
  assert.equal(m.validated, false);
  assert.equal(m.methodVersion, MEASUREMENT_METHOD_VERSION);
});

// ─── Profile height & history ────────────────────────────────────────────────

/** Thin side depths make the mid-plane offset tiny, so height can reach "available". */
const thin = () => {
  const d = { chestDepth: 0.02, waistDepth: 0.02, hipDepth: 0.02 };
  const sharp = { ...silhouette, maskHeight: 1024 };
  return features({
    scale: { kind: "truedepth", evidence: [consistentEvidence("front", 1.0, { residualM: 0 }, H, 0.02)] },
    views: [view("front", { silhouette: sharp }), view("side", { widths: d, silhouette: sharp }), view("back", { silhouette: sharp })],
  });
};

test("profile height: compared, never overwritten; a meaningful gap is flagged", () => {
  const h = get(computeMeasurements(thin()), "height");
  assert.equal(h.status, "available", JSON.stringify(h));
  assert.equal(h.value, 175);
  const same = computeMeasurements(thin(), 176);
  assert.deepEqual(same.profileComparison, { profileHeightCm: 176, scannerHeightCm: 175, differenceCm: -1, differs: false });
  const off = computeMeasurements(thin(), 182);
  assert.equal(off.profileComparison?.differs, true);
  assert.equal(off.profileComparison?.differenceCm, -7);
  const low = computeMeasurements(features(), 182);
  assert.deepEqual(low.profileComparison, { profileHeightCm: 182, differs: false }, "no claim from a low-confidence height");
  assert.equal(computeMeasurements(features()).profileComparison, undefined);
});

test("history: the result depends only on the stored features and the scan's own snapshot", () => {
  const a1 = computeMeasurements(features(), 175);
  const a2 = computeMeasurements(features(), 175);
  assert.deepEqual(a1, a2, "deterministic");
  const later = computeMeasurements(features(), 190);
  assert.deepEqual(later.measurements, a1.measurements, "a different profile height changes no measurement");
});

// ─── Change detection ────────────────────────────────────────────────────────

test("change: differences inside the combined uncertainty are noise", () => {
  const a = computeMeasurements(features());
  const b = computeMeasurements(features({ views: [view("front", { widths: { ...FRONT_W, shoulder: 0.252 } }), view("side"), view("back")] }));
  const c = compareMeasurements(a, b);
  assert.ok(c.comparable);
  if (c.comparable) {
    assert.equal(c.validated, false);
    const s = c.changes.find((x) => x.name === "shoulderWidth")!;
    assert.equal(s.delta, 0.3);
    assert.equal(s.exceedsNoise, false);
    assert.ok(!c.changes.some((x) => x.name === "height"), "low-confidence values are never compared");
  }
  const big = compareMeasurements(a, computeMeasurements(features({ views: [view("front", { widths: { ...FRONT_W, shoulder: 0.3 } }), view("side"), view("back")] })));
  if (big.comparable) assert.equal(big.changes.find((x) => x.name === "shoulderWidth")!.exceedsNoise, true);
  assert.deepEqual(compareMeasurements(a, { ...b, methodVersion: "m0" }), { comparable: false, reasons: ["method_version_differs"] });
  const lidar = computeMeasurements(features({ scale: { kind: "lidar", evidence: [consistentEvidence("front")] } }));
  assert.deepEqual(compareMeasurements(a, lidar), { comparable: false, reasons: ["scale_source_differs"] }, "TrueDepth and LiDAR scans aren't compared");
});

// ─── m2 (Phase 5E) ───────────────────────────────────────────────────────────

test("m2: new features — leg depths, waist-to-height range, silhouette area, symmetry, posture", () => {
  const f = features({ views: [view("front", { ratios: { ...view("front").ratios, armSymmetry: 0.03, legSymmetry: 0.02, shoulderTiltDeg: -1.4, hipTiltDeg: 0.8 } }), view("side"), view("back")] });
  const m = computeMeasurements(f);
  assert.equal(m.methodVersion, "m2");
  assert.equal(get(m, "thighDepth").value, 17.5);   // 0.1 × 175
  assert.equal(get(m, "calfDepth").value, 11.4);    // 0.065 × 175
  const whtr = get(m, "waistToHeight");
  assert.ok(whtr.uncertainty! > 0, "m2 gives waist-to-height a range");
  // Honest result under today's priors: outline edges (512-row mask) + ellipse model ≈ ±10 % → low confidence.
  assert.equal(whtr.status, "low_confidence");
  assert.ok(whtr.reasons.includes("uncertainty_too_high"));
  assert.equal(get(m, "silhouetteAreaIndex").value, 0.11);
  assert.equal(get(m, "armSymmetry").value, 0.03);
  assert.deepEqual([get(m, "shoulderTilt").value, get(m, "shoulderTilt").unit, get(m, "hipTilt").value], [-1.4, "deg", 0.8]);
});

test("m2: waist-to-height's range has no scale term — the same with or without depth", () => {
  const metric = get(computeMeasurements(features()), "waistToHeight");
  const noScale = get(computeMeasurements(features({ scale: { kind: "none" } })), "waistToHeight");
  assert.equal(metric.value, noScale.value);
  assert.equal(metric.uncertainty, noScale.uncertainty);
});

test("m2: every measurement m1 had is computed identically (the new version only adds)", () => {
  // m1's values for this synthetic set, frozen from the 5C run.
  const m = computeMeasurements(features());
  const expected: Record<string, number> = { height: 175, shoulderWidth: 43.8, waistDepth: 21.9, thighWidth: 15.8, torsoLength: 52.5, legLength: 82.3 };
  for (const [name, value] of Object.entries(expected)) assert.equal(get(m, name).value, value, name);
  assert.ok(Math.abs(get(m, "waistCircumference").value! - ellipsePerimeter(0.17 / 2, 0.125 / 2) * 175) < 0.06);
});

test("m2: missing posture/symmetry inputs are unavailable, never zero", () => {
  const m = computeMeasurements(features());
  assert.equal(get(m, "armSymmetry").status, "unavailable");
  assert.equal(get(m, "shoulderTilt").status, "unavailable");
  assert.equal(get(m, "shoulderTilt").value, undefined);
});
