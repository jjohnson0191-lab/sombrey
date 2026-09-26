# Sombrey Intelligence — Methodology

Status: **foundation built; Strain formula proposed, NOT approved.** No strain number is shown to users or sent to the AI Coach until (1) the band is validated (docs/SOMBREY_BAND_VALIDATION.md) and (2) the proposed formula is reviewed. The switch is `STRAIN_FORMULA_APPROVED` in `convex/strain/strainScore.ts`.

Code: `convex/strain/*` (pure, unit-tested in `tests/intelligence/`). Loader: `convex/intelligenceData.ts`. Registry of choices: `convex/strain/methodology.ts`.

## 1. The model chain

```
band signals + Sombrey records
  → sessions (workouts, band/app activities, noticed activities)
  → overlap resolution (each real minute counted once)
  → SessionLoad: cardiovascular | activity fallback, + resistance
  → Daily Load (normalized components, per local day)
  → personal baseline
  → Strain state (+ proposed value, internal only)
Readiness v1 ─ separate; never an input, never a multiplier
Weather ─ context only; never an input
→ AI Coach: structured intelligence context
```

There is exactly one pipeline (`strain/pipeline.ts`). Progress, the coach and future Home surfaces read it; nothing else computes strain.

## 2. Time

- **Sombrey owns the time zone.** Canonical instants are epoch ms. A "day" is the calendar day in the phone's IANA zone (`TimeZone.current.identifier`), reported by the app (`userTimeZone:setTimeZone`, readiness, band import, weather). Order of precedence: zone on the call → zone last reported → an older client's fixed offset → UTC. The band never decides it.
- DST-correct via `Intl` (`strain/time.ts`): 23- and 25-hour days are single days; weeks start on local Monday by calendar step.
- A session belongs to the local day it **started**.
- **Readiness** now buckets readings in the user's zone (previously UTC days — in Colombo, a morning before 05:30 fell on the previous day). Scoring is unchanged.
- **Band Sport+ start times**: the raw seconds may be true epoch or local wall-clock time counted as UTC (the vendor demo applies a zone offset). `normalizeBandStart` reads them as: a calibrated basis for this band if established; else local wall-clock when the epoch reading would end in the future and the local reading wouldn't (inferred); else epoch (assumed). Each record stores `timestampBasis`, `timestampBasisHow` and `bandStartedAt`; the raw value is kept.
- **Calibration**: when a band record matches an app-started session (Sombrey knows the true instant it pressed start), whichever reading lands within 2 min is evidence. Two agreeing, unambiguous sessions with none disagreeing settle the band's basis (`wearableDevices.bandClockBasis`); re-imports then correct earlier band-timed rows in place. In UTC-adjacent zones the readings coincide and evidence is "ambiguous" (harmless there).

## 3. Signals (`strain/signals.ts`)

| Signal | Reliability | Role |
|---|---|---|
| Live HR stream (while connected) | intermittent | input |
| Scheduled HR history | unverified spacing | input (quality-rated) |
| Band session HR series | unverified spacing | input (confidence capped) |
| Band session average HR | reliable | fallback input |
| Resting HR readings | reliable | input (HRR) |
| Session duration / type | reliable | input |
| Sets × reps × weight | reliable | input |
| Calories | — | **context only** |
| Steps | — | context only |
| HRV | unavailable on this band | not used |
| Weather | — | **context only** |
| Readiness | — | **not used** |

## 4. Cardiovascular load (`zones.ts`, `cardiovascularLoad.ts`)

- **Resting HR**: median of the band's resting readings (30–110 bpm), last 28 days.
- **HRmax**: measured if ever available; otherwise **estimated** as 208 − 0.7·age (Tanaka et al. 2001 — more accurate than 220 − age), raised to the highest peak the band has recorded (a peak can only be ≤ true max). No date of birth → no HRmax → no zones: nothing is guessed. The same estimate now drives activity intensity, so Sombrey has one HRmax.
- **Intensity**: fraction of heart-rate reserve (Karvonen 1957), requiring HRmax − HRrest ≥ 40.
- **Zones** (HRR): Z1 ≥ 30%, Z2 ≥ 45%, Z3 ≥ 60%, Z4 ≥ 75%, Z5 ≥ 85%, weighted 1–5 per minute — Edwards' (1993) summated-zone idea on HRR bands (Sombrey adaptation; Banister's TRIMP family).
- **Units**: zone-weighted minutes.
- **Sparse HR is not continuous**: each reading covers the time to the next one, **capped at 120 s**. Uncovered minutes carry no load.
- **Quality states**: HIGH (coverage ≥ 80%, median interval ≤ 30 s), MODERATE (≥ 50%, ≤ 120 s), LOW (≥ 20%), otherwise INSUFFICIENT. Capped at MODERATE while HRmax is estimated or the series timing is unverified. With too little series, the band's session **average** is used at LOW; with nothing, the component is INSUFFICIENT and zero.

## 5. Resistance load (`resistanceLoad.ts`)

- **Units**: set-equivalents. A completed set (reps ≥ 1) = 1; weighted sets are scaled by load relative to the user's own best prior e1RM for that exercise (Epley, reps ≤ 10), (w/ref)/0.7 clamped to 0.6–1.3. Bodyweight or unknown intensity = 1.
- Volume-load (kg) is reported, not scored — it over-weights high-rep light work (Scott et al. 2016).
- Limits: no RPE/RIR, no rest intervals, no eccentric/tempo information. Lifting minutes earn **no aerobic credit** without heart rate — 60 min of lifting is not 60 min of running.

## 6. Activity load (`activityLoad.ts`)

Only when a session has no usable heart rate (and isn't a lifting session): minutes × (MET − 1) using a family-level MET from the 2024 Adult Compendium. Always LOW confidence.

## 7. De-duplication (`sessionLoad.ts`)

Priority: **workout** (its band record is attached, never separate) > **band/app activity** > **noticed activity**. A lower-priority session is trimmed to its uncovered minutes, or dropped if more than half is covered. Cardiovascular and activity load never describe the same minutes. Noticed activities and timestamp-suspect records are downgraded one confidence step.

## 8. Daily Load (`dailyLoad.ts`)

- Components normalized by reference doses (Sombrey synthesis — engineering anchors to be reviewed): cardio 180 zone-min (≈ 60 min in Z3), activity 300 MET-min (≈ 60 min at 6 MET), resistance 20 set-equivalents.
- Each component capped at 4.0; Daily Load = sum (1.0 ≈ one substantial session-day).
- Confidence: weighted blend of session confidences. A day with nothing recorded is a certain zero.
- Idempotent: recomputed from stored records on every read. Re-importing the same band record refreshes it (keyed by the raw band start); a late import changes the day it belongs to and nothing else.

## 9. Baseline & Strain (`baseline.ts`, `strainScore.ts`)

- **Baseline requirements**: ≥ 14 days since the first session, ≥ 6 days with Daily Load ≥ 0.15 in the last 28, ≥ 4 sessions of at least MODERATE confidence. Reference = median active-day load. No acute:chronic ratio (Impellizzeri et al. 2020).
- **States**: NOT_ENOUGH_DATA (today's sessions are all insufficient), BUILDING_BASELINE, LOW_CONFIDENCE (baseline ready, today's data weak), READY.
- **Proposed value** (not approved): `100 × (1 − 2^(−load/reference))` — a typical day ≈ 50, twice typical ≈ 75; saturating at 100.
- Never multiplied by readiness, calories or weather.

## 10. Load ↔ recovery (`relationships.ts`)

The previous rule (Pearson, n ≥ 21, |r| ≥ 0.4) was audited: 21 days is too few for a stable correlation (Schönbrodt & Perugini 2013), and load is skewed. Now: **Spearman**, **n ≥ 28** paired days, **p < 0.05** and **|ρ| ≥ 0.4**; outcomes next-morning readiness, next-morning resting HR, sleep that night. Load for this purpose is measured active time (a fact), not the unapproved formula. Wording: "tended to … a pattern, not a cause".

## 11. Weather (`environment.ts`, `convex/environment.ts`)

- Provider: **MET Norway Locationforecast 2.0** — NLOD 2.0 / CC BY 4.0, commercial use with attribution (shown in Settings → Weather & location). Requires an identifying User-Agent: set `WEATHER_USER_AGENT` in Convex (a product contact — never a user's email).
- Fields: temperature, feels-like (**calculated**, Steadman/BoM apparent temperature), humidity, wind, UV (clear-sky index), precipitation next hour, condition.
- States: available, stale (> 90 min), unavailable (location denied → time-zone city + "Weather unavailable"; not fetched; provider error).
- **Privacy**: requested — reduced-accuracy location, when in use, at most every 30 min. Sent — to Sombrey's server only, rounded to 2 decimals (~1 km) for one provider request. Stored — locality name, time zone, weather values (one current row; a copy per finished session). Discarded — coordinates, always. No location history. User can clear stored weather.
- **Never a load input.** A future comparison model (`heatComparison`) groups the same kind of session by heat band (≥ 3 sessions each) — descriptive only; no weather-adjusted formula exists (Périard et al. 2021 describe why heat raises HR at a given work rate).

## 12. AI Coach (`strain/context.ts`)

A structured object — current day, recent history, recovery, training, environment, body, performance, data quality, rules — rendered to text. It states the Strain **state** and data confidence, never a number, and instructs the coach not to base recommendations on strain until validated.

## 13. Evidence vs synthesis

See `convex/strain/methodology.ts` — each choice is tagged `evidence`, `adapted_from_evidence` or `sombrey_synthesis`, with open questions. Competitor products (WHOOP, Polar, Garmin/Firstbeat) were consulted for terminology only; no formula was copied.

## References

- Banister EW (1991). Modeling elite athletic performance. In *Physiological Testing of Elite Athletes*.
- Edwards S (1993). *The Heart Rate Monitor Book*.
- Karvonen MJ, Kentala E, Mustala O (1957). Ann Med Exp Biol Fenn 35:307–315.
- Tanaka H, Monahan KD, Seals DR (2001). Age-predicted maximal heart rate revisited. JACC 37:153–156.
- Foster C et al. (2001). A new approach to monitoring exercise training. JSCR 15:109–115.
- Scott BR et al. (2016). Training monitoring for resistance exercise. Sports Med 46:687–698.
- Impellizzeri FM et al. (2020). Acute:chronic workload ratio: conceptual issues. IJSPP 15(6):907–913.
- Herrmann SD et al. (2024). 2024 Adult Compendium of Physical Activities. J Sport Health Sci.
- Périard JD, Eijsvogels TMH, Daanen HAM (2021). Exercise under heat stress. Physiol Rev 101:1873–1979.
- Schönbrodt FD, Perugini M (2013). At what sample size do correlations stabilize? J Res Pers 47:609–612.
- MET Norway API Terms of Service and data licence (api.met.no).
