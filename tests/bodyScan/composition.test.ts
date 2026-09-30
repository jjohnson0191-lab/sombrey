// Sombrey Body Scan, Phase 5E — composition layer (convex/bodyScan/composition.ts) and the
// three-state longitudinal change classification (measurements.ts compareMeasurements).
// All inputs here are SYNTHETIC geometry / synthetic profiles — no physical validation data.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BMI_WEIGHT_MAX_AGE_DAYS, COMPOSITION_VERSION, MODELS, RFM_PUBLISHED, computeComposition, recordedBmi, rfmEstimate, type CompositionInputs,
} from "../../convex/bodyScan/composition.ts";
import { compareMeasurements, type Measurement, type MeasurementSet } from "../../convex/bodyScan/measurements.ts";

const NOW = Date.UTC(2026, 8, 30, 9, 0, 0);
const DAY = 86_400_000;
const inputs = (over: Partial<CompositionInputs> = {}): CompositionInputs => ({
  scanAt: NOW, sex: "male", ageYears: 35, heightCm: 179, weightKg: 82, weightSource: "manual", weightRecordedAt: NOW - 2 * DAY,
  depthSource: "truedepth", captureQuality: 0.9, ...over,
});
const whtr = (value: number, uncertainty?: number, status: Measurement["status"] = "available"): Measurement =>
  ({ name: "waistToHeight", kind: "ratio", status, unit: "ratio", confidence: 0.5, method: "x", reasons: [], value, ...(uncertainty !== undefined ? { uncertainty } : {}) });

// ─── RFM (published equation, experimental with image inputs) ────────────────

test("RFM: the published equation, for men and women", () => {
  // WHtR 0.5 → height/waist 2 → men 64 − 40 = 24; women + 12 = 36.
  assert.equal(rfmEstimate(inputs(), whtr(0.5, 0.02)).value, 24);
  assert.equal(rfmEstimate(inputs({ sex: "female" }), whtr(0.5, 0.02)).value, 36);
  assert.equal(rfmEstimate(inputs(), whtr(0.45, 0.02)).value, 19.6);   // 64 − 20/0.45
});

test("RFM: the range combines propagated measurement error and the published model error — and names what isn't quantified", () => {
  const r = rfmEstimate(inputs(), whtr(0.5, 0.02));
  // measurement: 20 / 0.5² × 0.02 = 1.6; model: 1.96 × 4.2 = 8.232; combined √(1.6² + 8.232²) = 8.39
  assert.deepEqual(r.uncertaintyComponents, { measurement: 1.6, model: 8.2, unquantified: ["image_waist_vs_tape_waist", "waist_site_narrowest_vs_iliac_crest"] });
  assert.equal(r.uncertainty, 8.4);
  assert.deepEqual([r.low, r.high], [15.6, 32.4]);
  assert.equal(RFM_PUBLISHED.female.precision, 4.9);
  const noRange = rfmEstimate(inputs(), whtr(0.5));
  assert.equal(noRange.uncertaintyComponents.measurement, null);
  assert.ok(noRange.uncertaintyComponents.unquantified.includes("waist_to_height_uncertainty"));
});

test("RFM: never displayable in c1 — experimental, validation pending", () => {
  const r = rfmEstimate(inputs(), whtr(0.5, 0.02));
  assert.equal(r.status, "estimate");
  assert.equal(r.displayable, false);
  assert.equal(r.validationStatus, "experimental");
  assert.ok(r.reasons.includes("image_waist_not_validated_against_tape") && r.reasons.includes("waist_site_differs_from_equation"));
  assert.ok(rfmEstimate(inputs(), whtr(0.5, 0.05, "low_confidence")).reasons.includes("waist_to_height_low_confidence"));
});

test("RFM: missing or out-of-population inputs → unavailable, never guessed", () => {
  const cases: Array<[Partial<CompositionInputs>, Measurement | undefined, string]> = [
    [{ sex: undefined }, whtr(0.5, 0.02), "sex_missing"],
    [{ sex: "other" }, whtr(0.5, 0.02), "equation_defined_for_male_and_female_only"],
    [{ ageYears: undefined }, whtr(0.5, 0.02), "age_missing"],
    [{ ageYears: 16 }, whtr(0.5, 0.02), "outside_equation_population"],
    [{}, undefined, "waist_to_height_unavailable"],
    [{}, { ...whtr(0.5), status: "unavailable", value: undefined }, "waist_to_height_unavailable"],
  ];
  for (const [over, w, reason] of cases) {
    const r = rfmEstimate(inputs(over), w);
    assert.equal(r.status, "unavailable", reason);
    assert.equal(r.value, undefined, `${reason}: no number`);
    assert.ok(r.reasons.includes(reason), `${reason} → ${r.reasons}`);
  }
  assert.deepEqual(rfmEstimate(inputs(), whtr(0.2, 0.01)).reasons, ["implausible_result"], "invalid body geometry is refused, not clamped");
  assert.ok(rfmEstimate(inputs({ ageYears: 75 }), whtr(0.5, 0.02)).reasons.includes("older_than_validation_sample"));
});

// ─── BMI (recorded values only) ──────────────────────────────────────────────

test("BMI: weight ÷ height² from the scan's snapshot of recorded values", () => {
  const b = recordedBmi(inputs());
  assert.equal(b.value, 25.6);   // 82 / 1.79²
  assert.equal(b.status, "calculated");
  assert.equal(b.validationStatus, "calculated_from_recorded_values");
  assert.equal(b.displayable, true);
  assert.deepEqual(b.uncertaintyComponents.unquantified, ["recorded_inputs_not_verified"]);
});

test("BMI: missing weight or height, stale weight → unavailable (never estimated)", () => {
  assert.deepEqual(recordedBmi(inputs({ weightKg: undefined })).reasons, ["weight_missing"]);
  assert.deepEqual(recordedBmi(inputs({ heightCm: undefined })).reasons, ["height_missing"]);
  assert.deepEqual(recordedBmi(inputs({ weightRecordedAt: NOW - (BMI_WEIGHT_MAX_AGE_DAYS + 1) * DAY })).reasons, ["weight_older_than_30_days"]);
  const undated = recordedBmi(inputs({ weightRecordedAt: undefined, weightSource: "profile" }));
  assert.equal(undated.status, "calculated");
  assert.equal(undated.displayable, false, "an undated profile weight isn't shown");
  assert.equal(recordedBmi(inputs({ ageYears: 15 })).displayable, false, "the adult formula isn't shown under 18");
});

// ─── The set, versions, history ──────────────────────────────────────────────

const ms = (w?: Measurement): Pick<MeasurementSet, "methodVersion" | "measurements"> => ({ methodVersion: "m2", measurements: w ? [w] : [] });

test("composition set: versioned, input snapshot recorded, never 'validated'", () => {
  const c = computeComposition(ms(whtr(0.48, 0.03)), inputs());
  assert.equal(c.compositionVersion, COMPOSITION_VERSION);
  assert.equal(c.measurementMethodVersion, "m2");
  assert.equal(c.validated, false);
  assert.equal(c.inputs.weightKg, 82);
  assert.equal(c.inputs.waistToHeight, 0.48);
  assert.equal(c.inputs.waistToHeightUncertainty, 0.03);
  assert.deepEqual(c.results.map((r) => [r.model, r.status]), [["rfm", "estimate"], ["bmi.recorded", "calculated"], ["sombrey.bodyfat", "unavailable"], ["sombrey.bmi_image", "unavailable"]]);
});

test("future Sombrey models: registered, versioned, on-device, and not trained — so never a number", () => {
  for (const id of ["sombrey.bodyfat", "sombrey.bmi_image"]) {
    assert.equal(MODELS[id].validationStatus, "not_trained");
    assert.equal(MODELS[id].runsOn, "device_coreml");
    const r = computeComposition(ms(whtr(0.48, 0.03)), inputs()).results.find((x) => x.model === id)!;
    assert.deepEqual([r.status, r.value, r.reasons], ["unavailable", undefined, ["model_not_trained"]]);
  }
});

test("history: a later profile change can't alter a stored result (inputs are the scan's snapshot)", () => {
  const atScan = computeComposition(ms(whtr(0.48, 0.03)), inputs({ weightKg: 82 }));
  const again = computeComposition(ms(whtr(0.48, 0.03)), inputs({ weightKg: 82 }));
  assert.deepEqual(atScan, again, "deterministic");
  const laterProfile = computeComposition(ms(whtr(0.48, 0.03)), inputs({ weightKg: 76 }));
  assert.notDeepEqual(laterProfile.results[1], atScan.results[1], "only a different snapshot changes BMI — which is why the stored snapshot is used");
});

test("no body-fat number is ever displayable in c1, whatever the inputs", () => {
  for (const w of [0.4, 0.45, 0.5, 0.55, 0.6]) for (const sex of ["male", "female"]) {
    const r = computeComposition(ms(whtr(w, 0.01)), inputs({ sex })).results.find((x) => x.name === "bodyFatPercent" && x.model === "rfm")!;
    assert.equal(r.displayable, false);
  }
});

// ─── Longitudinal change: three states ──────────────────────────────────────

const set = (waist: number, u = 1): Pick<MeasurementSet, "methodVersion" | "measurements" | "scale"> => ({
  methodVersion: "m2", scale: { source: "truedepth", ok: true, views: ["front"], reasons: [] },
  measurements: [{ name: "waistCircumference", kind: "circumference", status: "available", unit: "cm", value: waist, uncertainty: u, confidence: 0.5, method: "x", reasons: [] }],
});
const state = (r: ReturnType<typeof compareMeasurements>) => (r.comparable ? r.changes[0].state : "not_comparable");

test("change: inside the combined range → no meaningful change", () => {
  assert.equal(state(compareMeasurements(set(84), set(85))), "no_meaningful_change");   // 1 ≤ √2
});

test("change: beyond the range but no validated MDC → only 'possible'", () => {
  assert.equal(state(compareMeasurements(set(84), set(88))), "possible_change");
  assert.equal(state(compareMeasurements(set(84), set(88), { mdc: { waistCircumference: 2 } })), "possible_change", "an unvalidated MDC can't make it meaningful");
});

test("change: with a validated MDC — meaningful only beyond it", () => {
  const opts = { mdc: { waistCircumference: 3.2 }, mdcValidated: true };
  assert.equal(state(compareMeasurements(set(84), set(88), opts)), "meaningful_change");
  assert.equal(state(compareMeasurements(set(84), set(86.5), opts)), "no_meaningful_change", "beyond the range but within the MDC");
});

test("change: misaligned scans or a different method are never compared", () => {
  assert.equal(state(compareMeasurements(set(84), set(88), { alignment: { comparable: false, reasons: ["front:distance_differs"] } })), "not_comparable");
  assert.equal(state(compareMeasurements(set(84), { ...set(88), methodVersion: "m1" })), "not_comparable");
});
