// Sombrey Body Scan — Phase 5F: the longitudinal layer's pure rules.
//
//   • release gate   — which measurements have passed the production
//                      validation gate (docs/BODY_SCAN_5D.md §12). EMPTY: none has.
//   • provenance     — how every shown value is labelled: measured /
//                      calculated / experimental / not available.
//   • scan summary   — what a scan's history row can honestly say.
//   • trends         — body-proportion series, only from enough comparable scans.
//
// Nothing here makes a value more certain than the layer that produced it.
// Pure — tested in tests/bodyScan/history.test.ts.

import type { Measurement } from "./measurements.ts";
import type { CompositionResult } from "./composition.ts";

/** Measurements released for users, by measurement method — filled only when
 * a measurement passes the production validation gate. Until then, every
 * scanner value is "experimental". */
export const RELEASED_MEASUREMENTS: Record<string, readonly string[]> = {};

export function isReleased(methodVersion: string, name: string): boolean {
  return (RELEASED_MEASUREMENTS[methodVersion] ?? []).includes(name);
}

export type Provenance = "measured" | "calculated" | "experimental" | "not_available";

/** How a scanner measurement may be labelled. "Measured" only once released;
 * an unreleased value — however confident — is "experimental". */
export function measurementProvenance(methodVersion: string, m: Pick<Measurement, "name" | "status" | "value">): Provenance {
  if (m.status === "unavailable" || m.value === undefined) return "not_available";
  if (m.status === "available" && isReleased(methodVersion, m.name)) return "measured";
  return "experimental";
}

/** Composition results: BMI from recorded values is "calculated"; everything
 * else is experimental (or not available). */
export function compositionProvenance(r: Pick<CompositionResult, "status" | "validationStatus" | "value">): Provenance {
  if (r.status === "unavailable" || r.value === undefined) return "not_available";
  if (r.validationStatus === "calculated_from_recorded_values") return "calculated";
  return "experimental";
}

export type ScanSummary = {
  /** Lowest capture-quality score of the views (0–1). */
  captureQuality: number | null;
  depthSource: string;
  processed: boolean;
  measured: string[];              // released + available
  experimental: string[];          // shown only on development builds
  bmi: { value: number; displayable: boolean } | null;
  composition: "experimental" | "not_available";
  /** "possible_only" until an MDC is validated — no change can be "meaningful". */
  changeDetection: "possible_only" | "validated";
};

const SHOWN = new Set([
  "height", "chestCircumference", "waistCircumference", "hipCircumference", "thighCircumference", "calfCircumference",
  "shoulderWidth", "waistWidth", "hipWidth", "waistDepth",
]);

export function scanSummary(input: {
  viewQualities: number[];
  depthSource: string;
  measurements: { methodVersion: string; measurements: Measurement[] } | null;
  composition: { results: CompositionResult[] } | null;
  mdcValidated: boolean;
}): ScanSummary {
  const ms = input.measurements;
  const measured: string[] = [], experimental: string[] = [];
  for (const m of ms?.measurements ?? []) {
    if (!SHOWN.has(m.name)) continue;
    const p = measurementProvenance(ms!.methodVersion, m);
    if (p === "measured") measured.push(m.name);
    else if (p === "experimental" && m.status === "available") experimental.push(m.name);
  }
  const bmi = input.composition?.results.find((r) => r.model === "bmi.recorded");
  const bodyFat = input.composition?.results.filter((r) => r.name === "bodyFatPercent" && r.status !== "unavailable") ?? [];
  return {
    captureQuality: input.viewQualities.length ? Math.min(...input.viewQualities) : null,
    depthSource: input.depthSource,
    processed: ms !== null,
    measured, experimental,
    bmi: bmi && bmi.value !== undefined ? { value: bmi.value, displayable: bmi.displayable } : null,
    composition: bodyFat.length ? "experimental" : "not_available",
    changeDetection: input.mdcValidated ? "validated" : "possible_only",
  };
}

// ─── Trends ─────────────────────────────────────────────────────────────────

/** Body-shape proportions a trend may show (all scale-free). */
export const TREND_MEASUREMENTS = ["waistToHeight", "shoulderToWaist", "waistToHip", "armSymmetry", "legSymmetry"] as const;
/** Fewer comparable points than this → no trend. */
export const MIN_TREND_POINTS = 3;

export type TrendScan = {
  scanId: string;
  at: number;
  protocolVersion: string;
  methodVersion: string;
  measurements: Measurement[];
};
export type TrendPoint = { scanId: string; at: number; value: number; uncertainty: number | null };
export type Trend = { name: string; points: TrendPoint[]; shown: boolean; reason: string | null; methodVersion: string | null };

/** One series per proportion: only "available" values, only from scans with
 * the newest scan's measurement method and capture protocol (so every point
 * was produced the same way), oldest → newest. Shown only with at least
 * MIN_TREND_POINTS points. A trend is a shape description — never fat loss,
 * muscle gain or health. */
export function buildTrends(scans: TrendScan[]): Trend[] {
  const ordered = [...scans].sort((a, b) => a.at - b.at);
  const newest = ordered[ordered.length - 1];
  return TREND_MEASUREMENTS.map((name) => {
    if (!newest) return { name, points: [], shown: false, reason: "no_scans", methodVersion: null };
    const points: TrendPoint[] = [];
    for (const s of ordered) {
      if (s.methodVersion !== newest.methodVersion || s.protocolVersion !== newest.protocolVersion) continue;
      const m = s.measurements.find((x) => x.name === name);
      if (!m || m.status !== "available" || m.value === undefined) continue;
      points.push({ scanId: s.scanId, at: s.at, value: m.value, uncertainty: m.uncertainty ?? null });
    }
    const shown = points.length >= MIN_TREND_POINTS;
    return { name, points, shown, reason: shown ? null : "not_enough_comparable_scans", methodVersion: newest.methodVersion };
  });
}
