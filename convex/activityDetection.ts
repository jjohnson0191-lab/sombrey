// "We noticed activity": finds periods where the band's own heart-rate
// readings stayed well above the user's resting level, that no recorded
// activity, workout or sleep explains. Pure (no Convex imports).
//
// This is a prompt, not a classification: it never says WHAT the user did,
// only that their heart rate suggests they were active, and asks. It is
// deliberately conservative — a missed prompt costs nothing, a wrong one
// erodes trust — and it only works on real band readings (live or
// scheduled); sparse readings simply produce no prompts.

export type HeartRateSample = { recordedAt: number; bpm: number };
export type Interval = { startedAt: number; endedAt: number };

export type DetectedWindow = {
  startedAt: number;
  endedAt: number;
  sampleCount: number;
  averageHeartRate: number;
  highestHeartRate: number;
};

const MINUTE = 60 * 1000;

export const DETECTION = {
  /** Beats per minute above the resting baseline that count as active. */
  elevationBpm: 25,
  /** Never treat a reading below this as active, whatever the baseline. */
  floorBpm: 90,
  /** Readings further apart than this don't describe one continuous period. */
  maxGapMs: 16 * MINUTE,
  /** Elevated runs this close together are one period (a short break). */
  mergeGapMs: 10 * MINUTE,
  minDurationMs: 20 * MINUTE,
  minSamples: 3,
  /** Baseline from raw readings needs at least this many of them. */
  minBaselineSamples: 50,
};

/** Resting baseline: the median of the band's resting-heart-rate readings
 * when there are any, else the 10th percentile of all readings (enough of
 * them), else undefined — and with no baseline nothing is detected. */
export function restingBaseline(restingReadings: number[], allReadings: number[]): number | undefined {
  const resting = restingReadings.filter((v) => v > 0).sort((a, b) => a - b);
  if (resting.length > 0) return resting[Math.floor(resting.length / 2)];
  const all = allReadings.filter((v) => v > 0).sort((a, b) => a - b);
  if (all.length < DETECTION.minBaselineSamples) return undefined;
  return all[Math.floor(all.length * 0.1)];
}

function overlaps(a: Interval, b: Interval) {
  return a.startedAt < b.endedAt && b.startedAt < a.endedAt;
}

export function detectActiveWindows(samples: HeartRateSample[], baseline: number | undefined, covered: Interval[]): DetectedWindow[] {
  if (baseline === undefined) return [];
  const threshold = Math.max(baseline + DETECTION.elevationBpm, DETECTION.floorBpm);
  const sorted = samples.filter((s) => s.bpm > 0 && Number.isFinite(s.recordedAt)).sort((a, b) => a.recordedAt - b.recordedAt);

  // Consecutive elevated readings, split wherever readings are too sparse.
  const runs: HeartRateSample[][] = [];
  let run: HeartRateSample[] = [];
  let previous: HeartRateSample | undefined;
  for (const sample of sorted) {
    const contiguous = previous !== undefined && sample.recordedAt - previous.recordedAt <= DETECTION.maxGapMs;
    if (sample.bpm >= threshold) {
      if (run.length > 0 && !contiguous) {
        runs.push(run);
        run = [];
      }
      run.push(sample);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
    previous = sample;
  }
  if (run.length > 0) runs.push(run);

  // Short breaks (a rest between games) don't split a period.
  const merged: HeartRateSample[][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0].recordedAt - last[last.length - 1].recordedAt <= DETECTION.mergeGapMs) {
      last.push(...r);
    } else {
      merged.push([...r]);
    }
  }

  return merged
    .map((r) => ({
      startedAt: r[0].recordedAt,
      endedAt: r[r.length - 1].recordedAt,
      sampleCount: r.length,
      averageHeartRate: Math.round(r.reduce((sum, s) => sum + s.bpm, 0) / r.length),
      highestHeartRate: Math.max(...r.map((s) => s.bpm)),
    }))
    .filter((w) => w.sampleCount >= DETECTION.minSamples && w.endedAt - w.startedAt >= DETECTION.minDurationMs)
    .filter((w) => !covered.some((c) => overlaps(w, c)));
}
