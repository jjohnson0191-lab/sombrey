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
import type { RollingLoad } from "./rollingLoad.ts";

export type ReadinessContext = {
  date: string;
  score?: number;
  state?: string;
  confidenceLevel?: string;
  version: string;
  domains: { metric: string; subScore?: number; weight: number; confidence: number; description: string }[];
};

export type IntelligenceContext = {
  timeZone: string;
  localDate: string;
  currentDay: {
    sessions: { name: string; kind: string; minutes: number; loadBasis: string; confidence: string; rpe?: number }[];
    activeMinutes: number;
    loadConfidence: string;
    strainState: string;
    strainValueShown: false | number;
    loadUnits: number;
    components: { cardio: number; resistance: number; activity: number };
    relativeToBaseline?: number;
  };
  yesterday?: { date: string; status: string; load: number; relativeToBaseline?: number; sessions: number; confidence: string; strainState?: string };
  recent: RollingLoad;
  readiness?: ReadinessContext;
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
  readinessToday?: ReadinessContext;
}): IntelligenceContext {
  const i = p.intelligence;
  const ref = i.baseline.reference;
  const y = i.days.length >= 2 ? i.days[i.days.length - 2] : undefined;
  const yStatus = i.loadDays.length >= 2 ? i.loadDays[i.loadDays.length - 2].status : "no_data";
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
        rpe: l.rpe,
      })),
      activeMinutes: i.today.activeMinutes,
      loadConfidence: i.today.confidence,
      strainState: i.strain.state,
      strainValueShown: i.strain.value !== undefined ? i.strain.value : false,
      loadUnits: i.today.load,
      components: { cardio: i.today.components.cardio, resistance: i.today.components.resistance, activity: i.today.components.activity },
      relativeToBaseline: ref ? Math.round((i.today.load / ref) * 100) / 100 : undefined,
    },
    yesterday: y ? {
      date: y.date, status: yStatus, load: y.load, sessions: y.sessions, confidence: y.confidence,
      relativeToBaseline: ref && (yStatus === "measured" || yStatus === "rest") ? Math.round((y.load / ref) * 100) / 100 : undefined,
      strainState: i.yesterdayStrain?.state,
    } : undefined,
    recent: i.rolling,
    readiness: p.readinessToday,
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
      "Sombrey Strain v1 is shown to the user but NOT yet validated on their band. Quote it with that caveat; never estimate a Strain yourself, and do not base recommendations on Strain alone.",
      "RPE (1–10) is the user's own report of how hard a session felt — a separate signal from measured load. Compare them descriptively; Sombrey has not learned a relationship between them.",
      "Weather is context only — it never changes load or strain.",
      "Relationships are patterns in this user's own history; say 'tended to', never 'causes'.",
      "Readiness and Strain are separate scores and are never combined: Strain = today's physical load; Readiness = sleep, cardiovascular recovery, recent load context and physiological signals. Interpret them together; do not merge them.",
      "Load figures are relative to this user's own typical training day; a day with no band data is unknown, not a rest day.",
    ],
  };
}

export function renderIntelligenceContext(c: IntelligenceContext): string[] {
  const lines = [`Sombrey intelligence (local day ${c.localDate}, time zone ${c.timeZone}):`];
  const d = c.currentDay;
  lines.push(`- Today: ${d.sessions.length} session${d.sessions.length === 1 ? "" : "s"}, ${d.activeMinutes} active min; data confidence ${d.loadConfidence.replace(/_/g, " ").toLowerCase()}; strain ${d.strainValueShown !== false ? `${d.strainValueShown}/100 (v1, not yet validated)` : `state ${d.strainState.replace(/_/g, " ").toLowerCase()}`}.`);
  for (const s of d.sessions) lines.push(`  · ${s.name} (${s.kind}) ${s.minutes} min — load from ${s.loadBasis}; ${s.confidence.replace(/_/g, " ").toLowerCase()}${s.rpe !== undefined ? `; felt ${s.rpe}/10 (user-reported RPE)` : ""}`);
  lines.push(`  · Load today: ${d.loadUnits} units (cardio ${d.components.cardio}, resistance ${d.components.resistance}, activity ${d.components.activity})${d.relativeToBaseline !== undefined ? ` = ${d.relativeToBaseline}× your typical training day` : " — no personal baseline yet"}`);
  if (c.yesterday) {
    const y = c.yesterday;
    lines.push(`- Yesterday (${y.date}): ${y.status === "no_data" ? "no band data — unknown, not zero" : y.status === "rest" ? "rest day (band worn, no sessions)" : `${y.sessions} session${y.sessions === 1 ? "" : "s"}, load ${y.load}${y.relativeToBaseline !== undefined ? ` = ${y.relativeToBaseline}× typical` : ""}`}; confidence ${y.confidence.replace(/_/g, " ").toLowerCase()}`);
  }
  const r = c.recent;
  const win = (label: string, w: RollingLoad["windows"]["d7"]) => `${label}: ${w.knownDays}/${w.days} days known, total ${w.total}${w.relativeToBaseline !== undefined ? `, avg ${w.relativeToBaseline}× typical` : ""}, ${w.activeDays} active, ${w.highLoadDays} high-load`;
  lines.push(`- Recent load (ending yesterday; unknown days excluded, never counted as zero):`);
  for (const [label, w] of [["3 days", r.windows.d3], ["7 days", r.windows.d7], ["14 days", r.windows.d14], ["28 days", r.windows.d28]] as const) lines.push(`  · ${win(label, w)}`);
  lines.push(`  · Personal reference day: ${r.reference !== undefined ? `${r.reference} load units` : "not established"}; consecutive high-load days: ${r.consecutiveHighLoadDays}${r.trend ? `; trend ${r.trend}` : ""}${r.monotony7 !== undefined ? `; 7-day monotony ${r.monotony7} (Foster)` : ""}`);
  if (c.readiness) {
    const rd = c.readiness;
    lines.push(`- Sombrey Readiness (${rd.version}, ${rd.date}): ${rd.score !== undefined ? rd.score : "no score"}; state ${rd.state?.replace(/_/g, " ").toLowerCase() ?? "—"}; confidence ${rd.confidenceLevel?.toLowerCase() ?? "—"}`);
    for (const dm of rd.domains) lines.push(`  · ${dm.metric}: ${dm.subScore !== undefined ? `${Math.round(dm.subScore)}/100 at ${Math.round(dm.weight * 100)}% weight` : "not included"} — ${dm.description}`);
  } else {
    lines.push("- Sombrey Readiness: not calculated yet today");
  }
  if (c.recentHistory.length) lines.push(`- Previous 7 days active minutes: ${c.recentHistory.map((h) => `${h.date.slice(5)} ${h.activeMinutes}`).join(", ")}`);
  if (c.recovery.readinessRecent.length) lines.push(`- Readiness, recent days: ${c.recovery.readinessRecent.map((x) => `${x.date.slice(5)} ${x.score}`).join(", ")}`);
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
