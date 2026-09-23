// Pure rules for importing the band's own Sport+ records (no Convex
// imports, so they're unit-tested directly — see tests/activity).

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
export function isTimestampSuspect(record: BandRecord, nowMs: number): boolean {
  const endMs = (record.bandStartTimeSec + record.durationSeconds) * 1000;
  return endMs > nowMs + 15 * 60 * 1000;
}

/** An app-started row this band record completes: same sport, not yet
 * linked to a band record, started within the match window. Nearest wins. */
export function findAppStartedMatch<T extends ExistingSession>(candidates: T[], record: BandRecord): T | undefined {
  const startMs = record.bandStartTimeSec * 1000;
  return candidates
    .filter((c) => c.bandStartTimeSec === undefined && c.sportType === record.sportType && Math.abs(c.startedAt - startMs) <= APP_MATCH_WINDOW_MS)
    .sort((a, b) => Math.abs(a.startedAt - startMs) - Math.abs(b.startedAt - startMs))[0];
}
