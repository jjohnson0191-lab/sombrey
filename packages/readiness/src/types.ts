/**
 * Sombrey readiness/recovery domain boundary — Phase 1.
 *
 * These are foundational types only. There is no scoring formula, no
 * normalization logic, no baseline calculation, and no engine
 * implementation in this package yet — none of that is invented here.
 *
 * The planned future module layout (not built yet):
 *
 *   wearable data
 *     -> normalization/   (clean/flag raw samples)
 *     -> baselines/        (rolling personal baselines)
 *     -> derived/           (trend/load/deviation metrics)
 *     -> engine/             (versioned scoring function)
 *     -> versions/            (registry of algorithm implementations)
 *
 * `score` on ReadinessResult is explicitly nullable: the engine, once
 * built, must be able to say "not enough data yet" or "this version
 * doesn't score, it only collects" rather than fabricate a number.
 * Product/UI copy must stay conservative until an algorithm version is
 * actually validated — see the approved product specification.
 */

export type AlgorithmVersion = string; // e.g. "v0-collect-only"

export interface ReadinessInputs {
  userId: string;
  date: string; // YYYY-MM-DD, local to the user
  sleepMinutes?: number;
  restingHeartRate?: number;
  avgHeartRate?: number;
  hrv?: number;
  steps?: number;
  activeCalories?: number;
  recentTrainingLoad?: number;
  spo2?: number;
  skinTemperature?: number;
}

export interface ContributingFactor {
  metric: string;
  description: string;
  /** Reserved for once a validated algorithm defines actual weighting. */
  weight?: number;
}

export interface ReadinessResult {
  userId: string;
  date: string;
  algorithmVersion: AlgorithmVersion;
  /** null when there isn't yet a validated score to show for this date/version. */
  score: number | null;
  /** 0–1, reflects data sufficiency, not scientific confidence. */
  confidence: number;
  contributingFactors: ContributingFactor[];
  missingInputs: string[];
  calculatedAt: number; // epoch ms
}

export interface PersonalBaseline {
  userId: string;
  metricType: string;
  windowDays: number;
  mean: number;
  sampleCount: number;
  confidence: number;
  updatedAt: number; // epoch ms
}
