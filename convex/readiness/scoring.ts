/**
 * Sombrey Readiness v1 ("readiness-1.0") — pure scoring, no Convex/DB.
 * `convex/readiness.ts` gathers the data; this file is unit-tested directly
 * (tests/readiness). Full rationale and references:
 * docs/SOMBREY_INTELLIGENCE_METHODOLOGY.md §Readiness v1.
 *
 * Readiness answers "how prepared/recovered does this person appear to be
 * right now?" from four independent domains:
 *
 *   sleep           40  duration vs personal need (75%) + timing regularity (25%)
 *   cardiovascular  30  overnight resting HR vs personal baseline
 *   recentLoad      20  Daily Load of the last days vs the personal reference
 *                       (yesterday's load — the quantity Strain is made from —
 *                       enters HERE, as context, never as a subtraction)
 *   physiological   10  SpO2 drop / skin-temperature deviation vs baseline
 *
 * The weights are EVIDENCE-INFORMED PRIORS, not scientific constants — no
 * published formula prescribes percentages for a consumer readiness score.
 * They live in READINESS_V1 so longitudinal Sombrey data can recalibrate
 * them; any change bumps the version.
 *
 * Missing data: a domain without data is EXCLUDED and the remaining nominal
 * weights are renormalized — never scored as zero/poor. Confidence falls
 * with every missing domain (confidence uses nominal, not renormalized,
 * weights). A score needs sleep or cardiovascular data: load and SpO2/temp
 * alone can't say how recovered someone is.
 *
 * Readiness is never multiplied by Strain, and Strain never by Readiness.
 */

import { localParts, type Zone } from "../strain/time.ts";
import type { LoadDay, RollingLoad } from "../strain/rollingLoad.ts";

export const READINESS_V1 = {
  version: "readiness-1.0",
  weights: { sleep: 0.40, cardiovascular: 0.30, recentLoad: 0.20, physiological: 0.10 },
  sleep: {
    durationShare: 0.75,
    regularityShare: 0.25,
    minNightsForBaseline: 5,
    baselineWindowNights: 28,
    populationBridgeMinutes: 420, // 7 h — cold-start bridge only, labelled, low confidence
    regularityNights: 7,
    minRegularityNights: 4,
  },
  cardiovascular: { minDaysForBaseline: 5, baselineWindowDays: 28, maturityDays: 21, spreadFloorBpm: 2, toleranceSd: 0.5 },
  physiological: { minDaysForBaseline: 7 },
  recentLoad: {
    // Most recent days weigh most (acute fatigue from a session largely
    // resolves over ~1–3 days — Sombrey synthesis of the recovery literature).
    dayWeights: [0.5, 0.3, 0.2], // yesterday, 2 days ago, 3 days ago
    floor: 40,
  },
} as const;

/** Stored on every row; older rows keep their own version string. */
export const ALGORITHM_VERSION = READINESS_V1.version;

export type ReadinessState = "NOT_ENOUGH_DATA" | "BUILDING_BASELINE" | "LOW_CONFIDENCE" | "READY";
export type ConfidenceLevel = "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT";
export type DomainId = keyof typeof READINESS_V1.weights;

export interface DailyAggregate {
  /** YYYY-MM-DD in the user's time zone. */
  date: string;
  /** Sleep ending on this (wake) day. */
  sleepMinutes?: number;
  /** Midpoint of the main sleep, minutes after local noon (0–1440) — avoids the midnight wrap. */
  sleepMidpoint?: number;
  /** Overnight resting heart rate (see overnightRestingHR). */
  restingHeartRate?: number;
  spo2?: number;
  skinTemperature?: number;
}

export type RecentLoadInput = {
  /** The personal reference day (Strain baseline); undefined while building. */
  reference?: number;
  /** Past days, oldest → newest, ending yesterday (with status). */
  days: (LoadDay & { confidence?: string })[];
  rolling?: RollingLoad;
};

export interface ComponentResult {
  metric: DomainId;
  /** 0–100, undefined when the domain couldn't be computed. */
  subScore?: number;
  /** Weight actually used after renormalization; 0 when not included. */
  weight: number;
  /** The domain's nominal Readiness v1 weight. */
  nominalWeight: number;
  /** 0–1 — how much this domain's data and baseline can be trusted. */
  confidence: number;
  description: string;
  included: boolean;
  /** True when judged against the user's own baseline (not a population bridge). */
  personal: boolean;
  /** Inputs behind the sub-score, for explanation and the AI Coach. */
  detail?: Record<string, number | string | boolean | undefined>;
}

export interface ReadinessScoreOutput {
  score: number | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  state: ReadinessState;
  components: ComponentResult[];
  missingInputs: string[];
  version: string;
}

// ─── Robust statistics ──────────────────────────────────────────────────────

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median absolute deviation — a robust, outlier-resistant spread measure. */
export function medianAbsoluteDeviation(values: number[], center?: number): number | undefined {
  if (values.length === 0) return undefined;
  const m = center ?? median(values);
  if (m === undefined) return undefined;
  return median(values.map((v) => Math.abs(v - m)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function maturity(samples: number, matureAt: number, floor: number): number {
  if (samples <= 0) return 0;
  return clamp(floor + (1 - floor) * (samples / matureAt), floor, 1);
}

// ─── Input preparation (pure, used by convex/readiness.ts) ────────────────

/** Overnight resting HR for one night. Preference: the band's own resting
 * reading(s) for the day (median); else, with ≥ 6 heart-rate readings in the
 * sleep window, the median of the lowest 20% (at least 3) — a sustained low,
 * robust to a single artifact reading (the legacy version took the single
 * minimum). No sleep window → no value: a daytime minimum is not resting HR. */
export function overnightRestingHR(bandResting: number[], sleepWindowReadings: number[]): { value?: number; source: "band_resting" | "sleep_window" | "none" } {
  const band = bandResting.filter((v) => v >= 30 && v <= 110);
  if (band.length) return { value: Math.round(median(band)!), source: "band_resting" };
  const r = sleepWindowReadings.filter((v) => v >= 30 && v <= 130).sort((a, b) => a - b);
  if (r.length < 6) return { source: "none" };
  const k = Math.max(3, Math.floor(r.length * 0.2));
  return { value: Math.round(median(r.slice(0, k))!), source: "sleep_window" };
}

/** Midpoint of a sleep period in minutes after local noon (0–1440). */
export function sleepMidpointAfterNoon(startMs: number, endMs: number, zone: Zone): number {
  const p = localParts(startMs + (endMs - startMs) / 2, zone);
  return ((p.hour * 60 + p.minute) - 720 + 1440) % 1440;
}

// ─── Domain scorers ─────────────────────────────────────────────────────────
// Each returns an undefined sub-score when there isn't enough data — never
// a fabricated fallback.

const W = READINESS_V1.weights;

function excluded(metric: DomainId, description: string): ComponentResult {
  return { metric, weight: 0, nominalWeight: W[metric], confidence: 0, included: false, personal: false, description };
}

function sleepDurationScore(ratio: number): number {
  if (ratio >= 1.0) return 100;
  if (ratio >= 0.85) return 80 + ((ratio - 0.85) / 0.15) * 20;
  if (ratio >= 0.6) return 40 + ((ratio - 0.6) / 0.25) * 40;
  return clamp((ratio / 0.6) * 40, 0, 40);
}

/** SD of sleep midpoints: ≤ 30 min → 100, ≥ 120 min → 50, linear between. */
function regularityScore(sdMinutes: number): number {
  if (sdMinutes <= 30) return 100;
  if (sdMinutes >= 120) return 50;
  return 100 - ((sdMinutes - 30) / 90) * 50;
}

export function scoreSleep(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const cfg = READINESS_V1.sleep;
  if (today.sleepMinutes === undefined) return excluded("sleep", "No sleep recorded for last night");
  const prior = history.filter((d) => d.date < today.date && d.sleepMinutes !== undefined).slice(-cfg.baselineWindowNights).map((d) => d.sleepMinutes!);
  const personal = prior.length >= cfg.minNightsForBaseline;
  const need = personal ? median(prior)! : cfg.populationBridgeMinutes;
  const ratio = today.sleepMinutes / Math.max(need, 1);
  const duration = sleepDurationScore(ratio);

  const mids = [...history.filter((d) => d.date < today.date).slice(-(cfg.regularityNights - 1)), today]
    .map((d) => d.sleepMidpoint).filter((m): m is number => m !== undefined);
  let regularity: number | undefined, sd: number | undefined;
  if (mids.length >= cfg.minRegularityNights) {
    const mean = mids.reduce((a, b) => a + b, 0) / mids.length;
    sd = Math.sqrt(mids.reduce((a, b) => a + (b - mean) ** 2, 0) / mids.length);
    regularity = regularityScore(sd);
  }
  const subScore = regularity === undefined
    ? duration
    : duration * cfg.durationShare + regularity * cfg.regularityShare;
  const confidence = personal ? maturity(prior.length, 14, 0.45) : 0.3;
  const description = !personal
    ? `Sleep compared with a general 7-hour reference until ${cfg.minNightsForBaseline} nights build your own`
    : ratio >= 0.95 ? "Sleep met your usual need" : ratio >= 0.8 ? "Sleep was a little short of your usual" : "Sleep was well short of your usual";
  return {
    metric: "sleep", subScore: clamp(subScore, 0, 100), weight: 0, nominalWeight: W.sleep, confidence, included: true, personal,
    description: regularity !== undefined && regularity < 75 ? `${description}; sleep timing has been irregular` : description,
    detail: { sleepMinutes: today.sleepMinutes, needMinutes: Math.round(need), durationScore: Math.round(duration), regularityScore: regularity === undefined ? undefined : Math.round(regularity), midpointSdMinutes: sd === undefined ? undefined : Math.round(sd) },
  };
}

export function scoreCardiovascular(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const cfg = READINESS_V1.cardiovascular;
  const prior = history.filter((d) => d.date < today.date && d.restingHeartRate !== undefined).slice(-cfg.baselineWindowDays).map((d) => d.restingHeartRate!);
  if (today.restingHeartRate === undefined) return excluded("cardiovascular", "No overnight heart rate for last night");
  if (prior.length < cfg.minDaysForBaseline) {
    return excluded("cardiovascular", `Resting heart-rate baseline building (${prior.length} of ${cfg.minDaysForBaseline} nights)`);
  }
  const baseline = median(prior)!;
  const spread = Math.max(1.4826 * (medianAbsoluteDeviation(prior, baseline) ?? 0), cfg.spreadFloorBpm);
  const z = (today.restingHeartRate - baseline) / spread;
  // Elevation beyond normal night-to-night noise lowers the score. A lower
  // resting HR is not penalized: its meaning is ambiguous (Buchheit 2014).
  const subScore = z <= cfg.toleranceSd ? 100 : clamp(100 - 20 * (z - cfg.toleranceSd), 0, 100);
  const recentElevated = [...prior.slice(-2), today.restingHeartRate].filter((v) => (v - baseline) / spread > 1).length;
  const description = z > 2 ? "Resting heart rate is well above your baseline"
    : z > 1 ? "Resting heart rate is above your baseline"
    : z < -1 ? "Resting heart rate is below your baseline"
    : "Resting heart rate is in your usual range";
  return {
    metric: "cardiovascular", subScore, weight: 0, nominalWeight: W.cardiovascular,
    confidence: maturity(prior.length, cfg.maturityDays, 0.35), included: true, personal: true,
    description: recentElevated >= 3 ? `${description} (elevated 3 nights running)` : description,
    detail: { restingHR: today.restingHeartRate, baselineHR: Math.round(baseline), deviationSd: Math.round(z * 10) / 10 },
  };
}

function loadDayConfidence(d: LoadDay & { confidence?: string }): number {
  if (d.status === "rest") return 0.8; // band worn, no sessions — a measured zero
  switch (d.confidence) {
    case "HIGH_CONFIDENCE": return 1;
    case "MODERATE_CONFIDENCE": return 0.7;
    case "LOW_CONFIDENCE": return 0.4;
    default: return 0.1;
  }
}

/** Recent load vs the personal reference. Typical or lighter load = 100 (rest
 * is never penalized); above typical, the score eases down to a floor — load
 * is context for recovery, not a measurement of it. */
export function scoreRecentLoad(input: RecentLoadInput | undefined): ComponentResult {
  const cfg = READINESS_V1.recentLoad;
  if (!input || input.reference === undefined || input.reference <= 0) {
    return excluded("recentLoad", "Recent-load baseline still building (your typical training day isn't established yet)");
  }
  const last3 = input.days.slice(-3).reverse(); // yesterday first
  let wSum = 0, acc = 0, conf = 0;
  last3.forEach((d, i) => {
    if (d.status !== "measured" && d.status !== "rest") return;
    const w = cfg.dayWeights[i] ?? 0;
    wSum += w;
    acc += w * (d.load / input.reference!);
    conf += w * loadDayConfidence(d);
  });
  if (wSum === 0) return excluded("recentLoad", "No load data for the last three days");
  const acute = acc / wSum;
  let subScore = acute <= 1 ? 100
    : acute <= 2 ? 100 - (acute - 1) * 25
    : acute <= 3 ? 75 - (acute - 2) * 20
    : 55 - Math.min(1, acute - 3) * 10;
  const streak = input.rolling?.consecutiveHighLoadDays ?? 0;
  if (streak >= 3) subScore -= Math.min(15, (streak - 2) * 5);
  subScore = clamp(subScore, cfg.floor, 100);
  const coverage = wSum / cfg.dayWeights.reduce((a, b) => a + b, 0);
  const yesterday = last3[0];
  const yRel = yesterday && (yesterday.status === "measured" || yesterday.status === "rest") ? yesterday.load / input.reference : undefined;
  const description = streak >= 3 ? `${streak} high-load days in a row`
    : acute > 2 ? "Recent load is well above your typical days"
    : acute > 1.25 ? "Recent load is above your typical days"
    : "Recent load is within your usual range";
  return {
    metric: "recentLoad", subScore: Math.round(subScore * 10) / 10, weight: 0, nominalWeight: W.recentLoad,
    confidence: clamp((conf / wSum) * coverage, 0, 1), included: true, personal: true, description,
    detail: {
      yesterdayRelative: yRel === undefined ? undefined : Math.round(yRel * 100) / 100,
      threeDayRelative: Math.round(acute * 100) / 100,
      sevenDayRelative: input.rolling?.windows.d7.relativeToBaseline,
      consecutiveHighLoadDays: streak,
      knownDaysOf3: last3.filter((d) => d.status === "measured" || d.status === "rest").length,
    },
  };
}

export function scorePhysiological(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const min = READINESS_V1.physiological.minDaysForBaseline;
  const spo2Prior = history.filter((d) => d.date < today.date && d.spo2 !== undefined).slice(-28).map((d) => d.spo2!);
  const tempPrior = history.filter((d) => d.date < today.date && d.skinTemperature !== undefined).slice(-28).map((d) => d.skinTemperature!);
  const subs: number[] = [], confs: number[] = [], notes: string[] = [];
  const detail: Record<string, number | undefined> = {};
  if (today.spo2 !== undefined && spo2Prior.length >= min) {
    const b = median(spo2Prior)!;
    const d = (today.spo2 - b) / Math.max(1.4826 * (medianAbsoluteDeviation(spo2Prior, b) ?? 0), 0.5);
    subs.push(d < -1 ? clamp(100 + (d + 1) * 15, 0, 100) : 100); // only a DROP matters
    confs.push(maturity(spo2Prior.length, 21, 0.3));
    detail.spo2DeviationSd = Math.round(d * 10) / 10;
    if (d < -1.5) notes.push("SpO2 is below your usual range");
  }
  if (today.skinTemperature !== undefined && tempPrior.length >= min) {
    const b = median(tempPrior)!;
    const d = Math.abs(today.skinTemperature - b) / Math.max(1.4826 * (medianAbsoluteDeviation(tempPrior, b) ?? 0), 0.2);
    subs.push(d > 1.5 ? clamp(100 - (d - 1.5) * 20, 0, 100) : 100);
    confs.push(maturity(tempPrior.length, 21, 0.3));
    detail.temperatureDeviationSd = Math.round(d * 10) / 10;
    if (d > 1.5) notes.push("Skin temperature is outside your usual range");
  }
  if (subs.length === 0) return excluded("physiological", `SpO2/temperature baseline building (needs ${min} days)`);
  return {
    metric: "physiological", subScore: subs.reduce((a, b) => a + b, 0) / subs.length, weight: 0, nominalWeight: W.physiological,
    confidence: confs.reduce((a, b) => a + b, 0) / confs.length, included: true, personal: true,
    description: notes[0] ?? "SpO2 and temperature are in your usual range", detail,
  };
}

// ─── Combination ─────────────────────────────────────────────────────────

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.7) return "HIGH";
  if (c >= 0.45) return "MODERATE";
  if (c >= 0.2) return "LOW";
  return "INSUFFICIENT";
}

export function computeReadinessScore(history: DailyAggregate[], today: DailyAggregate, recentLoad?: RecentLoadInput): ReadinessScoreOutput {
  const raw = [scoreSleep(history, today), scoreCardiovascular(history, today), scoreRecentLoad(recentLoad), scorePhysiological(history, today)];
  const active = raw.filter((c) => c.included && c.subScore !== undefined);
  const missingInputs = raw.filter((c) => !c.included).map((c) => c.description);
  const core = active.some((c) => c.metric === "sleep" || c.metric === "cardiovascular");

  if (!core) {
    return {
      score: null, confidence: 0, confidenceLevel: "INSUFFICIENT", state: "NOT_ENOUGH_DATA",
      components: raw.map((c) => ({ ...c, weight: 0 })), missingInputs, version: READINESS_V1.version,
    };
  }
  const total = active.reduce((s, c) => s + c.nominalWeight, 0);
  const components = raw.map((c) => (c.included && c.subScore !== undefined ? { ...c, weight: c.nominalWeight / total } : { ...c, weight: 0 }));
  const score = clamp(Math.round(components.reduce((s, c) => s + (c.subScore ?? 0) * c.weight, 0)), 0, 100);
  // Nominal weights: every missing domain lowers confidence.
  const confidence = clamp(active.reduce((s, c) => s + c.confidence * c.nominalWeight, 0), 0, 1);
  const level = confidenceLevel(confidence);
  const state: ReadinessState = !active.some((c) => c.personal) ? "BUILDING_BASELINE"
    : level === "LOW" || level === "INSUFFICIENT" ? "LOW_CONFIDENCE"
    : "READY";
  return { score, confidence, confidenceLevel: level, state, components, missingInputs, version: READINESS_V1.version };
}

export function scoreBand(score: number): string {
  if (score >= 85) return "Highly Ready";
  if (score >= 70) return "Ready";
  if (score >= 55) return "Moderate";
  if (score >= 40) return "Caution";
  return "Low Readiness";
}

/** Presentation label for numeric confidence (the levels above, in words). */
export function confidenceBand(confidence: number): string {
  switch (confidenceLevel(confidence)) {
    case "HIGH": return "High";
    case "MODERATE": return "Moderate";
    case "LOW": return "Low";
    default: return "Insufficient";
  }
}

export type SleepSignal = "good" | "poor" | "neutral" | "insufficient" | "unavailable";

/**
 * Coarse good/poor/neutral sleep signal for notifications, from the sleep
 * domain's own sub-score and confidence — never a separate threshold. Below
 * 0.35 confidence it reports "insufficient" so a maturing baseline can't
 * produce a confident-sounding notification.
 */
export function deriveSleepSignal(sleepComponent: Pick<ComponentResult, "subScore" | "confidence"> | undefined): SleepSignal {
  if (sleepComponent?.subScore === undefined) return "unavailable";
  if (sleepComponent.confidence < 0.35) return "insufficient";
  if (sleepComponent.subScore >= 85) return "good";
  if (sleepComponent.subScore <= 45) return "poor";
  return "neutral";
}
