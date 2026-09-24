// How the AI Coach hears about physical activity: one factual line per
// activity ("Tennis — yesterday, 1 h 30 min, avg HR 142 bpm [band
// record]"), never "1 workout". Pure (no Convex imports). Every figure
// carries where it came from, so the coach can't mistake a timed or
// user-named activity for a band measurement.

export type CoachActivity = {
  displayName: string;
  activityCategory: string;
  provenance: string;
  classificationSource: "band" | "app" | "user";
  needsClassification?: boolean;
  startedAt: number;
  durationSeconds?: number;
  durationSource?: "band" | "sombrey_timer";
  averageHeartRate?: number;
  highestHeartRate?: number;
  heartRateSource?: "band_record" | "band_samples";
  calories?: number;
  caloriesSource?: "band_record" | "band_live" | "user_entered";
  distanceMeters?: number;
  steps?: number;
  climbMeters?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function when(startedAt: number, nowMs: number): string {
  const days = Math.floor((Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate())
    - Date.UTC(new Date(startedAt).getUTCFullYear(), new Date(startedAt).getUTCMonth(), new Date(startedAt).getUTCDate())) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export function describeActivityForCoach(a: CoachActivity, nowMs: number): string {
  const parts: string[] = [when(a.startedAt, nowMs)];
  if (a.durationSeconds !== undefined && a.durationSeconds > 0) {
    parts.push(`${duration(a.durationSeconds)}${a.durationSource === "sombrey_timer" ? " (timed by the app)" : ""}`);
  }
  if (a.averageHeartRate !== undefined) {
    const peak = a.highestHeartRate !== undefined ? `, peak ${Math.round(a.highestHeartRate)}` : "";
    const source = a.heartRateSource === "band_samples" ? "calculated from band readings" : "band record";
    parts.push(`avg HR ${Math.round(a.averageHeartRate)} bpm${peak} (${source})`);
  }
  if (a.distanceMeters !== undefined && a.distanceMeters > 0) parts.push(`${(a.distanceMeters / 1000).toFixed(1)} km`);
  if (a.steps !== undefined && a.steps > 0) parts.push(`${Math.round(a.steps)} steps`);
  if (a.climbMeters !== undefined && a.climbMeters > 0) parts.push(`${Math.round(a.climbMeters)} m climb`);
  if (a.calories !== undefined && a.calories > 0) {
    parts.push(`${Math.round(a.calories)} kcal${a.caloriesSource === "user_entered" ? " (user's figure)" : ""}`);
  }
  const origin =
    a.provenance === "user_labelled" ? "noticed from band heart rate, named by the user"
    : a.needsClassification ? "band mode too generic — the user hasn't said what it was"
    : a.classificationSource === "user" ? "named by the user"
    : a.provenance === "manual" ? "logged by the user"
    : "recorded by the band";
  return `${a.displayName} (${a.activityCategory.replace(/_/g, " ")}) — ${parts.join(", ")} [${origin}]`;
}

/** The coach's physical-activity lines, newest first, capped. */
export function describeActivitiesForCoach(activities: CoachActivity[], nowMs: number, max = 10): string[] {
  if (activities.length === 0) return ["Physical activities in the last 7 days: none recorded"];
  const sorted = [...activities].sort((x, y) => y.startedAt - x.startedAt);
  const lines = [`Physical activities in the last 7 days (${activities.length}):`];
  for (const a of sorted.slice(0, max)) lines.push(`- ${describeActivityForCoach(a, nowMs)}`);
  if (sorted.length > max) lines.push(`- …and ${sorted.length - max} more`);
  return lines;
}
