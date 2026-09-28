# Sombrey Body Scan — Phase 5A (capture foundation)

What 5A is: a private, repeatable capture of three standard views (front, side, back) and a
longitudinal record of them. **Nothing is measured or estimated in 5A** — no body fat, BMI or
circumferences are produced or shown.

## Flow (iOS, `AICoach/BodyScanFlow.swift`)
Consent (first time; versioned) → Your details (only missing ones) → Prepare (clothing, placement)
→ FRONT → SIDE → BACK (front camera, live guidance, auto-capture) → Review (retake any view)
→ Save → scan history.

## Capture protocol `5a.1` (`AICoach/BodyScanQuality.swift`, `AICoach/BodyScanCamera.swift`)
- Front camera, portrait, 4:3 stills; Apple Vision body pose (~8 fps), Core Motion tilt/movement,
  mean luma for light. No third-party dependencies.
- Gates: one person; head and feet in frame; nose-to-ankle span 0.66–0.84 of the frame height;
  hips centred (0.36–0.64); phone pitch ≤ 10°, roll ≤ 4°; light ≥ 0.22 luma; subject and phone still;
  orientation per view (shoulder width ÷ torso length, face visibility); A-pose arms for front/back.
- One instruction at a time, in priority order. Auto-capture after the gates hold for 1.2 s, then a
  3-2-1 countdown that cancels the moment a gate fails. Manual shutter only when gates pass.
- Changing any threshold = a new protocol version (stored on each scan).

## Stored image
Upright, never mirrored, re-rendered (drops EXIF/GPS/camera metadata), long side **2048 px**, JPEG
**0.9**. Rationale: body-model stages work at ~256–1024 px on the body crop; 2048 keeps silhouette-edge
detail at the protocol distance with headroom (~0.5–1 MB/view); 0.9 avoids ringing at the outline.
No filters, smoothing or reshaping. Server accepts JPEG, portrait, long side 1024–4096, ≤ 8 MB.

## Data model (`convex/schema.ts`)
- `bodyScans` — one row per scan (never overwritten): `scanId` (client UUID, idempotency),
  `status` capturing|complete, `protocolVersion`, `consentVersion`, `capture` (device model, OS, app
  version, camera, image settings), `context` snapshot (height, weight + source/date, sex, age — the
  user's own records at scan time), reserved `analysis` (model version/time) for 5B+.
- `bodyScanImages` — one row per view: storage id (server-only), size, bytes, quality score, issue
  codes (closed set), capture time.
- `users`: `sex`, `bodyScanConsentVersion`, `bodyScanConsentAt` (height/weight/DOB already existed).

## Security
- Every function derives the user from the auth token — no client user ids.
- Ownership is checked server-side on every read, write and delete; another user's scan is
  indistinguishable from a missing one (NOT_FOUND / 404).
- No storage URL is ever minted for scan images; storage ids never leave the server.
- Images are served only by `GET /body-scan-image?scanId&view` (convex/http.ts) with
  `Authorization: Bearer <Clerk JWT>`, checked per request; `Cache-Control: private, no-store`.
  The app loads them into memory with an ephemeral URLSession (no disk cache).
- Uploads need consent; an upload must be a recent JPEG and is attached at most once; a refused
  upload is deleted (the refusal is returned, not thrown, so the deletion commits).

## Retention & deletion
- Scans are kept until the user deletes the scan or their account.
- `bodyScans:remove` deletes every image blob, image row and the scan; the endpoint then serves nothing.
- Leaving before saving discards the unfinished scan and its images.
- Account deletion (`users:deleteSelfAccount`) removes all scans and image blobs.
- Images are not used for model training without separate, explicit consent (not collected in 5A).
- Known gap: an upload whose attach call never happens (e.g. the app is killed mid-save) remains an
  unreferenced blob; a sweeper is proposed for 5B.

## Height & weight
Asked once in the scanner only if missing; editable in Settings › Profile › Body details. A new
weight is appended to the weight history (`measurements`, source manual); every scan keeps its own
snapshot, so later edits never rewrite earlier scans.

## Dev builds
`SOMBREY_CONVEX_URL` (set in `apps/ios/Secrets.xcconfig` → Info.plist `SombreyConvexDeploymentURL`)
points a build at a non-production Convex deployment; unset/empty/invalid = production. The Codemagic
workflow `sombrey-body-scan-5a-dev` (manual start) builds the same app against the development
deployment, verifies the compiled Info.plist, and uploads to TestFlight for internal testing. Such a
build shows "· DEV <deployment>" beside its version in Settings › About Sombrey.
