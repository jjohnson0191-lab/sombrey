// Sombrey Body Scan, Phase 5B — CV feature records (convex/bodyScan/features.ts) and 5A.2 capture conditions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABANDONED_AFTER_MS, CV_VERSIONS, PROFILE_SAMPLES, compareFeatureSets, isAbandoned, validateFeatureSet,
  type FeatureSet, type FeatureView, type ScaleEvidence,
} from "../../convex/bodyScan/features.ts";
import { PROTOCOL_VERSION, validateConditions } from "../../convex/bodyScan/rules.ts";

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0);

const view = (v: string, over: Partial<FeatureView> = {}): FeatureView => ({
  view: v, imageWidth: 1536, imageHeight: 2048, processingMs: 180,
  keypoints: [{ name: "leftShoulder", x: 0.4, y: 0.22, confidence: 0.9 }, { name: "rightShoulder", x: 0.6, y: 0.22, confidence: 0.9 }],
  silhouette: { maskWidth: 384, maskHeight: 512, top: 0.05, bottom: 0.95, left: 0.3, right: 0.7, heightFraction: 0.9, areaPerHeight2: 0.11, mainComponentFraction: 0.97, keypointAgreement: 1 },
  widths: { shoulder: 0.25, waist: 0.16, hip: 0.19 },
  ratios: { waistToHip: 0.84, torsoToLeg: 0.72 },
  quality: { framing: 1, segmentation: 0.97 },
  issues: [],
  ...over,
});

const set = (over: Partial<FeatureSet> = {}): FeatureSet => ({
  cvVersion: "5b.1",
  processedAt: NOW - 5_000,
  processing: { deviceModel: "iPhone16,1", osVersion: "iOS 26.0", appVersion: "1.0 (49)", components: ["vision.personSegmentation.accurate", "vision.bodyPose2D"] },
  scale: { kind: "none" },
  views: [view("front"), view("side", { widths: { waistDepth: 0.13 } }), view("back")],
  multiView: { ratios: { waistWidthToDepth: 1.23 }, consistency: { heightAgreement: 0.98 } },
  quality: { overallScore: 0.93, framing: 1, pose: 0.9, lighting: 0.95, segmentation: 0.97, motion: 1, multiViewConsistency: 0.98 },
  ...over,
});

test("a well-formed feature set is accepted", () => {
  assert.equal(validateFeatureSet(set(), NOW), null);
  assert.ok(CV_VERSIONS.includes("5b.1"));
});

test("versioning: only known CV versions are stored", () => {
  assert.ok(validateFeatureSet(set({ cvVersion: "9z.9" }), NOW));
  assert.ok(validateFeatureSet(set({ cvVersion: "" }), NOW));
});

test("scale: no metric factor without a real scale source", () => {
  assert.ok(validateFeatureSet(set({ scale: { kind: "none", metersPerUnit: 0.01 } }), NOW));
  assert.ok(validateFeatureSet(set({ scale: { kind: "guess" } }), NOW));
  assert.ok(validateFeatureSet(set({ scale: { kind: "lidar", metersPerUnit: 0.002 } }), NOW), "a scale factor is never accepted from the client (5C derives it from evidence)");
  assert.ok(validateFeatureSet(set({ scale: { kind: "truedepth" } }), NOW), "a metric source needs evidence");
});

// ─── 5c.1: profiles and scale evidence ───────────────────────────────────────

const evidence = (v: string, over: Partial<ScaleEvidence> = {}): ScaleEvidence => ({
  view: v, depthWidth: 480, depthHeight: 640, focalPx: 505, intrinsics: "calibration", accuracy: "absolute", filtered: false,
  samples: 1800, validFraction: 0.92, distanceM: 1.32, planeTiltDeg: 6, residualM: 0.012, surfaceHeightM: 1.62, ...over,
});
const profile = (x = 0.1) => Array.from({ length: PROFILE_SAMPLES }, () => x);
const set5c = (over: Partial<FeatureSet> = {}) => set({
  cvVersion: "5c.1",
  scale: { kind: "truedepth", evidence: [evidence("front"), evidence("back")] },
  views: [view("front", { profile: profile() }), view("side", { widths: { waistDepth: 0.13 }, profile: profile(0.08) }), view("back", { profile: profile() })],
  ...over,
});

test("5c.1: a TrueDepth feature set with evidence and profiles is accepted", () => {
  assert.ok(CV_VERSIONS.includes("5c.1"));
  assert.equal(validateFeatureSet(set5c(), NOW), null);
  assert.equal(validateFeatureSet(set5c({ scale: { kind: "none" } }), NOW), null, "5c.1 without depth (no TrueDepth) is still valid");
});

test("5c.1: scale evidence is bounded and never optional for a metric source", () => {
  const withEv = (e: ScaleEvidence) => set5c({ scale: { kind: "truedepth", evidence: [e] } });
  assert.ok(validateFeatureSet(set5c({ scale: { kind: "none", evidence: [evidence("front")] } }), NOW), "evidence without a source");
  assert.ok(validateFeatureSet(set5c({ scale: { kind: "truedepth", evidence: [] } }), NOW));
  assert.ok(validateFeatureSet(set5c({ scale: { kind: "truedepth", evidence: [evidence("front"), evidence("front")] } }), NOW), "duplicate view");
  assert.ok(validateFeatureSet(withEv(evidence("front", { distanceM: 0 })), NOW), "zero distance");
  assert.ok(validateFeatureSet(withEv(evidence("front", { distanceM: -1.2 })), NOW), "negative distance");
  assert.ok(validateFeatureSet(withEv(evidence("front", { distanceM: 40 })), NOW), "extreme distance");
  assert.ok(validateFeatureSet(withEv(evidence("front", { surfaceHeightM: 0 })), NOW), "zero height");
  assert.ok(validateFeatureSet(withEv(evidence("front", { surfaceHeightM: 9 })), NOW), "impossible height");
  assert.ok(validateFeatureSet(withEv(evidence("front", { focalPx: NaN })), NOW));
  assert.ok(validateFeatureSet(withEv(evidence("front", { validFraction: 1.5 })), NOW));
  assert.ok(validateFeatureSet(withEv(evidence("front", { accuracy: "guess" as "absolute" })), NOW));
  assert.ok(validateFeatureSet(set({ scale: { kind: "truedepth", evidence: [evidence("front")] } }), NOW), "5b.1 can't carry evidence");
});

test("5c.1: profiles have exactly PROFILE_SAMPLES bounded values", () => {
  assert.ok(validateFeatureSet(set5c({ views: [view("front", { profile: profile().slice(1) })] }), NOW));
  assert.ok(validateFeatureSet(set5c({ views: [view("front", { profile: profile(-0.1) })] }), NOW), "negative width");
  assert.ok(validateFeatureSet(set5c({ views: [view("front", { profile: profile(30) })] }), NOW), "a cm value, not a normalised one");
  assert.ok(validateFeatureSet(set({ views: [view("front", { profile: profile() })] }), NOW), "5b.1 has no profiles");
});

test("views: at most one of each protocol view", () => {
  assert.ok(validateFeatureSet(set({ views: [] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("front"), view("front")] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("top")] }), NOW));
  assert.equal(validateFeatureSet(set({ views: [view("front")] }), NOW), null, "a partial set (e.g. one view failed) is still valid");
});

test("keypoints: known names, normalised coordinates, no duplicates", () => {
  assert.ok(validateFeatureSet(set({ views: [view("front", { keypoints: [{ name: "tail", x: 0.5, y: 0.5, confidence: 1 }] })] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("front", { keypoints: [{ name: "nose", x: 1600, y: 200, confidence: 1 }] })] }), NOW), "pixels are not normalised");
  assert.ok(validateFeatureSet(set({ views: [view("front", { keypoints: [{ name: "nose", x: 0.5, y: 0.1, confidence: 1.4 }] })] }), NOW));
  const dup = [{ name: "nose", x: 0.5, y: 0.1, confidence: 1 }, { name: "nose", x: 0.5, y: 0.1, confidence: 1 }];
  assert.ok(validateFeatureSet(set({ views: [view("front", { keypoints: dup })] }), NOW));
});

test("feature maps: bounded keys and values; no free text, no NaN", () => {
  assert.ok(validateFeatureSet(set({ views: [view("front", { widths: { "waist width": 0.2 } })] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("front", { widths: { waist: NaN } })] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("front", { widths: { waist: 42 } })] }), NOW), "a width can't exceed twice the body height");
  assert.ok(validateFeatureSet(set({ views: [view("front", { quality: { pose: 1.2 } })] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("front", { issues: ["Feet cut off!"] })] }), NOW));
  const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, 0.1]));
  assert.ok(validateFeatureSet(set({ views: [view("front", { ratios: many })] }), NOW));
});

test("silhouette: bounds are consistent", () => {
  const s = view("front").silhouette!;
  assert.ok(validateFeatureSet(set({ views: [view("front", { silhouette: { ...s, top: 0.9, bottom: 0.1 } })] }), NOW));
  assert.ok(validateFeatureSet(set({ views: [view("front", { silhouette: { ...s, keypointAgreement: 1.5 } })] }), NOW));
  assert.equal(validateFeatureSet(set({ views: [view("front", { silhouette: undefined, issues: ["no_mask"] })] }), NOW), null);
});

test("overall quality: every component 0–1", () => {
  assert.ok(validateFeatureSet(set({ quality: { ...set().quality, overallScore: 93 } }), NOW));
  assert.ok(validateFeatureSet(set({ processedAt: NOW + 3_600_000 }), NOW));
});

test("capture conditions (5a.2): tilt, span, light and the gate configuration", () => {
  assert.equal(PROTOCOL_VERSION, "5a.2");
  const c = { pitchDegrees: 12, rollDegrees: -2, bodySpan: 0.8, brightness: 0.5, protocolConfig: "default" };
  assert.equal(validateConditions(c), null);
  assert.equal(validateConditions(undefined), null);
  assert.equal(validateConditions({ ...c, protocolConfig: "tuned:span=0.55-0.92,pitch=25" }), null);
  assert.ok(validateConditions({ ...c, pitchDegrees: 200 }));
  assert.ok(validateConditions({ ...c, bodySpan: -1 }));
  assert.ok(validateConditions({ ...c, brightness: 3 }));
  assert.ok(validateConditions({ ...c, protocolConfig: "<script>" }));
});

test("comparison: only like-for-like scans, raw deltas, never 'validated'", () => {
  const a = { ...set(), protocolVersion: "5a.2" };
  const b = { ...set({ views: [view("front", { widths: { shoulder: 0.25, waist: 0.15, hip: 0.19 } })] }), protocolVersion: "5a.2" };
  const r = compareFeatureSets(a, b);
  assert.ok(r.comparable);
  if (r.comparable) {
    assert.equal(r.validated, false);
    assert.ok(Math.abs(r.views.front!.waist.delta - -0.01) < 1e-9);
    assert.equal(r.views.side, undefined, "B has no side view");
  }
  const newer = compareFeatureSets(a, { ...b, cvVersion: "5b.2" });
  assert.deepEqual(newer, { comparable: false, reasons: ["cv_version_differs"] });
  const scaled = compareFeatureSets(a, { ...b, scale: { kind: "truedepth" }, protocolVersion: "5a.1" });
  assert.equal(scaled.comparable, false);
  if (!scaled.comparable) assert.deepEqual(scaled.reasons.sort(), ["protocol_differs", "scale_differs"]);
});

test("abandoned scans: unfinished and older than a day", () => {
  assert.ok(isAbandoned({ status: "capturing", createdAt: NOW - ABANDONED_AFTER_MS - 1 }, NOW));
  assert.ok(!isAbandoned({ status: "capturing", createdAt: NOW - 60_000 }, NOW));
  assert.ok(!isAbandoned({ status: "complete", createdAt: NOW - 10 * ABANDONED_AFTER_MS }, NOW), "a saved scan is never 'abandoned'");
});
