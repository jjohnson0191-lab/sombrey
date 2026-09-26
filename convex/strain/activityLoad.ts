// Activity load — for sessions with no usable heart rate. Pure.
//
// Evidence: the 2024 Adult Compendium of Physical Activities (Herrmann et
// al.) gives typical energy costs (METs) per activity; MET-minutes above
// rest ((MET − 1) × minutes) are the standard physical-activity dose unit.
// These are POPULATION averages for an activity, not this user's response —
// so this component is always LOW confidence and is used only when a
// session has no usable heart rate (never added on top of cardiovascular
// load for the same minutes).
// Sombrey synthesis: one representative MET per activity family, rounded
// from the Compendium's entries for that family.

import type { Confidence } from "./confidence.ts";

export const FAMILY_MET: Record<string, number> = {
  running: 9, walking: 3.5, hiking: 6, cycling: 7, swimming: 7, racquet: 7, golf: 4.5,
  team_sport: 7, water_sport: 5, winter_sport: 6, strength: 5, cardio: 7, mobility: 2.5,
  dance: 5, combat: 8, outdoor_adventure: 5, leisure: 3, motorsport: 2.5, games: 1.5, other: 4,
};

export type ActivityLoad = { load: number; met: number; minutes: number; confidence: Confidence };

export function activityLoad(category: string | undefined, minutes: number): ActivityLoad {
  const met = FAMILY_MET[category ?? "other"] ?? FAMILY_MET.other;
  if (!(minutes > 0)) return { load: 0, met, minutes: 0, confidence: "INSUFFICIENT_DATA" };
  return { load: minutes * (met - 1), met, minutes, confidence: "LOW_CONFIDENCE" };
}
