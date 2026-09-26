// Daily Load — the day's components on one normalized scale. Pure.
//
// Each component is divided by its reference dose (strainConfig.ts), so no
// component dominates merely because of its units, capped (a runaway
// record — e.g. an all-day recording — can't swamp the day), then scaled by
// its Strain v1 exchange rate (the 45/30/25 domain weights):
//   Daily Load = Σ rate_d × min(dose_d / reference_d, CAP)
// Units: "load units" — 1.0 = one reference dose of cardiovascular load.
// Cardiovascular and activity load never describe the same minutes (a
// session uses one or the other), so adding them doesn't double count.
// Whether plain addition is the right combination is an open question
// (Sombrey synthesis, documented) — it's kept linear and inspectable so it
// can be revisited against real data.

import { type Confidence, blend } from "./confidence.ts";
import { ACTIVITY_REF, CARDIO_REF, RESIST_REF, type SessionLoad } from "./sessionLoad.ts";
import { STRAIN_V1, exchangeRates } from "./strainConfig.ts";

export const COMPONENT_CAP = STRAIN_V1.componentCap;

export type DailyLoadResult = {
  date: string;
  sessions: number;
  activeMinutes: number;
  /** Reference doses per domain, capped — before domain weights. */
  normalized: { cardio: number; activity: number; resistance: number };
  /** Load units each domain contributed (normalized × exchange rate). */
  components: { cardio: number; activity: number; resistance: number };
  raw: { cardioLoad: number; activityMetMinutes: number; resistanceSetEquivalents: number };
  load: number;           // normalized Daily Load (1.0 ≈ one substantial session-day)
  confidence: Confidence;
};

export function dailyLoad(date: string, loads: SessionLoad[]): DailyLoadResult {
  const cardioLoad = loads.reduce((s, l) => s + (l.aerobicBasis === "cardio" ? l.cardio?.load ?? 0 : 0), 0);
  const activityMet = loads.reduce((s, l) => s + (l.aerobicBasis === "activity" ? l.activity?.load ?? 0 : 0), 0);
  const sets = loads.reduce((s, l) => s + (l.resistance?.load ?? 0), 0);
  const normalized = {
    cardio: Math.min(COMPONENT_CAP, cardioLoad / CARDIO_REF),
    activity: Math.min(COMPONENT_CAP, activityMet / ACTIVITY_REF),
    resistance: Math.min(COMPONENT_CAP, sets / RESIST_REF),
  };
  const rate = exchangeRates();
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const components = {
    cardio: r3(normalized.cardio * rate.cardiovascular),
    activity: r3(normalized.activity * rate.activity),
    resistance: r3(normalized.resistance * rate.resistance),
  };
  const load = components.cardio + components.activity + components.resistance;
  const confidence = loads.length === 0
    ? "HIGH_CONFIDENCE" // nothing recorded is a certain zero
    : blend(loads.map((l) => ({ confidence: l.confidence, weight: Math.max(0.05, contribution(l)) })));
  return {
    date,
    sessions: loads.length,
    activeMinutes: Math.round(loads.reduce((s, l) => s + l.minutes, 0)),
    normalized,
    components,
    raw: { cardioLoad: Math.round(cardioLoad), activityMetMinutes: Math.round(activityMet), resistanceSetEquivalents: Math.round(sets * 10) / 10 },
    load: Math.round(load * 1000) / 1000,
    confidence,
  };
}

function contribution(l: SessionLoad): number {
  return (l.aerobicBasis === "cardio" ? (l.cardio?.load ?? 0) / CARDIO_REF : 0)
    + (l.aerobicBasis === "activity" ? (l.activity?.load ?? 0) / ACTIVITY_REF : 0)
    + (l.resistance?.load ?? 0) / RESIST_REF;
}
