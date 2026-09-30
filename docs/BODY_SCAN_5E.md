# Sombrey Body Scan — Phase 5E (body-composition engine)

Builds on 5A–5D. **Development only** (dev backend adamant-chicken-676; production untouched). Nothing
in 5E is validated; no model was trained; no training data or accuracy figure was invented.

```
photo → Vision → geometry → metric scale → features (5c.1) → MEASUREMENTS (m2)
      → COMPOSITION (c1) → uncertainty → stored result (bodyScanCompositions)
```

## 1. Measurement method m2 (convex/bodyScan/measurements.ts)
New version; every stored m1 row is kept. m2 = m1 unchanged for every shared measurement (tested), plus:
- thigh depth, calf depth (side view, 5c.1 features);
- **waist-to-height with a ±95 % range** — the scale cancels, so its uncertainty is the outline-edge and
  ellipse-model terms only (the input the composition layer needs);
- silhouette area index (area ÷ height²), arm/leg symmetry, shoulder/hip tilt (posture, degrees).
Priors and thresholds are unchanged (no validation data). Under them, waist-to-height at a 512-row
mask is ≈ ±10 % → `low_confidence` — reported honestly, not loosened.

## 2. Composition layer c1 (convex/bodyScan/composition.ts)
A registry of versioned models; each declares inputs, feature version, population, validation status,
provenance and where it runs. Each result stores its value (if any), range, **named uncertainty
components** (measurement-propagated, published model error, and a list of what's unquantified),
`displayable`, and reasons. Inputs are the **scan's own snapshot** (height, weight + source/date, sex,
age at scan time) — later profile edits never change a stored result (tested).

| Model | Kind | Status | Output in c1 |
|---|---|---|---|
| `rfm` v0 | published equation | experimental | Internal estimate + range. **Never displayable.** |
| `bmi.recorded` v1 | formula | calculated from recorded values | Shown (dev builds) when weight is dated ≤ 30 days before the scan |
| `sombrey.bodyfat` v1 | learned (Core ML, on device) | not trained | Always unavailable (`model_not_trained`) |
| `sombrey.bmi_image` v1 | learned (Core ML, on device) | not trained | Always unavailable |

### RFM v0 — why it's stored but not shown
Woolcott OO, Bergman RN. *Relative fat mass (RFM) as a new estimator of whole-body fat percentage.*
Sci Rep 2018;8:10980: **RFM = 64 − 20 × (height / waist) + 12 × (female)**. Developed on NHANES
1999–2004 (ages 20–85), validated on NHANES 2005–2006 (n = 3,456, ages 20–69) against DXA; published
validation bias/precision 0.5/4.2 (men) and 0.9/4.9 (women) body-fat points — **for a tape waist at
the top of the iliac crest**.

Sombrey's range = √(measurement² + model²): measurement = 20/WHtR² × the waist-to-height range;
model = 1.96 × published precision. Two error sources are **unquantified** and named on every result:
the image waist vs a tape waist (never validated), and the site (Sombrey's narrowest-torso waist vs the
equation's iliac-crest waist — a likely systematic bias). Because the dominant error is unquantified,
no defensible user-facing range exists yet: the estimate is kept internally for the consolidated
evaluation (against DXA, via the 5D harness) and `displayable: false`. Unavailable (never guessed) when
sex is missing or not male/female (the equation is defined for those two), age is missing or outside
20–85, or waist-to-height is unavailable; implausible results are refused, not clamped.

### BMI
- **Recorded pathway (built):** weight ÷ height² from the user's recorded values at scan time — a
  calculation, labelled "from your recorded height and weight", not a scanner estimate. Unavailable
  when height or weight is missing or the weight is > 30 days older than the scan; not shown when the
  weight has no date or the user is under 18 (adult formula).
- **Metric pathway:** needs a validated weight; the scanner never estimates weight (m2: `weight`
  unavailable, `not_estimated_from_images`) and never converts volume to weight.
- **Image pathway:** `sombrey.bmi_image` slot — not trained.

## 3. Change over time (measurements.ts `compareMeasurements`, bodyScans:compare)
Scans must align (5D `align.1`: same depth source/protocol, similar distance, tilt and pose) and share a
method version. Then, per measurement "available" in both:
- |Δ| ≤ √(uA² + uB²) → **no meaningful change**
- beyond that, with a **validated** MDC: > MDC → **meaningful change**, else no meaningful change
- beyond that, without a validated MDC → **possible change** (never "meaningful")

`VALIDATED_MDC` is empty until the 5D repeatability study fills it; so today nothing can be
"meaningful". The app words it "Possible change (±n cm) · not confirmed".

## 4. Uploads and orphan cleanup
`POST /body-scan-upload` (Clerk JWT; consent required; JPEG ≤ 8 MB) stores the image and binds it to
its owner in `bodyScanUploads` in the same request. Attaching (or refusal) removes the row; rows older
than an hour are orphans and their blobs are deleted hourly (`cleanupOrphanUploads`, minute 47 UTC).
Only blobs this endpoint created are ever swept — other features' files are never touched. Someone
else's in-flight upload can't be attached and isn't deleted by the attempt. The upload-URL path stays
as the app's fallback (and for installed builds ≤ 51); its uploads aren't ledgered (documented gap,
narrowed rather than closed). Account deletion removes ledger rows and their blobs.

Security fix found by the 5E suite: both Body Scan endpoints answered a forged/malformed token with a
**500 that echoed the JWT parser error**; they now return a plain **401**.

## 5. Capture framing without an app release
The capture gates are served with the profile (`CAPTURE_CONFIG`, versioned). The app applies them only
inside its own sanity bounds, records `server:<version>` with each capture, and a dev build's local
tuning wins. After the consolidated evaluation, the practical distance (span/margins) can be moved
server-side — the quality gates themselves stay in force.

## 6. The future Sombrey model (architecture only)
Interface: model id + version, feature version (m2), inputs (m2 features, depth source, capture quality,
sex, age), runs on device via Core ML; the server registry declares its validation status and
population; results are stored per composition version, never over older ones. Training requires:
consented Sombrey scans (separate, explicit training consent — not the Body Scan consent) with DXA
reference (bodyFat) and measured weight (BMI), spanning sex, age, height, body size/composition,
skin tone and devices; a licensed training stack; a held-out validation set; per-population error
reporting. No dataset or model weights were added; SMPL/SMPL-X, unclear weights and scraped data are
excluded. Anny / Meta MHR were not needed for this layer and weren't integrated.

## 7. Privacy
Unchanged 5A model: authenticated, owner-only image access; no public URLs; metadata stripped; scan,
abandoned-scan, orphan-upload and account deletion remove images. No image, depth map or body number
goes to any external AI provider. A future LLM explanation layer may receive derived numbers only and
never produces a measurement (not built).

## 8. What remains unvalidated
Everything metric and every composition output: scale (TrueDepth/LiDAR), heights, widths/depths,
circumferences, volume, waist-to-height, RFM-from-image, change detection thresholds (no MDC). BMI from
recorded values is only as good as the user's recorded height and weight. The consolidated physical
evaluation (5D run sheet + DXA where available) is the next evidence step.
