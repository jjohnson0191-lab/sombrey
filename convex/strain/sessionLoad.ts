// Session load — every workout/activity's load components. Pure.
//
// De-duplication hierarchy (each real minute counted once):
//   1. a workout (the user ran it in Sombrey; its band session is attached
//      to it, so that session never appears separately)
//   2. a band or app Sport+ activity
//   3. a period Sombrey noticed and the user named
// A lower-priority session overlapping a higher one keeps only its
// uncovered minutes; one that is mostly covered is dropped as the same
// activity. Deterministic, so recomputing a day gives the same result
// (a late-arriving band record changes the day, never duplicates it).

import { activityLoad, type ActivityLoad } from "./activityLoad.ts";
import { cardiovascularLoad, type CardioLoad, type HRSample } from "./cardiovascularLoad.ts";
import { type Confidence, RANK, blend, downgrade } from "./confidence.ts";
import { resistanceLoad, type ResistanceLoad, type ResistanceSet } from "./resistanceLoad.ts";
import type { HeartRateProfile } from "./zones.ts";
import { STRAIN_V1 } from "./strainConfig.ts";

export type SessionInput = {
  id: string;
  kind: "workout" | "activity";
  origin: string; // sombrey_workout | plan_workout | manual_workout | band_activity | app_activity | noticed_activity
  category?: string;
  activityKey?: string;
  startMs: number;
  endMs: number;
  averageHR?: number;
  calories?: number;
  /** HR readings for this session's window (live stream / scheduled / band series). */
  samples: HRSample[];
  seriesTimingVerified: boolean;
  sets: ResistanceSet[];
  timestampSuspect?: boolean;
  durationSource?: string;
};

export type SessionLoad = {
  id: string;
  kind: "workout" | "activity";
  origin: string;
  category?: string;
  startMs: number;
  endMs: number;
  minutes: number;
  cardio?: CardioLoad;
  resistance?: ResistanceLoad;
  activity?: ActivityLoad;
  /** Which component represents this session's cardiovascular side. */
  aerobicBasis: "cardio" | "activity" | "none";
  confidence: Confidence;
  caloriesContext?: number;
  trimmed: boolean;
};

const PRIORITY: Record<string, number> = {
  sombrey_workout: 4, plan_workout: 4, manual_workout: 4,
  band_activity: 3, app_activity: 3,
  noticed_activity: 1,
};

/** Removes double-counted minutes; returns sessions with effective windows. */
export function resolveOverlaps(sessions: SessionInput[]): { kept: (SessionInput & { trimmed: boolean })[]; dropped: string[] } {
  const ordered = [...sessions].sort((a, b) => (PRIORITY[b.origin] ?? 2) - (PRIORITY[a.origin] ?? 2) || a.startMs - b.startMs || a.id.localeCompare(b.id));
  const accepted: (SessionInput & { trimmed: boolean })[] = [];
  const dropped: string[] = [];
  for (const s of ordered) {
    let start = s.startMs, end = s.endMs, trimmed = false;
    for (const a of accepted) {
      if (a.endMs <= start || a.startMs >= end) continue;
      if (a.startMs <= start && a.endMs >= end) { start = end; break; }          // fully covered
      if (a.startMs <= start) { start = a.endMs; trimmed = true; }               // covered at the front
      else if (a.endMs >= end) { end = a.startMs; trimmed = true; }              // covered at the back
      else { trimmed = true; end = a.startMs; }                                   // covered in the middle → keep the first part
    }
    const kept = end - start;
    if (kept <= 0 || kept < 0.5 * (s.endMs - s.startMs)) { dropped.push(s.id); continue; }
    accepted.push({ ...s, startMs: start, endMs: end, trimmed });
  }
  return { kept: accepted.sort((a, b) => a.startMs - b.startMs), dropped };
}

export function sessionLoad(s: SessionInput & { trimmed?: boolean }, profile: HeartRateProfile, references: Map<string, number>): SessionLoad {
  const minutes = Math.max(0, (s.endMs - s.startMs) / 60000);
  const cardio = cardiovascularLoad({
    startMs: s.startMs, endMs: s.endMs, samples: s.samples, profile,
    averageHR: s.trimmed ? undefined : s.averageHR, // an average over the untrimmed session no longer describes these minutes
    seriesTimingVerified: s.seriesTimingVerified,
  });
  const resistance = s.sets.length ? resistanceLoad(s.sets, references) : undefined;
  // The aerobic side: measured heart rate when usable; otherwise, for
  // activities (not lifting sessions, whose dose is the sets), the
  // population energy cost of the activity.
  let aerobicBasis: SessionLoad["aerobicBasis"] = "none";
  let activity: ActivityLoad | undefined;
  if (RANK[cardio.confidence] >= RANK.LOW_CONFIDENCE) aerobicBasis = "cardio";
  else if (!resistance || resistance.completedSets === 0) {
    activity = activityLoad(s.category, minutes);
    if (activity.load > 0) aerobicBasis = "activity";
  }
  const parts: { confidence: Confidence; weight: number }[] = [];
  if (aerobicBasis === "cardio") parts.push({ confidence: cardio.confidence, weight: cardio.load / CARDIO_REF });
  if (aerobicBasis === "activity" && activity) parts.push({ confidence: activity.confidence, weight: activity.load / ACTIVITY_REF });
  if (resistance && resistance.completedSets > 0) parts.push({ confidence: resistance.confidence, weight: resistance.load / RESIST_REF });
  let confidence = blend(parts);
  if (s.timestampSuspect) confidence = downgrade(confidence);
  if (s.origin === "noticed_activity") confidence = downgrade(confidence); // the activity is the user's label on an HR pattern
  return {
    id: s.id, kind: s.kind, origin: s.origin, category: s.category, startMs: s.startMs, endMs: s.endMs, minutes,
    cardio, resistance, activity: aerobicBasis === "activity" ? activity : undefined, aerobicBasis,
    confidence, caloriesContext: s.calories, trimmed: s.trimmed ?? false,
  };
}

// Reference doses: what one "substantial" session-day of each component
// looks like, so the components meet on one scale (1.0 = substantial).
// Sombrey synthesis — engineering anchors, to be reviewed with real data:
//   cardio 180   ≈ 60 min in zone 3 (weight 3)
//   activity 300 ≈ 60 min at 6 MET ((6 − 1) × 60)
//   resistance 20 set-equivalents ≈ a full lifting session
export const CARDIO_REF = STRAIN_V1.referenceDoses.cardiovascular;
export const ACTIVITY_REF = STRAIN_V1.referenceDoses.activity;
export const RESIST_REF = STRAIN_V1.referenceDoses.resistance;
