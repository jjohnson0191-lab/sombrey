// Methodology registry — every modelling choice, with whether it rests on
// published evidence or is Sombrey's own synthesis. Pure data; the long
// form is docs/SOMBREY_INTELLIGENCE_METHODOLOGY.md.

export type MethodBasis = "evidence" | "adapted_from_evidence" | "sombrey_synthesis";

export type Method = { id: string; module: string; choice: string; basis: MethodBasis; sources: string[]; openQuestion?: string };

export const METHODOLOGY: Method[] = [
  { id: "time_model", module: "time.ts", choice: "Canonical epoch instants; days are the phone's IANA time-zone calendar days (DST-correct).", basis: "sombrey_synthesis", sources: [] },
  { id: "hr_max", module: "zones.ts", choice: "HRmax = 208 − 0.7·age (Tanaka), floored by the highest peak the band has recorded; measured value when one exists.", basis: "evidence", sources: ["Tanaka, Monahan & Seals 2001, JACC 37:153–156"] },
  { id: "hr_reserve", module: "zones.ts", choice: "Intensity as fraction of heart-rate reserve (Karvonen).", basis: "evidence", sources: ["Karvonen, Kentala & Mustala 1957"] },
  { id: "zone_weights", module: "zones.ts", choice: "Five HRR zones (30/45/60/75/85%) weighted 1–5 per minute.", basis: "adapted_from_evidence", sources: ["Edwards 1993 summated heart-rate-zone method", "Banister 1991 TRIMP"], openQuestion: "Zone boundaries follow HRR, not Edwards' %HRmax — review against band data." },
  { id: "sparse_hr", module: "cardiovascularLoad.ts", choice: "Each reading covers at most 120 s; uncovered minutes carry no load; coverage sets confidence.", basis: "sombrey_synthesis", sources: [] },
  { id: "resistance", module: "resistanceLoad.ts", choice: "Completed sets scaled by load relative to the user's own best e1RM (Epley), clamped 0.6–1.3; volume-load reported, not scored.", basis: "adapted_from_evidence", sources: ["Scott et al. 2016, Sports Med 46:687", "Foster et al. 2001 session-RPE (not collected)"], openQuestion: "Set-equivalent to cardio-load exchange rate (20 sets ≈ 180 zone-min) is an engineering anchor." },
  { id: "activity_fallback", module: "activityLoad.ts", choice: "Without usable HR: minutes × (MET − 1) by activity family; always LOW confidence.", basis: "adapted_from_evidence", sources: ["2024 Adult Compendium of Physical Activities (Herrmann et al.)"] },
  { id: "dedup", module: "sessionLoad.ts", choice: "Workout > band/app activity > noticed activity; overlapping minutes counted once.", basis: "sombrey_synthesis", sources: [] },
  { id: "daily_load", module: "dailyLoad.ts", choice: "Components normalized by reference doses, capped at 4 each, summed.", basis: "sombrey_synthesis", sources: [], openQuestion: "Linear sum and reference doses to be reviewed with validated band data." },
  { id: "baseline", module: "baseline.ts", choice: "≥14 days history, ≥6 active days and ≥4 MODERATE+ sessions in 28 days; reference = median active-day load.", basis: "sombrey_synthesis", sources: ["Impellizzeri et al. 2020 (ACWR pitfalls) — why no acute:chronic ratio is used"] },
  { id: "strain_curve", module: "strainScore.ts", choice: "Proposed: 100 × (1 − 2^(−load/reference)); NOT approved, not shown.", basis: "sombrey_synthesis", sources: [], openQuestion: "Awaiting hardware validation and product review." },
  { id: "relationships", module: "relationships.ts", choice: "Spearman, n ≥ 28, p < 0.05, |ρ| ≥ 0.4, 'tended to' wording.", basis: "adapted_from_evidence", sources: ["Schönbrodt & Perugini 2013 (correlations stabilize near n≈250)"] },
  { id: "weather", module: "environment.ts", choice: "Context only; apparent temperature (Steadman/BoM) labelled calculated; comparison needs ≥3 sessions per heat band.", basis: "adapted_from_evidence", sources: ["Périard, Eijsvogels & Daanen 2021, Physiol Rev 101:1873", "Australian BoM apparent temperature"] },
];
