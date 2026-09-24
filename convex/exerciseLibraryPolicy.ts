// Sombrey Exercise Library policy. Pure (no Convex imports).
//
// - What the app may see of an exercise: Sombrey's own fields only. Provider
//   provenance (which provider, its ids, its URLs) never leaves the server.
// - How often a provider may be asked: each query once per TTL, within a
//   monthly request budget below the provider's own quota.

export const QUERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RELATED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A media fetch that failed is retried after this long. */
export const MEDIA_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Requests per month Sombrey allows itself, by the provider's plan —
 * roughly 90% of each plan's published quota, leaving headroom. */
export function monthlyBudget(plan: string | undefined, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) return Math.floor(override);
  switch (plan) {
    case "ultra": return 31_500;
    case "pro": return 9_000;
    case "basic": return 2_700;
    default: return 450; // free, or not yet known
  }
}

/** Results per provider request, by plan (free plans cap at 10). */
export function pageSizeFor(plan: string | undefined): number {
  return plan === undefined || plan === "free" ? 10 : 25;
}

export function monthKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function queryKey(q: { name?: string; bodyPart?: string; equipment?: string; offset: number; limit: number }): string {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `name=${norm(q.name)}|bodyPart=${norm(q.bodyPart)}|equipment=${norm(q.equipment)}|offset=${q.offset}|limit=${q.limit}`;
}

export function isFresh(fetchedAt: number | undefined, ttlMs: number, nowMs: number): boolean {
  return fetchedAt !== undefined && nowMs - fetchedAt < ttlMs;
}

type StoredExercise = {
  _id: string;
  name: string;
  description: string;
  muscleGroup: string;
  bodyRegion?: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  primaryEquipment?: string;
  instructions: string[];
  difficulty?: string;
  category?: string;
  mechanic?: string;
  force?: string;
  met?: number;
  caloriesPerMinute?: number;
  isUnilateral?: boolean;
  mediaStatus?: string;
  mediaStorageId?: string;
};

export type LibrarySummary = {
  _id: string;
  name: string;
  description: string;
  muscleGroup: string;
  primaryMuscles: string[];
  equipment: string[];
  difficulty?: string;
  category?: string;
  hasMedia: boolean;
};

export type LibraryDetail = LibrarySummary & {
  secondaryMuscles: string[];
  instructions: string[];
  bodyRegion?: string;
  mechanic?: string;
  force?: string;
  met?: number;
  caloriesPerMinute?: number;
  isUnilateral?: boolean;
};

/** An exercise as the app sees it — an explicit allow-list, so a new
 * internal field can never leak by accident. */
export function toSummary(e: StoredExercise): LibrarySummary {
  return {
    _id: e._id,
    name: e.name,
    description: e.description,
    muscleGroup: e.muscleGroup,
    primaryMuscles: e.primaryMuscles,
    equipment: e.equipment,
    difficulty: e.difficulty,
    category: e.category,
    hasMedia: e.mediaStatus === "cached" && e.mediaStorageId !== undefined,
  };
}

export function toDetail(e: StoredExercise): LibraryDetail {
  return {
    ...toSummary(e),
    secondaryMuscles: e.secondaryMuscles,
    instructions: e.instructions,
    bodyRegion: e.bodyRegion,
    mechanic: e.mechanic,
    force: e.force,
    met: e.met,
    caloriesPerMinute: e.caloriesPerMinute,
    isUnilateral: e.isUnilateral,
  };
}
