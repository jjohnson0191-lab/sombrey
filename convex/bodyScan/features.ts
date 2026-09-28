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

/** Current on-device feature pipeline (the app sends it; the server only
 * accepts known versions). */
export const CV_VERSIONS = ["5b.1"] as const;
export type CvVersion = (typeof CV_VERSIONS)[number];

/** Keypoint names the pipeline emits (Apple Vision body pose, 2D). */
export const KEYPOINTS = [
  "nose", "leftEye", "rightEye", "leftEar", "rightEar", "neck",
  "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist",
  "root", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle",
] as const;

export const SCALE_KINDS = ["none", "lidar", "arkit"] as const;

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
};

export type FeatureSet = {
  cvVersion: string;
  processedAt: number;
  processing: { deviceModel: string; osVersion: string; appVersion: string; components: string[] };
  scale: { kind: string; metersPerUnit?: number };
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
  if (f.scale.kind === "none" && f.scale.metersPerUnit !== undefined) return "No metric scale without a scale source";
  if (f.scale.metersPerUnit !== undefined && (!finite(f.scale.metersPerUnit) || f.scale.metersPerUnit <= 0 || f.scale.metersPerUnit > 100)) return "Invalid scale";
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
  }
  if (!validRecord(f.multiView?.ratios, 40, (x) => Math.abs(x) <= 100)) return "Invalid multi-view ratios";
  if (!validRecord(f.multiView?.consistency, 20, (x) => x >= 0 && x <= 1)) return "Invalid multi-view consistency";
  const q = f.quality;
  for (const n of [q?.overallScore, q?.framing, q?.pose, q?.lighting, q?.segmentation, q?.motion, q?.multiViewConsistency]) if (!unit(n)) return "Invalid quality";
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
