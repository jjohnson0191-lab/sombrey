# Sombrey Band — physical validation for the intelligence model (A–J)

Everything in `convex/strain/*` rests on SDK capability until these checks pass on a real Sombrey Band. Until A–F pass, the Strain formula stays unapproved (`STRAIN_FORMULA_APPROVED = false`), and heart-rate-series confidence stays capped.

**Where to look.** Train › Workout history › a band session › **Recording details** shows the raw band start, raw duration, **how the band's clock was read** ("UTC" or "Local time", and whether that is confirmed, inferred or assumed), and the band start as a time. Debug builds: Settings › Developer › Wearable diagnostics (raw records, report types). Server: `wearableDevices.bandClockEvidence` counts the evidence per band.

**Set-up.** A phone set to a zone well away from UTC (e.g. Asia/Colombo, +5:30) makes A–B decisive; in UTC±1 the two readings coincide. Note the phone's zone and the watch time for every step.

| # | What | Procedure | Pass when | Record |
|---|---|---|---|---|
| **A** | Timestamp semantics | Start Sport+ **from the app** (Train › Activity) at a noted time; stop after 5 min; wait for the band record (≤ 60 s). Repeat once. | Recording details: "Band clock read as … (confirmed for this band)" after the 2nd session. Band start matches the noted time to within 1 min | Which basis (UTC / Local time). Raw start value |
| **B** | Sport+ start & end | Start and stop a session **on the band** at noted times; sync | Started matches the noted start (±1 min) and Started + Duration matches the noted end; not flagged "time looks wrong" | Offsets, if any |
| **C** | Duration units | Same session as B, timed with a stopwatch | Raw duration ≈ stopwatch seconds (not ms, not minutes) | Raw value vs stopwatch |
| **D** | HR series availability | After B, check the session detail | A heart-rate series exists (debug: detail row `heartRates` non-empty) | Count of values |
| **E** | HR sample interval | Series count vs duration; compare `sampleRateSeconds` | count × sampleRate ≈ duration (±1 sample) | sampleRate, count, duration |
| **F** | HR accuracy (short controlled session) | 10 min: 3 min seated, 4 min brisk stepping, 3 min seated, chest strap or second device as reference if available | Band average within ±5 bpm of reference; the step-up visible in the series at the right minutes | Averages, max, lag |
| **G** | Sport+ calories | Session of B | kcal plausible for the effort (not ×1000, not 0) | kcal |
| **H** | Daily HR availability | Wear the band a full day with the phone intermittently away; sync | Scheduled HR readings exist across the day; note their spacing (`secondInterval`) and gaps | Interval, readings/day |
| **I** | Generic band activity | Start a generic mode (e.g. "Other"/"Free training") on the band | Imported; Sombrey asks what it was; answering changes the label, not the vendor type | — |
| **J** | Multiple sessions in one day | Two band sessions and one app workout on the same local day, one overlapping the workout | All appear; the overlapping band record is attached to the workout (one entry, not two); Progress shows one day with the correct session count | Session list |

## After the checks

1. **A settles basis** → any earlier band-timed sessions are corrected in place on the next sync (re-import is idempotent).
2. **D + E pass** → mark series timing verified: set `seriesTimingVerified = true` for band series in `convex/intelligenceData.ts` (it caps confidence at MODERATE today).
3. **H** gives the scheduled-HR spacing → update `hr_scheduled` in `convex/strain/signals.ts`.
4. **F** informs whether zone-level load is trustworthy during intense/grip-heavy work.
5. With A–F passed, review the proposed Strain formula (docs/SOMBREY_INTELLIGENCE_METHODOLOGY.md §9) against real days before setting `STRAIN_FORMULA_APPROVED`.
