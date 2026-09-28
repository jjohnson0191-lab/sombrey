# Sombrey Body Scan — Phase 5B (capture refinement + computer-vision foundation)

5B builds on 5A (docs/BODY_SCAN_5A.md). **Still nothing is shown to the user** — no body fat, BMI,
weight, height or circumference numbers are produced for display, and no LLM is involved. The new
data is scale-free engineering features for a future, separately validated model.

## 1. Capture refinement (protocol `5a.2`)
Physical testing of build 48 showed the frame was too small and the user had to stand too far back.

- **Practical distance.** The subject now fills **60–90 %** of the frame height (nose→ankle span;
  was 66–84 %), head ≥ 4 % from the top, ankles ≤ 95 %, hips centred 33–67 %. With a phone propped
  upright at waist height this is roughly **1.2–1.7 m** for most adults (the exact distance depends
  on height and the phone's field of view — see "Tuning").
- **Phone upright, not flat.** Pitch ≤ 20°, roll ≤ 6° (was 10°/4°, which was hard to achieve when the
  phone leans on something). The tilt instruction reads "Stand the phone more upright".
- **Larger body frame.** The on-screen guide (`BodyFrameGuide`) is drawn from the *same* numbers the
  gates use (`BodyScanProtocolConfig.guideSpan/guideNoseY/guideAnkleY`): its head, shoulders, hips,
  knees and feet sit where a correctly placed person's landmarks will be. It fills ~80 % of the
  preview height.
- **10-second hands-free timer.** Tap **Start** → 10…1 → capture. Seconds 10–4 read "GET INTO
  POSITION", 3–1 "HOLD STILL". The countdown only reaches capture if every check passed for the
  final 3 consecutive seconds (`CaptureCountdown.holdSeconds`).
- **Pause/cancel.** If a check fails during the last 3 seconds the countdown pauses on "PAUSED" and
  shows the one instruction to fix (e.g. "Step back a little"); it resumes at 3 once all checks pass
  again. Stop/Cancel ends it at any time. No capture is ever taken while a check fails.
- **Flow.** PREPARE → POSITION → COUNTDOWN → AUTO CAPTURE → FRONT REVIEW (Use photo / Retake) →
  SIDE → review → BACK → review → REVIEW ALL (retake any single view) → SAVE.
- **Capture conditions** are recorded with every view (`bodyScanImages.conditions`): phone pitch
  and roll, body span, scene brightness, and the protocol config id, so later analysis can tell which
  thresholds a photo was taken under.

### Tuning (development builds only)
Builds that point at a non-production deployment show a **Tune** button on the capture screen
(`BodyScanTuningView`): span min/max, head/ankle margins, pitch/roll limits. Saved per device
(`UserDefaults "bodyScan.protocolConfig"`); captures made with tuned values record
`protocolConfig = "tuned:…"`. Production builds always use the defaults. Once device testing settles
the numbers, they become the next protocol version's defaults.

## 2. Computer-vision pipeline (CV version `5b.1`)
Runs **on the phone** after each view is accepted, in the background, on the stored image (upright,
unmirrored, 2048 px). Apple frameworks only:

| Step | API | Output |
|---|---|---|
| Image validation | server `validateBlob` + client JPEG decode | JPEG, portrait, size |
| Person segmentation | `VNGeneratePersonSegmentationRequest` (`.accurate`, 8-bit) | mask, box-downsampled to ≤ 512 rows |
| Pose / keypoints | `VNDetectHumanBodyPoseRequest` | 19 2D joints, normalised 0–1 + confidence |
| Silhouette | mask rows connected to the body's column (between the hips) | top/bottom/left/right, height fraction, area/height², main-component fraction, keypoint↔mask agreement |
| Proportion features | `BodyScanFeatureExtractor.extract` | widths ÷ silhouette height (shoulder, chest, waist, hip; thigh, calf, upper arm), side-view depths (`…Depth`), ratios (waist:hip, shoulder:waist, torso:height, leg:height, torso:leg, thigh:lower-leg, arm:torso, arm/leg symmetry, shoulder/hip tilt) |
| Multi-view | `BodyScanFeatureExtractor.combine` | width:depth ratios, unitless girth *indices* (ellipse perimeter from front width + side depth, ÷ height), consistency (height agreement, front/back agreement, coverage) |
| Quality | per view + combined | `overallScore, framing, pose, lighting, segmentation, motion, multiViewConsistency` (0–1; internal only) |

No ARKit/LiDAR: the front camera gives no metric scale, so every stored geometric value is
**normalised** (a fraction of the body's own image height). `scale.kind` is `"none"`; the server
refuses `metersPerUnit` unless a real scale source (`lidar`/`arkit`) is declared. Nothing converts
features to cm or kg. The keys `cm`, `kg`, `fat`, `bmi` never appear (checked by tests).

Not used: SMPL/SMPL-X (non-commercial licence), MediaPipe/BlazePose GHUM (Apache-2.0 code, but its
model card restricts some uses and it is a third-party model), any research-only checkpoint, and
any cloud CV API. No third-party model is included in 5B, so there are no model-licence obligations.

### Privacy
iPhone → on-device Vision → structured numbers → `bodyScans:attachFeatures`. The image is never
sent anywhere for analysis (not to Claude, OpenAI, Gemini or any CV API); the image itself is only
the 5A private upload. Features are stored per user, behind the same ownership checks, and deleted
with the scan and with the account.

### Performance
Two Vision requests per view on a 1536×2048 image, at utility priority while the user continues;
`processingMs` is stored per view so device timings are measured, not assumed. The mask is reduced
to ≤ 512 rows (~0.4 MB) before feature extraction.

## 3. Storage and versioning (`convex/schema.ts`, `convex/bodyScans.ts`)
- `bodyScanFeatures`: one row per **(scan, cvVersion)**. Re-sending the same version is a no-op; a
  new pipeline version is stored alongside, never over, older rows. Each row records the processing
  components, device, OS and app version.
- `attachFeatures` requires: the owner, a **saved** scan, a known CV version, features only for
  views the scan has, and tight bounds (closed keypoint names, key pattern
  `^[A-Za-z][A-Za-z0-9_]{0,39}$`, widths 0–2, qualities 0–1, no free text).
- `features` (owner-only query) returns the stored sets without ids; `list` shows only which CV
  versions ran (`featureVersions`), never values.

## 4. Scan-to-scan comparison (foundation only)
`compareFeatureSets` (convex/bodyScan/features.ts) compares two scans **only** when CV version,
capture protocol and scale kind match (otherwise `comparable: false` with reasons). It returns raw
deltas with `validated: false`: until a repeatability study measures how much each feature varies
from capture alone, no difference may be presented as a change. Nothing user-facing uses it.

## 5. Retention additions
- Abandoned scans (still `capturing` after 24 h) are removed hourly with their images and blobs
  (`cleanupAbandoned`, convex/crons.ts).
- Scan delete / discard / account deletion also remove feature rows.
- Remaining gap: an upload whose attach call never happens leaves an unreferenced blob (no row
  points at it, so it can't be served); a storage-level sweep needs an upload ledger (future work).

## 6. Limitations
- A 2D photo has no metric scale; features are relative shape descriptors, not measurements.
- Clothing, hair and posture change silhouettes; the protocol guidance reduces this but cannot remove it.
- Side-view depths assume a true 90° turn; the orientation gate enforces it approximately.
- Legs or arms touching the torso merge silhouettes — detected (`legs_touching`) and those widths omitted.
- Thresholds are first-pass values from one tester; they need a multi-person repeatability study.
- No feature is validated against DEXA or any reference. Any body-composition output needs its own
  validation study, licensing review and product approval before it is shown to anyone.
