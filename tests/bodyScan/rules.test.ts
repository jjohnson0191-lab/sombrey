// Sombrey Body Scan, Phase 5A — capture protocol rules (convex/bodyScan/rules.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_VERSION, IMAGE_LIMITS, PROTOCOL_VERSION, QUALITY_ISSUES, UPLOAD_MAX_AGE_MS, VIEWS,
  ageFromDateOfBirth, contextSnapshot, isView, missingProfile, missingViews, sanitizeCapture,
  validScanId, validateBlob, validateViewMeta,
} from "../../convex/bodyScan/rules.ts";

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const goodView = { view: "front", width: 1536, height: 2048, qualityScore: 0.92, issues: [], capturedAt: NOW - 5_000 };
const goodBlob = { contentType: "image/jpeg", size: 650_000, _creationTime: NOW - 10_000 };

test("the protocol is front → side → back, versioned", () => {
  assert.deepEqual([...VIEWS], ["front", "side", "back"]);
  assert.ok(PROTOCOL_VERSION && CONSENT_VERSION);
  assert.ok(isView("side") && !isView("top") && !isView(undefined));
});

test("a scan can only be saved with every view; retakes don't create extra views", () => {
  assert.deepEqual(missingViews([]), ["front", "side", "back"]);
  assert.deepEqual(missingViews(["front", "side"]), ["back"]);
  assert.deepEqual(missingViews(["front", "side", "back"]), []);
  assert.deepEqual(missingViews(["front", "front", "side", "back"]), []);
});

test("view metadata: portrait, sane resolution, bounded quality info, recent capture", () => {
  assert.equal(validateViewMeta(goodView, NOW), null);
  assert.ok(validateViewMeta({ ...goodView, view: "top" }, NOW));
  assert.ok(validateViewMeta({ ...goodView, width: 2048, height: 1536 }, NOW), "landscape");
  assert.ok(validateViewMeta({ ...goodView, width: 400, height: 600 }, NOW), "too small");
  assert.ok(validateViewMeta({ ...goodView, width: 3000, height: 5000 }, NOW), "too large");
  assert.ok(validateViewMeta({ ...goodView, width: 1536.5 }, NOW), "fractional");
  assert.ok(validateViewMeta({ ...goodView, qualityScore: 1.4 }, NOW));
  assert.ok(validateViewMeta({ ...goodView, qualityScore: NaN }, NOW));
  assert.ok(validateViewMeta({ ...goodView, issues: ["make me thinner"] }, NOW), "free text never stored");
  assert.equal(validateViewMeta({ ...goodView, issues: ["low_light", "motion"] }, NOW), null);
  assert.ok(validateViewMeta({ ...goodView, capturedAt: NOW + 5 * 60_000 }, NOW), "future");
  assert.ok(validateViewMeta({ ...goodView, capturedAt: NOW - UPLOAD_MAX_AGE_MS - 1 }, NOW), "stale");
});

test("the uploaded blob must be a recent JPEG within the size limit", () => {
  assert.equal(validateBlob(goodBlob, NOW), null);
  assert.ok(validateBlob(null, NOW));
  assert.ok(validateBlob({ ...goodBlob, contentType: "image/png" }, NOW));
  assert.ok(validateBlob({ ...goodBlob, contentType: undefined }, NOW));
  assert.ok(validateBlob({ ...goodBlob, size: IMAGE_LIMITS.maxBytes + 1 }, NOW));
  assert.ok(validateBlob({ ...goodBlob, size: 0 }, NOW));
  assert.ok(validateBlob({ ...goodBlob, _creationTime: NOW - UPLOAD_MAX_AGE_MS - 1 }, NOW), "an old upload can't be attached later");
});

test("scan ids are UUIDs (the idempotency key)", () => {
  assert.ok(validScanId("3F2504E0-4F89-11D3-9A0C-0305E82C3301"));
  assert.ok(!validScanId("scan-1"));
  assert.ok(!validScanId("3F2504E0-4F89-11D3-9A0C-0305E82C330"));
  assert.ok(!validScanId(undefined));
});

test("capture metadata: only the protocol's fields, bounded; camera ↔ depth source consistent", () => {
  const c = { deviceModel: "iPhone16,1", osVersion: "iOS 18.1", appVersion: "1.0 (48)", camera: "front", imageMaxPixel: 2048, jpegQuality: 0.9 };
  assert.deepEqual(sanitizeCapture({ ...c, gps: "6.9,79.8", serial: "ABC" }), c);
  assert.deepEqual(sanitizeCapture({ ...c, depth: "truedepth" }), { ...c, depth: "truedepth" });
  assert.deepEqual(sanitizeCapture({ ...c, depth: "none" }), { ...c, depth: "none" }, "a device without depth still scans");
  assert.deepEqual(sanitizeCapture({ ...c, camera: "rear", depth: "lidar" }), { ...c, camera: "rear", depth: "lidar" }, "5C LiDAR mode");
  assert.equal(sanitizeCapture({ ...c, camera: "rear" }), null, "the rear mode exists only for LiDAR");
  assert.equal(sanitizeCapture({ ...c, camera: "rear", depth: "truedepth" }), null);
  assert.equal(sanitizeCapture({ ...c, depth: "lidar" }), null, "the front camera has no LiDAR");
  assert.equal(sanitizeCapture({ ...c, depth: "sonar" }), null);
  assert.equal(sanitizeCapture({ ...c, camera: "wide" }), null);
  assert.equal(sanitizeCapture({ ...c, deviceModel: "x".repeat(200) }), null);
  assert.equal(sanitizeCapture({ ...c, imageMaxPixel: 512 }), null);
  assert.equal(sanitizeCapture({ ...c, jpegQuality: 0.2 }), null);
  assert.equal(sanitizeCapture(null), null);
});

test("age from birth date: whole years, birthday-aware, implausible ages dropped", () => {
  assert.equal(ageFromDateOfBirth("1995-04-12", NOW), 31);
  assert.equal(ageFromDateOfBirth("1995-09-29", NOW), 30);
  assert.equal(ageFromDateOfBirth("1995-09-28", NOW), 31);
  assert.equal(ageFromDateOfBirth("2020-01-01", NOW), undefined);
  assert.equal(ageFromDateOfBirth("12/04/1995", NOW), undefined);
  assert.equal(ageFromDateOfBirth(undefined, NOW), undefined);
});

test("context snapshot: the user's own records, latest logged weight first, implausible values left out", () => {
  const ctx = contextSnapshot({
    heightCm: 178.24, sex: "male", dateOfBirth: "1995-04-12",
    latestWeight: { kg: 82.36, source: "manual", recordedAt: NOW - 86_400_000 }, profileWeightKg: 90,
  }, NOW);
  assert.deepEqual(ctx, { heightCm: 178.2, weightKg: 82.4, weightSource: "manual", weightRecordedAt: NOW - 86_400_000, sex: "male", ageYears: 31 });
  // No weight log: the profile weight, labelled as such.
  assert.deepEqual(contextSnapshot({ profileWeightKg: 70 }, NOW), { weightKg: 70, weightSource: "profile" });
  // Nothing is "corrected" or invented.
  assert.deepEqual(contextSnapshot({ heightCm: 17, profileWeightKg: 900, sex: "unknown" }, NOW), {});
  // Onboarding age only when there's no birth date.
  assert.equal(contextSnapshot({ onboardingAge: 29 }, NOW).ageYears, 29);
  assert.equal(contextSnapshot({ onboardingAge: 29, dateOfBirth: "1995-04-12" }, NOW).ageYears, 31);
});

test("historical integrity: a later profile edit produces a new snapshot and never changes an earlier one", () => {
  const baseline = contextSnapshot({ heightCm: 178, latestWeight: { kg: 85, recordedAt: NOW - 1 } }, NOW);
  const frozen = structuredClone(baseline);
  const later = contextSnapshot({ heightCm: 179, latestWeight: { kg: 81, recordedAt: NOW + 30 * 86_400_000 } }, NOW + 30 * 86_400_000);
  assert.deepEqual(baseline, frozen);
  assert.notDeepEqual(later, baseline);
  assert.equal(baseline.weightKg, 85);
});

test("the scanner asks only for what's missing — never circumferences", () => {
  assert.deepEqual(missingProfile({}), ["height", "weight", "sex", "age"]);
  assert.deepEqual(missingProfile({ heightCm: 170, weightKg: 70, sex: "female", ageYears: 30 }), []);
  const asked = new Set(missingProfile({}));
  for (const c of ["waist", "chest", "hips", "arms", "thighs", "calves", "neck"]) assert.ok(!asked.has(c as never));
});

test("quality issues are a closed, known set", () => {
  assert.ok(QUALITY_ISSUES.includes("feet_out_of_frame") && QUALITY_ISSUES.includes("multiple_people"));
  assert.equal(new Set(QUALITY_ISSUES).size, QUALITY_ISSUES.length);
});
