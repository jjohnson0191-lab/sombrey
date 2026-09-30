# Sombrey Body Scan — Phase 5F (longitudinal experience; final implementation phase)

Completes the user-facing Body Scan on top of 5A–5E. **Development only**; production untouched.
Nothing is validated: no scanner value is called "Measured" until it passes the production gate
(docs/BODY_SCAN_5D.md §12). After 5F comes one consolidated physical evaluation of all of Phase 5.

## 1. Labels and what each build shows
Every value carries its provenance (convex/bodyScan/history.ts):

| Label | Meaning | Production build | Development build |
|---|---|---|---|
| **Measured** | a scanner measurement released through the validation gate (`RELEASED_MEASUREMENTS`, **empty**) | shown | shown |
| **Calculated** | from the user's recorded values (BMI from recorded height/weight at scan time) | shown | shown |
| **Experimental** | any unreleased scanner value, proportion, trend or change state | hidden | shown, labelled |
| **Not available** | nothing computed / not precise enough | — | — |

Body fat is never shown as a value (5E: `displayable: false`); the UI says composition is experimental
and validation is pending. No medical, clinical or accuracy claim appears anywhere.

## 2. Result hierarchy (BodyScanResultCard)
1. Scan status (capture quality, views kept, distance measurement) → 2. Compare with another scan →
3. Measurements (Measured; Experimental on dev) → 4. Body proportions → 5. BMI (Calculated) →
6. Body composition note (experimental) → 7. Uncertainty (± stated once) → 8. **Analysis details**
(expanded only): device, iOS, app version, camera, depth, clothing, capture protocol and capture
settings, capture quality, features/method/composition versions, distance-measurement use, the
height/weight/sex/age snapshot, consent version, validation status. Dev builds add every raw result.

## 3. History
Saved scans newest first, each row: date, capture quality, deleted images, "not analysed yet",
measured / experimental counts (experimental on dev only), BMI (calculated). "Since your previous
scan": production says change can't yet be told from normal variation; dev shows the three states
(no meaningful / possible / meaningful — meaningful impossible until a validated MDC exists).

## 4. Visual comparison (BodyScanCompareView)
Pick any two saved scans. Allowed only when the compatibility system says so (`bodyScans:compare`:
same depth source, protocol and method; align.1 distance/tilt/pose) — otherwise a plain refusal
("…captured under different conditions and can't be reliably compared"); nothing is force-aligned.
Per view (front/side/back), only when both scans still have that image and a detected outline.
Photos are placed so the body outline spans the same 6–94 % of the frame, centred
(`BodyScanAlignment.placement`); side by side or an overlay with a wipe slider. Loaded from the
authenticated endpoint into memory only. No before/after hype, scores, streaks or badges.

## 5. Proportion trends (bodyScans:trends)
Waist-to-height, shoulder-to-waist, waist-to-hip, arm/leg symmetry — only "available" values, only from
scans with the newest scan's method and capture protocol, only with ≥ 3 such scans. Labelled
experimental (dev builds); worded as shape, never fat loss, muscle gain or health. Note: under
today's priors waist-to-height is `low_confidence`, so it never forms a trend yet.

## 6. Images, retention, deletion
"Keeping scan images allows Sombrey to compare your physique over time." Per scan: delete one view's
image (`bodyScans:removeView` — the scan and its analysis stay; that view can't be compared; recorded in
`removedViews`), or delete the whole scan. Images stay in the existing Convex storage behind the
authenticated, owner-checked endpoint (no URLs, no-store, metadata stripped at capture); no new storage
provider; never sent to an external AI or analysis service; never used for training.

## 7. Optional training consent (architecture only)
`bodyScanTrainingConsent`: append-only log (version, granted, timestamp) — optional, explicit, revocable,
versioned, **completely separate** from Body Scan consent (tested both ways). Wording
`draft-2026-10` (pending legal review) is shown on development builds only. No training pipeline
exists and nothing reads this for training.

## 8. Capture
- Framing via the server capture settings (5E mechanism), now **5f.1**: body span 0.62–0.93 of the frame
  (was 0.60–0.90), head margin 0.03, ankles ≤ 0.96 — the drawn guide spans ≈ 2–97 % of the preview
  height and the user can stand ~10 % closer. Quality gates otherwise unchanged; changing them again
  needs no app release.
- Hands-free timer unchanged: Start → 10…4 walk into position (not gated) → 3-2-1 gated; any failed
  check pauses at 3 with the reason and resumes when fixed; capture only after three valid seconds.
- Clothing: "As recommended" (default) or "Fitted athletic wear" — the latter shows a neutral note that
  accuracy may be a little lower, and is recorded with the scan (`capture.clothing`).
- Rear LiDAR mode unchanged, optional, LiDAR devices only; its values are experimental like all others.

## 9. What remains unvalidated
Everything metric, every proportion, every trend, the RFM estimate, change thresholds (no MDC), the new
framing's effect on accuracy. BMI is only as good as the recorded height and weight. Encryption at rest
is a property of the Convex platform that this work relies on but did not itself verify.
