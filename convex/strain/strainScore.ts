// Sombrey Strain — the user-facing interpretation of Daily Load. Pure.
//
// Strain answers "how much load did I experience today, for me?". It is NOT
// adjusted by readiness, calories or weather.
//
// Strain v1 normalization (Sombrey synthesis — display-gated until the band
// is physically validated):
//   strain = 100 × (1 − 2^(−DailyLoad / reference))
// where `reference` is the user's typical training-day load (baseline.ts),
// floored at STRAIN_V1.referenceFloor.
// A typical day ≈ 50, twice typical ≈ 75, three times ≈ 88 — saturating, so
// no day exceeds 100 and differences at the top compress as effort does.
// The value is shown once STRAIN_DISPLAY_ENABLED (product decision), always
// with its state and version; `approved` marks physical validation.

import { type Confidence, RANK } from "./confidence.ts";
import type { Baseline } from "./baseline.ts";
import type { DailyLoadResult } from "./dailyLoad.ts";

import { STRAIN_V1 } from "./strainConfig.ts";

/** Display gate: stays false until the band passes physical validation
 * A–F (docs/SOMBREY_BAND_VALIDATION.md). The value is computed and stored
 * with its version either way. */
export const STRAIN_FORMULA_APPROVED = false;
export const STRAIN_FORMULA_VERSION = STRAIN_V1.version;

/** Product decision (build 40): Strain v1 values are SHOWN to users, labelled
 * "not yet validated", while physical validation is pending. This changes
 * visibility only — never the methodology. `approved` (validated) stays
 * false until the band passes checks A–F. */
export const STRAIN_DISPLAY_ENABLED = true;

/** Presentation band for a Strain value (0–100; ~50 is the user's own
 * typical training day). Labels only — no scoring. */
export function strainBand(value: number): "Light" | "Moderate" | "High" | "Very high" {
  if (value < 30) return "Light";
  if (value < 60) return "Moderate";
  if (value < 80) return "High";
  return "Very high";
}

/** Today's load in words, relative to the personal typical day. */
export function relativeLabel(relative: number): string {
  if (relative < 0.75) return "Below your usual day";
  if (relative <= 1.25) return "About your usual day";
  if (relative <= 2) return "Above your usual day";
  return "Well above your usual day";
}

export type StrainState = "NOT_ENOUGH_DATA" | "BUILDING_BASELINE" | "LOW_CONFIDENCE" | "READY";

export type Strain = {
  state: StrainState;
  confidence: Confidence;
  /** The computed value (always, once a baseline exists). */
  proposedValue?: number;
  /** What a user may see: when validated or display is enabled. */
  value?: number;
  approved: boolean;
  version: string;
  /** The personal reference (floored) this value was normalized against. */
  reference?: number;
};

/** The personal reference Strain normalizes against, with its floor. */
export function strainReference(baselineReference: number): number {
  return Math.max(baselineReference, STRAIN_V1.referenceFloor);
}

export function proposedStrain(load: number, reference: number): number {
  return Math.round(100 * (1 - Math.pow(2, -load / strainReference(reference))));
}

export function strainFor(today: DailyLoadResult, baseline: Baseline, approved = STRAIN_FORMULA_APPROVED): Strain {
  const base = { approved, version: STRAIN_FORMULA_VERSION, confidence: today.confidence };
  if (today.sessions > 0 && today.confidence === "INSUFFICIENT_DATA") return { ...base, state: "NOT_ENOUGH_DATA" };
  if (baseline.status !== "ready" || baseline.reference === undefined || baseline.reference <= 0) return { ...base, state: "BUILDING_BASELINE" };
  const proposed = proposedStrain(today.load, baseline.reference);
  const state: StrainState = RANK[today.confidence] <= RANK.LOW_CONFIDENCE ? "LOW_CONFIDENCE" : "READY";
  return { ...base, state, proposedValue: proposed, value: approved || STRAIN_DISPLAY_ENABLED ? proposed : undefined, reference: strainReference(baseline.reference) };
}
