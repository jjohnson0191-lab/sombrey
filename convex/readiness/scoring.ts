/**
 * Sombrey Readiness Score v1 — pure scoring math, no Convex/DB
 * dependency. `convex/readiness.ts` gathers real data and calls
 * `computeReadinessScore()`; this file never touches a database and is
 * directly unit-testable (see `scoring.test.ts`).
 *
 * SCIENTIFIC BASIS (own synthesis from public sports-science literature —
 * no proprietary Whoop/Oura/Garmin/Apple formula is used or approximated):
 *
 * - Sleep duration relative to a person's own typical need is one of the
 *   most consistently reported correlates of next-day physical and
 *   cognitive performance (e.g. Fullagar et al. 2015, "Sleep and
 *   Athletic Performance" review). We score sleep as a ratio to the
 *   user's own rolling median, not a fixed universal number, bridged by
 *   a population reference (7h) only until a personal baseline exists.
 * - Morning/resting heart rate elevated above a person's own baseline is
 *   one of the oldest, simplest recovery-monitoring markers in sports
 *   science (predates wearables entirely — see Achten & Jeukendrup 2003
 *   review of HR-based training monitoring), and is the best cardiovascular
 *   recovery proxy available from this SDK/device. HRV, the more modern
 *   gold-standard autonomic marker (Plews et al. 2013; Buchheit 2014), is
 *   deliberately NOT used — the vendor's own SDK documentation marks it
 *   (and stress) as ring-only, and this cannot be confirmed on the
 *   physical Sombrey Band without device testing.
 * - Recent-vs-longer-term training load ("acute:chronic workload ratio")
 *   is a widely discussed injury/fatigue-risk concept (Gabbett 2016,
 *   "The training-injury prevention paradox"), with real, acknowledged
 *   methodological criticism (Impellizzeri et al. 2020). We use a
 *   simplified, clearly-caveated version — total Sport+ session minutes
 *   as the load unit (no session-RPE or HR-based intensity weighting is
 *   available from this integration yet) — and only penalize sharp
 *   *increases*, not reduced training, matching what the literature
 *   actually flags as risk.
 * - SpO2/skin-temperature deviation from personal baseline is included
 *   as a small bonus signal only (10% max weight) — consumer wrist-PPG
 *   sensors are considerably noisier than sleep/HR data, and this is
 *   explicitly never framed as medical or diagnostic anywhere in the UI.
 * - Individual-baseline deviation (rather than population norms) as the
 *   core personalization mechanism is standard, published
 *   sports-science methodology for individual monitoring (e.g. the
 *   rolling-log + coefficient-of-variation approach in Plews et al.'s
 *   HRV-guided-training work) — a general, public methodology, not a
 *   proprietary algorithm.
 *
 * KNOWN V1 LIMITATIONS (documented, not hidden):
 * - Training "load" is duration-only — no intensity weighting.
 * - Baselines are a rolling 30-day median, recomputed at score time —
 *   robust to single bad days, but not a true EWMA; that's a reasonable
 *   future improvement, not implemented here to avoid over-engineering
 *   a V1.
 * - Consumer optical HR/SpO2/temperature sensors have real accuracy
 *   limitations this algorithm cannot correct for.
 */

export const ALGORITHM_VERSION = "v1";

export interface DailyAggregate {
  /** YYYY-MM-DD, local to the user. */
  date: string;
  sleepMinutes?: number;
  restingHeartRate?: number;
  spo2?: number;
  skinTemperature?: number;
  trainingMinutes: number; // 0 when nothing logged that day — a real, not-missing observation
}

export interface ComponentResult {
  metric: string;
  /** 0-100, undefined when this component couldn't be computed. */
  subScore?: number;
  /** The weight actually used after redistributing missing components' weight. */
  weight: number;
  /** 0-1 — how much this component's own baseline can be trusted. */
  confidence: number;
  description: string;
  included: boolean;
}

export interface ReadinessScoreOutput {
  score: number | null;
  confidence: number;
  components: ComponentResult[];
  missingInputs: string[];
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
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function maturityConfidence(sampleCount: number, maturityDays: number, floor: number): number {
  if (sampleCount <= 0) return 0;
  return clamp(floor + (1 - floor) * (sampleCount / maturityDays), floor, 1);
}

// ─── Component scorers ──────────────────────────────────────────────────────
// Each returns `undefined` subScore when there truly isn't enough data —
// never a fabricated fallback number.

const POPULATION_SLEEP_MINUTES = 420; // 7h — a bridge for cold start only, not a claim of ideal sleep

function scoreSleep(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const priorNights = history
    .filter((d) => d.date !== today.date && d.sleepMinutes !== undefined)
    .map((d) => d.sleepMinutes as number);

  if (today.sleepMinutes === undefined) {
    return { metric: "sleep", weight: 0, confidence: 0, included: false, description: "No sleep data synced yet" };
  }

  const hasPersonalBaseline = priorNights.length >= 3;
  const baseline = hasPersonalBaseline ? (median(priorNights) as number) : POPULATION_SLEEP_MINUTES;
  const ratio = today.sleepMinutes / Math.max(baseline, 1);

  let subScore: number;
  if (ratio >= 1.0) subScore = 100;
  else if (ratio >= 0.85) subScore = 80 + ((ratio - 0.85) / 0.15) * 20;
  else if (ratio >= 0.6) subScore = 40 + ((ratio - 0.6) / 0.25) * 40;
  else subScore = clamp((ratio / 0.6) * 40, 0, 40);

  // Consistency: recent night-to-night variability, a small capped penalty.
  const recentNights = priorNights.slice(-7);
  if (recentNights.length >= 3) {
    const m = median(recentNights) as number;
    const variance = recentNights.reduce((sum, v) => sum + (v - m) ** 2, 0) / recentNights.length;
    const stdevMinutes = Math.sqrt(variance);
    if (stdevMinutes > 90) subScore -= 5;
  }
  subScore = clamp(subScore, 0, 100);

  const confidence = hasPersonalBaseline ? maturityConfidence(priorNights.length, 14, 0.4) : 0.4;
  const description =
    ratio >= 0.95 ? "Sleep duration is strong" : ratio >= 0.8 ? "Sleep duration is slightly below typical" : "Sleep duration is well below typical";

  return { metric: "sleep", subScore, weight: 0, confidence, included: true, description };
}

function scoreCardiovascular(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const priorReadings = history
    .filter((d) => d.date !== today.date && d.restingHeartRate !== undefined)
    .map((d) => d.restingHeartRate as number);

  if (today.restingHeartRate === undefined || priorReadings.length < 3) {
    return {
      metric: "cardiovascular",
      weight: 0,
      confidence: 0,
      included: false,
      description: priorReadings.length < 3 ? "Resting heart rate baseline still building" : "No heart rate data synced yet",
    };
  }

  const baseline = median(priorReadings) as number;
  const mad = medianAbsoluteDeviation(priorReadings, baseline) ?? 2;
  const spread = Math.max(mad, 2); // floor: real BPM sensor/round-off noise
  const deviation = (today.restingHeartRate - baseline) / spread;

  const subScore = deviation > 0 ? clamp(100 - deviation * 20, 0, 100) : clamp(100 - deviation * 8, 85, 100);
  const confidence = maturityConfidence(priorReadings.length, 21, 0.3);
  const description = deviation > 1.5 ? "Heart rate is elevated versus your baseline" : deviation > 0.5 ? "Heart rate is slightly elevated" : "Recovery trend is stable";

  return { metric: "cardiovascular", subScore, weight: 0, confidence, included: true, description };
}

function scoreTrainingLoad(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const last7 = [...history.filter((d) => d.date !== today.date).slice(-6), today];
  const last28 = history.filter((d) => d.date !== today.date).slice(-27).concat([today]);

  const acute = last7.reduce((sum, d) => sum + d.trainingMinutes, 0) / last7.length;
  const chronicSamples = last28.filter((d) => d.trainingMinutes > 0 || last28.length >= 14);
  const chronic = last28.reduce((sum, d) => sum + d.trainingMinutes, 0) / Math.max(last28.length, 1);

  if (acute === 0 && chronic === 0) {
    return { metric: "trainingLoad", weight: 0, confidence: 0, included: false, description: "No recent training sessions logged" };
  }

  if (chronic < 0.01 || last28.length < 7) {
    // Not enough history to assess a trend yet — acknowledge activity
    // happened without pretending we can judge acute:chronic balance.
    return {
      metric: "trainingLoad",
      subScore: 70,
      weight: 0,
      confidence: 0.25,
      included: true,
      description: "Training history still building",
    };
  }

  const ratio = acute / Math.max(chronic, 1);
  let subScore: number;
  let description: string;
  if (ratio <= 1.3) {
    subScore = 100 - clamp((ratio - 0.8) * 20, 0, 10); // sensible range, near-flat
    description = "Recent training load is balanced";
  } else if (ratio <= 1.5) {
    subScore = 90 - ((ratio - 1.3) / 0.2) * 30;
    description = "Recent training load is elevated";
  } else {
    subScore = clamp(60 - (ratio - 1.5) * 30, 0, 60);
    description = "Recent training load has spiked sharply";
  }
  subScore = clamp(subScore, 0, 100);

  const confidence = maturityConfidence(Math.min(last28.length, chronicSamples.length + 7), 28, 0.35);
  return { metric: "trainingLoad", subScore, weight: 0, confidence, included: true, description };
}

function scorePhysiological(history: DailyAggregate[], today: DailyAggregate): ComponentResult {
  const spo2Prior = history.filter((d) => d.date !== today.date && d.spo2 !== undefined).map((d) => d.spo2 as number);
  const tempPrior = history.filter((d) => d.date !== today.date && d.skinTemperature !== undefined).map((d) => d.skinTemperature as number);

  const subScores: number[] = [];
  const confidences: number[] = [];
  const notes: string[] = [];

  if (today.spo2 !== undefined && spo2Prior.length >= 5) {
    const baseline = median(spo2Prior) as number;
    const mad = medianAbsoluteDeviation(spo2Prior, baseline) ?? 0.5;
    const deviation = (today.spo2 - baseline) / Math.max(mad, 0.5);
    subScores.push(deviation < 0 ? clamp(100 + deviation * 15, 0, 100) : 100);
    confidences.push(maturityConfidence(spo2Prior.length, 14, 0.3));
    if (deviation < -1.5) notes.push("SpO2 is below your baseline");
  }

  if (today.skinTemperature !== undefined && tempPrior.length >= 5) {
    const baseline = median(tempPrior) as number;
    const mad = medianAbsoluteDeviation(tempPrior, baseline) ?? 0.2;
    const deviation = Math.abs(today.skinTemperature - baseline) / Math.max(mad, 0.2);
    subScores.push(deviation > 1.5 ? clamp(100 - (deviation - 1.5) * 20, 0, 100) : 100);
    confidences.push(maturityConfidence(tempPrior.length, 14, 0.3));
    if (deviation > 1.5) notes.push("Skin temperature is outside your usual range");
  }

  if (subScores.length === 0) {
    return { metric: "physiological", weight: 0, confidence: 0, included: false, description: "Not enough SpO2/temperature history yet" };
  }

  const subScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const description = notes[0] ?? "Physiological readings are within your usual range";
  return { metric: "physiological", subScore, weight: 0, confidence, included: true, description };
}

// ─── Combination ─────────────────────────────────────────────────────────

const BASE_WEIGHTS: Record<string, number> = {
  sleep: 0.35,
  cardiovascular: 0.3,
  trainingLoad: 0.25,
  physiological: 0.1,
};

export function computeReadinessScore(history: DailyAggregate[], today: DailyAggregate): ReadinessScoreOutput {
  const raw = [
    scoreSleep(history, today),
    scoreCardiovascular(history, today),
    scoreTrainingLoad(history, today),
    scorePhysiological(history, today),
  ];

  const active = raw.filter((c) => c.included && c.subScore !== undefined);
  const missingInputs = raw.filter((c) => !c.included).map((c) => c.description);

  if (active.length === 0) {
    return {
      score: null,
      confidence: 0,
      components: raw.map((c) => ({ ...c, weight: 0 })),
      missingInputs,
    };
  }

  const totalBaseWeight = active.reduce((sum, c) => sum + BASE_WEIGHTS[c.metric], 0);
  const components = raw.map((c) => {
    if (!c.included || c.subScore === undefined) return { ...c, weight: 0 };
    const weight = BASE_WEIGHTS[c.metric] / totalBaseWeight;
    return { ...c, weight };
  });

  const score = Math.round(components.reduce((sum, c) => sum + (c.subScore ?? 0) * c.weight, 0));
  const confidence = components.reduce((sum, c) => sum + c.confidence * c.weight, 0);

  return {
    score: clamp(score, 0, 100),
    confidence: clamp(confidence, 0, 1),
    components,
    missingInputs,
  };
}

export function scoreBand(score: number): string {
  if (score >= 85) return "Highly Ready";
  if (score >= 70) return "Ready";
  if (score >= 55) return "Moderate";
  if (score >= 40) return "Caution";
  return "Low Readiness";
}

export function confidenceBand(confidence: number): string {
  if (confidence >= 0.7) return "High";
  if (confidence >= 0.35) return "Improving";
  return "Building baseline";
}
