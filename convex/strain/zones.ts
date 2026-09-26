// The user's heart-rate profile and intensity zones. Pure.
//
// Evidence: intensity as a fraction of heart-rate reserve (HRR = (HR −
// HRrest)/(HRmax − HRrest); Karvonen 1957) tracks relative metabolic
// intensity better than %HRmax across fitness levels, and is the intensity
// term of Banister's TRIMP. Age-predicted HRmax: Tanaka, Monahan & Seals
// 2001 (208 − 0.7·age) is more accurate than 220 − age, but still an
// estimate with an SD of ~10 bpm.
// Sombrey synthesis: five HRR bands with integer weights 1–5 — Edwards'
// (1993) summated-zone idea applied to HRR instead of %HRmax. The band edges
// below are an engineering choice, not a published standard.

export type HRMaxSource = "measured" | "observed_peak" | "estimated_age" | "none";

export type HeartRateProfile = {
  restingHR?: number;
  restingSource: "band_resting_reading" | "none";
  maxHR?: number;
  maxSource: HRMaxSource;
};

/** Tanaka et al. 2001. */
export function estimatedMaxHR(age: number | undefined): number | undefined {
  return age === undefined ? undefined : Math.round(208 - 0.7 * age);
}

/** Resting HR from the band's own resting readings (median), and HRmax from,
 * in order: a measured value (none exist today), the age estimate raised to
 * the highest peak the band has actually recorded (an observed peak can
 * only be at or below the true max, so it's a floor, never a replacement). */
export function heartRateProfile(input: {
  restingReadings: number[];
  measuredMax?: number;
  age?: number;
  observedPeaks: number[];
}): HeartRateProfile {
  const rest = input.restingReadings.filter((v) => v >= 30 && v <= 110).sort((a, b) => a - b);
  const restingHR = rest.length ? rest[Math.floor(rest.length / 2)] : undefined;
  if (input.measuredMax && input.measuredMax > 100) {
    return { restingHR, restingSource: restingHR ? "band_resting_reading" : "none", maxHR: input.measuredMax, maxSource: "measured" };
  }
  const estimate = estimatedMaxHR(input.age);
  const peak = input.observedPeaks.filter((v) => v > 100 && v < 230).reduce((m, v) => Math.max(m, v), 0);
  if (estimate === undefined) {
    return { restingHR, restingSource: restingHR ? "band_resting_reading" : "none", maxSource: "none" };
  }
  const maxHR = Math.max(estimate, peak);
  return { restingHR, restingSource: restingHR ? "band_resting_reading" : "none", maxHR, maxSource: peak > estimate ? "observed_peak" : "estimated_age" };
}

/** Fraction of heart-rate reserve, or undefined without both ends. */
export function hrr(hr: number, p: HeartRateProfile): number | undefined {
  if (p.restingHR === undefined || p.maxHR === undefined || p.maxHR - p.restingHR < 40) return undefined;
  return (hr - p.restingHR) / (p.maxHR - p.restingHR);
}

export const HRR_BANDS = [
  { zone: 1, from: 0.3, weight: 1 },
  { zone: 2, from: 0.45, weight: 2 },
  { zone: 3, from: 0.6, weight: 3 },
  { zone: 4, from: 0.75, weight: 4 },
  { zone: 5, from: 0.85, weight: 5 },
] as const;

/** Zone (1–5) and weight for an HRR fraction; below zone 1 carries no load. */
export function zoneFor(fraction: number): { zone: number; weight: number } {
  let out = { zone: 0, weight: 0 };
  for (const b of HRR_BANDS) if (fraction >= b.from) out = { zone: b.zone, weight: b.weight };
  return out;
}
