// Progress → AI Coach: structured facts, each with its basis. Pure.
// The coach receives these lines, never raw rows.

import type { StrainDay } from "./strainEngine.ts";
import type { Consistency } from "./consistency.ts";
import type { PersonalRecord } from "./records.ts";
import type { Milestone } from "./milestones.ts";
import type { Insight } from "./youVsYou.ts";
import type { BodySummary } from "./body.ts";
import type { LoadRecovery } from "./loadRecovery.ts";

export function describeProgressForCoach(p: {
  strain: StrainDay; consistency: Consistency; records: PersonalRecord[]; milestones: Milestone[];
  insights: Insight[]; body: BodySummary; loadRecovery: LoadRecovery;
}): string[] {
  const lines: string[] = ["Progress (Sombrey-calculated from recorded data):"];
  lines.push(`- Daily strain: no validated strain score exists yet (engine "${p.strain.engine.id}"). Today's measured load: ${p.strain.load.sessionCount} sessions, ${p.strain.load.activeMinutes} active min.`);
  lines.push(`- Last 7 days of active minutes: ${p.strain.week.map((d) => `${d.date.slice(5)} ${d.activeMinutes}`).join(", ")}`);
  lines.push(p.strain.usualActiveMinutes !== undefined
    ? `- Usual daily active time (median of ${p.strain.baselineDays} days): ${Math.round(p.strain.usualActiveMinutes)} min`
    : `- Usual daily load: not established (${p.strain.baselineDays} days of history)`);
  const w = p.consistency.thisWeek;
  lines.push(`- This week: ${w.trainingDays} training days, ${w.activeDays} active days, ${w.minutes} min${w.plannedScheduled ? `, ${w.plannedCompleted} of ${w.plannedScheduled} planned workouts` : ""}${p.consistency.usualTrainingDays !== undefined ? `; usual ${p.consistency.usualTrainingDays} training days/week` : ""}`);
  const readiness = p.loadRecovery.days.filter((d) => d.readiness !== undefined).map((d) => `${d.date.slice(5)} ${d.readiness}`);
  if (readiness.length) lines.push(`- Readiness, last 7 days: ${readiness.join(", ")}`);
  if (p.loadRecovery.relationship) lines.push(`- Load vs recovery (${p.loadRecovery.pairedDays} paired days, r=${p.loadRecovery.relationship.correlation}): ${p.loadRecovery.relationship.statement}`);
  if (p.body.latest) {
    lines.push(`- Body weight: ${p.body.latest.weightKg} kg (${p.body.latest.source}, ${new Date(p.body.latest.date).toISOString().slice(0, 10)})${p.body.changeKg !== undefined ? `, ${p.body.changeKg > 0 ? "+" : ""}${p.body.changeKg} kg since baseline` : ""}`);
  }
  for (const i of p.insights) lines.push(`- You vs you: ${i.text} [${i.basis}]`);
  for (const r of p.records.slice(0, 6)) lines.push(`- Personal record: ${r.subject} — ${r.metric} ${r.display} (${new Date(r.date).toISOString().slice(0, 10)}, ${r.source})`);
  for (const m of p.milestones.slice(0, 3)) lines.push(`- Milestone: ${m.title} (${new Date(m.achievedAt).toISOString().slice(0, 10)})`);
  return lines;
}
