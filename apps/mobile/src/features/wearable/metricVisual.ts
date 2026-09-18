import type { WearableMetricType } from "@sombrey/wearable";

/**
 * Boundary for the FUTURE wearable metric-circle visual system —
 * interface only, per the V1 scope decision: "do not fully design or
 * implement this system yet." The approved future visual language is
 * translucent illuminated circular material with a soft colored
 * perimeter light (green/yellow/red-ish, by metric state) and optional
 * perimeter motion — but exact placement, thresholds, and per-metric
 * tone rules are deferred until QCBANDSDK integration reveals the real
 * data shape and update cadence.
 *
 * MetricCircle (ui/MetricCircle.tsx) renders this today as a plain flat
 * circle with no perimeter light at all, so screens can already lay
 * out wearable metrics in their real positions now, and the lit-glass
 * treatment can be dropped in later as a pure visual upgrade to this
 * one component — not a screen rewrite.
 */
export type MetricTone = "neutral" | "good" | "caution" | "alert";

export interface MetricVisualState {
  metricType: WearableMetricType;
  value: number | null;
  unit: string;
  /** Always "neutral" until the real thresholds are designed post-SDK. */
  tone: MetricTone;
}

/** Pure placeholder — no thresholds exist yet, so every metric is
 * "neutral" until the wearable-integration phase defines real ones. */
export function toMetricVisualState(
  metricType: WearableMetricType,
  value: number | null,
  unit: string,
): MetricVisualState {
  return { metricType, value, unit, tone: "neutral" };
}
