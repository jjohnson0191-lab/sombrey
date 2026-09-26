// Environment — weather as CONTEXT for physiology, never as load. Pure.
//
// Nothing here changes Daily Load or Strain. Snapshots are kept so that,
// once enough sessions exist, Sombrey can compare how the user's heart rate
// behaved in similar work under different conditions (heat, humidity) —
// descriptive comparison only; no weather-adjusted formula exists.
//
// Privacy: a snapshot carries a place name (locality) and the IANA time
// zone, never coordinates. The server rounds coordinates to 2 decimals
// (~1 km) only to ask the weather provider, then discards them.

export type EnvironmentSnapshot = {
  observedAt: number;        // provider observation time (epoch ms)
  fetchedAt: number;
  timeZone: string;
  locality?: string;
  temperatureC?: number;
  feelsLikeC?: number;       // calculated (Australian apparent temperature), labelled as such
  humidityPct?: number;
  windMs?: number;
  uvIndex?: number;
  precipitationMm?: number;  // next hour
  condition?: string;        // provider symbol, normalized to a Sombrey phrase
  source: "met_norway";
};

/** Steadman / Australian BoM apparent temperature (shade), °C. */
export function apparentTemperature(tempC: number, humidityPct: number, windMs: number): number {
  const e = (humidityPct / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return Math.round((tempC + 0.33 * e - 0.7 * windMs - 4.0) * 10) / 10;
}

export const WEATHER_STALE_MS = 90 * 60 * 1000;
export const WEATHER_REFRESH_MS = 30 * 60 * 1000;

export type EnvironmentState =
  | { state: "available"; snapshot: EnvironmentSnapshot; stale: false }
  | { state: "stale"; snapshot: EnvironmentSnapshot; stale: true }
  | { state: "unavailable"; reason: "location_denied" | "not_fetched" | "provider_error"; timeZone?: string };

export function environmentState(snapshot: EnvironmentSnapshot | null | undefined, nowMs: number, locationDenied: boolean, deviceTimeZone?: string): EnvironmentState {
  if (!snapshot) return { state: "unavailable", reason: locationDenied ? "location_denied" : "not_fetched", timeZone: deviceTimeZone };
  if (nowMs - snapshot.fetchedAt > WEATHER_STALE_MS) return { state: "stale", snapshot, stale: true };
  return { state: "available", snapshot, stale: false };
}

/** MET Norway symbol_code → a short Sombrey phrase. */
export function conditionPhrase(symbol: string | undefined): string | undefined {
  if (!symbol) return undefined;
  const base = symbol.replace(/_(day|night|polartwilight)$/, "");
  const map: Record<string, string> = {
    clearsky: "Clear", fair: "Mostly clear", partlycloudy: "Partly cloudy", cloudy: "Cloudy", fog: "Fog",
  };
  if (map[base]) return map[base];
  if (base.includes("thunder")) return "Thunderstorms";
  if (base.includes("sleet")) return "Sleet";
  if (base.includes("snow")) return base.includes("heavy") ? "Heavy snow" : "Snow";
  if (base.includes("rain")) return base.includes("heavy") ? "Heavy rain" : base.includes("light") ? "Light rain" : "Rain";
  return undefined;
}

/** Heat context band for a session — descriptive, from apparent temperature. */
export function heatBand(feelsLikeC: number | undefined): "cool" | "mild" | "warm" | "hot" | "very_hot" | undefined {
  if (feelsLikeC === undefined) return undefined;
  if (feelsLikeC < 15) return "cool";
  if (feelsLikeC < 24) return "mild";
  if (feelsLikeC < 30) return "warm";
  if (feelsLikeC < 36) return "hot";
  return "very_hot";
}

/** Future-ready comparison: same kind of session, different heat bands.
 *  Returns per-band median average-HR only with ≥ 3 sessions per band. */
export type SessionEnvironmentRow = { category: string; averageHR?: number; feelsLikeC?: number };
export function heatComparison(rows: SessionEnvironmentRow[], category: string) {
  const byBand = new Map<string, number[]>();
  for (const r of rows) {
    const band = heatBand(r.feelsLikeC);
    if (r.category !== category || !band || !r.averageHR) continue;
    byBand.set(band, [...(byBand.get(band) ?? []), r.averageHR]);
  }
  return [...byBand].filter(([, v]) => v.length >= 3).map(([band, v]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return { band, sessions: v.length, medianAverageHR: Math.round(m) };
  });
}

/** Parses a Locationforecast "complete" response into a snapshot (pure). */
export function parseLocationforecast(body: any, nowMs: number, timeZone: string, locality?: string): EnvironmentSnapshot | null {
  const series = body?.properties?.timeseries;
  if (!Array.isArray(series) || series.length === 0) return null;
  // The entry for the current hour (the first not more than an hour old).
  const entry = series.find((e: any) => Date.parse(e.time) >= nowMs - 60 * 60 * 1000) ?? series[0];
  const d = entry?.data?.instant?.details ?? {};
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const temperatureC = num(d.air_temperature), humidityPct = num(d.relative_humidity), windMs = num(d.wind_speed);
  return {
    observedAt: Date.parse(entry.time) || nowMs,
    fetchedAt: nowMs,
    timeZone,
    locality,
    temperatureC,
    humidityPct,
    windMs,
    feelsLikeC: temperatureC !== undefined && humidityPct !== undefined && windMs !== undefined ? apparentTemperature(temperatureC, humidityPct, windMs) : undefined,
    uvIndex: num(d.ultraviolet_index_clear_sky),
    precipitationMm: num(entry?.data?.next_1_hours?.details?.precipitation_amount),
    condition: conditionPhrase(entry?.data?.next_1_hours?.summary?.symbol_code ?? entry?.data?.next_6_hours?.summary?.symbol_code),
    source: "met_norway",
  };
}

