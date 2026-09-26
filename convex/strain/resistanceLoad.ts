// Resistance load — the dose of strength work. Pure.
//
// Evidence: resistance dose is multi-dimensional (load, volume, rest,
// velocity — Scott et al. 2016); the number of challenging sets is the most
// consistently used dose unit in the hypertrophy/strength literature, while
// tonnage (sets × reps × kg) is scale-dependent (a leg press and a curl
// differ by an order of magnitude) and so is reported, not scored.
// Sombrey synthesis: each completed set = 1 set-equivalent, scaled by
// relative intensity when the user's own recent best for that exercise is
// known (weight / estimated 1RM, Epley). 60 minutes of lifting is therefore
// never treated as 60 minutes of running — it is counted in sets.
// Not measured: effort per set (RPE/RIR), bar speed, rest intervals.

import type { Confidence } from "./confidence.ts";

export type ResistanceSet = { exerciseId: string; reps: number; weightKg?: number };

export type ResistanceLoad = {
  load: number;              // set-equivalents
  completedSets: number;
  weightedSets: number;
  volumeLoadKg: number;      // reported, not scored
  confidence: Confidence;
};

/** Epley 1RM estimate for 1–10 reps. */
export function epley(weightKg: number, reps: number): number | undefined {
  if (!(weightKg > 0) || reps < 1 || reps > 10) return undefined;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** `references`: the user's best estimated 1RM per exercise from EARLIER
 * sessions (so today can't inflate its own reference). */
export function resistanceLoad(sets: ResistanceSet[], references: Map<string, number>): ResistanceLoad {
  const done = sets.filter((s) => Number.isFinite(s.reps) && s.reps >= 1);
  if (done.length === 0) return { load: 0, completedSets: 0, weightedSets: 0, volumeLoadKg: 0, confidence: "INSUFFICIENT_DATA" };
  let load = 0, weighted = 0, withReference = 0, volume = 0;
  for (const s of done) {
    const w = s.weightKg ?? 0;
    if (w > 0) { weighted += 1; volume += w * s.reps; }
    const ref = references.get(s.exerciseId);
    if (w > 0 && ref && ref > 0) {
      withReference += 1;
      const relative = w / ref; // fraction of the user's own best 1RM
      load += Math.min(1.3, Math.max(0.6, relative / 0.7));
    } else {
      load += 1;
    }
  }
  const confidence: Confidence = withReference / done.length >= 0.8 ? "HIGH_CONFIDENCE" : weighted / done.length >= 0.5 ? "MODERATE_CONFIDENCE" : "LOW_CONFIDENCE";
  return { load, completedSets: done.length, weightedSets: weighted, volumeLoadKg: Math.round(volume), confidence };
}
