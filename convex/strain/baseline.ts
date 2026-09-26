// The personal baseline Strain is measured against. Pure.
//
// Sombrey synthesis — explicit requirements before any "personal" claim:
//   • ≥ 14 days since the first recorded session
//   • ≥ 6 days with meaningful load (Daily Load ≥ 0.15) in the last 28
//   • ≥ 4 sessions of at least MODERATE confidence in the last 28
// The reference is the median Daily Load of the user's active days in the
// last 28 (excluding today) — "your typical training day".

import { RANK, type Confidence } from "./confidence.ts";
import type { DailyLoadResult } from "./dailyLoad.ts";

export const BASELINE_REQUIREMENTS = { minHistoryDays: 14, minActiveDays: 6, minQualitySessions: 4, activeDayLoad: 0.15, windowDays: 28 };

export type Baseline = {
  status: "insufficient" | "building" | "ready";
  historyDays: number;
  activeDays: number;
  qualitySessions: number;
  reference?: number;
};

export function strainBaseline(previousDays: DailyLoadResult[], qualitySessionConfidences: Confidence[], historyDays: number): Baseline {
  const r = BASELINE_REQUIREMENTS;
  const window = previousDays.slice(-r.windowDays);
  const active = window.filter((d) => d.load >= r.activeDayLoad);
  const quality = qualitySessionConfidences.filter((c) => RANK[c] >= RANK.MODERATE_CONFIDENCE).length;
  const ready = historyDays >= r.minHistoryDays && active.length >= r.minActiveDays && quality >= r.minQualitySessions;
  const sorted = active.map((d) => d.load).sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : undefined;
  return {
    status: historyDays === 0 ? "insufficient" : ready ? "ready" : "building",
    historyDays, activeDays: active.length, qualitySessions: quality,
    reference: ready ? median : undefined,
  };
}
