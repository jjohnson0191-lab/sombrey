# Sombrey Body Scan — Phase 5C (metric scale + measurement engine)

Builds on 5A (capture, storage, security — docs/BODY_SCAN_5A.md) and 5B (on-device CV features —
docs/BODY_SCAN_5B.md). **Development only**: nothing here is deployed to production, and measurement
values are shown only on development builds.

Status key — **IMPLEMENTED**: built and tested (unit + dev backend). **EXPERIMENTAL**: built, but its
error model is a prior awaiting the device study. **NOT YET VALIDATED**: no comparison against a
reference (tape measure, stadiometer, DXA) has been done — this applies to every measurement.

## 1. Architecture

```
Front camera (TrueDepth, automatic)  ─┐                        ┌─ bodyScanFeatures (5c.1): scale-free
Rear camera (LiDAR, optional mode)   ─┤  on the phone:         │    features + scale.evidence (numbers)
                                      ├→ Vision mask + pose ───┤
      depth map (in memory only) ─────┘  + plane fit            └─→ server: computeMeasurements (m1)
                                                                      → bodyScanMeasurements (per scan)
```

- The depth map never leaves the phone. Per front/back view the phone sends **scale evidence**:
  depth-map size, focal length (calibration or field-of-view), depth accuracy, whether filtered,
  samples, valid fraction, torso-surface distance, plane tilt, fit residual, and the silhouette's
  height projected onto that surface. (`BodyScanDepth.swift`, `BodyScanLiDAR.swift`)
- The server derives measurements with a deterministic, versioned method
  (`convex/bodyScan/measurements.ts`, method `m1`) from the stored numbers only — so a better method
  can be recomputed later (`bodyScans:recomputeMeasurements`) without any image, and older results
  are kept alongside, never overwritten.
- No new scanner: the rear mode feeds the same PoseFrame → gates → countdown → review → save pipeline.

### Why a new table (`bodyScanMeasurements`)
The existing `measurements` table (and its reserved `source: "scanner"`) feeds Progress charts, the
coach dashboard and the AI coach context as **recorded values**, and has no place for uncertainty,
method, status or scale source. Writing unvalidated scanner estimates there would present them as
fact and put body-composition data into AI coaching. Scanner results therefore stay per scan in
`bodyScanMeasurements`; once a validation study signs off a measurement, the documented bridge is to
mirror its "available" values into `measurements` with `source: "scanner"`.

## 2. Scale sources and device compatibility — IMPLEMENTED

| Device | Front (standard) scan | Rear mode | Result |
|---|---|---|---|
| Face ID iPhone (TrueDepth) | TrueDepth depth with every still (automatic) | not offered | metric **may** be available when depth passes the checks |
| LiDAR iPhone/iPad (Pro) | TrueDepth, as above | offered: "Back camera · measures distance" | LiDAR metric when checks pass |
| No depth hardware | plain photo | not offered | "Body proportions available" — no cm values |

- Capabilities come from hardware (`AVCaptureDevice .builtInTrueDepthCamera`,
  `ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)`), never assumed.
- Scale kinds: `none`, `truedepth`, `lidar`; `arkit_metric` is reserved (no error model → any such
  evidence yields no metric values). No generic human height, no Vision default height, no
  client-sent scale factor is ever used (the server refuses `metersPerUnit`).
- Each scan records `capture.camera` (front | rear) and `capture.depth` (none | truedepth | lidar).
  The server refuses rear-without-LiDAR, front-with-LiDAR, and a feature set whose scale source
  differs from the scan's recorded depth source.
- TrueDepth: unfiltered depth (`isDepthDataFiltered = false` — holes stay holes), not embedded in the
  stored photo, oriented with the photo's EXIF orientation; intrinsics from the camera calibration.
- LiDAR: ARKit scene depth, high-confidence pixels only, rotated upright with the photo.

### Rear LiDAR mode — IMPLEMENTED (device test pending)
The phone stands with its back camera facing the user's spot (~2 m). The timer is 15 s (to walk
round); the screen faces away, so guidance is **spoken** (AVSpeechSynthesizer): the one instruction
that matters, "3, 2, 1", "Got it. Come back to the phone." The view-review/retake flow is unchanged.

## 3. Geometry — IMPLEMENTED
- Scale-free inputs (5B, extended in 5c.1): widths (front/back) and depths (side) ÷ the silhouette's
  own height; side-view thigh and calf depth; 40-sample width/depth profiles; keypoint proportions.
- **Height.** A plane is fitted to the torso's measured surface (rows between shoulders and hips,
  inset 20 % from the outline, outliers > 25 cm from the median rejected). The silhouette's top and
  bottom edges are projected onto that plane (a tilted phone is handled by the fitted plane, not by a
  tilt formula). The outline lies in the body's mid-plane, behind the measured surface by half the
  torso depth δ; a parallel plane shift scales central projections exactly by (Z+δ)/Z, and δ = ½·d·H
  (d = side-view torso depth ÷ height) gives δ = ½·d·Hs / (1 − ½·d·Hs/Z), H = Hs·(Z+δ)/Z.
  Front and back must agree within 3 %; the side view is never used for height.
- **Lengths** = scale-free value × H (shoulder/chest/waist/hip width, chest/waist/hip depth, thigh,
  calf and upper-arm width, torso and leg length).

## 4. Circumference — EXPERIMENTAL / NOT YET VALIDATED
Front width + side depth → an elliptical cross-section → Ramanujan's perimeter × H. Never width × π.
Assumption: the cross-section is an ellipse whose axes are the silhouette width and depth at the
landmark rows; model error prior 3 % (1σ). A width:depth ratio outside a plausible range per site
→ `inconsistent_front_side` (unavailable). Chest, waist, hip, thigh and calf are computed; **upper arm
is unavailable** (the arm overlaps the torso in the side view, so there's no depth for it).

## 5. Confidence model — EXPERIMENTAL
Every measurement: `status` (available | low_confidence | unavailable), value (not for unavailable),
**≈95 % uncertainty**, a 0–1 heuristic `confidence` (quality × threshold/(threshold + relative
half-width) — not a probability), `method`, `reasons`. Error priors (1σ), all in `PRIORS`:
depth (TrueDepth 1 % to 1 m + 3 %/m beyond; LiDAR 1 % + 0.5 %/m), mid-plane offset 25 % of δ,
silhouette edges 2 px, stature 0.5 %, keypoint lengths 2 %, ellipse 3 %, volume 8 %.
"Available" thresholds (95 % half-width ÷ value): height 2.5 %, lengths 8 %, circumferences 7 %,
volume 10 %; capture quality below 0.6 → never available. Depth evidence is refused outright for:
relative accuracy, < 150 samples, < 60 % valid, residual > 4 cm, distance outside 0.4 m–2.5 m
(TrueDepth) / 4 m (LiDAR), plane tilt > 35°.

**Consequence with today's priors (honest, by design):** at ~1.3 m, height and circumferences come out
`low_confidence` (the mid-plane offset and TrueDepth depth error dominate); widths can be available.
The device study replaces these priors with measured error — see §10.

## 6. Height vs profile — IMPLEMENTED
The scanner's height is stored with the scan and compared with the **scan-time snapshot** of the
profile height. Only an available height can raise "Scanner estimate differs from your saved height"
(gap > max(3 cm, uncertainty)). The profile is never changed; the user can edit it in Settings.

## 7. Weight — NOT IMPLEMENTED (deliberately)
Always `unavailable` (`not_estimated_in_5c`). A defensible estimate needs validated body volume and a
validated density model; neither exists. The manual weight history stays the source of truth.

## 8. Body volume — EXPERIMENTAL
Stacked ellipses over the 40 aligned front/side profile samples, trunk + legs (arms excluded):
`volumeIndex` = V/H³ (scale-free) and `trunkLegVolume` in litres when metric. Uncertainty
√((3σH)² + 8 %²) keeps it low-confidence; never shown, never converted to weight.

## 9. BMI and body fat — NOT IMPLEMENTED (deliberately)
BMI is `unavailable` (`requires_validated_weight`); no image→BMI model. No body-fat output exists in
5C (no RFM, no model). Stored inputs for later phases: height with uncertainty, waist girth,
waist-to-height (scale-free), volume index, provenance.

## 10. Change detection (foundation) — IMPLEMENTED
`compareMeasurements`: only same method version and same scale source; only "available" values;
`exceedsNoise` only when |Δ| exceeds the combined 95 % uncertainty √(uA²+uB²). `validated: false`.
Nothing user-facing uses it yet (5F).

## 11. Privacy and images — IMPLEMENTED (unchanged from 5A)
Images: authenticated endpoint only, owner-checked per request, no URLs, no-store, deletable.
Depth: on the phone only, in memory, never uploaded or written to disk. No external AI or CV
service. Scan deletion, discard, abandoned-scan cleanup and account deletion remove measurements
with features and images. Raw photos are never used for training without separate consent.

## 12. Performance
Per view: one depth conversion (TrueDepth ≈ 640×480 floats ≈ 1.2 MB; LiDAR 256×192), one plane fit
over the torso band (thousands of points, O(n)), Vision at utility priority after capture, off the
main thread; the capture UI never waits. Mask resolution raised to ≤ 1024 rows (~0.8 MB) for edges.
`processingMs` per view is stored, so device timings are measured, not assumed.

## 13. Licensing
Apple frameworks only (AVFoundation, Vision, ARKit, Core Motion, AVSpeechSynthesizer). No
third-party model; SMPL/SMPL-X, Anny, Meta MHR and similar were **not** integrated — none is needed
for this layer, and any future body model needs its own licence review before code.

## 14. Known limitations
- Nothing is validated. Priors are literature-informed guesses; one reported TrueDepth figure (~5 %
  past 2 m) is from a single developer report.
- TrueDepth is designed for < 1 m; at the protocol's ~1.5 m its depth may often fail the checks.
- The mid-plane assumption (outline at half torso depth) dominates height uncertainty.
- Principal point and depth/photo alignment rely on Apple's calibration data; lens-distortion
  residue isn't modelled.
- Clothing, hair and posture change silhouettes; the ellipse is an approximation of real sections.
- Rear mode: tap Start, then walk round — the spoken guidance and 15 s timer need device testing.

## 15. Validation needed before anything is shown in production
1. Device study: known height (stadiometer) and tape circumferences vs scanner, repeated scans,
   TrueDepth vs LiDAR, distances 1–2.5 m → replace `PRIORS` with measured error; new method version.
2. Repeatability (same person, same day) per measurement → the "meaningful change" thresholds (5F).
3. Product sign-off per measurement; only then enable display outside development builds and the
   bridge into `measurements` (`source: "scanner"`).
