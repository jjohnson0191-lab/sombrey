// What Sombrey can actually measure — the registry every load/strain
// decision is checked against. Pure data. "reliability" reflects what has
// been verified on the physical Sombrey Band, not what the SDK header lists.

export type Reliability = "reliable" | "intermittent" | "unverified" | "unavailable";
export type StrainRole = "input" | "fallback_input" | "context_only" | "not_used";

export type Signal = {
  id: string;
  source: string;
  reliability: Reliability;
  resolution: string;
  strainRole: StrainRole;
  notes: string;
};

export const SIGNALS: Signal[] = [
  { id: "hr_live", source: "Band live stream while connected (stored as heart_rate readings)", reliability: "intermittent", resolution: "~1–5 s while the app is connected; none otherwise", strainRole: "input", notes: "Densest HR Sombrey gets; only exists while the phone is connected and nearby." },
  { id: "hr_scheduled", source: "Band scheduled HR history (per day, secondInterval spacing)", reliability: "unverified", resolution: "secondInterval — value not yet verified (commonly 5–30 min on this class of band)", strainRole: "input", notes: "Too sparse for minute-level load unless the interval proves short; quality-rated by gap." },
  { id: "hr_session_series", source: "Band Sport+ record detail (hrs + sampleRateSeconds)", reliability: "unverified", resolution: "sampleRateSeconds (unverified)", strainRole: "input", notes: "Series timing is start + index × rate — assumed until verified." },
  { id: "hr_session_summary", source: "Band Sport+ record (average / lowest / peak)", reliability: "unverified", resolution: "one value per session", strainRole: "fallback_input", notes: "Average-only load underestimates intermittent sessions (the HR–load curve is non-linear)." },
  { id: "resting_hr", source: "Band resting HR reading; readiness v1 uses the night's minimum", reliability: "intermittent", resolution: "≤ 1 per day", strainRole: "input", notes: "Needed for heart-rate reserve; without it cardiovascular load is not computed." },
  { id: "hr_max", source: "Estimate: Tanaka 208 − 0.7·age (needs date of birth); observed peak as a floor", reliability: "unavailable", resolution: "—", strainRole: "input", notes: "No measured maximum exists; zones built on it are labelled estimated." },
  { id: "session_duration", source: "Band record duration / app timer / workout reconciliation", reliability: "unverified", resolution: "seconds", strainRole: "input", notes: "Band duration unit (seconds) and clock basis are being verified." },
  { id: "session_type", source: "Sport+ mode → Sombrey taxonomy; workout; user label", reliability: "reliable", resolution: "per session", strainRole: "input", notes: "Selects the component model and the MET prior." },
  { id: "resistance_sets", source: "Sets × reps × kg the user logs", reliability: "reliable", resolution: "per set", strainRole: "input", notes: "User-entered; no RPE/RIR or bar speed." },
  { id: "session_calories", source: "Band record / live kcal", reliability: "unverified", resolution: "per session", strainRole: "context_only", notes: "A device estimate of energy, not load. Never a load input." },
  { id: "steps_daily", source: "Band cumulative daily steps", reliability: "reliable", resolution: "daily total (live ticks while connected)", strainRole: "context_only", notes: "Cannot be split into session vs non-session steps without double counting." },
  { id: "sleep", source: "Band sleep stages", reliability: "intermittent", resolution: "per night", strainRole: "not_used", notes: "Recovery input (readiness), never strain." },
  { id: "spo2_temperature", source: "Band SpO2 / skin temperature", reliability: "intermittent", resolution: "sparse", strainRole: "not_used", notes: "Recovery context only." },
  { id: "hrv", source: "—", reliability: "unavailable", resolution: "—", strainRole: "not_used", notes: "Ring-only per the vendor SDK." },
  { id: "weather", source: "MET Norway forecast at the user's approximate location", reliability: "reliable", resolution: "hourly", strainRole: "context_only", notes: "Explains physiology (heat raises HR at equal work); never adds load." },
  { id: "readiness", source: "Sombrey Readiness v1", reliability: "reliable", resolution: "daily", strainRole: "not_used", notes: "Separate concept — never multiplies or penalises strain." },
];
