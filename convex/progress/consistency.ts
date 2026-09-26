// Training consistency — what the user actually did, week by week. Pure.
// No streaks: training days, active days, time, planned-vs-completed, and
// the user's own usual week once there are enough weeks to say.

import { type ProgressSession, DAY_MS, dayKey, median, minutes, startOfLocalWeek } from "./model.ts";

export type WeekDay = { date: string; trained: boolean; active: boolean; minutes: number; isFuture: boolean };

export type WeekSummary = {
  weekStart: number;
  trainingDays: number;   // days with a workout
  activeDays: number;     // days with a workout or an activity
  minutes: number;
  plannedCompleted: number; // plan workouts completed
  sessions: number;
};

export type Consistency = {
  thisWeek: WeekSummary & { days: WeekDay[]; restDays: number; plannedScheduled?: number };
  previousWeeks: WeekSummary[]; // most recent first, up to 8, only weeks since history began
  usualTrainingDays?: number;
  usualActiveMinutes?: number;
};

export const MIN_WEEKS_FOR_USUAL = 3;

function summarize(sessions: ProgressSession[], weekStart: number, tz: number): WeekSummary {
  const inWeek = sessions.filter((s) => s.startedAt >= weekStart && s.startedAt < weekStart + 7 * DAY_MS);
  const trainingDays = new Set(inWeek.filter((s) => s.kind === "workout").map((s) => dayKey(s.startedAt, tz)));
  const activeDays = new Set(inWeek.map((s) => dayKey(s.startedAt, tz)));
  return {
    weekStart,
    trainingDays: trainingDays.size,
    activeDays: activeDays.size,
    minutes: Math.round(inWeek.reduce((sum, s) => sum + minutes(s), 0)),
    plannedCompleted: inWeek.filter((s) => s.fromPlan).length,
    sessions: inWeek.length,
  };
}

/** `plannedPerWeek`: how many of the current plan's days are tied to a
 * weekday (only then is "planned this week" a real number). */
export function consistency(sessions: ProgressSession[], nowMs: number, tz: number, plannedPerWeek?: number): Consistency {
  const weekStart = startOfLocalWeek(nowMs, tz);
  const today = dayKey(nowMs, tz);
  const summary = summarize(sessions, weekStart, tz);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const start = weekStart + i * DAY_MS;
    const key = dayKey(start + 12 * 60 * 60 * 1000, tz);
    const daySessions = sessions.filter((s) => dayKey(s.startedAt, tz) === key);
    return {
      date: key,
      trained: daySessions.some((s) => s.kind === "workout"),
      active: daySessions.length > 0,
      minutes: Math.round(daySessions.reduce((sum, s) => sum + minutes(s), 0)),
      isFuture: key > today,
    };
  });
  const elapsed = days.filter((d) => !d.isFuture).length;
  const first = sessions.length ? Math.min(...sessions.map((s) => s.startedAt)) : undefined;
  const previousWeeks: WeekSummary[] = [];
  for (let i = 1; i <= 8; i++) {
    const start = weekStart - i * 7 * DAY_MS;
    if (first === undefined || start + 7 * DAY_MS <= first) break;
    previousWeeks.push(summarize(sessions, start, tz));
  }
  const enough = previousWeeks.length >= MIN_WEEKS_FOR_USUAL;
  return {
    thisWeek: {
      ...summary,
      days,
      restDays: Math.max(0, elapsed - summary.activeDays),
      plannedScheduled: plannedPerWeek && plannedPerWeek > 0 ? plannedPerWeek : undefined,
    },
    previousWeeks,
    usualTrainingDays: enough ? median(previousWeeks.map((w) => w.trainingDays)) : undefined,
    usualActiveMinutes: enough ? median(previousWeeks.map((w) => w.minutes)) : undefined,
  };
}
