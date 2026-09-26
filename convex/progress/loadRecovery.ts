// Load ↔ Recovery — each day's measured load beside the next morning's
// readiness. Pure. A relationship is described only when there are enough
// paired days and the pattern is strong enough to say anything.

import { dailyLoad } from "./strainEngine.ts";
import { type ProgressSession, type ReadinessDay, dayKey } from "./model.ts";

export type LoadRecoveryDay = { date: string; activeMinutes: number; sessions: number; readiness?: number; nextMorningReadiness?: number };

export type LoadRecovery = {
  days: LoadRecoveryDay[];
  pairedDays: number;
  relationship?: { correlation: number; statement: string };
};

export const MIN_PAIRED_DAYS = 21;
export const MIN_CORRELATION = 0.4;

export function pearson(xs: number[], ys: number[]): number | undefined {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return undefined;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx === 0 || dy === 0 ? undefined : num / Math.sqrt(dx * dy);
}

/** Readiness dates are the day they describe (the morning after the night). */
export function loadRecovery(sessions: ProgressSession[], readiness: ReadinessDay[], nowMs: number, tz: number, days = 7): LoadRecovery {
  const scoreByDate = new Map(readiness.filter((r) => r.score !== undefined).map((r) => [r.date, r.score!]));
  const byDay = new Map<string, ProgressSession[]>();
  for (const s of sessions) { const k = dayKey(s.startedAt, tz); byDay.set(k, [...(byDay.get(k) ?? []), s]); }
  const keyAt = (i: number) => dayKey(nowMs - i * 86_400_000, tz);
  const row = (i: number): LoadRecoveryDay => {
    const date = keyAt(i);
    const load = dailyLoad(date, byDay.get(date) ?? []);
    return { date, activeMinutes: load.activeMinutes, sessions: load.sessionCount, readiness: scoreByDate.get(date), nextMorningReadiness: i > 0 ? scoreByDate.get(keyAt(i - 1)) : undefined };
  };
  const shown = Array.from({ length: days }, (_, i) => row(days - 1 - i));

  // Pairs over up to 90 days: load on D, readiness the morning of D+1.
  const pairs: [number, number][] = [];
  for (let i = 1; i <= 90; i++) {
    const r = row(i);
    if (r.nextMorningReadiness !== undefined) pairs.push([r.activeMinutes, r.nextMorningReadiness]);
  }
  let relationship: LoadRecovery["relationship"];
  if (pairs.length >= MIN_PAIRED_DAYS) {
    const r = pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    if (r !== undefined && Math.abs(r) >= MIN_CORRELATION) {
      relationship = {
        correlation: Math.round(r * 100) / 100,
        statement: r < 0
          ? "Higher-load days have typically been followed by lower readiness the next morning."
          : "Higher-load days have typically been followed by higher readiness the next morning.",
      };
    }
  }
  return { days: shown, pairedDays: pairs.length, relationship };
}
