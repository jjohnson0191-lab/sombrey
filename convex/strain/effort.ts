// Rate of Perceived Exertion (RPE) — the user's own report of how hard a
// session felt. Pure.
//
// RPE is a MEASURED SIGNAL of its own (the user's perception), recorded on
// the session it describes. It is NOT a Strain input in strain-1.0: Strain
// stays physiological/external load. It is stored so a future methodology
// can compare physiological load, external load, perceived effort, activity
// type and duration (session-RPE: Foster et al. 2001; valid for resistance
// sessions too: Sweet et al. 2004) — see sessionLoadSnapshots.
//
// Scale: 1–10 whole numbers (CR-10 style anchors below). Version-stamped so
// a later scale change can't be confused with this one.

export const RPE_SCALE_VERSION = "rpe-1";

export const RPE_ANCHORS: Record<number, string> = {
  1: "Very easy",
  3: "Easy",
  5: "Moderate",
  7: "Hard",
  9: "Very hard",
  10: "Max effort",
};

/** A whole number 1–10, or an error message. */
export function validateRpe(value: unknown): { ok: true; rpe: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "RPE must be a number" };
  if (!Number.isInteger(value)) return { ok: false, error: "RPE must be a whole number" };
  if (value < 1 || value > 10) return { ok: false, error: "RPE must be between 1 and 10" };
  return { ok: true, rpe: value };
}

export type RatedKind = "workout" | "band_activity" | "noticed_activity";

/** Where a rating belongs: a band record that a workout owns is that
 * workout — one physical session, one rating. */
export function ratingTarget(kind: RatedKind, id: string, owningWorkoutId?: string): { kind: RatedKind; id: string } {
  if (kind === "band_activity" && owningWorkoutId) return { kind: "workout", id: owningWorkoutId };
  return { kind, id };
}

/** Session-RPE load (Foster 2001): RPE × minutes, in arbitrary units.
 * Context for future calibration only — never added to Strain here. */
export function sessionRpeLoad(rpe: number | undefined, minutes: number): number | undefined {
  return rpe === undefined || !(minutes > 0) ? undefined : Math.round(rpe * minutes);
}

/** Descriptive pairing of measured load and perceived effort, for display
 * and the coach — no inference, no "learned" relationship. */
export function effortPairing(relativeLoad: number | undefined, rpe: number | undefined): string | undefined {
  if (relativeLoad === undefined || rpe === undefined) return undefined;
  const measured = relativeLoad < 0.6 ? "light" : relativeLoad <= 1.4 ? "typical" : "high";
  const felt = rpe <= 3 ? "easy" : rpe <= 6 ? "moderate" : "hard";
  return `Measured load ${measured} for you; felt ${felt} (${rpe}/10)`;
}
