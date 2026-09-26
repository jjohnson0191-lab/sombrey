// Pure rules for importing the band's own Sport+ records (no Convex
// imports, so they're unit-tested directly — see tests/activity).

import { type BandClockBasis, type Zone, BAND_CLOCK_EVIDENCE_REQUIRED, bandClockEvidence } from "./strain/time.ts";

export type BandRecord = {
  sportType: number;
  recordSource?: "band" | "app";
  bandStartTimeSec: number;
  bandDurationRaw: number;
  durationSeconds: number;
};

export type ExistingSession = {
  sportType: number;
  startedAt: number;          // epoch ms
  bandStartTimeSec?: number;
};

/** How close an app-started row's start must be to a band record's start
 * to be the same real session. The app records its own clock at the
 * moment it sent "start"; the band records when it began. */
export const APP_MATCH_WINDOW_MS = 2 * 60 * 1000;

/** A record is only imported if it's a real session: a known start, a
 * positive duration no longer than a day, and a start not absurdly far in
 * the future. Anything else is skipped, not repaired. */
export function isMalformed(record: BandRecord, nowMs: number): boolean {
  if (!Number.isFinite(record.bandStartTimeSec) || record.bandStartTimeSec <= 0) return true;
  if (!Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0 || record.durationSeconds > 24 * 3600) return true;
  if (record.bandStartTimeSec * 1000 > nowMs + 2 * 24 * 3600 * 1000) return true;
  return false;
}

/** Flags timing that can't be real — a session ending more than 15
 * minutes in the future (e.g. the band storing local wall-clock time as if
 * it were UTC). Flagged and stored as returned; never shifted by a guessed
 * offset. */
export function isTimestampSuspect(record: BandRecord, nowMs: number, startMs = record.bandStartTimeSec * 1000): boolean {
  const endMs = startMs + record.durationSeconds * 1000;
  return endMs > nowMs + 15 * 60 * 1000;
}

/** An app-started row this band record completes: same sport, not yet
 * linked to a band record, started within the match window of the band's
 * start. Nearest wins. `startMs` is the band start as an instant (see
 * strain/time.ts normalizeBandStart). */
export function findAppStartedMatch<T extends ExistingSession>(candidates: T[], record: BandRecord, startMs = record.bandStartTimeSec * 1000): T | undefined {
  return candidates
    .filter((c) => c.bandStartTimeSec === undefined && c.sportType === record.sportType && Math.abs(c.startedAt - startMs) <= APP_MATCH_WINDOW_MS)
    .sort((a, b) => Math.abs(a.startedAt - startMs) - Math.abs(b.startedAt - startMs))[0];
}

/** Like findAppStartedMatch, but while the band's clock basis is unknown:
 * an app-started row matches under EITHER reading of the raw start, and
 * the reading that matched is evidence of the band's basis. */
export function findAppStartedMatchAnyBasis<T extends ExistingSession>(candidates: T[], record: BandRecord, zone: Zone):
  { row: T; evidence: BandClockBasis | "ambiguous" } | undefined {
  const matches = candidates
    .filter((c) => c.bandStartTimeSec === undefined && c.sportType === record.sportType)
    .map((c) => ({ row: c, evidence: bandClockEvidence(record.bandStartTimeSec, c.startedAt, zone, APP_MATCH_WINDOW_MS) }))
    .filter((m): m is { row: T; evidence: BandClockBasis | "ambiguous" } => m.evidence !== "none");
  return matches[0];
}

export type ClockEvidence = { epochUtc: number; localWallClock: number; ambiguous: number; none: number; lastAt: number };

/** Adds one app-started session's evidence; the basis is settled once
 * BAND_CLOCK_EVIDENCE_REQUIRED unambiguous sessions agree and none disagree. */
export function addClockEvidence(prev: ClockEvidence | undefined, e: BandClockBasis | "ambiguous" | "none", nowMs: number):
  { evidence: ClockEvidence; basis?: BandClockBasis } {
  const ev = { ...(prev ?? { epochUtc: 0, localWallClock: 0, ambiguous: 0, none: 0, lastAt: 0 }), lastAt: nowMs };
  if (e === "epoch_utc") ev.epochUtc += 1;
  else if (e === "local_wall_clock") ev.localWallClock += 1;
  else if (e === "ambiguous") ev.ambiguous += 1;
  else ev.none += 1;
  const basis = ev.epochUtc >= BAND_CLOCK_EVIDENCE_REQUIRED && ev.localWallClock === 0 ? "epoch_utc"
    : ev.localWallClock >= BAND_CLOCK_EVIDENCE_REQUIRED && ev.epochUtc === 0 ? "local_wall_clock"
    : undefined;
  return { evidence: ev, basis };
}
