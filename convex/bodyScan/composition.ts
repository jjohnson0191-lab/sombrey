// Sombrey Body Scan — Phase 5E: the body-composition layer.
//
//   photo → Vision → geometry → metric scale → features → MEASUREMENTS (m2)
//         → COMPOSITION (this file, version c1) → uncertainty → stored result
//
// A registry of versioned models, each declaring its inputs, the population it
// applies to, its validation status and its provenance. Every result carries
// its inputs snapshot, a range whose components are named (and, where a
// component can't be quantified, says so), and whether it may be displayed.
//
// Nothing here is validated for Sombrey's image-derived inputs. No model was
// trained; no training data was invented. In c1:
//   • rfm (v0)            — a PUBLISHED equation (Woolcott & Bergman 2018) fed
//                           with the scanner's waist-to-height ratio. Stored as an
//                           internal estimate with a range; never displayable:
//                           the image waist isn't validated against a tape waist
//                           and is taken at a different site than the equation's.
//   • bmi.recorded (v1)   — weight ÷ height² from the user's OWN recorded height
//                           and weight at scan time (the scan's snapshot). A
//                           calculation from recorded values, not a scanner estimate.
//   • sombrey.bodyfat, sombrey.bmi_image (v1) — the interface for future
//                           Sombrey-trained models: always "not trained" here.
//
// Pure and deterministic. Tested in tests/bodyScan/composition.test.ts.

import type { Measurement, MeasurementSet } from "./measurements.ts";

export const COMPOSITION_VERSION = "c1";

export type ValidationStatus = "experimental" | "calculated_from_recorded_values" | "not_trained";

export type ModelSpec = {
  id: string;
  version: string;
  kind: "equation" | "learned";
  target: "bodyFatPercent" | "bmi";
  inputs: string[];
  /** The measurement method whose features it reads (null: none). */
  featureVersion: string | null;
  validationStatus: ValidationStatus;
  population: string;
  provenance: string;
  /** Where inference runs once trained (Core ML on the phone for learned models). */
  runsOn: "server_pure" | "device_coreml";
};

/** Published RFM validation (NHANES 2005–2006, n = 3,456, ages 20–69, DXA):
 * bias and precision in body-fat percentage points — for TAPE waist inputs. */
export const RFM_PUBLISHED = {
  male: { bias: 0.5, precision: 4.2 },
  female: { bias: 0.9, precision: 4.9 },
  developmentAges: [20, 85] as const,
} as const;

export const MODELS: Record<string, ModelSpec> = {
  rfm: {
    id: "rfm", version: "0", kind: "equation", target: "bodyFatPercent",
    inputs: ["sex", "ageYears", "waistToHeight"], featureVersion: "m2", validationStatus: "experimental",
    population: "US adults 20–85 (development, NHANES 1999–2004) / 20–69 (validation, NHANES 2005–2006); DXA reference; tape waist at the iliac crest",
    provenance: "Woolcott OO, Bergman RN. Relative fat mass (RFM) as a new estimator of whole-body fat percentage. Sci Rep 2018;8:10980. RFM = 64 − 20·(height/waist) + 12·(female)",
    runsOn: "server_pure",
  },
  "bmi.recorded": {
    id: "bmi.recorded", version: "1", kind: "equation", target: "bmi",
    inputs: ["heightCm (recorded)", "weightKg (recorded)"], featureVersion: null, validationStatus: "calculated_from_recorded_values",
    population: "Adults (Sombrey shows no BMI category)",
    provenance: "BMI = weight (kg) / height (m)², from the user's own recorded values at scan time",
    runsOn: "server_pure",
  },
  "sombrey.bodyfat": {
    id: "sombrey.bodyfat", version: "1", kind: "learned", target: "bodyFatPercent",
    inputs: ["m2 features", "depth source", "capture quality", "sex", "age"], featureVersion: "m2", validationStatus: "not_trained",
    population: "None yet", provenance: "Not trained. Requires consented Sombrey scans with DXA reference (docs/BODY_SCAN_5E.md §6).",
    runsOn: "device_coreml",
  },
  "sombrey.bmi_image": {
    id: "sombrey.bmi_image", version: "1", kind: "learned", target: "bmi",
    inputs: ["m2 features", "depth source", "capture quality"], featureVersion: "m2", validationStatus: "not_trained",
    population: "None yet", provenance: "Not trained. Requires consented Sombrey scans with measured weight (docs/BODY_SCAN_5E.md §6).",
    runsOn: "device_coreml",
  },
};

/** A recorded weight older than this (before the scan) isn't used for BMI. */
export const BMI_WEIGHT_MAX_AGE_DAYS = 30;

export type CompositionInputs = {
  scanAt: number;
  sex?: string;
  ageYears?: number;
  heightCm?: number;
  weightKg?: number;
  weightSource?: string;
  weightRecordedAt?: number;
  depthSource: string;
  captureQuality: number;
};

export type CompositionResult = {
  name: "bodyFatPercent" | "bmi";
  model: string;
  modelVersion: string;
  modelKind: "equation" | "learned";
  validationStatus: ValidationStatus;
  status: "estimate" | "calculated" | "unavailable";
  value?: number;
  low?: number;
  high?: number;
  /** Approximate 95 % half-width of the quantified components. */
  uncertainty?: number;
  uncertaintyComponents: { measurement: number | null; model: number | null; unquantified: string[] };
  displayable: boolean;
  population: string;
  reasons: string[];
};

export type CompositionSet = {
  compositionVersion: string;
  measurementMethodVersion: string;
  inputs: CompositionInputs & { waistToHeight?: number; waistToHeightUncertainty?: number; waistToHeightStatus?: string };
  results: CompositionResult[];
  validated: false;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

function unavailableResult(spec: ModelSpec, reasons: string[]): CompositionResult {
  return {
    name: spec.target, model: spec.id, modelVersion: spec.version, modelKind: spec.kind, validationStatus: spec.validationStatus,
    status: "unavailable", uncertaintyComponents: { measurement: null, model: null, unquantified: [] }, displayable: false,
    population: spec.population, reasons,
  };
}

/** RFM from the image-derived waist-to-height ratio. Measurement uncertainty
 * propagates through d(RFM)/d(WHtR) = 20 / WHtR²; the equation's own published
 * error (tape inputs) is the model term; what can't be quantified is named. */
export function rfmEstimate(inputs: CompositionInputs, whtr: Measurement | undefined): CompositionResult {
  const spec = MODELS.rfm;
  const why: string[] = [];
  if (inputs.sex === undefined) why.push("sex_missing");
  else if (inputs.sex !== "male" && inputs.sex !== "female") why.push("equation_defined_for_male_and_female_only");
  if (inputs.ageYears === undefined) why.push("age_missing");
  else if (inputs.ageYears < RFM_PUBLISHED.developmentAges[0] || inputs.ageYears > RFM_PUBLISHED.developmentAges[1]) why.push("outside_equation_population");
  if (!whtr || whtr.status === "unavailable" || whtr.value === undefined || !(whtr.value > 0)) why.push("waist_to_height_unavailable");
  if (why.length) return unavailableResult(spec, why);

  const w = whtr!.value as number;
  const female = inputs.sex === "female";
  const value = 64 - 20 / w + (female ? 12 : 0);
  if (!(value >= 3 && value <= 60)) return unavailableResult(spec, ["implausible_result"]);
  const measurement = whtr!.uncertainty !== undefined ? (20 / (w * w)) * whtr!.uncertainty : null;
  const model = 1.96 * (female ? RFM_PUBLISHED.female.precision : RFM_PUBLISHED.male.precision);
  const unquantified = ["image_waist_vs_tape_waist", "waist_site_narrowest_vs_iliac_crest"];
  if (measurement === null) unquantified.push("waist_to_height_uncertainty");
  const half = Math.hypot(measurement ?? 0, model);
  const reasons = ["experimental", "image_waist_not_validated_against_tape", "waist_site_differs_from_equation"];
  if (whtr!.status === "low_confidence") reasons.push("waist_to_height_low_confidence");
  if (inputs.ageYears! > 69) reasons.push("older_than_validation_sample");
  return {
    name: "bodyFatPercent", model: spec.id, modelVersion: spec.version, modelKind: spec.kind, validationStatus: spec.validationStatus,
    status: "estimate", value: r1(value), low: r1(Math.max(0, value - half)), high: r1(value + half), uncertainty: r1(half),
    uncertaintyComponents: { measurement: measurement === null ? null : r1(measurement), model: r1(model), unquantified },
    // Never shown in c1: the dominant error (image vs tape waist) is unquantified.
    displayable: false,
    population: spec.population, reasons,
  };
}

/** BMI from the scan's snapshot of the user's recorded height and weight. */
export function recordedBmi(inputs: CompositionInputs): CompositionResult {
  const spec = MODELS["bmi.recorded"];
  const why: string[] = [];
  if (!(inputs.heightCm && inputs.heightCm > 0)) why.push("height_missing");
  if (!(inputs.weightKg && inputs.weightKg > 0)) why.push("weight_missing");
  if (inputs.weightRecordedAt !== undefined && inputs.scanAt - inputs.weightRecordedAt > BMI_WEIGHT_MAX_AGE_DAYS * 86_400_000) why.push("weight_older_than_30_days");
  if (why.length) return unavailableResult(spec, why);
  const m = inputs.heightCm! / 100;
  const value = inputs.weightKg! / (m * m);
  const reasons = ["from_recorded_height_and_weight"];
  let displayable = true;
  if (inputs.weightRecordedAt === undefined) { reasons.push("weight_date_unknown"); displayable = false; }
  if (inputs.ageYears !== undefined && inputs.ageYears < 18) { reasons.push("adult_formula_under_18"); displayable = false; }
  return {
    name: "bmi", model: spec.id, modelVersion: spec.version, modelKind: spec.kind, validationStatus: spec.validationStatus,
    status: "calculated", value: r1(value),
    uncertaintyComponents: { measurement: null, model: null, unquantified: ["recorded_inputs_not_verified"] },
    displayable, population: spec.population, reasons,
  };
}

/** The composition layer for one scan's measurement set. `inputs` must be the
 * scan's own snapshot (never today's profile), so a stored result never
 * changes when the profile does. */
export function computeComposition(ms: Pick<MeasurementSet, "methodVersion" | "measurements">, inputs: CompositionInputs): CompositionSet {
  const whtr = ms.measurements.find((m) => m.name === "waistToHeight");
  const results = [
    rfmEstimate(inputs, whtr),
    recordedBmi(inputs),
    unavailableResult(MODELS["sombrey.bodyfat"], ["model_not_trained"]),
    unavailableResult(MODELS["sombrey.bmi_image"], ["model_not_trained"]),
  ];
  return {
    compositionVersion: COMPOSITION_VERSION,
    measurementMethodVersion: ms.methodVersion,
    inputs: {
      ...inputs,
      ...(whtr?.value !== undefined ? { waistToHeight: whtr.value, waistToHeightStatus: whtr.status } : {}),
      ...(whtr?.uncertainty !== undefined ? { waistToHeightUncertainty: whtr.uncertainty } : {}),
    },
    results,
    validated: false,
  };
}
