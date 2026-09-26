// The AI Coach's intelligence context — one structured object, then text. Pure.
//
// Sections: current day, recent history, recovery, training, environment,
// body, performance, data quality. Every fact carries its basis. Rules for
// the coach are part of the context:
//   - Strain is NOT validated: no strain number is given, and the coach must
//     not base recommendations on load/strain.
//   - Weather is context only.
//   - Relationships are patterns in this user's history ("tended to").

import type { Relationship } from "./relationships.ts";
import type { EnvironmentState } from "./environment.ts";
import type { IntelligenceDays } from "./pipeline.ts";
import type { HeartRateProfile } from "./zones.ts";

export type IntelligenceContext = {
  timeZone: string;
  localDate: string;
  currentDay: {
    sessions: { name: string; kind: string; minutes: number; loadBasis: string; confidence: string }[];
    activeMinutes: number;
    loadConfidence: string;
    strainState: string;
    strainValueShown: false | number;
  };
  recentHistory: { date: string; activeMinutes: number; sessions: number }[];
  recovery: { readinessToday?: number; readinessRecent: { date: string; score: number }[]; relationships: Relationship[] };
  training: { trainingDaysThisWeek: number; activeDaysThisWeek: number; minutesThisWeek: number; usualTrainingDays?: number; planned?: { completed: number; scheduled: number } };
  environment: EnvironmentState;
  body: { weightKg?: number; weightSource?: string; changeKg?: number };
  performance: { records: string[]; insights: string[] };
  dataQuality: { restingHR: string; maxHR: string; baseline: string };
  rules: string[];
};

export function buildIntelligenceContext(p: {
  timeZone: string;
  intelligence: IntelligenceDays;
  profile: HeartRateProfile;
  sessionNames: Map<string, string>;
  readiness: { date: string; score?: number }[];
  relationships: Relationship[];
  week: { trainingDays: number; activeDays: number; minutes: number; plannedCompleted: number; plannedScheduled?: number };
  usualTrainingDays?: number;
  environment: EnvironmentState;
  body: { weightKg?: number; source?: string; changeKg?: number };
  records: string[];
  insights: string[];
}): IntelligenceContext {
  const i = p.intelligence;
  const recent = i.days.slice(-8, -1);
  const readinessRecent = p.readiness.filter((r) => r.score !== undefined).slice(0, 7).map((r) => ({ date: r.date, score: r.score! }));
  return {
    timeZone: p.timeZone,
    localDate: i.today.date,
    currentDay: {
      sessions: i.todaySessions.map((l) => ({
        name: p.sessionNames.get(l.id) ?? l.kind,
        kind: l.kind,
        minutes: Math.round(l.minutes),
        loadBasis: [l.aerobicBasis === "cardio" ? "heart rate" : l.aerobicBasis === "activity" ? "activity type (no usable heart rate)" : undefined, (l.resistance?.completedSets ?? 0) > 0 ? `${l.resistance!.completedSets} sets` : undefined].filter(Boolean).join(" + ") || "duration only",
        confidence: l.confidence,
      })),
      activeMinutes: i.today.activeMinutes,
      loadConfidence: i.today.confidence,
      strainState: i.strain.state,
      strainValueShown: i.strain.approved && i.strain.value !== undefined ? i.strain.value : false,
    },
    recentHistory: recent.map((d) => ({ date: d.date, activeMinutes: d.activeMinutes, sessions: d.sessions })),
    recovery: { readinessToday: p.readiness.find((r) => r.date === i.today.date)?.score, readinessRecent, relationships: p.relationships },
    training: {
      trainingDaysThisWeek: p.week.trainingDays, activeDaysThisWeek: p.week.activeDays, minutesThisWeek: p.week.minutes,
      usualTrainingDays: p.usualTrainingDays,
      planned: p.week.plannedScheduled ? { completed: p.week.plannedCompleted, scheduled: p.week.plannedScheduled } : undefined,
    },
    environment: p.environment,
    body: { weightKg: p.body.weightKg, weightSource: p.body.source, changeKg: p.body.changeKg },
    performance: { records: p.records, insights: p.insights },
    dataQuality: {
      restingHR: p.profile.restingHR !== undefined ? `${p.profile.restingHR} bpm (band resting readings, median)` : "not available",
      maxHR: p.profile.maxHR !== undefined ? `${p.profile.maxHR} bpm (${p.profile.maxSource === "measured" ? "measured" : p.profile.maxSource === "observed_peak" ? "highest observed" : "estimated from age, Tanaka"})` : "not available (no date of birth)",
      baseline: `${i.baseline.status} — ${i.baseline.historyDays} days of history, ${i.baseline.activeDays} active days, ${i.baseline.qualitySessions} good-quality sessions`,
    },
    rules: [
      "Sombrey Strain is not validated yet: no strain number exists for the user. Do not estimate one, and do not base recommendations on strain or load scores.",
      "Weather is context only — it never changes load or strain.",
      "Relationships are patterns in this user's own history; say 'tended to', never 'causes'.",
      "Readiness v1 is separate from strain and is never combined with it.",
    ],
  };
}

export function renderIntelligenceContext(c: IntelligenceContext): string[] {
  const lines = [`Sombrey intelligence (local day ${c.localDate}, time zone ${c.timeZone}):`];
  const d = c.currentDay;
  lines.push(`- Today: ${d.sessions.length} session${d.sessions.length === 1 ? "" : "s"}, ${d.activeMinutes} active min; data confidence ${d.loadConfidence.replace(/_/g, " ").toLowerCase()}; strain state ${d.strainState.replace(/_/g, " ").toLowerCase()} (no strain number shown).`);
  for (const s of d.sessions) lines.push(`  · ${s.name} (${s.kind}) ${s.minutes} min — load from ${s.loadBasis}; ${s.confidence.replace(/_/g, " ").toLowerCase()}`);
  if (c.recentHistory.length) lines.push(`- Previous 7 days active minutes: ${c.recentHistory.map((h) => `${h.date.slice(5)} ${h.activeMinutes}`).join(", ")}`);
  if (c.recovery.readinessRecent.length) lines.push(`- Readiness (v1), recent: ${c.recovery.readinessRecent.map((r) => `${r.date.slice(5)} ${r.score}`).join(", ")}`);
  for (const r of c.recovery.relationships) lines.push(`- Pattern (${r.n} days, Spearman ρ=${r.rho}): ${r.statement}`);
  const t = c.training;
  lines.push(`- This week: ${t.trainingDaysThisWeek} training days, ${t.activeDaysThisWeek} active days, ${t.minutesThisWeek} min${t.planned ? `, ${t.planned.completed} of ${t.planned.scheduled} planned workouts` : ""}${t.usualTrainingDays !== undefined ? `; usual ${t.usualTrainingDays} training days/week` : ""}`);
  const e = c.environment;
  if (e.state === "unavailable") lines.push(`- Environment: weather unavailable (${e.reason.replace(/_/g, " ")})`);
  else {
    const s = e.snapshot;
    lines.push(`- Environment${e.stale ? " (stale)" : ""}: ${[s.locality, s.temperatureC !== undefined ? `${Math.round(s.temperatureC)}°C` : undefined, s.feelsLikeC !== undefined ? `feels like ${Math.round(s.feelsLikeC)}°C (calculated)` : undefined, s.humidityPct !== undefined ? `${Math.round(s.humidityPct)}% humidity` : undefined, s.condition].filter(Boolean).join(", ")} — context only`);
  }
  if (c.body.weightKg !== undefined) lines.push(`- Body weight: ${c.body.weightKg} kg (${c.body.weightSource ?? "recorded"})${c.body.changeKg !== undefined ? `, ${c.body.changeKg > 0 ? "+" : ""}${c.body.changeKg} kg since baseline` : ""}`);
  for (const r of c.performance.records) lines.push(`- Personal record: ${r}`);
  for (const r of c.performance.insights) lines.push(`- You vs you: ${r}`);
  lines.push(`- Data quality: resting HR ${c.dataQuality.restingHR}; max HR ${c.dataQuality.maxHR}; baseline ${c.dataQuality.baseline}`);
  lines.push("- Rules:");
  for (const r of c.rules) lines.push(`  · ${r}`);
  return lines;
}
