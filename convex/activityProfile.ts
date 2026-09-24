// "Your Tennis": what Sombrey remembers about one activity, from the
// user's own recorded sessions only. Pure (no Convex imports).
//
// An average is only formed from sessions that actually measured the
// value, and says how many sessions it covers — a session without a band
// heart-rate record doesn't drag the heart-rate average toward zero.

export type ProfileSession = {
  startedAt: number;
  durationSeconds?: number;
  averageHeartRate?: number;
  highestHeartRate?: number;
  calories?: number;
  steps?: number;
  distanceMeters?: number;
};

export type Averaged = { value: number; sessions: number };

export type ActivityProfileSummary = {
  sessionCount: number;
  lastStartedAt?: number;
  averageDurationSeconds?: Averaged;
  averageHeartRate?: Averaged;
  averagePeakHeartRate?: Averaged;
  averageCalories?: Averaged;
  averageSteps?: Averaged;
  averageDistanceMeters?: Averaged;
  sessionsLast30Days: number;
  sessionsPrevious30Days: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function averageOf(values: (number | undefined)[]): Averaged | undefined {
  const real = values.filter((v): v is number => v !== undefined && Number.isFinite(v) && v > 0);
  if (real.length === 0) return undefined;
  return { value: real.reduce((a, b) => a + b, 0) / real.length, sessions: real.length };
}

export function summarizeActivity(sessions: ProfileSession[], nowMs: number): ActivityProfileSummary {
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  return {
    sessionCount: sorted.length,
    lastStartedAt: sorted[0]?.startedAt,
    averageDurationSeconds: averageOf(sorted.map((s) => s.durationSeconds)),
    averageHeartRate: averageOf(sorted.map((s) => s.averageHeartRate)),
    averagePeakHeartRate: averageOf(sorted.map((s) => s.highestHeartRate)),
    averageCalories: averageOf(sorted.map((s) => s.calories)),
    averageSteps: averageOf(sorted.map((s) => s.steps)),
    averageDistanceMeters: averageOf(sorted.map((s) => s.distanceMeters)),
    sessionsLast30Days: sorted.filter((s) => s.startedAt >= nowMs - 30 * DAY_MS).length,
    sessionsPrevious30Days: sorted.filter((s) => s.startedAt < nowMs - 30 * DAY_MS && s.startedAt >= nowMs - 60 * DAY_MS).length,
  };
}

export type ActivityUsage = { activityKey: string; count: number; lastStartedAt: number };

/** Per-activity counts and recency, most recent first. */
export function usageOf(items: { activityKey: string; startedAt: number }[]): ActivityUsage[] {
  const byKey = new Map<string, ActivityUsage>();
  for (const item of items) {
    const current = byKey.get(item.activityKey);
    if (current) {
      current.count += 1;
      current.lastStartedAt = Math.max(current.lastStartedAt, item.startedAt);
    } else {
      byKey.set(item.activityKey, { activityKey: item.activityKey, count: 1, lastStartedAt: item.startedAt });
    }
  }
  return [...byKey.values()].sort((a, b) => b.lastStartedAt - a.lastStartedAt);
}
