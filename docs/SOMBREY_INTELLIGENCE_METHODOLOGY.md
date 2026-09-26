# Sombrey Intelligence — Scoring Methodology (Readiness v1 · Strain v1)

**Versions:** `readiness-1.0` · `strain-1.0` (config: `convex/readiness/scoring.ts` `READINESS_V1`, `convex/strain/strainConfig.ts` `STRAIN_V1`; changelog: `METHODOLOGY_CHANGELOG`).

**Status.** Both methodologies are implemented, versioned and unit-tested. **Neither is validated.** The band has not yet passed physical validation (docs/SOMBREY_BAND_VALIDATION.md). Readiness is shown, as it has been since its first version, with its confidence and state. The Strain *value* is computed and stored but stays hidden (`STRAIN_FORMULA_APPROVED = false`) until checks A–F pass.

**What the numbers are.** Every weight below is an **evidence-informed engineering prior**. No peer-reviewed source prescribes percentages for a consumer readiness or strain score, and none is claimed. The literature tells us *which* signals carry information and *roughly how much we can trust them*. Sombrey turns that into numbers, and those numbers will be recalibrated from longitudinal Sombrey data (§8).

---

## 1. Four concepts, kept apart

| Concept | Question | Where |
|---|---|---|
| **Strain** | How much physical load has this person accumulated today? | `strain/*` → Daily Load → Strain |
| **Recent load** | What have they been doing over recent days? | `strain/rollingLoad.ts` |
| **Readiness** | How prepared/recovered do they appear to be right now? | `readiness/scoring.ts` |
| **Interpretation** | What does load + readiness + history + context mean? | AI Coach (`strain/context.ts`) |

```
physical load  → SessionLoad → Daily Load → Strain            (what you did)
sleep + cardiovascular recovery + recent load + physiology → Readiness   (how you are)
Strain + Readiness + recent history + environment → interpretation       (what it means)
```

- Strain is **never** multiplied or adjusted by Readiness.
- Readiness is **never** "readiness − strain" or "readiness × (1 − strain)".
- Yesterday's load enters Readiness **only** through the recent-load domain (§4.3), as context.

---

## 2. Audit — before Phase 6C

**Readiness (legacy "v1", rows stamped `v1`).**
- Weights: sleep 35, resting HR 30, training load 25, physiological 10.
- Sleep: duration vs the personal median, with a small variability penalty.
- Resting HR: the day's **single minimum** reading, which a single artifact reading could distort.
- Training load: **Sport+ minutes only** (workouts were ignored), as an acute:chronic ratio that penalised spikes.
- SpO2 and temperature deviation.
- Days were UTC days until Phase 6.
- A new row was inserted on every computation (duplicates per day).
- The loader scanned the user's entire measurement history on every run.

**Strain (Phase 6 "proposal-1").** An unweighted sum of normalized components, not shown.

**Data reality.**

| Signal | Status |
|---|---|
| Sleep duration and timing | Reliable when the band syncs sleep |
| Stages | Present but unvalidated — **not used** |
| Resting HR | Band resting readings (intermittent), plus scheduled/live HR inside the sleep window |
| HRV | **Unavailable** on this band |
| SpO2, skin temperature | Intermittent; wrist-optical and noisy |
| Session HR | Series spacing unverified; band average available |
| Sets, reps, weight | Reliable, from the app |
| Steps, calories | Available; context only |
| Subjective wellness / RPE | **Not collected** |

---

## 3. Evidence reviewed

| Area | Evidence | What it supports |
|---|---|---|
| Load monitoring | Bourdon et al. 2017 consensus (IJSPP 12:S2-161); Soligard et al. 2016 IOC consensus (BJSM 50:1030) | Monitor internal *and* external load; individual responses vary; load relates to injury/illness risk |
| Recovery | Kellmann et al. 2018 recovery consensus (IJSPP 13:240) | Stress–recovery balance; recovery is multidimensional and individual |
| Subjective vs objective | Saw, Main & Gastin 2016 systematic review (BJSM 50:281) | Subjective wellness responds to load more consistently than common objective markers. Sombrey has no subjective input, so load context partly stands in |
| Sleep | Fullagar et al. 2015 (Sports Med 45:161); Walsh et al. 2021 consensus (BJSM 55:356); Windred et al. 2024 (Sleep 47:zsad253) | Sleep loss impairs performance, though the evidence is mixed; sleep need is **individual**; sleep **regularity** is independently informative (stronger than duration for mortality in UK Biobank) |
| Resting HR | Buchheit 2014 (Front Physiol 5:73) | RHR is informative but less sensitive than HRV. Day-to-day noise is high, so baseline deviation and multi-day views are preferred. Lower RHR is ambiguous |
| Nightly wearable metrics | Nuuttila et al. 2025 (Sensors, Polar, overload study) | Group-level nocturnal HR and sleep often **didn't** move with 2 weeks of overload, while subjective strain did. Individual responses vary; load context matters |
| Illness signals | Mishra et al. 2020 (Nat Biomed Eng 4:1208) | RHR elevation vs personal baseline flags illness. Temperature deviation is an illness/stress signal |
| Wrist SpO2 | Wrist reflectance oximetry reviews (e.g. Lancet Respir Med 2022; J Clin Sleep Med 2024) | Wrist SpO2 error ≈ 2–4%, with frequent signal rejection; not a precise signal |
| HR load | Banister 1991 (TRIMP); Edwards 1993 (zones); Karvonen 1957 (HR reserve); Tanaka et al. 2001 (JACC 37:153) | HR × time in zone is an internal-load measure; HRmax 208 − 0.7·age beats 220 − age but is still individually imprecise |
| Session-RPE | Foster et al. 2001; Haddad et al. 2017 review (Front Neurosci 11:612) | sRPE is valid across modes and correlates with HR methods. **Not collected by Sombrey** — a known gap |
| Resistance | Scott et al. 2016 (Sports Med 46:687); Sweet et al. 2004 (JSCR 18:796) | Volume-load is external load. %1RM alone misses rest, velocity and reps-in-reserve. sRPE is valid for resistance sessions |
| Monotony | Foster 1998 (MSSE 30:1164) | Monotony (mean/SD) and strain (load × monotony) relate to illness beyond load alone |
| ACWR | Impellizzeri et al. 2020 (IJSPP 15:907); Lolli et al. 2019 | ACWR has ratio-coupling and causal-inference problems — **not used** as a score |
| Fitness–fatigue | Banister impulse–response model | Fatigue decays faster than fitness, so recent days matter most for current state |
| Weather | Périard, Eijsvogels & Daanen 2021 (Physiol Rev 101:1873) | Heat raises HR at a given work rate — context, not load |

**Not used as evidence:** competitor marketing (WHOOP, Oura, Garmin, Apple, Polar). Their public descriptions were read for terminology only; no formulas, weights or equivalence are claimed.

---

## 4. Readiness v1 (`readiness-1.0`)

Score 0–100. There are four domains, each scored 0–100 **against the user's own baseline**, then combined with the weights below.

| Domain | Weight | Inputs | Basis |
|---|---|---|---|
| Sleep | **40%** | Duration vs personal need (75% of domain) + timing regularity (25%) | Evidence (sleep loss; individual need; regularity), with Sombrey's curve |
| Cardiovascular recovery | **30%** | Overnight resting HR vs personal baseline | Evidence (RHR, illness detection), with Sombrey thresholds |
| Recent load | **20%** | Daily Load of the last 3 days vs the personal reference, plus repeated high-load days | Adapted (fitness–fatigue, monotony); Sombrey weights |
| Physiological | **10%** | SpO2 drop, skin-temperature deviation vs baseline | Evidence of signal value, limited by sensor quality |

### 4.1 Why these weights (vs the 35/30/20/15 starting hypothesis)

- **Sleep 40 (up from 35).** This is the most consistent evidence base for next-day function. It's also the band's most complete overnight signal, and it now carries regularity as well as duration. With no HRV and no subjective questionnaire, sleep is the strongest recovery information Sombrey has.
- **Cardiovascular 30 (kept).** RHR vs personal baseline is the only autonomic marker available. Buchheit shows it's less sensitive than HRV and noisy day to day, which argues against raising it; Mishra shows elevations are meaningful, which argues against lowering it.
- **Recent load 20 (kept).** Load is the *context* of recovery, not a measurement of recovery status. It matters because physiology often lags or doesn't show overload (Nuuttila 2025; Saw 2016), and Sombrey has no wellness questionnaire to catch it. It's capped at 20 because the load–recovery relationship is highly individual and ratio metrics are unreliable (Impellizzeri 2020).
- **Physiological 10 (down from the hypothesised 15).** Wrist SpO2 has ~2–4% error with frequent rejection, and temperature deviation is mostly an *illness* signal. Both domains are asymmetric (normal = 100). An asymmetric domain at 15% would pull every other domain's score upward by default, which is spurious optimism.

### 4.2 Domain details

**Sleep**
- Need = median of up to 28 prior nights (≥ 5 nights required).
- Before that, a labelled 7-hour population bridge is used at confidence 0.3, and the state is BUILDING_BASELINE.
- Duration curve: ≥ 100% of need → 100; 85% → 80; 60% → 40; below that, linear to 0.
- Regularity: SD of the sleep midpoint (minutes after local noon, so there's no midnight wrap) over 7 nights, needing ≥ 4. SD ≤ 30 min → 100; SD ≥ 120 min → 50.
- Stages are not used (unvalidated).

**Cardiovascular**
- Overnight RHR comes from the band's own resting reading for the day. Otherwise it's the **median of the lowest 20%** (at least 3) of ≥ 6 HR readings inside the sleep window.
- A daytime minimum is never used.
- Baseline: median of up to 28 prior nights, needing ≥ 5.
- Spread: 1.4826 × MAD, floored at 2 bpm.
- Scoring: z ≤ 0.5 SD → 100; above that, −20 per SD. A lower RHR is not penalized, because its meaning is ambiguous.

**Recent load**
- 3-day weighted load relative to the personal reference: yesterday 0.5, two days ago 0.3, three days ago 0.2 (Sombrey synthesis).
- ≤ 1× typical → 100, so rest and normal training are never penalized. 2× → 75. 3× → 55. Floor 40.
- 3 or more consecutive high-load days (≥ 1.5× reference): −5 per day beyond 2, maximum −15.
- Unknown days are **excluded** from the weights. With no known day, or no baseline, the domain is excluded.
- No acute:chronic ratio is used.

**Physiological**
- SpO2 counts only as a drop (> 1 SD below baseline).
- Temperature counts as an absolute deviation of > 1.5 SD.
- Baselines need ≥ 7 days.

### 4.3 How yesterday's Strain enters Readiness

- Yesterday's Strain is a function of yesterday's **Daily Load** relative to the personal reference. Readiness uses that same relative load as the most heavily weighted day of the recent-load domain.
- It can lower Readiness only within that domain's 20% share, and never below the domain floor. That's at most 12 points, plus the high-load-streak adjustment.
- It is not a subtraction, not a multiplier, and not a fixed share of Readiness.
- While the Strain value is display-gated, the domain still uses the underlying load, which is the same information.

### 4.4 Missing data, confidence, states

- A domain without data is **excluded**, and the remaining nominal weights are renormalized. Missing data is never scored as zero or poor.
- **Confidence** = Σ (domain confidence × *nominal* weight), so each missing domain lowers it.
- Levels: HIGH ≥ 0.7, MODERATE ≥ 0.45, LOW ≥ 0.2, otherwise INSUFFICIENT.
- A score requires sleep **or** cardiovascular data. Load and physiology alone can't say how recovered someone is.

| State | Meaning |
|---|---|
| NOT_ENOUGH_DATA | No sleep and no cardiovascular data |
| BUILDING_BASELINE | Scored, but no domain has a personal baseline yet |
| LOW_CONFIDENCE | Confidence LOW or INSUFFICIENT |
| READY | Personal baselines and adequate data |

**Persistence and time.**
- One row per user per local day, replaced on recomputation. Each row carries its version, state, confidence level, time zone and per-domain detail.
- Legacy `v1` rows keep their own version string and are never rewritten.
- Readiness describes the **morning state**: the recent-load domain uses days *before* today.

---

## 5. Strain v1 (`strain-1.0`)

### 5.1 Domains and weights

| Domain | Weight | Measures | Evidence |
|---|---|---|---|
| Cardiovascular | **45%** | Zone-weighted minutes in HR-reserve zones (Edwards-style weights 1–5) | Internal load; HR methods are the best-validated wearable load measures |
| Resistance | **30%** | Set-equivalents scaled by load relative to the user's own best e1RM (0.6–1.3) | External load only; no internal measure (no RPE; HR under-reads lifting) |
| Activity | **25%** | MET-minutes above rest, only for sessions without usable HR | Population METs (2024 Compendium); no individual intensity |

**Why the weights are exchange rates, not shares.** Load is additive: a run plus a lifting session is more load than either alone. Weights used as shares of an *average* would dilute a single-domain day, so instead each weight sets the contribution of **one reference dose** of that domain:

- a cardio reference dose = 1.0 load unit;
- a resistance reference dose = 30/45 ≈ 0.67;
- an activity reference dose = 25/45 ≈ 0.56.

**Why the 45/30/25 starting point holds, and what it means.**
- It encodes *measurement certainty per unit of load*, not a claim that lifting is physiologically "worth less".
- Cardiovascular load is the only internal measure Sombrey has.
- Resistance load is external, and its internal cost is uncertain (Scott 2016).
- The activity fallback is a population estimate that is likely to overstate intermittent sports.

The resistance exchange rate is the weakest prior of the three. Collecting sRPE would be the single best improvement (Sweet 2004; Haddad 2017).

### 5.2 Components and Daily Load

- **Reference doses:**

  | Domain | Reference dose | Roughly |
  |---|---|---|
  | Cardiovascular | 180 zone-minutes | 60 min in zone 3 |
  | Resistance | 20 set-equivalents | a full lifting session |
  | Activity | 300 MET-minutes | 60 min at 6 MET |

- **Cap:** 4 reference doses per domain per day.
- **Daily Load** = Σ rate × min(dose ÷ reference, 4). It keeps its components (cardio, resistance, activity), the raw doses, its confidence and the session list.
- **Cardiovascular details:**
  - HRmax is Tanaka's estimate (labelled), raised to the highest peak the band has recorded; a measured value is used when one exists.
  - Resting HR comes from the band.
  - Each HR reading covers at most 120 s, so sparse HR is never treated as continuous.
  - Quality depends on coverage and sampling spacing, and is capped at MODERATE while HRmax is estimated or the series timing is unverified.
- **Calories, steps, weather and readiness are never inputs.**

### 5.3 Normalization

- Strain = 100 × (1 − 2^(−DailyLoad ÷ reference)).
  - The reference is the median Daily Load of the user's active days over the previous 28 days, **floored at 0.5 load units** (so a near-sedentary usual day doesn't make half a session look extreme).
  - A typical training day is about 50, twice typical about 75, three times about 88.
  - The scale saturates below 100, and differences at the top compress as effort does.
- **Why it's nonlinear:** it keeps the scale readable, reflects diminishing marginal cost, and stays bounded without an arbitrary maximum.
- **Why it's personal:** the same session means more to a less-trained person. This is Sombrey synthesis.
- **Cold start:** there is no value until the baseline is ready (≥ 14 days of history, ≥ 6 active days, ≥ 4 sessions of MODERATE+ quality). The state is BUILDING_BASELINE and no population reference is substituted.
- **States:** NOT_ENOUGH_DATA (the day's data is insufficient, or it's a day with no band data), BUILDING_BASELINE, LOW_CONFIDENCE, READY.
- **Each day is scored against the baseline as it stood before that day,** so historical values don't drift as the baseline moves. They change only through a documented recomputation: a late import, or a version change.

### 5.4 Double counting

One physical session → one SessionLoad. The priority order is:

1. Workout (its Sport+ record is attached to it, never separate).
2. Band or app activity.
3. Noticed activity.

- An overlapping lower-priority session is trimmed; if it's more than 50% covered, it's dropped.
- Duplicate imports are keyed on the band's raw start.
- Merged app/band rows are one row.
- Steps and active minutes are never load inputs, so they can't double count a walk or a workout.

---

## 6. Recent load (`strain/rollingLoad.ts`)

**Day status**

| Status | Meaning |
|---|---|
| `measured` | Sessions with usable load data |
| `incomplete` | Sessions exist, but none had enough data to measure load |
| `rest` | No sessions, but the band was worn or synced that day (a step summary, a resting-HR reading, or a sleep ending that day) — a measured zero |
| `no_data` | Unknown — never zero |
| `in_progress` | Today |

**Windows.** 1, 3, 7, 14 and 28 days, ending yesterday, each reporting:
- known and unknown days;
- total load, average per *known* day, highest and lowest;
- active days;
- high-load days (≥ 1.5× reference);
- load relative to baseline.

**Pattern:**
- consecutive high-load days;
- Foster monotony (7-day mean ÷ SD, needing ≥ 5 known days) and weekly strain;
- trend (last 7 vs previous 7 known-day averages, ±20%).

This is **context** for Readiness's recent-load domain and the coach. It is not a penalty in itself.

---

## 7. Late data, idempotency, time

- **Recomputed from stored records.** Every value — Daily Load, Strain, rolling windows, readiness recent load — is recomputed from stored records on read or recompute. A late band import updates its own day's SessionLoad, Daily Load and Strain, the rolling windows, and (at the next readiness computation, triggered after every import) today's recent-load domain.
- **No double counting on re-import.** Re-importing the same record changes nothing.
- **Daily snapshots.** `dailyLoadSnapshots` holds one row per user per day, rewritten only when the recomputed values change and stamped with `strainVersion`.
- **Time zones.**
  - Days are the phone's IANA-zone calendar days. The band never decides the zone.
  - Handling is DST-correct.
  - A session belongs to the day it **started**, even if it crosses midnight.
  - After a time-zone change, history is regrouped in the current zone. This is deterministic, and it's a documented limitation.

---

## 8. Validation plan (future — not performed)

The architecture stores what's needed:
- versioned readiness rows with per-domain inputs;
- versioned daily load snapshots with components and status;
- environment snapshots per session.

Once enough longitudinal data exists (n per user and across users — correlations stabilize only around n ≈ 250), evaluate:

1. Does the sleep deviation explain next-day readiness or performance?
2. Does the RHR deviation add information beyond sleep?
3. Does yesterday's load improve the recovery interpretation?
4. Does the 7-day load add information beyond yesterday's?
5. Does resistance load add information beyond cardiovascular load?
6. Does the activity fallback add independent information?
7. Does weather explain an unusual HR response at the same external work?
8. Which inputs are redundant?

**Method:**
- within-person mixed models on the stored daily features;
- recalibrate the weights only with a version bump and changelog entry;
- never tune to make a particular test day produce a desired score.

---

## 9. AI Coach

The coach receives a structured context: today, yesterday, rolling load, readiness and environment.

- **Today:** load units, components, relative to baseline, sessions with their load basis and confidence, and the Strain state. The value appears only once it's approved.
- **Yesterday:** its status (unknown vs rest), load and relative load, sessions, confidence and Strain state.
- **Rolling load:** the 3/7/14/28-day windows, reference, streak, trend and monotony.
- **Readiness:** version, score, state, confidence level, and every domain with its sub-score, weight and description.
- **Environment:** context only.

It includes rules telling the coach:
- Strain and Readiness are separate and never combined;
- unknown days aren't rest;
- say "tended to", never "causes";
- don't base recommendations on the unvalidated Strain value.

Each session appears once.

---

## 10. Limitations

- **No hardware validation yet.**
  - Band timestamp basis, duration unit and HR series spacing are unverified.
  - Wrist optical HR is noisy during intense or grip-heavy work.
- **No HRV, no subjective wellness, no session-RPE.** These are the three best-evidenced inputs Sombrey lacks.
- **Readiness priors:**
  - Every weight, curve and threshold is a prior.
  - The recent-load day weights (0.5/0.3/0.2) and the high-load multiple (1.5×) are Sombrey synthesis.
- **Strain priors:**
  - The resistance exchange rate is the weakest.
  - Reference doses are engineering anchors.
  - The saturating curve and the 0.5 reference floor are synthesis.
- **Individual baselines take time:** 5 nights for sleep and RHR, 7 days for physiology, 14+ days for load.
- **Time-zone history:** travel regroups history in the new zone.
- **Nutrition** still uses UTC days (separate system).

## References

- Bourdon PC et al. Monitoring athlete training loads: consensus statement. *IJSPP* 2017;12(S2):S2161–S2170.
- Soligard T et al. How much is too much? (Part 1) IOC consensus statement on load in sport and risk of injury. *BJSM* 2016;50:1030–1041.
- Kellmann M et al. Recovery and performance in sport: consensus statement. *IJSPP* 2018;13(2):240–245.
- Saw AE, Main LC, Gastin PB. Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures. *BJSM* 2016;50:281–291.
- Fullagar HHK et al. Sleep and athletic performance. *Sports Med* 2015;45:161–186.
- Walsh NP et al. Sleep and the athlete: narrative review and 2021 expert consensus recommendations. *BJSM* 2021;55:356–368.
- Windred DP et al. Sleep regularity is a stronger predictor of mortality risk than sleep duration. *Sleep* 2024;47(1):zsad253.
- Buchheit M. Monitoring training status with HR measures: do all roads lead to Rome? *Front Physiol* 2014;5:73.
- Nuuttila OP et al. Monitoring sleep and nightly recovery with wrist-worn wearables: links to training load and performance adaptations. *Sensors* 2025.
- Mishra T et al. Pre-symptomatic detection of COVID-19 from smartwatch data. *Nat Biomed Eng* 2020;4:1208–1220.
- Foster C. Monitoring training in athletes with reference to overtraining syndrome. *MSSE* 1998;30:1164–1168.
- Foster C et al. A new approach to monitoring exercise training. *JSCR* 2001;15:109–115.
- Haddad M et al. Session-RPE method for training load monitoring: validity, ecological usefulness, and influencing factors. *Front Neurosci* 2017;11:612.
- Sweet TW et al. Quantitation of resistance training using the session RPE method. *JSCR* 2004;18:796–802.
- Scott BR et al. Training monitoring for resistance exercise: theory and applications. *Sports Med* 2016;46:687–698.
- Impellizzeri FM et al. Acute:chronic workload ratio: conceptual issues and fundamental pitfalls. *IJSPP* 2020;15:907–913.
- Banister EW. Modeling elite athletic performance. In: *Physiological Testing of Elite Athletes*, 1991.
- Edwards S. *The Heart Rate Monitor Book*, 1993.
- Karvonen MJ, Kentala E, Mustala O. *Ann Med Exp Biol Fenn* 1957;35:307–315.
- Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. *JACC* 2001;37:153–156.
- Herrmann SD et al. 2024 Adult Compendium of Physical Activities. *J Sport Health Sci* 2024.
- Périard JD, Eijsvogels TMH, Daanen HAM. Exercise under heat stress. *Physiol Rev* 2021;101:1873–1979.
- Schönbrodt FD, Perugini M. At what sample size do correlations stabilize? *J Res Pers* 2013;47:609–612.
- Wrist SpO2: "Can we trust the oxygen saturation measured by consumer smartwatches?" *Lancet Respir Med* 2022; *J Clin Sleep Med* 2024 (smartwatch vs polysomnography).
- Weather: MET Norway Locationforecast (CC BY 4.0).
