// Session intensity from real heart rate. Pure (no Convex imports).
//
// Sombrey does not have a validated intensity or load model yet (that
// arrives with Strain). Until then intensity is expressed with the widely
// used five-zone scale over percent of maximum heart rate, where maximum
// heart rate is the age-predicted estimate Sombrey uses everywhere (Tanaka,
// 208 − 0.7·age — convex/strain/zones.ts). Both are
// estimates, and every surface that shows a zone says so. With no date of
// birth there is no estimate — and no intensity label: nothing is guessed.

import { estimatedMaxHR } from "./strain/zones.ts";

export const INTENSITY_ZONES = [
  { zone: 1, label: "Very light", minPercent: 50 },
  { zone: 2, label: "Light", minPercent: 60 },
  { zone: 3, label: "Moderate", minPercent: 70 },
  { zone: 4, label: "Hard", minPercent: 80 },
  { zone: 5, label: "Maximum", minPercent: 90 },
] as const;

export type Intensity = { zone: number; label: string; percentOfMax: number };

/** Whole years between an ISO date of birth ("1995-04-12") and `nowMs`,
 * or undefined when the date is missing or implausible. */
export function ageFromDateOfBirth(dateOfBirth: string | undefined, nowMs: number): number | undefined {
  if (!dateOfBirth) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const now = new Date(nowMs);
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
  return age >= 10 && age <= 100 ? age : undefined;
}

/** The age-predicted maximum heart rate — the one estimate Sombrey uses
 * (Tanaka et al. 2001), shared with the load model. */
export function estimatedMaxHeartRate(age: number | undefined): number | undefined {
  return age === undefined ? undefined : estimatedMaxHR(age);
}

/** The zone a heart rate falls in, or undefined below zone 1 / without an
 * estimate / without a real reading. */
export function intensityFor(heartRate: number | undefined, maxHeartRate: number | undefined): Intensity | undefined {
  if (heartRate === undefined || maxHeartRate === undefined || heartRate <= 0 || maxHeartRate <= 0) return undefined;
  const percentOfMax = Math.round((heartRate / maxHeartRate) * 100);
  let found: Intensity | undefined;
  for (const z of INTENSITY_ZONES) {
    if (percentOfMax >= z.minPercent) found = { zone: z.zone, label: z.label, percentOfMax };
  }
  return found;
}
