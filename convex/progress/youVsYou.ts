// You vs You — the user against their own history. Pure. An insight exists
// only when both periods have enough data and the change is meaningful;
// each carries its basis.

import { comparePeriods, pct, MIN_POINTS_PER_PERIOD } from "./baseline.ts";
import { type ProgressSession, type ReadinessDay, type WeightEntry, DAY_MS, minutes } from "./model.ts";

export type Insight = { id: string; text: string; basis: string };

const inWindow = <T>(items: T[], at: (t: T) => number, from: number, to: number) => items.filter((i) => at(i) > from && at(i) <= to);

export function youVsYou(
  sessions: ProgressSession[], readiness: ReadinessDay[], weights: WeightEntry[],
  nowMs: number, displayName: (key: string) => string,
): Insight[] {
  const out: Insight[] = [];
  const d30 = 30 * DAY_MS;
  const cur = inWindow(sessions, (s) => s.startedAt, nowMs - d30, nowMs);
  const prev = inWindow(sessions, (s) => s.startedAt, nowMs - 2 * d30, nowMs - d30);

  // Training frequency (workouts) — last 30 days vs the 30 before.
  const cw = cur.filter((s) => s.kind === "workout").length, pw = prev.filter((s) => s.kind === "workout").length;
  if (cw >= MIN_POINTS_PER_PERIOD && pw >= MIN_POINTS_PER_PERIOD && Math.abs(cw - pw) / pw >= 0.1) {
    out.push({ id: "training-frequency", text: `Training frequency is ${pct((cw - pw) / pw)} ${cw > pw ? "higher" : "lower"} than the previous 30 days (${cw} vs ${pw} workouts).`, basis: "Workouts, last 60 days" });
  }
  // Active time.
  const cm = cur.reduce((a, s) => a + minutes(s), 0), pm = prev.reduce((a, s) => a + minutes(s), 0);
  if (cur.length >= MIN_POINTS_PER_PERIOD && prev.length >= MIN_POINTS_PER_PERIOD && pm > 0 && Math.abs(cm - pm) / pm >= 0.1) {
    out.push({ id: "active-time", text: `You've recorded ${pct((cm - pm) / pm)} ${cm > pm ? "more" : "less"} active time in the last 30 days than in the 30 before.`, basis: "Workouts and activities, last 60 days" });
  }
  // Pace/speed per activity with recorded speed.
  const keys = [...new Set(sessions.filter((s) => s.kind === "activity" && s.activityKey).map((s) => s.activityKey!))];
  for (const key of keys) {
    const speeds = (list: ProgressSession[]) => list.filter((s) => s.activityKey === key && (s.averageSpeed ?? 0) > 0.3).map((s) => s.averageSpeed!);
    const c = comparePeriods(speeds(cur), speeds(prev));
    if (c) {
      out.push({ id: `speed:${key}`, text: `Your average ${displayName(key)} speed ${c.change > 0 ? "has improved" : "has dropped"} ${pct(c.change)} over the last 30 days.`, basis: `${speeds(cur).length} vs ${speeds(prev).length} ${displayName(key)} sessions with recorded speed` });
    }
  }
  // Readiness.
  const scores = (from: number, to: number) => readiness.filter((r) => r.score !== undefined).filter((r) => { const t = Date.parse(r.date); return t > from && t <= to; }).map((r) => r.score!);
  const rc = comparePeriods(scores(nowMs - 14 * DAY_MS, nowMs), scores(nowMs - 28 * DAY_MS, nowMs - 14 * DAY_MS));
  if (rc) {
    out.push({ id: "readiness", text: `Your average readiness is ${pct(rc.change)} ${rc.change > 0 ? "higher" : "lower"} over the last two weeks than the two before.`, basis: "Readiness scores, last 28 days" });
  }
  // Body weight over 30 days.
  const sorted = [...weights].sort((a, b) => a.date - b.date);
  const latest = sorted[sorted.length - 1];
  const monthAgo = [...sorted].reverse().find((w) => w.date <= nowMs - d30);
  if (latest && monthAgo && latest.date > nowMs - 14 * DAY_MS) {
    const diff = Math.round((latest.weightKg - monthAgo.weightKg) * 10) / 10;
    if (Math.abs(diff) >= 0.5) out.push({ id: "weight", text: `Body weight is ${Math.abs(diff)} kg ${diff < 0 ? "lower" : "higher"} than a month ago.`, basis: "Your weight entries" });
  }
  return out;
}
