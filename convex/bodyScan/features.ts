// Sombrey Body Scan — Phase 5B: computer-vision feature records.
//
// The phone runs Apple Vision (person segmentation + body pose) on each
// captured view and derives SCALE-FREE shape features: silhouette widths and
// depths divided by the body's own height in the image, limb/trunk
// proportions, normalised keypoints, and an internal quality object. Only
// these structured numbers reach the backend — never the image.
//
// These are engineering values for a future, validated body-composition
// model. None of them is a measurement of the person, none is shown to the
// user, and none may be converted to cm/kg unless `scale.kind` says real
// metric scale was captured.
//
// Pure — no I/O — tested in tests/bodyScan/features.test.ts.

import { VIEWS, type View } from "./rules.ts";

/** On-device feature pipelines the server accepts (the app sends its own).
 * 5c.1 adds side-view thigh/calf depths, height profiles and, where the
 * phone measured depth, per-view scale evidence. */
export const CV_VERSIONS = ["5b.1", "5c.1"] as const;
export type CvVersion = (typeof CV_VERSIONS)[number];

/** Samples in a 5c.1 view profile, top of the head → soles, evenly spaced
 * over the silhouette height. */
export const PROFILE_SAMPLES = 40;

/** Keypoint names the pipeline emits (Apple Vision body pose, 2D). */
export const KEYPOINTS = [
  "nose", "leftEye", "rightEye", "leftEar", "rightEar", "neck",
  "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist",
  "root", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle",
] as const;

/** Where metric scale came from. `none`: a plain photo — no metric values
 * exist. `truedepth`: the front TrueDepth camera's absolute depth map
 * (Phase 5C). `lidar` / `arkit_metric`: reserved for rear-camera capture
 * (not built; see docs/BODY_SCAN_5C.md). */
export const SCALE_KINDS = ["none", "truedepth", "lidar", "arkit_metric"] as const;
export type ScaleKind = (typeof SCALE_KINDS)[number];

/** What the phone measured about one view's metric scale. The depth map
 * itself never leaves the phone — only these numbers. */
export type ScaleEvidence = {
  view: string;
  depthWidth: number;
  depthHeight: number;
  /** Focal length in depth-map pixels. */
  focalPx: number;
  intrinsics: "calibration" | "field_of_view";
  accuracy: "absolute" | "relative";
  filtered: boolean;
  /** Torso depth samples used / the fraction of the torso that had depth. */
  samples: number;
  validFraction: number;
  /** Torso front (or back) surface: distance along its normal, tilt from the
   * camera axis, and RMS distance of the samples from the fitted plane. */
  distanceM: number;
  planeTiltDeg: number;
  residualM: number;
  /** Silhouette top → bottom, projected onto that surface plane. */
  surfaceHeightM: number;
};

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const unit = (n: unknown) => finite(n) && n >= 0 && n <= 1;

export type FeatureView = {
  view: string;
  imageWidth: number;
  imageHeight: number;
  processingMs: number;
  keypoints: Array<{ name: string; x: number; y: number; confidence: number }>;
  silhouette?: {
    maskWidth: number; maskHeight: number; top: number; bottom: number; left: number; right: number;
    heightFraction: number; areaPerHeight2: number; mainComponentFraction: number; keypointAgreement: number;
  };
  widths: Record<string, number>;
  ratios: Record<string, number>;
  quality: Record<string, number>;
  issues: string[];
  /** 5c.1: the body's width (front/back) or depth (side) at PROFILE_SAMPLES
   * heights, ÷ silhouette height; 0 where there's no body. */
  profile?: number[];
};

export type FeatureSet = {
  cvVersion: string;
  processedAt: number;
  processing: { deviceModel: string; osVersion: string; appVersion: string; components: string[] };
  scale: { kind: string; metersPerUnit?: number; evidence?: ScaleEvidence[] };
  views: FeatureView[];
  multiView: { ratios: Record<string, number>; consistency: Record<string, number> };
  quality: { overallScore: number; framing: number; pose: number; lighting: number; segmentation: number; motion: number; multiViewConsistency: number };
};

function validRecord(r: unknown, max: number, check: (v: number) => boolean): boolean {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const entries = Object.entries(r as Record<string, unknown>);
  if (entries.length > max) return false;
  return entries.every(([k, v]) => KEY.test(k) && finite(v) && check(v));
}

/** Everything the server checks before storing a feature set. Returns the
 * first problem, or null. Bounds are deliberately tight: these rows are
 * engineering data, and junk (or free text) must never get in. */
export function validateFeatureSet(f: FeatureSet, now: number): string | null {
  if (!(CV_VERSIONS as readonly string[]).includes(f.cvVersion)) return "Unknown CV version";
  if (!finite(f.processedAt) || f.processedAt > now + 60_000 || f.processedAt < now - 7 * 86_400_000) return "Invalid processing time";
  const p = f.processing;
  for (const s of [p?.deviceModel, p?.osVersion, p?.appVersion]) if (typeof s !== "string" || !s || s.length > 40) return "Invalid processing info";
  if (!Array.isArray(p.components) || p.components.length > 12 || p.components.some((c) => typeof c !== "string" || !/^[a-z0-9.]{1,60}$/i.test(c))) return "Invalid components";
  if (!(SCALE_KINDS as readonly string[]).includes(f.scale?.kind)) return "Invalid scale";
  // Metric scale is never asserted directly: it's derived on the server from
  // the phone's evidence, and only when a real scale source produced it.
  if (f.scale.metersPerUnit !== undefined) return "Metric scale is derived from evidence, never sent";
  const evidence = f.scale.evidence;
  if (f.scale.kind === "none") {
    if (evidence !== undefined) return "No metric scale without a scale source";
  } else {
    if (f.cvVersion === "5b.1") return "Scale evidence needs CV version 5c.1";
    const problem = validateEvidence(evidence);
    if (problem) return problem;
  }
  if (!Array.isArray(f.views) || f.views.length === 0 || f.views.length > VIEWS.length) return "Invalid views";
  const seen = new Set<string>();
  for (const v of f.views) {
    if (!(VIEWS as readonly string[]).includes(v.view) || seen.has(v.view)) return "Invalid view";
    seen.add(v.view);
    for (const n of [v.imageWidth, v.imageHeight]) if (!Number.isInteger(n) || n < 64 || n > 8192) return "Invalid image size";
    if (!finite(v.processingMs) || v.processingMs < 0 || v.processingMs > 120_000) return "Invalid processing time";
    if (!Array.isArray(v.keypoints) || v.keypoints.length > KEYPOINTS.length) return "Invalid keypoints";
    const names = new Set<string>();
    for (const k of v.keypoints) {
      if (!(KEYPOINTS as readonly string[]).includes(k.name) || names.has(k.name)) return "Invalid keypoint";
      names.add(k.name);
      if (!finite(k.x) || !finite(k.y) || k.x < -0.5 || k.x > 1.5 || k.y < -0.5 || k.y > 1.5 || !unit(k.confidence)) return "Invalid keypoint";
    }
    if (v.silhouette) {
      const s = v.silhouette;
      for (const n of [s.maskWidth, s.maskHeight]) if (!Number.isInteger(n) || n < 16 || n > 4096) return "Invalid silhouette";
      for (const n of [s.top, s.bottom, s.left, s.right, s.heightFraction, s.mainComponentFraction, s.keypointAgreement]) if (!unit(n)) return "Invalid silhouette";
      if (!finite(s.areaPerHeight2) || s.areaPerHeight2 < 0 || s.areaPerHeight2 > 2) return "Invalid silhouette";
      if (s.bottom < s.top || s.right < s.left) return "Invalid silhouette";
    }
    if (!validRecord(v.widths, 40, (x) => x >= 0 && x <= 2)) return "Invalid widths";
    if (!validRecord(v.ratios, 40, (x) => Math.abs(x) <= 100)) return "Invalid ratios";
    if (!validRecord(v.quality, 20, (x) => x >= 0 && x <= 1)) return "Invalid quality";
    if (!Array.isArray(v.issues) || v.issues.length > 20 || v.issues.some((i) => typeof i !== "string" || !/^[a-z_]{1,40}$/.test(i))) return "Invalid issues";
    if (v.profile !== undefined) {
      if (f.cvVersion === "5b.1") return "Profiles need CV version 5c.1";
      if (!Array.isArray(v.profile) || v.profile.length !== PROFILE_SAMPLES || v.profile.some((x) => !finite(x) || x < 0 || x > 2)) return "Invalid profile";
    }
  }
  if (!validRecord(f.multiView?.ratios, 40, (x) => Math.abs(x) <= 100)) return "Invalid multi-view ratios";
  if (!validRecord(f.multiView?.consistency, 20, (x) => x >= 0 && x <= 1)) return "Invalid multi-view consistency";
  const q = f.quality;
  for (const n of [q?.overallScore, q?.framing, q?.pose, q?.lighting, q?.segmentation, q?.motion, q?.multiViewConsistency]) if (!unit(n)) return "Invalid quality";
  return null;
}

function validateEvidence(evidence: ScaleEvidence[] | undefined): string | null {
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > VIEWS.length) return "Scale evidence required for a metric scale source";
  const seen = new Set<string>();
  for (const e of evidence) {
    if (!(VIEWS as readonly string[]).includes(e.view) || seen.has(e.view)) return "Invalid scale evidence";
    seen.add(e.view);
    for (const n of [e.depthWidth, e.depthHeight]) if (!Number.isInteger(n) || n < 16 || n > 4096) return "Invalid scale evidence";
    if (!finite(e.focalPx) || e.focalPx <= 0 || e.focalPx > 20_000) return "Invalid scale evidence";
    if (e.intrinsics !== "calibration" && e.intrinsics !== "field_of_view") return "Invalid scale evidence";
    if (e.accuracy !== "absolute" && e.accuracy !== "relative") return "Invalid scale evidence";
    if (typeof e.filtered !== "boolean") return "Invalid scale evidence";
    if (!Number.isInteger(e.samples) || e.samples < 0 || e.samples > 1_000_000 || !unit(e.validFraction)) return "Invalid scale evidence";
    if (!finite(e.distanceM) || e.distanceM <= 0 || e.distanceM > 10) return "Invalid scale evidence";
    if (!finite(e.planeTiltDeg) || e.planeTiltDeg < 0 || e.planeTiltDeg > 90) return "Invalid scale evidence";
    if (!finite(e.residualM) || e.residualM < 0 || e.residualM > 1) return "Invalid scale evidence";
    if (!finite(e.surfaceHeightM) || e.surfaceHeightM <= 0 || e.surfaceHeightM > 4) return "Invalid scale evidence";
  }
  return null;
}

// ─── Scan-to-scan comparison (foundation) ─────────────────────────────────────

export type FeatureDelta = { a: number; b: number; delta: number; relative: number };

export type Comparison =
  | { comparable: false; reasons: string[] }
  | {
      comparable: true;
      /** Always false until a repeatability study defines, per feature, the
       * variation expected from capture alone. Until then no difference
       * may be presented as a real change. */
      validated: false;
      views: Partial<Record<View, Record<string, FeatureDelta>>>;
      multiView: Record<string, FeatureDelta>;
    };

type Comparable = Pick<FeatureSet, "cvVersion" | "scale" | "views" | "multiView"> & { protocolVersion: string };

function deltas(a: Record<string, number>, b: Record<string, number>): Record<string, FeatureDelta> {
  const out: Record<string, FeatureDelta> = {};
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue;
    const d = b[k] - a[k];
    out[k] = { a: a[k], b: b[k], delta: d, relative: a[k] !== 0 ? d / Math.abs(a[k]) : 0 };
  }
  return out;
}

/** Scan A → scan B on the features both have. Only like-for-like data is
 * compared: the same CV version, capture protocol and scale kind — a scan
 * processed by a newer pipeline is never compared with an older one's
 * numbers. The result is raw, unvalidated deltas for internal use. */
export function compareFeatureSets(a: Comparable, b: Comparable): Comparison {
  const reasons: string[] = [];
  if (a.cvVersion !== b.cvVersion) reasons.push("cv_version_differs");
  if (a.protocolVersion !== b.protocolVersion) reasons.push("protocol_differs");
  if (a.scale.kind !== b.scale.kind) reasons.push("scale_differs");
  if (reasons.length) return { comparable: false, reasons };
  const views: Partial<Record<View, Record<string, FeatureDelta>>> = {};
  for (const va of a.views) {
    const vb = b.views.find((v) => v.view === va.view);
    if (!vb) continue;
    views[va.view as View] = { ...deltas(va.widths, vb.widths), ...deltas(va.ratios, vb.ratios) };
  }
  return { comparable: true, validated: false, views, multiView: deltas(a.multiView.ratios, b.multiView.ratios) };
}

// ─── Abandoned scans ──────────────────────────────────────────────────────────

/** An unfinished scan older than this is removed (with its images). */
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
export const isAbandoned = (scan: { status: string; createdAt: number }, now: number) =>
  scan.status === "capturing" && now - scan.createdAt > ABANDONED_AFTER_MS;

// ─── Scan-to-scan alignment (Phase 5D, method align.1) ─────────────────────────
//
// Features are already normalised for camera distance and crop (every width
// is ÷ the body's own image height). What alignment adds is a check that two
// scans were captured comparably — the same depth source and protocol, a
// similar distance and phone tilt, and a similar pose — before any difference
// between them is interpreted. It never changes stored data; limits are
// provisional until the 5D repeatability data calibrates them.

export const ALIGNMENT_METHOD = "align.1";
export const ALIGNMENT_LIMITS = {
  /** Nose-to-ankle span of the frame (distance proxy). */
  bodySpan: 0.1,
  /** Phone forward/back tilt, degrees (perspective changes widths). */
  pitchDeg: 8,
  /** Shoulder / hip line tilt, degrees (lean, weight shift). */
  tiltDeg: 4,
  /** Arm length ÷ torso length (arms-in vs A-pose changes the outline). */
  armToTorso: 0.15,
  /** Silhouette height ÷ image height (a second distance proxy). */
  heightFraction: 0.1,
} as const;

export type AlignmentView = {
  view: string;
  bodySpan?: number;
  pitchDegrees?: number;
  heightFraction?: number;
  ratios: Record<string, number>;
};
export type AlignmentInput = { depthSource: string; protocolVersion: string; views: AlignmentView[] };
export type Alignment = { method: string; comparable: boolean; reasons: string[]; deltas: Record<string, Record<string, number>> };

export function alignScans(a: AlignmentInput, b: AlignmentInput): Alignment {
  const reasons: string[] = [];
  const deltas: Record<string, Record<string, number>> = {};
  if (a.depthSource !== b.depthSource) reasons.push("depth_source_differs");
  if (a.protocolVersion !== b.protocolVersion) reasons.push("protocol_differs");
  for (const va of a.views) {
    const vb = b.views.find((v) => v.view === va.view);
    if (!vb) { reasons.push(`${va.view}:missing`); continue; }
    const d: Record<string, number> = {};
    const diff = (x?: number, y?: number) => (typeof x === "number" && typeof y === "number" ? Math.round((y - x) * 1000) / 1000 : undefined);
    const span = diff(va.bodySpan, vb.bodySpan), pitch = diff(va.pitchDegrees, vb.pitchDegrees), hf = diff(va.heightFraction, vb.heightFraction);
    if (span !== undefined) d.bodySpan = span;
    if (pitch !== undefined) d.pitchDegrees = pitch;
    if (hf !== undefined) d.heightFraction = hf;
    for (const k of ["shoulderTiltDeg", "hipTiltDeg", "armToTorso"]) { const x = diff(va.ratios[k], vb.ratios[k]); if (x !== undefined) d[k] = x; }
    if (Math.abs(span ?? 0) > ALIGNMENT_LIMITS.bodySpan || Math.abs(hf ?? 0) > ALIGNMENT_LIMITS.heightFraction) reasons.push(`${va.view}:distance_differs`);
    if (Math.abs(pitch ?? 0) > ALIGNMENT_LIMITS.pitchDeg) reasons.push(`${va.view}:tilt_differs`);
    if (Math.abs(d.shoulderTiltDeg ?? 0) > ALIGNMENT_LIMITS.tiltDeg || Math.abs(d.hipTiltDeg ?? 0) > ALIGNMENT_LIMITS.tiltDeg || Math.abs(d.armToTorso ?? 0) > ALIGNMENT_LIMITS.armToTorso) {
      reasons.push(`${va.view}:pose_differs`);
    }
    deltas[va.view] = d;
  }
  return { method: ALIGNMENT_METHOD, comparable: reasons.length === 0, reasons, deltas };
}
