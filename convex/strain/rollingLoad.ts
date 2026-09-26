// Recent load history — what the user has been doing. Pure.
//
// A day is never silently "zero". Each local day has a status:
//   measured    — sessions with usable load data
//   incomplete  — sessions exist, but none had enough data to measure load
//   rest        — no sessions, but the band was worn/synced that day (a
//                 measured zero)
//   no_data     — no sessions and no sign of the band: UNKNOWN, excluded
//   in_progress — today
// Windows (1/3/7/14/28 days, ending yesterday) summarize measured + rest
// days only; unknown days are counted and reported, never filled in.
//
// Load distribution follows Foster (1998): monotony = mean / SD of daily
// load over 7 days; weekly strain = weekly load × monotony. These are
// CONTEXT (for the coach and readiness's recent-load domain), not penalties
// in themselves.

import type { DailyLoadResult } from "./dailyLoad.ts";

export type DayStatus = "measured" | "incomplete" | "rest" | "no_data" | "in_progress";

export type LoadDay = { date: string; load: number; status: DayStatus; relative?: number; confidence?: string };

/** A "high-load day": at least this multiple of the personal reference. */
export const HIGH_LOAD_MULTIPLE = 1.5;

export function dayStatus(d: DailyLoadResult, wearableSeen: boolean, isToday: boolean): DayStatus {
  if (isToday) return "in_progress";
  if (d.sessions > 0) return d.confidence === "INSUFFICIENT_DATA" && d.load === 0 ? "incomplete" : "measured";
  return wearableSeen ? "rest" : "no_data";
}

export type LoadWindow = {
  days: number;
  knownDays: number;          // measured + rest
  unknownDays: number;        // no_data + incomplete
  total: number;
  averagePerKnownDay?: number;
  highest?: number;
  lowest?: number;
  activeDays: number;
  highLoadDays: number;
  relativeToBaseline?: number; // average known-day load ÷ personal reference
};

export type RollingLoad = {
  reference?: number;
  yesterday?: LoadDay;
  windows: Record<"d1" | "d3" | "d7" | "d14" | "d28", LoadWindow>;
  consecutiveHighLoadDays: number;   // ending yesterday
  highLoadDaysLast7: number;
  monotony7?: number;                // Foster: mean / SD (≥ 5 known days)
  weeklyStrain7?: number;            // Foster: weekly load × monotony
  trend?: "rising" | "steady" | "falling"; // last 7 vs previous 7 known-day averages
};

const known = (d: LoadDay) => d.status === "measured" || d.status === "rest";

/** `days` oldest → newest; the last entry is today (in_progress). */
export function rollingLoad(days: LoadDay[], reference?: number): RollingLoad {
  const past = days.filter((d) => d.status !== "in_progress");
  const window = (n: number): LoadWindow => {
    const w = past.slice(-n);
    const k = w.filter(known);
    const loads = k.map((d) => d.load);
    const total = loads.reduce((a, b) => a + b, 0);
    const avg = k.length ? total / k.length : undefined;
    return {
      days: n,
      knownDays: k.length,
      unknownDays: w.length - k.length + Math.max(0, n - w.length),
      total: round(total),
      averagePerKnownDay: avg === undefined ? undefined : round(avg),
      highest: loads.length ? round(Math.max(...loads)) : undefined,
      lowest: loads.length ? round(Math.min(...loads)) : undefined,
      activeDays: k.filter((d) => d.load > 0).length,
      highLoadDays: reference ? k.filter((d) => d.load >= HIGH_LOAD_MULTIPLE * reference).length : 0,
      relativeToBaseline: reference && avg !== undefined ? round(avg / reference) : undefined,
    };
  };
  let streak = 0;
  if (reference) for (let i = past.length - 1; i >= 0 && known(past[i]) && past[i].load >= HIGH_LOAD_MULTIPLE * reference; i--) streak++;

  const last7 = past.slice(-7).filter(known).map((d) => d.load);
  let monotony: number | undefined, weeklyStrain: number | undefined;
  if (last7.length >= 5) {
    const mean = last7.reduce((a, b) => a + b, 0) / last7.length;
    const sd = Math.sqrt(last7.reduce((a, b) => a + (b - mean) ** 2, 0) / last7.length);
    if (mean > 0) {
      monotony = sd > 0 ? round(mean / sd) : undefined; // identical days: undefined (division by zero), reported as such
      weeklyStrain = monotony !== undefined ? round(mean * last7.length * monotony) : undefined;
    }
  }
  const prev7 = past.slice(-14, -7).filter(known).map((d) => d.load);
  let trend: RollingLoad["trend"];
  if (last7.length >= 4 && prev7.length >= 4) {
    const a = last7.reduce((x, y) => x + y, 0) / last7.length, b = prev7.reduce((x, y) => x + y, 0) / prev7.length;
    trend = b === 0 ? (a > 0 ? "rising" : "steady") : a > b * 1.2 ? "rising" : a < b * 0.8 ? "falling" : "steady";
  }
  const y = past[past.length - 1];
  return {
    reference,
    yesterday: y ? { ...y, relative: reference && known(y) ? round(y.load / reference) : undefined } : undefined,
    windows: { d1: window(1), d3: window(3), d7: window(7), d14: window(14), d28: window(28) },
    consecutiveHighLoadDays: streak,
    highLoadDaysLast7: window(7).highLoadDays,
    monotony7: monotony,
    weeklyStrain7: weeklyStrain,
    trend,
  };
}

function round(x: number): number { return Math.round(x * 1000) / 1000; }
