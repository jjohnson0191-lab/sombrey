// Sombrey Body Scan — Phase 5C: the metric measurement engine.
//
// Input: one stored feature set (convex/bodyScan/features.ts) — the phone's
// scale-free silhouette features plus, when the phone measured depth, per-view
// scale evidence. Output: measurements, each with a status, an approximate
// 95 % uncertainty, a heuristic confidence, the method, and the reasons behind
// its status. Nothing here has been validated against a reference (tape,
// stadiometer, DXA): every set is stored with `validated: false`.
//
// The one metric quantity is the body's height in the image, recovered from
// the TrueDepth evidence. Every other length is a 5B scale-free value (already
// ÷ the silhouette height in its own view) × that height. No scale evidence →
// no metric value, ever: scale-free proportions only.
//
// Deterministic and pure — the same features always give the same result, so
// a new METHOD version can be recomputed from stored numbers without any
// image. Tested in tests/bodyScan/measurements.test.ts.

import type { FeatureSet, FeatureView, ScaleEvidence } from "./features.ts";

/** Method history (stored rows of every version are kept; never overwritten):
 *  m1 (5C) — height, widths/depths, ellipse circumferences, volume, proportions.
 *  m2 (5E) — m1 unchanged for every shared measurement, plus: thigh/calf depth,
 *            a ±95 % range on waist-to-height (scale cancels: edges + ellipse
 *            model only — the input to the composition layer), silhouette area
 *            index, arm/leg symmetry and shoulder/hip tilt (posture). Priors and
 *            thresholds are unchanged: no validation data exists yet (5D). */
export const MEASUREMENT_METHOD_VERSION = "m2";

/** Provisional error model (1σ, relative unless stated). These are priors,
 * not measured accuracy: a validation study replaces them. Kept in one place
 * so the device test can tune them and every stored set names its version. */
export const PRIORS = {
  /** Relative depth error by source, 1σ: `at1m` up to 1 m, growing
   * `perMetre` per metre beyond. TrueDepth (front, structured light) is built
   * for < 1 m; a ~5 % error has been reported past 2 m. LiDAR (rear, ARKit
   * scene depth, high-confidence pixels only) holds its accuracy over the
   * capture range. Both are priors to be replaced by the device study. */
  depth: {
    truedepth: { at1m: 0.01, perMetre: 0.03 },
    lidar: { at1m: 0.01, perMetre: 0.005 },
  } as Record<string, { at1m: number; perMetre: number }>,
  /** The silhouette outline lies in the body's mid-plane, behind the measured
   * surface by half the torso depth; that offset is uncertain by this fraction. */
  midPlaneRel: 0.25,
  /** Plane-fit residual (body curvature) → distance uncertainty, × residual. */
  residualWeight: 0.25,
  /** Silhouette edge uncertainty, mask pixels per edge. */
  edgePx: 2,
  /** Hair, posture, stance. */
  stature: 0.005,
  /** Keypoint-based lengths (torso, leg). */
  keypointLength: 0.02,
  /** An ellipse vs a real body cross-section. */
  ellipseModel: 0.03,
  /** Stacked ellipses vs real trunk + leg volume (arms excluded). */
  volumeModel: 0.08,
} as const;

/** Evidence a view must meet before its depth is trusted for scale. */
export const EVIDENCE_LIMITS = {
  minValidFraction: 0.6,
  minSamples: 150,
  maxResidualM: 0.04,
  minDistanceM: 0.4,
  /** Beyond these the source isn't trusted for body scale. */
  maxDistanceM: { truedepth: 2.5, lidar: 4 } as Record<string, number>,
  maxTiltDeg: 35,
} as const;

/** A measurement is "available" (may be shown, with its ± range) only when its
 * 95 % half-width ÷ value is at most this; otherwise "low_confidence". */
export const AVAILABLE_MAX_REL = { height: 0.025, length: 0.08, circumference: 0.07, volume: 0.1 } as const;
export const MIN_CAPTURE_QUALITY = 0.6;
/** Front and back are taken from the same spot seconds apart: their heights
 * must agree to within this fraction (their shared errors cancel here). */
export const VIEW_AGREEMENT_MAX_REL = 0.03;

export type MeasurementStatus = "available" | "low_confidence" | "unavailable";
export type MeasurementKind = "length" | "circumference" | "volume" | "mass" | "index" | "ratio" | "angle";

export type Measurement = {
  name: string;
  kind: MeasurementKind;
  status: MeasurementStatus;
  unit: "cm" | "L" | "kg" | "kg/m2" | "ratio" | "deg";
  /** Present for available and low-confidence results only. */
  value?: number;
  /** Approximate 95 % half-width, same unit. */
  uncertainty?: number;
  /** 0–1 heuristic: capture quality × threshold / (threshold + 95 % relative
   * half-width) — 0.5 × quality exactly at the "available" threshold. Not a probability. */
  confidence: number;
  method: string;
  reasons: string[];
};

export type ScaleResult =
  | { ok: true; source: string; heightM: number; rel: number; views: string[]; reasons: string[] }
  | { ok: false; source: string; reasons: string[] };

export type MeasurementSet = {
  methodVersion: string;
  cvVersion: string;
  scale: { source: string; ok: boolean; views: string[]; reasons: string[] };
  measurements: Measurement[];
  profileComparison?: { profileHeightCm: number; scannerHeightCm?: number; differenceCm?: number; differs: boolean };
  validated: false;
};

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Ramanujan's ellipse perimeter (semi-axes a, b). */
export function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function viewOf(f: FeatureSet, v: string): FeatureView | undefined {
  return f.views.find((x) => x.view === v);
}

/** Silhouette height in mask pixels (for edge uncertainty). */
function silhouettePx(v: FeatureView | undefined): number | null {
  const s = v?.silhouette;
  if (!s) return null;
  const px = s.heightFraction * s.maskHeight;
  return px > 0 ? px : null;
}

/** Mean torso depth (side view), ÷ height — for the mid-plane offset. */
function torsoDepth(f: FeatureSet): number | null {
  const w = viewOf(f, "side")?.widths ?? {};
  const ds = ["chestDepth", "waistDepth", "hipDepth"].map((k) => w[k]).filter((x): x is number => typeof x === "number" && x > 0);
  return ds.length ? mean(ds) : null;
}

export function evidenceProblems(e: ScaleEvidence, source: string): string[] {
  const p: string[] = [];
  const maxDistance = EVIDENCE_LIMITS.maxDistanceM[source];
  if (maxDistance === undefined || !PRIORS.depth[source]) return ["unsupported_scale_source"];
  if (e.accuracy !== "absolute") p.push("relative_depth");
  if (e.samples < EVIDENCE_LIMITS.minSamples) p.push("few_depth_samples");
  if (e.validFraction < EVIDENCE_LIMITS.minValidFraction) p.push("sparse_depth");
  if (e.residualM > EVIDENCE_LIMITS.maxResidualM) p.push("uneven_depth");
  if (e.distanceM < EVIDENCE_LIMITS.minDistanceM || e.distanceM > maxDistance) p.push("distance_out_of_range");
  if (e.planeTiltDeg > EVIDENCE_LIMITS.maxTiltDeg) p.push("body_plane_tilted");
  return p;
}

/** One view's body height from its evidence: the silhouette projected onto the
 * measured surface plane, moved back to the body's mid-plane. A plane shifted
 * along its normal by δ scales central projections by exactly (Z + δ) / Z; δ is
 * half the torso depth, which is itself a fraction d of the height:
 * δ = ½·d·H and H = Hs·(Z + δ)/Z  ⇒  δ = ½·d·Hs / (1 − ½·d·Hs/Z). */
export function viewHeight(e: ScaleEvidence, depthNorm: number, silhouetteHeightPx: number | null, source = "truedepth"):
  { ok: true; heightM: number; rel: number } | { ok: false; reasons: string[] } {
  const reasons = evidenceProblems(e, source);
  if (silhouetteHeightPx === null) reasons.push("no_silhouette");
  if (reasons.length) return { ok: false, reasons };
  const Z = e.distanceM, Hs = e.surfaceHeightM;
  const k = (0.5 * depthNorm * Hs) / Z;
  if (!(k > 0 && k < 0.5)) return { ok: false, reasons: ["implausible_geometry"] };
  const delta = (0.5 * depthNorm * Hs) / (1 - k);
  const heightM = (Hs * (Z + delta)) / Z;
  const prior = PRIORS.depth[source];
  const depth = prior.at1m + prior.perMetre * Math.max(0, Z - 1);
  const fit = (PRIORS.residualWeight * e.residualM) / Z;
  const mid = (PRIORS.midPlaneRel * delta) / (Z + delta);
  const px = (PRIORS.edgePx * Math.SQRT2) / (silhouetteHeightPx as number);
  const rel = Math.sqrt(depth ** 2 + fit ** 2 + mid ** 2 + px ** 2 + PRIORS.stature ** 2);
  return { ok: true, heightM, rel };
}

/** The scan's metric scale: its height from the front/back evidence. Two views
 * must agree within their uncertainty; they share systematic errors (depth
 * bias, mid-plane), so the combined uncertainty is the better view's, not less. */
export function scaleFor(f: FeatureSet): ScaleResult {
  const source = f.scale.kind;
  if (source === "none" || !f.scale.evidence?.length) return { ok: false, source, reasons: ["no_metric_scale"] };
  const d = torsoDepth(f);
  if (d === null) return { ok: false, source, reasons: ["no_side_depth"] };
  const reasons: string[] = [];
  const heights: Array<{ view: string; heightM: number; rel: number }> = [];
  for (const e of f.scale.evidence) {
    if (e.view === "side") continue; // its visible surface is the arm/flank, not the torso front
    const h = viewHeight(e, d, silhouettePx(viewOf(f, e.view)), source);
    if (h.ok) heights.push({ view: e.view, heightM: h.heightM, rel: h.rel });
    else reasons.push(...h.reasons.map((r) => `${e.view}:${r}`));
  }
  if (!heights.length) return { ok: false, source, reasons: reasons.length ? reasons : ["no_usable_depth"] };
  if (heights.length >= 2) {
    const [a, b] = heights;
    const m = (a.heightM + b.heightM) / 2;
    if (Math.abs(a.heightM - b.heightM) > VIEW_AGREEMENT_MAX_REL * m) {
      return { ok: false, source, reasons: [...reasons, "front_back_height_disagree"] };
    }
  }
  return {
    ok: true, source,
    heightM: mean(heights.map((h) => h.heightM)),
    rel: Math.min(...heights.map((h) => h.rel)),
    views: heights.map((h) => h.view),
    reasons,
  };
}

// ─── Building measurements ────────────────────────────────────────────────────

const PLAUSIBLE: Record<string, [number, number]> = {
  height: [100, 250],
  shoulderWidth: [25, 70], chestWidth: [20, 65], waistWidth: [15, 70], hipWidth: [20, 75],
  chestDepth: [12, 50], waistDepth: [10, 60], hipDepth: [12, 55],
  upperArmWidth: [5, 25], thighWidth: [8, 40], calfWidth: [6, 25],
  torsoLength: [30, 90], legLength: [50, 130],
  chestCircumference: [60, 180], waistCircumference: [45, 200], hipCircumference: [60, 200],
  thighCircumference: [30, 110], calfCircumference: [20, 70],
  trunkLegVolume: [20, 250],
};

/** Front width ÷ side depth a real cross-section can have. */
const WIDTH_TO_DEPTH: Record<string, [number, number]> = {
  chest: [1.05, 2.3], waist: [0.9, 2.2], hip: [1.05, 2.2], thigh: [0.7, 1.5], calf: [0.7, 1.5],
};

function unavailable(name: string, kind: MeasurementKind, unit: Measurement["unit"], method: string, reasons: string[]): Measurement {
  return { name, kind, status: "unavailable", unit, confidence: 0, method, reasons };
}

function metric(name: string, kind: MeasurementKind, unit: "cm" | "L", method: string, value: number, rel: number,
  threshold: number, quality: number, reasons: string[]): Measurement {
  const [lo, hi] = PLAUSIBLE[name] ?? [0, Infinity];
  if (!(value >= lo && value <= hi)) return unavailable(name, kind, unit, method, [...reasons, "implausible_value"]);
  const half = 2 * rel;
  const why = [...reasons];
  let status: MeasurementStatus = "available";
  if (half > threshold) { status = "low_confidence"; why.push("uncertainty_too_high"); }
  if (quality < MIN_CAPTURE_QUALITY) { status = "low_confidence"; why.push("capture_quality_low"); }
  return {
    name, kind, status, unit, method, reasons: why,
    value: round(value), uncertainty: round(half * value),
    confidence: round((threshold / (threshold + half)) * clamp01(quality), 3),
  };
}

function ratio(name: string, method: string, value: number | undefined, quality: number): Measurement {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return unavailable(name, "ratio", "ratio", method, ["missing_view_data"]);
  return { name, kind: "ratio", status: "available", unit: "ratio", value: round(value, 3), confidence: round(clamp01(quality), 3), method, reasons: ["scale_free"] };
}

/** A scale-free ratio with a ±95 % range (relative 1σ `rel`), judged like a
 * circumference: its uncertainty comes from the same outline and shape terms. */
function ratioWithRange(name: string, method: string, value: number | undefined, rel: number, quality: number): Measurement {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return unavailable(name, "ratio", "ratio", method, ["missing_view_data"]);
  const half = 2 * rel, threshold = AVAILABLE_MAX_REL.circumference;
  const why = ["scale_free"];
  let status: MeasurementStatus = "available";
  if (half > threshold) { status = "low_confidence"; why.push("uncertainty_too_high"); }
  if (quality < MIN_CAPTURE_QUALITY) { status = "low_confidence"; why.push("capture_quality_low"); }
  return {
    name, kind: "ratio", status, unit: "ratio", method, reasons: why, value: round(value, 3), uncertainty: round(half * value, 3),
    confidence: round((threshold / (threshold + half)) * clamp01(quality), 3),
  };
}

/** A posture angle (degrees) straight from the keypoints: no scale, no range model. */
function angle(name: string, value: number | undefined, quality: number): Measurement {
  if (value === undefined || !Number.isFinite(value)) return unavailable(name, "angle", "deg", "keypoint_line_angle", ["missing_view_data"]);
  return { name, kind: "angle", status: "available", unit: "deg", value: round(value, 1), confidence: round(clamp01(quality), 3), method: "keypoint_line_angle", reasons: ["scale_free"] };
}

/** Mean of the named widths that are present. */
function widthOf(v: FeatureView | undefined, keys: string[]): number | undefined {
  const xs = keys.map((k) => v?.widths[k]).filter((x): x is number => typeof x === "number" && x > 0);
  return xs.length ? mean(xs) : undefined;
}

const edgeRel = (norm: number, px: number | null) => (px ? (PRIORS.edgePx * Math.SQRT2) / (norm * px) : 1);

/** Everything Phase 5C derives from one feature set. `profileHeightCm` is the
 * height on the user's profile AT SCAN TIME (the scan's own snapshot), so the
 * result never changes when the profile does. */
export function computeMeasurements(f: FeatureSet, profileHeightCm?: number | null): MeasurementSet {
  const scale = scaleFor(f);
  const quality = f.quality.overallScore;
  const front = viewOf(f, "front") ?? viewOf(f, "back");
  const side = viewOf(f, "side");
  const frontPx = silhouettePx(front), sidePx = silhouettePx(side);
  const noScale = scale.ok ? [] : ["no_metric_scale", ...scale.reasons];
  const out: Measurement[] = [];

  // Height
  const HEIGHT = "depth_plane_midline";
  if (scale.ok) out.push(metric("height", "length", "cm", HEIGHT, scale.heightM * 100, scale.rel, AVAILABLE_MAX_REL.height, quality, []));
  else out.push(unavailable("height", "length", "cm", HEIGHT, noScale));

  // Widths (front/back) and depths (side): scale-free value × height
  const LEN = "silhouette_width_x_height";
  const lengths: Array<[string, FeatureView | undefined, string[], number | null]> = [
    ["shoulderWidth", front, ["shoulder"], frontPx], ["chestWidth", front, ["chest"], frontPx],
    ["waistWidth", front, ["waist"], frontPx], ["hipWidth", front, ["hip"], frontPx],
    ["chestDepth", side, ["chestDepth"], sidePx], ["waistDepth", side, ["waistDepth"], sidePx], ["hipDepth", side, ["hipDepth"], sidePx],
    ["upperArmWidth", front, ["upperArmLeft", "upperArmRight"], frontPx],
    ["thighWidth", front, ["thighLeft", "thighRight"], frontPx], ["calfWidth", front, ["calfLeft", "calfRight"], frontPx],
    // m2: side-view leg depths (5c.1 features).
    ["thighDepth", side, ["thighDepth"], sidePx], ["calfDepth", side, ["calfDepth"], sidePx],
  ];
  for (const [name, v, keys, px] of lengths) {
    const norm = widthOf(v, keys);
    if (!scale.ok) out.push(unavailable(name, "length", "cm", LEN, noScale));
    else if (norm === undefined) out.push(unavailable(name, "length", "cm", LEN, ["missing_view_data"]));
    else out.push(metric(name, "length", "cm", LEN, norm * scale.heightM * 100, Math.hypot(scale.rel, edgeRel(norm, px)), AVAILABLE_MAX_REL.length, quality, []));
  }
  // Keypoint lengths
  const KP = "keypoint_ratio_x_height";
  for (const [name, key] of [["torsoLength", "torsoToHeight"], ["legLength", "legToHeight"]] as const) {
    const r = front?.ratios[key];
    if (!scale.ok) out.push(unavailable(name, "length", "cm", KP, noScale));
    else if (!r) out.push(unavailable(name, "length", "cm", KP, ["missing_view_data"]));
    else out.push(metric(name, "length", "cm", KP, r * scale.heightM * 100, Math.hypot(scale.rel, PRIORS.keypointLength), AVAILABLE_MAX_REL.length, quality, []));
  }

  // Circumferences: front width + side depth → an elliptical cross-section.
  const CIRC = "front_side_ellipse";
  const girths: Array<[string, string, string[], string[]]> = [
    ["chestCircumference", "chest", ["chest"], ["chestDepth"]],
    ["waistCircumference", "waist", ["waist"], ["waistDepth"]],
    ["hipCircumference", "hip", ["hip"], ["hipDepth"]],
    ["thighCircumference", "thigh", ["thighLeft", "thighRight"], ["thighDepth"]],
    ["calfCircumference", "calf", ["calfLeft", "calfRight"], ["calfDepth"]],
  ];
  let waistGirthNorm: number | undefined;
  let waistShapeRel: number | undefined;
  for (const [name, part, wKeys, dKeys] of girths) {
    const w = widthOf(front, wKeys), d = widthOf(side, dKeys);
    if (w === undefined || d === undefined) {
      const why = [...(scale.ok ? [] : noScale), "missing_view_data"];
      if (front?.issues.includes("legs_touching") && (part === "thigh" || part === "calf")) why.push("legs_touching");
      out.push(unavailable(name, "circumference", "cm", CIRC, why));
      continue;
    }
    const [lo, hi] = WIDTH_TO_DEPTH[part];
    if (w / d < lo || w / d > hi) { out.push(unavailable(name, "circumference", "cm", CIRC, ["inconsistent_front_side"])); continue; }
    const norm = ellipsePerimeter(w / 2, d / 2);
    const shape = (edgeRel(w, frontPx) * w + edgeRel(d, sidePx) * d) / (w + d);
    if (part === "waist") { waistGirthNorm = norm; waistShapeRel = Math.hypot(shape, PRIORS.ellipseModel); }
    if (!scale.ok) { out.push(unavailable(name, "circumference", "cm", CIRC, noScale)); continue; }
    out.push(metric(name, "circumference", "cm", CIRC, norm * scale.heightM * 100,
      Math.sqrt(scale.rel ** 2 + shape ** 2 + PRIORS.ellipseModel ** 2), AVAILABLE_MAX_REL.circumference, quality, []));
  }
  out.push(unavailable("upperArmCircumference", "circumference", "cm", CIRC, ["no_side_depth_for_arm"]));

  // Volume: stacked ellipses, trunk + legs (arms excluded).
  const VOL = "stacked_ellipse_trunk_legs";
  const fp = front?.profile, sp = side?.profile;
  let volumeIndex: number | undefined;
  if (fp && sp && fp.length === sp.length) {
    let sum = 0;
    for (let i = 0; i < fp.length; i++) if (fp[i] > 0 && sp[i] > 0) sum += (Math.PI / 4) * fp[i] * sp[i];
    volumeIndex = sum / fp.length;
  }
  if (volumeIndex === undefined || volumeIndex <= 0) out.push(unavailable("trunkLegVolume", "volume", "L", VOL, ["missing_view_data"]));
  else if (!scale.ok) out.push(unavailable("trunkLegVolume", "volume", "L", VOL, noScale));
  else out.push(metric("trunkLegVolume", "volume", "L", VOL, volumeIndex * scale.heightM ** 3 * 1000,
    Math.hypot(3 * scale.rel, PRIORS.volumeModel), AVAILABLE_MAX_REL.volume, quality, []));

  // The scanner never estimates weight; BMI from the user's RECORDED height and
  // weight belongs to the composition layer (convex/bodyScan/composition.ts).
  out.push(unavailable("weight", "mass", "kg", "none", ["not_estimated_from_images"]));
  out.push(unavailable("bmi", "index", "kg/m2", "none", ["scanner_does_not_estimate_weight"]));

  // Scale-free proportions (need no metric scale).
  const RATIO = "scale_free_ratio";
  out.push(ratio("waistToHip", RATIO, front?.ratios.waistToHip, quality));
  out.push(ratio("shoulderToWaist", RATIO, front?.ratios.shoulderToWaist, quality));
  out.push(ratioWithRange("waistToHeight", "front_side_ellipse_over_height", waistGirthNorm, waistShapeRel ?? 1, quality));
  out.push(ratio("volumeIndex", "stacked_ellipse_over_height_cubed", volumeIndex, quality));
  // m2: silhouette area, symmetry, posture (scale-free; engineering inputs, not shown).
  out.push(ratio("silhouetteAreaIndex", "silhouette_area_over_height_squared", front?.silhouette?.areaPerHeight2, quality));
  out.push(ratio("armSymmetry", "keypoint_limb_length_difference", front?.ratios.armSymmetry === 0 ? undefined : front?.ratios.armSymmetry, quality));
  out.push(ratio("legSymmetry", "keypoint_limb_length_difference", front?.ratios.legSymmetry === 0 ? undefined : front?.ratios.legSymmetry, quality));
  out.push(angle("shoulderTilt", front?.ratios.shoulderTiltDeg, quality));
  out.push(angle("hipTilt", front?.ratios.hipTiltDeg, quality));

  // The scan's height vs the profile height at scan time — never overwritten.
  let profileComparison: MeasurementSet["profileComparison"];
  if (typeof profileHeightCm === "number" && profileHeightCm > 0) {
    const h = out[0];
    if (h.status === "available" && h.value !== undefined) {
      const diff = round(h.value - profileHeightCm);
      profileComparison = { profileHeightCm, scannerHeightCm: h.value, differenceCm: diff, differs: Math.abs(diff) > Math.max(3, h.uncertainty ?? 0) };
    } else {
      profileComparison = { profileHeightCm, differs: false };
    }
  }

  return {
    methodVersion: MEASUREMENT_METHOD_VERSION,
    cvVersion: f.cvVersion,
    scale: { source: f.scale.kind, ok: scale.ok, views: scale.ok ? scale.views : [], reasons: scale.reasons },
    measurements: out,
    ...(profileComparison ? { profileComparison } : {}),
    validated: false,
  };
}

// ─── Change detection (foundation for 5F) ─────────────────────────────────────

export type ChangeState = "no_meaningful_change" | "possible_change" | "meaningful_change";
export type MeasurementChange = {
  name: string; unit: string; a: number; b: number; delta: number;
  /** Combined ±95 % range of the two results: √(uA² + uB²). */
  noise: number;
  /** Minimum detectable change (5D) for this measurement, if known. */
  mdc: number | null;
  exceedsNoise: boolean;
  state: ChangeState;
};

/** Scan A → scan B on measurements both have as "available" (with a range).
 *   |Δ| ≤ combined range                          → no_meaningful_change
 *   |Δ| > range, MDC validated and |Δ| > MDC      → meaningful_change
 *   |Δ| > range, MDC validated and |Δ| ≤ MDC      → no_meaningful_change
 *   |Δ| > range, no validated MDC                 → possible_change
 * "Meaningful" therefore needs a validated MDC (5D repeatability study); until
 * one exists nothing is ever called meaningful. Scans that don't align (align.1)
 * or differ in method / scale source aren't compared at all. Unvalidated. */
export function compareMeasurements(
  a: Pick<MeasurementSet, "methodVersion" | "measurements" | "scale">,
  b: Pick<MeasurementSet, "methodVersion" | "measurements" | "scale">,
  opts: { mdc?: Record<string, number>; mdcValidated?: boolean; alignment?: { comparable: boolean; reasons: string[] } } = {},
): { comparable: false; reasons: string[] } | { comparable: true; validated: false; changes: MeasurementChange[] } {
  const reasons: string[] = [];
  if (a.methodVersion !== b.methodVersion) reasons.push("method_version_differs");
  if (a.scale.source !== b.scale.source) reasons.push("scale_source_differs");
  if (opts.alignment && !opts.alignment.comparable) reasons.push(...opts.alignment.reasons.map((r) => `alignment:${r}`));
  if (reasons.length) return { comparable: false, reasons };
  const changes: MeasurementChange[] = [];
  for (const ma of a.measurements) {
    const mb = b.measurements.find((m) => m.name === ma.name);
    if (!mb || ma.status !== "available" || mb.status !== "available" || ma.unit !== mb.unit) continue;
    if (ma.value === undefined || mb.value === undefined || ma.uncertainty === undefined || mb.uncertainty === undefined) continue;
    const digits = ma.unit === "ratio" ? 3 : 1;
    const delta = round(mb.value - ma.value, digits);
    const noise = round(Math.hypot(ma.uncertainty, mb.uncertainty), digits);
    const mdc = opts.mdc?.[ma.name] ?? null;
    const size = Math.abs(delta);
    const state: ChangeState = size <= noise
      ? "no_meaningful_change"
      : opts.mdcValidated && mdc !== null
        ? (size > mdc ? "meaningful_change" : "no_meaningful_change")
        : "possible_change";
    changes.push({ name: ma.name, unit: ma.unit, a: ma.value, b: mb.value, delta, noise, mdc, exceedsNoise: size > Math.max(noise, mdc ?? 0), state });
  }
  return { comparable: true, validated: false, changes };
}
