// Cardiovascular load — time spent at heart-rate intensity. Pure.
//
// Evidence: heart-rate-based internal load (TRIMP family — Banister 1991;
// Edwards 1993) weights time by intensity; intensity as heart-rate reserve
// (Karvonen 1957). The weighting must grow with intensity (the HR–lactate
// relationship is non-linear), so an average HR over a session underestimates
// intermittent sessions — hence average-only is a LOW-confidence fallback.
// Sombrey synthesis: HRR bands × weights 1–5 (zones.ts); each reading covers
// the time to the next one, capped, so gaps are never filled in.

import { type Confidence, lower } from "./confidence.ts";
import { type HeartRateProfile, hrr, zoneFor } from "./zones.ts";

export type HRSample = { t: number; bpm: number };

export type CardioLoad = {
  load: number;                 // zone-weighted minutes
  minutesByZone: number[];      // index 0 = below zone 1 … 5
  coveredMinutes: number;
  coverage: number;             // covered / session minutes
  medianIntervalSec?: number;
  method: "series" | "session_average" | "none";
  confidence: Confidence;
  reason?: string;
};

/** No reading covers more than this — beyond it, time is unmeasured. */
export const MAX_SAMPLE_SPAN_SEC = 120;

export function cardiovascularLoad(input: {
  startMs: number;
  endMs: number;
  samples: HRSample[];
  profile: HeartRateProfile;
  averageHR?: number;
  /** Whether the series' timing is verified (band record series are
   * start + index × sampleRate — assumed until checked on the band). */
  seriesTimingVerified: boolean;
}): CardioLoad {
  const minutes = Math.max(0, (input.endMs - input.startMs) / 60000);
  const empty = (reason: string, confidence: Confidence = "INSUFFICIENT_DATA"): CardioLoad =>
    ({ load: 0, minutesByZone: [0, 0, 0, 0, 0, 0], coveredMinutes: 0, coverage: 0, method: "none", confidence, reason });
  if (minutes <= 0) return empty("no duration");
  if (input.profile.restingHR === undefined) return empty("no resting heart rate from the band yet");
  if (input.profile.maxHR === undefined) return empty("no maximum heart rate (add a date of birth for the estimate)");

  const samples = input.samples
    .filter((s) => s.bpm >= 30 && s.bpm <= 230 && s.t >= input.startMs && s.t <= input.endMs)
    .sort((a, b) => a.t - b.t);
  const byZone = [0, 0, 0, 0, 0, 0];
  let load = 0, covered = 0;
  const intervals: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const next = i + 1 < samples.length ? samples[i + 1].t : input.endMs;
    const gapSec = (next - samples[i].t) / 1000;
    if (i + 1 < samples.length) intervals.push(gapSec);
    const spanMin = Math.min(gapSec, MAX_SAMPLE_SPAN_SEC) / 60;
    const f = hrr(samples[i].bpm, input.profile);
    if (f === undefined) continue;
    const z = zoneFor(f);
    byZone[z.zone] += spanMin;
    load += spanMin * z.weight;
    covered += spanMin;
  }
  const coverage = covered / minutes;
  const sorted = [...intervals].sort((a, b) => a - b);
  const medianInterval = sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;

  let confidence: Confidence =
    coverage >= 0.8 && (medianInterval ?? Infinity) <= 30 ? "HIGH_CONFIDENCE"
    : coverage >= 0.5 && (medianInterval ?? Infinity) <= MAX_SAMPLE_SPAN_SEC ? "MODERATE_CONFIDENCE"
    : coverage >= 0.2 ? "LOW_CONFIDENCE"
    : "INSUFFICIENT_DATA";
  if (confidence !== "INSUFFICIENT_DATA") {
    if (input.profile.maxSource !== "measured") confidence = lower(confidence, "MODERATE_CONFIDENCE");
    if (!input.seriesTimingVerified) confidence = lower(confidence, "MODERATE_CONFIDENCE");
    return { load, minutesByZone: byZone, coveredMinutes: covered, coverage, medianIntervalSec: medianInterval, method: "series", confidence };
  }

  // Too little series: the session's average heart rate, if the band gave one.
  if (input.averageHR !== undefined && input.averageHR > 0) {
    const f = hrr(input.averageHR, input.profile);
    if (f !== undefined) {
      const z = zoneFor(f);
      const avgByZone = [0, 0, 0, 0, 0, 0];
      avgByZone[z.zone] = minutes;
      return { load: minutes * z.weight, minutesByZone: avgByZone, coveredMinutes: 0, coverage, medianIntervalSec: medianInterval, method: "session_average", confidence: "LOW_CONFIDENCE", reason: "average heart rate only" };
    }
  }
  return { ...empty(samples.length ? "heart-rate readings too sparse for this session" : "no heart-rate readings in this session"), coverage, medianIntervalSec: medianInterval };
}
