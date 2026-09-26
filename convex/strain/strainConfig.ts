// Sombrey Strain v1 — the versioned, configurable parameters. Pure data.
//
// Every number here is an evidence-informed ENGINEERING PRIOR, not a
// scientific constant (docs/SOMBREY_INTELLIGENCE_METHODOLOGY.md §Strain v1).
// Changing any of them is a methodology change: bump `version` and record
// it in METHODOLOGY_CHANGELOG.
//
// Domain weights. Load is ADDITIVE — a day with a run and a lifting session
// carries more load than either alone — so the weights cannot be shares of
// an average (that would dilute a single-domain day). They are exchange
// rates: the contribution of ONE reference dose of each domain, expressed
// as percentages of the three together.
//   cardiovascular 45 — the only INTERNAL load measure Sombrey has (heart
//                       rate against the user's own resting/max); HR-based
//                       load is the best-validated wearable load method.
//   resistance     30 — EXTERNAL load only (sets, reps, load relative to the
//                       user's own best); no internal measure (no RPE, HR
//                       under-reads lifting), so less certain per unit.
//   activity       25 — fallback when a session has no usable HR: population
//                       MET values, no individual intensity — the least
//                       certain estimate of the three.

export const STRAIN_V1 = {
  version: "strain-1.0",
  weights: { cardiovascular: 0.45, resistance: 0.30, activity: 0.25 },
  /** One reference dose per domain (the unit each is normalized by). */
  referenceDoses: {
    cardiovascular: 180, // zone-weighted minutes ≈ 60 min in HRR zone 3
    resistance: 20,      // set-equivalents ≈ a full lifting session
    activity: 300,       // MET-minutes above rest ≈ 60 min at 6 MET
  },
  /** Per-domain cap, in reference doses (a runaway record can't swamp a day). */
  componentCap: 4,
  /** Personal reference floor (Daily Load units): a very light usual day
   * must not make every session look extreme. ≈ half a cardio reference dose. */
  referenceFloor: 0.5,
} as const;

/** Exchange rate per domain: a reference dose of cardio = 1.0 load unit. */
export function exchangeRates(w = STRAIN_V1.weights) {
  return { cardiovascular: 1, resistance: w.resistance / w.cardiovascular, activity: w.activity / w.cardiovascular };
}

export const METHODOLOGY_CHANGELOG = [
  { version: "strain-0 (proposal-1)", date: "2026-09-26", change: "Unweighted sum of normalized components; not approved." },
  { version: "strain-1.0", date: "2026-09-26", change: "Domain weights 45/30/25 as exchange rates; reference floor 0.5; rolling load history; still display-gated until band validation." },
  { version: "readiness v1 (legacy)", date: "2026-05", change: "Sleep 35 / resting HR 30 / Sport+ minutes ACWR 25 / SpO2+temp 10; minimum HR of the day." },
  { version: "readiness-1.0", date: "2026-09-26", change: "Sleep 40 (duration 75% + regularity 25%) / cardiovascular 30 (robust overnight HR vs personal baseline) / recent load 20 (Daily Load vs personal reference, no ACWR) / physiological 10; states and confidence levels; upsert per day." },
];
