// Sombrey's time model. Pure (Intl only).
//
// - Canonical instants are epoch milliseconds (UTC), always.
// - The user's time zone (IANA name from the phone, e.g. "Asia/Colombo") is
//   authoritative for every "day": Home, Progress, Daily Load, Strain,
//   readiness, AI context. The band never decides the time zone.
// - A fixed UTC offset in minutes is accepted for older clients; it cannot
//   follow daylight-saving changes, so an IANA name is preferred.
// - Band timestamps are raw values whose meaning is being verified (see
//   `normalizeBandStart`); they are converted into canonical instants here.

export type Zone = string | number; // IANA name, or a fixed offset in minutes

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try { formatter(tz); return true; } catch { return false; }
}

/** The zone to read days in: the zone the call carries (the phone, now),
 * else the zone the app last reported, else an older client's fixed offset,
 * else UTC. The band's clock never enters this. */
export function chooseZone(argZone?: string, storedZone?: string, offsetMinutes?: number): Zone {
  if (argZone && isValidTimeZone(argZone)) return argZone;
  if (storedZone && isValidTimeZone(storedZone)) return storedZone;
  if (offsetMinutes !== undefined && Number.isFinite(offsetMinutes)) return offsetMinutes;
  return "UTC";
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Local wall-clock fields of an instant in a zone. */
export function localParts(ms: number, zone: Zone): Parts {
  if (typeof zone === "number") {
    const d = new Date(ms + zone * 60_000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  }
  const out: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

/** The zone's UTC offset (minutes) at an instant — DST-correct for IANA zones. */
export function offsetMinutes(ms: number, zone: Zone): number {
  if (typeof zone === "number") return zone;
  const p = localParts(ms, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** "2026-09-26" — the user's local calendar day for an instant. */
export function localDayKey(ms: number, zone: Zone): string {
  const p = localParts(ms, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant a local wall-clock time happens in a zone (the earlier one
 * when a DST fall-back repeats it; the moment after a spring-forward gap). */
export function wallClockToInstant(year: number, month: number, day: number, hour: number, minute: number, second: number, zone: Zone): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let ms = guess - offsetMinutes(guess, zone) * 60_000;
  // Re-check once: the offset at the corrected instant may differ (DST edge).
  const second_ = guess - offsetMinutes(ms, zone) * 60_000;
  if (second_ !== ms) ms = Math.min(ms, second_);
  return ms;
}

/** Local midnight (as an instant) of the day containing `ms`. */
export function startOfLocalDay(ms: number, zone: Zone): number {
  const p = localParts(ms, zone);
  return wallClockToInstant(p.year, p.month, p.day, 0, 0, 0, zone);
}

/** Local Monday 00:00 of the week containing `ms`. */
export function startOfLocalWeek(ms: number, zone: Zone): number {
  const p = localParts(ms, zone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - ((weekday + 6) % 7)));
  return wallClockToInstant(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, 0, zone);
}

/** The local day `n` days before the day of `ms` (calendar arithmetic, so a
 * 23- or 25-hour DST day is still one day). */
export function localDayKeyDaysAgo(ms: number, n: number, zone: Zone): string {
  const p = localParts(ms, zone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ── Band timestamps ─────────────────────────────────────────────────────────
//
// The band's clock is set from the phone (`setTime:`) and its daily records
// are local "yyyy-MM-dd HH:mm:ss" strings. Its Sport+ `startTime` is a count
// of seconds whose basis the SDK doesn't document: either a true Unix epoch
// ("epoch_utc"), or the band's LOCAL wall-clock time counted as if it were
// UTC ("local_wall_clock" — the vendor demo converts it with a time-zone
// offset, which suggests this). Which one is verified on the physical band
// (docs/SOMBREY_BAND_VALIDATION.md); until then both readings are kept.

export type BandClockBasis = "epoch_utc" | "local_wall_clock";

/** The instant a raw band start represents, under a given basis. */
export function bandStartInstant(rawSec: number, basis: BandClockBasis, zone: Zone): number {
  if (basis === "epoch_utc") return rawSec * 1000;
  const d = new Date(rawSec * 1000); // local wall-clock fields read as UTC
  return wallClockToInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), zone);
}

export type BandStartReading = {
  instant: number;
  basis: BandClockBasis;
  /** How the basis was chosen: calibrated for this band, inferred from this
   * record alone, or assumed (the historical default). */
  how: "calibrated" | "inferred" | "assumed";
};

const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

/** Chooses how to read a raw band start: the band's calibration when one has
 * been established; otherwise the epoch reading unless it would end in the
 * future while the local reading wouldn't (a physical impossibility for a
 * finished record); otherwise the epoch reading, as assumed so far. */
export function normalizeBandStart(rawSec: number, durationSec: number, zone: Zone, nowMs: number, calibrated?: BandClockBasis): BandStartReading {
  if (calibrated) return { instant: bandStartInstant(rawSec, calibrated, zone), basis: calibrated, how: "calibrated" };
  const epoch = bandStartInstant(rawSec, "epoch_utc", zone);
  const local = bandStartInstant(rawSec, "local_wall_clock", zone);
  const epochEndsInFuture = epoch + durationSec * 1000 > nowMs + FUTURE_TOLERANCE_MS;
  const localEndsInFuture = local + durationSec * 1000 > nowMs + FUTURE_TOLERANCE_MS;
  if (epochEndsInFuture && !localEndsInFuture) return { instant: local, basis: "local_wall_clock", how: "inferred" };
  return { instant: epoch, basis: "epoch_utc", how: "assumed" };
}

/** Evidence from an app-started session: the app knows the true instant it
 * pressed start; whichever reading of the band's raw start lands within the
 * window of it is the band's basis. Ambiguous when both do (UTC-adjacent
 * zones) or neither does. */
export function bandClockEvidence(rawSec: number, appStartMs: number, zone: Zone, windowMs = 2 * 60 * 1000): BandClockBasis | "ambiguous" | "none" {
  const epoch = Math.abs(bandStartInstant(rawSec, "epoch_utc", zone) - appStartMs) <= windowMs;
  const local = Math.abs(bandStartInstant(rawSec, "local_wall_clock", zone) - appStartMs) <= windowMs;
  if (epoch && local) return "ambiguous";
  if (epoch) return "epoch_utc";
  if (local) return "local_wall_clock";
  return "none";
}

/** A band's clock basis is settled after this many agreeing, unambiguous
 * app-started sessions, with none disagreeing. */
export const BAND_CLOCK_EVIDENCE_REQUIRED = 2;
