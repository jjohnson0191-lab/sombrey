// Body Scan argument/row validators shared by convex/schema.ts and
// convex/bodyScans.ts, so the stored shape and the accepted shape can't drift.
import { v } from "convex/values";

export const VIEW = v.union(v.literal("front"), v.literal("side"), v.literal("back"));
const RECORD = v.record(v.string(), v.number());

/** Phase 5C: what the phone measured about one view's metric scale (the
 * depth map itself never leaves the phone). See convex/bodyScan/features.ts. */
export const scaleEvidence = v.object({
  view: VIEW,
  depthWidth: v.number(),
  depthHeight: v.number(),
  focalPx: v.number(),
  intrinsics: v.union(v.literal("calibration"), v.literal("field_of_view")),
  accuracy: v.union(v.literal("absolute"), v.literal("relative")),
  filtered: v.boolean(),
  samples: v.number(),
  validFraction: v.number(),
  distanceM: v.number(),
  planeTiltDeg: v.number(),
  residualM: v.number(),
  surfaceHeightM: v.number(),
});

export const featureScale = v.object({
  kind: v.union(v.literal("none"), v.literal("truedepth"), v.literal("lidar"), v.literal("arkit_metric")),
  evidence: v.optional(v.array(scaleEvidence)),
});

export const featureView = v.object({
  view: VIEW,
  imageWidth: v.number(),
  imageHeight: v.number(),
  processingMs: v.number(),
  // Normalised to the image: x, y in 0–1 from the top-left.
  keypoints: v.array(v.object({ name: v.string(), x: v.number(), y: v.number(), confidence: v.number() })),
  silhouette: v.optional(v.object({
    maskWidth: v.number(),
    maskHeight: v.number(),
    top: v.number(), bottom: v.number(), left: v.number(), right: v.number(),
    heightFraction: v.number(),        // silhouette height ÷ image height
    areaPerHeight2: v.number(),        // silhouette area ÷ silhouette height²
    mainComponentFraction: v.number(),
    keypointAgreement: v.number(),
  })),
  widths: RECORD,    // silhouette width (or depth) ÷ silhouette height
  ratios: RECORD,
  quality: RECORD,   // 0–1 each
  issues: v.array(v.string()),
  profile: v.optional(v.array(v.number())),   // 5c.1: width/depth at 40 heights ÷ silhouette height
});

export const featureProcessing = v.object({
  deviceModel: v.string(),
  osVersion: v.string(),
  appVersion: v.string(),
  components: v.array(v.string()),     // e.g. "vision.personSegmentation.accurate"
});

export const featureMultiView = v.object({ ratios: RECORD, consistency: RECORD });

export const featureQuality = v.object({
  overallScore: v.number(),
  framing: v.number(),
  pose: v.number(),
  lighting: v.number(),
  segmentation: v.number(),
  motion: v.number(),
  multiViewConsistency: v.number(),
});

/** Phase 5C: one derived measurement (convex/bodyScan/measurements.ts). */
export const measurement = v.object({
  name: v.string(),
  kind: v.union(v.literal("length"), v.literal("circumference"), v.literal("volume"), v.literal("mass"), v.literal("index"), v.literal("ratio"), v.literal("angle")),
  status: v.union(v.literal("available"), v.literal("low_confidence"), v.literal("unavailable")),
  unit: v.union(v.literal("cm"), v.literal("L"), v.literal("kg"), v.literal("kg/m2"), v.literal("ratio"), v.literal("deg")),
  value: v.optional(v.number()),
  uncertainty: v.optional(v.number()),   // ≈ 95 % half-width, same unit
  confidence: v.number(),                // 0–1 heuristic, not a probability
  method: v.string(),
  reasons: v.array(v.string()),
});

export const measurementScale = v.object({
  source: v.string(),
  ok: v.boolean(),
  views: v.array(v.string()),
  reasons: v.array(v.string()),
});

export const profileComparison = v.object({
  profileHeightCm: v.number(),
  scannerHeightCm: v.optional(v.number()),
  differenceCm: v.optional(v.number()),
  differs: v.boolean(),
});

/** Phase 5E: one composition-model output (convex/bodyScan/composition.ts). */
export const compositionResult = v.object({
  name: v.union(v.literal("bodyFatPercent"), v.literal("bmi")),
  model: v.string(),
  modelVersion: v.string(),
  modelKind: v.union(v.literal("equation"), v.literal("learned")),
  validationStatus: v.union(v.literal("experimental"), v.literal("calculated_from_recorded_values"), v.literal("not_trained")),
  status: v.union(v.literal("estimate"), v.literal("calculated"), v.literal("unavailable")),
  value: v.optional(v.number()),
  low: v.optional(v.number()),
  high: v.optional(v.number()),
  uncertainty: v.optional(v.number()),
  uncertaintyComponents: v.object({
    measurement: v.union(v.number(), v.null()),
    model: v.union(v.number(), v.null()),
    unquantified: v.array(v.string()),
  }),
  displayable: v.boolean(),
  population: v.string(),
  reasons: v.array(v.string()),
});

/** The exact inputs a composition result used (the scan's snapshot). */
export const compositionInputs = v.object({
  scanAt: v.number(),
  sex: v.optional(v.string()),
  ageYears: v.optional(v.number()),
  heightCm: v.optional(v.number()),
  weightKg: v.optional(v.number()),
  weightSource: v.optional(v.string()),
  weightRecordedAt: v.optional(v.number()),
  depthSource: v.string(),
  captureQuality: v.number(),
  waistToHeight: v.optional(v.number()),
  waistToHeightUncertainty: v.optional(v.number()),
  waistToHeightStatus: v.optional(v.string()),
});
