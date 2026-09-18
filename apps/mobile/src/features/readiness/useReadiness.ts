import type { ReadinessResult } from "@sombrey/readiness";

/**
 * Readiness feature boundary — typed foundation only.
 *
 * No Convex readiness backend exists yet (Phase 2 built @sombrey/readiness
 * as pure types; the normalization/baseline/engine implementation is a
 * later, dedicated phase — see the architecture report). This hook's
 * shape is what screens (Home's readiness card, the Readiness Detail
 * screen) are written against today, so wiring in the real backend query
 * later is a one-file change here, not a screen rewrite.
 *
 * Deliberately returns the "no data yet" state always, for now — this is
 * honest about what exists, not a fake score.
 */
export function useReadiness(): { result: ReadinessResult | null; isLoading: boolean } {
  return { result: null, isLoading: false };
}
