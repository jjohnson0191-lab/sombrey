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

import { localDayKey, localParts } from "./time.ts";

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
  /** Neutral condition code (conditionCode()), never a provider symbol. */
  conditionCode?: ConditionCode;
  isNight?: boolean;
  forecast?: ForecastDay[];
  /** Today's remaining hours (hourly()), in the snapshot's time zone. */
  hourly?: ForecastHour[];
  source: "met_norway";
};

export type ForecastHour = {
  time: number;              // epoch ms — the start of the hour (displayed in the device's zone)
  temperatureC: number;
  conditionCode?: ConditionCode;
  isNight?: boolean;
  precipitationMm?: number;
  precipitationProbability?: number; // % — only where the provider publishes it
  windMs?: number;
  humidityPct?: number;
};

/** Sombrey's own weather vocabulary — the UI maps these to icons; no
 * provider model reaches SwiftUI. */
export type ConditionCode = "clear" | "mostly_clear" | "partly_cloudy" | "cloudy" | "fog" | "light_rain" | "rain" | "heavy_rain" | "sleet" | "snow" | "thunder";

export type ForecastDay = {
  date: string;              // local day (the snapshot's time zone)
  highC: number;
  lowC: number;
  condition?: string;
  conditionCode?: ConditionCode;
  precipitationMm?: number;
  precipitationProbability?: number; // % — only where the provider publishes it
  /** Today: high/low cover only the hours still ahead ("rest of today"). */
  partial?: boolean;
};

export function conditionCode(symbol: string | undefined): ConditionCode | undefined {
  if (!symbol) return undefined;
  const base = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (base === "clearsky") return "clear";
  if (base === "fair") return "mostly_clear";
  if (base === "partlycloudy") return "partly_cloudy";
  if (base === "cloudy") return "cloudy";
  if (base === "fog") return "fog";
  if (base.includes("thunder")) return "thunder";
  if (base.includes("sleet")) return "sleet";
  if (base.includes("snow")) return "snow";
  if (base.includes("rain")) return base.includes("heavy") ? "heavy_rain" : base.includes("light") ? "light_rain" : "rain";
  return undefined;
}

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
    conditionCode: conditionCode(entry?.data?.next_1_hours?.summary?.symbol_code ?? entry?.data?.next_6_hours?.summary?.symbol_code),
    isNight: /_night$/.test(entry?.data?.next_1_hours?.summary?.symbol_code ?? entry?.data?.next_6_hours?.summary?.symbol_code ?? ""),
    forecast: dailyForecast(series, timeZone, nowMs),
    hourly: todayHourly(series, timeZone, nowMs),
    source: "met_norway",
  };
}


/** Daily forecast in the user's time zone from a Locationforecast timeseries
 * (hourly for ~2.5 days, then 6-hourly). High/low from air temperature;
 * condition from the period nearest local noon; precipitation summed once
 * per period (1 h where given, else 6 h); probability only if published.
 * Days with fewer than two readings are dropped (not enough to call a
 * high/low). Up to 7 days, today first. */
export function dailyForecast(series: any[], timeZone: string, nowMs: number): ForecastDay[] {
  type Acc = { temps: number[]; noonGap: number; symbol?: string; precip: number; hasPrecip: boolean; prob?: number };
  const days = new Map<string, Acc>();
  const today = localDayKey(nowMs, timeZone);
  for (const e of series) {
    const t = Date.parse(e?.time);
    if (!Number.isFinite(t)) continue;
    const day = localDayKey(t, timeZone);
    if (day < today) continue;
    const acc = days.get(day) ?? { temps: [], noonGap: Infinity, precip: 0, hasPrecip: false };
    const temp = e?.data?.instant?.details?.air_temperature;
    if (typeof temp === "number") acc.temps.push(temp);
    const h1 = e?.data?.next_1_hours, h6 = e?.data?.next_6_hours;
    const symbol = h6?.summary?.symbol_code ?? h1?.summary?.symbol_code;
    const hour = localParts(t, timeZone).hour;
    const gap = Math.abs(hour - 12);
    if (symbol && gap < acc.noonGap) { acc.noonGap = gap; acc.symbol = symbol; }
    const amount = h1 ? h1.details?.precipitation_amount : h6?.details?.precipitation_amount;
    if (typeof amount === "number") { acc.precip += amount; acc.hasPrecip = true; }
    const prob = h1?.details?.probability_of_precipitation ?? h6?.details?.probability_of_precipitation;
    if (typeof prob === "number") acc.prob = Math.max(acc.prob ?? 0, prob);
    days.set(day, acc);
  }
  return [...days.entries()]
    .filter(([, a]) => a.temps.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 7)
    .map(([date, a]) => ({
      date,
      highC: Math.round(Math.max(...a.temps)),
      lowC: Math.round(Math.min(...a.temps)),
      condition: conditionPhrase(a.symbol),
      conditionCode: conditionCode(a.symbol),
      precipitationMm: a.hasPrecip ? Math.round(a.precip * 10) / 10 : undefined,
      precipitationProbability: a.prob !== undefined ? Math.round(a.prob) : undefined,
      partial: date === today ? true : undefined,
    }));
}

/** Today's hourly forecast: the provider's own 1-hour periods whose start
 * falls on the user's local today, from the hour containing `now` to local
 * midnight. Only hourly periods (those with a next_1_hours summary) are
 * used — the 6-hourly tail is never split into invented hours — so a gap in
 * the provider's data stays a gap. Chronological; no hour fabricated. */
export function todayHourly(series: any[], timeZone: string, nowMs: number): ForecastHour[] {
  const today = localDayKey(nowMs, timeZone);
  const currentHourStart = nowMs - 60 * 60 * 1000; // a period that started < 1 h ago contains now
  const out: ForecastHour[] = [];
  for (const e of series) {
    const t = Date.parse(e?.time);
    if (!Number.isFinite(t) || t <= currentHourStart || localDayKey(t, timeZone) !== today) continue;
    const h1 = e?.data?.next_1_hours;
    const d = e?.data?.instant?.details ?? {};
    if (!h1 || typeof d.air_temperature !== "number") continue;
    const symbol = h1.summary?.symbol_code;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
    out.push({
      time: t,
      temperatureC: Math.round(d.air_temperature * 10) / 10,
      conditionCode: conditionCode(symbol),
      isNight: /_night$/.test(symbol ?? ""),
      precipitationMm: num(h1.details?.precipitation_amount),
      precipitationProbability: num(h1.details?.probability_of_precipitation),
      windMs: num(d.wind_speed),
      humidityPct: num(d.relative_humidity),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}
