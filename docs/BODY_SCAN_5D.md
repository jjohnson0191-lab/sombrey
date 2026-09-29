# Sombrey Body Scan — Phase 5D (validation & calibration)

5D measures how accurate and repeatable the 5C measurement engine (method `m1`) really is, before
any metric measurement is treated as trustworthy. It adds **tooling and methodology**, not accuracy:
no threshold, prior or display rule was changed, because no validation data exists yet. Every
change to the method will come as a new method version (`m2`), justified by the data below.

**Status at the end of 5D: no physical validation data has been collected.** No accuracy,
repeatability or calibration figure exists for Sombrey's scanner; none may be claimed.

## 1. Architecture (development only)

```
Hand measurements ─→ bodyScanValidation:recordTruth ─→ bodyScanValidationTruth   (isolated)
Saved scan ────────→ bodyScanValidation:tagScan     ─→ bodyScanValidationTags    (isolated)
                                  │
bodyScanMeasurements (5C, read-only) ─┴→ bodyScanValidation:report → convex/bodyScan/validation.ts
                                                                     (pure, analysis v1) → report + CSV
```

- **Gate:** every validation function refuses unless the deployment sets
  `SOMBREY_BODYSCAN_VALIDATION=enabled`. It is set on the development deployment
  (adamant-chicken-676) only; production never sets it. The app shows the tool only on builds
  pointing at a non-production backend (`BodyScanDevTools.enabled`): Scan history › "DEV · Validation".
- **Isolation:** ground truth and scan labels live in their own tables. They are never read by the
  profile, weight history, `measurements`, Progress, coach or AI context, and the analysis only
  reads scanner results (never writes them). Verified by the dev security suite.
- **Ownership:** the operator is the signed-in account; every record is theirs alone
  (another account sees nothing and can't delete or tag). Scan deletion removes its label; account
  deletion removes all validation records.
- **Privacy:** subjects are pseudonymous codes (`S01`) — names are refused. Measure other people only
  with their informed consent; their scans are stored on the operator's account.

## 2. Ground-truth data model

`bodyScanValidationTruth`: subject code · measured at · measurement · value (canonical cm / kg) ·
unit · protocol · operator (self | assistant | clinician) · repeat (1–5).
Measurements: height, weight, chest, waist, hips, upper arm, thigh, calf, shoulder width.
Units accepted: cm / mm / in, kg / lb — converted on the server; implausible values and
protocol/measurement mismatches are refused, never stored.

`bodyScanValidationTags`: scan → subject, session (groups one set-up on one day), repeat label,
tape-measured distance (camera → toes), phone height, lighting, clothing, pose.

## 3. Measurement protocol (ground truth)

Take every tape measurement **twice** (repeat 1, 2); take a third if the two differ by > 1 cm.
Same operator, same tape, same session, before scanning. Record the operator.

| Measurement | Protocol id | How |
|---|---|---|
| Height | `stadiometer_barefoot` | Barefoot, heels together against the board, heels/buttocks/upper back touching, head in the Frankfort plane, deep breath in, headboard down firmly on the crown. |
| Height (no stadiometer) | `wall_mark_barefoot` | Same posture against a wall; a rigid set-square flat on the crown marks the wall; tape from floor to mark. |
| Weight | `scale_calibrated_morning` | Calibrated scale on a hard floor; morning, after voiding, before eating; minimal clothing. |
| Chest | `tape_isak_style` | Tape horizontal at mid-sternum (nipple line for men, under the arms above the bust for women), arms relaxed, end of a normal exhale. |
| Waist | `tape_isak_style` | Narrowest point between the lowest rib and the iliac crest (if none, midway), end of normal exhale, relaxed abdomen. |
| Hips | `tape_isak_style` | Greatest posterior protrusion of the buttocks, feet together, tape horizontal. |
| Upper arm | `tape_isak_style` | Relaxed arm hanging, midway acromion–olecranon. |
| Thigh | `tape_isak_style` | Midway between the inguinal crease and the top of the patella, weight evenly on both feet. |
| Calf | `tape_isak_style` | Maximal girth, standing, weight even. |
| Shoulder width | `tape_shoulder_silhouette` | Across the widest point of the deltoids (what the silhouette sees). `caliper_biacromial` (bone width) is recorded but is a different quantity. |

Tape: non-stretch, snug on the skin without compressing it, horizontal (check in a mirror or with
the assistant). Clothing during tape: the scan clothing.

## 4. Capture protocol variables (scan labels)

- **Repeats:** **A** normal capture; **B** immediate repeat, nothing changed; **C** after picking the
  phone up and putting it back (repositioning). A↔B isolates capture variation; A/B↔C adds
  set-up variation. More repeats (D, E) as time allows.
- **Distance** (camera → toes, tape): 1.0, 1.3, 1.5, 1.7, 2.0 m (2.5 m for LiDAR). None of these is
  assumed valid — at 1.0 m most adults won't fit the frame; the gates will say so, and that is data.
- **Phone height:** waist (protocol) / chest.
- **Lighting:** bright even / moderate / dim (never unsafe).
- **Clothing:** minimal (male: shirtless + fitted shorts; female: sports bra + fitted shorts) —
  the intended protocol; fitted athletic wear only if the product will support it.
- **Pose:** ideal / natural small deviations / arms slightly close / feet moved / small torso rotation.
  The gates are NOT loosened for these tests; if a pose is refused by the gates, record that.

## 5. First physical session (your iPhone) — run sheet

Prep: tape measure, stadiometer or wall + set-square, calibrated scale, masking tape marks on the
floor at each distance, a helper if possible. In the app: Scan history › DEV · Validation, subject
`S01`, session e.g. `2026-10-01-a`.

1. Record height ×2, weight ×1, chest/waist/hips/upper arm/thigh/calf ×2, shoulder width (silhouette) ×2.
2. Front camera (TrueDepth), waist height, bright light, minimal clothing, ideal pose:
   scans at 1.3 m **A, B, C**; then 1.0, 1.5, 1.7, 2.0 m (A each; A+B at 1.5 m).
3. Back camera (LiDAR mode), same conditions: 1.5 m A, B, C; 2.0 m A, B; 2.5 m A.
4. At the best distance from 2–3: chest height (A); moderate light (A); dim light (A); the four
   pose variants (A each).
5. Label every scan right after saving (subject, session, repeat, distance, conditions).
6. Open "Show pilot report" and export the CSV. Each row already carries device model, depth source,
   distance, phone height, lighting, clothing, scanner value, ±range, status, confidence and truth.

~25 scans; ~90 minutes. This is a single-subject engineering pilot: it can show gross errors,
failure modes, distance limits and within-person repeatability — not accuracy in general.

## 6. Error metrics (analysis v1)

Per scan × measurement: absolute error |s − t|, signed error s − t (bias), absolute % error.
Truth = mean of that subject's repeats within 36 h of the scan. Aggregates per measurement
(never pooled across measurements): n, MAE, median AE, RMSE, mean bias, SD of error,
95 % limits of agreement (bias ± 1.96 SD), MAPE — for all values and separately for
"available" values (what users would see). Minimums: accuracy n ≥ 3; calibration n ≥ 5; range
multiplier n ≥ 10; repeatability ≥ 2 degrees of freedom; ICC ≥ 5 subjects. Below the minimum the
statistic is **null**, shown as "n/a" — never computed from too little data. Everything with
n < 30 is labelled **pilot**.

## 7. Repeatability and minimum detectable change

Repeat groups = same subject, session and set-up (distance, phone height, lighting, clothing, pose,
depth source). Within-subject SD **SEM = √(Σ within-group SS / Σ (k−1))** (pooled; = technical error
of measurement), **CV% = SEM / mean**, **ICC(1,1)** one-way random (≥ 5 subjects),
**MDC95 = 1.96 × √2 × SEM**: the smallest scan-to-scan difference distinguishable from capture noise
with 95 % confidence. Also reported: mean |A−B| (immediate) and mean |A/B−C| (repositioned), and the
tape's own repeatability (operator SD) — the floor any accuracy figure inherits.

Change detection (for 5F) already uses it: `compareMeasurements` only flags a change when it exceeds
BOTH the combined ±95 % ranges AND the measurement's MDC95 (once measured), and refuses scans that
don't align (`align.1`: depth source, protocol, distance, tilt, pose differences named). The MDC must
come from ≥ 10 subjects × ≥ 2 repeats before it can drive anything user-facing.

## 8. Calibration of the stated ranges

For each measurement: **coverage** = share of results with |error| ≤ stated ±95 % range, with a
binomial interval. Verdict: `ranges_too_narrow` (upper bound < 95 %), `ranges_too_wide` (lower
bound > 99 %), else `consistent_with_95` (which, at small n, mostly means "not enough data").
`suggestedRangeMultiplier` = 95th percentile of |error| / stated range (n ≥ 10): the factor the
ranges would need. It is **evidence for method m2, never applied automatically**; the displayed
range is never narrowed to look better.

## 9. Threshold calibration

`operatingCurve`: for candidate "available" thresholds (stated range ÷ value: 2 %, 2.5 %, 3 %, 4 %,
5 %, 7 %, 10 %, 15 %) — how many results would pass, their MAE and their coverage. A threshold is
chosen where passing results are accurate (MAE within the target) and calibrated — not where the
most results pass. Factor breakdowns (depth source, distance, phone height, lighting, clothing,
pose, device model) show where availability and error change.

## 10. Device and distance matrices

| Category | Example | Source | What 5D must establish |
|---|---|---|---|
| A | Face ID iPhone (no LiDAR) | TrueDepth (front) | Does TrueDepth pass its depth checks at 1.3–2.0 m at all? Error vs distance. |
| B | iPhone Pro | TrueDepth (front) + LiDAR (rear) | Same subject, both sources: availability, bias, repeatability. |
| C | iPhone without depth | none | Proportions only; confirm no metric value is ever produced. |

Distances 1.0–2.0 m (2.5 m LiDAR) per category, repeats A/B at each distance used for decisions.

## 11. Known limitations (unchanged by 5D)

All 5C limitations stand (docs/BODY_SCAN_5C.md §14). In particular TrueDepth is designed for < 1 m;
the mid-plane offset dominates height uncertainty; the ellipse cross-section is an approximation;
upper-arm circumference has no depth; weight/BMI/body fat are not produced.

## 12. Production gate — what must exist before any metric measurement ships

1. **Accuracy:** per measurement, per depth source: ≥ 30 subjects spanning sex, age, height, body
   size and composition, skin tone; MAE, bias and limits of agreement against the protocol above,
   with tape/stadiometer operator error measured.
2. **Repeatability:** ≥ 10 subjects × ≥ 3 repeats (A/B/C) → SEM, ICC, MDC95 per measurement.
3. **Calibration:** coverage of the stated ranges within 90–98 % on the validation set (new method
   version with recalibrated priors and thresholds; the old version kept alongside).
4. **Devices:** categories A and B each characterised; unsupported cases fall back to proportions.
5. **Capture distance:** the production range set from the distance analysis (where depth passes,
   the body fits, error and repeatability are acceptable) — then a new protocol version.
6. **Protocol stability:** clothing, pose and phone-height effects measured; the protocol frozen.
7. **Per-measurement sign-off:** only measurements meeting pre-registered targets are displayed;
   the rest stay "available as proportion" or hidden. Weight, BMI and body fat require their own
   reference studies (e.g. DXA) and are out of scope.
