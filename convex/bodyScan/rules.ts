// Sombrey Body Scan — capture protocol rules (Phase 5A).
//
// A body scan is a private, longitudinal record: three standardised views
// (front, side, back) captured by the guided scanner, each stored as its own
// image row (convex/bodyScans.ts). Nothing here measures anything: 5A stores
// what was captured, how it was captured, and the user's own recorded
// context at that moment — so later phases (pose/shape, anthropometry,
// composition) can process the same images and every result stays traceable.
//
// Pure — no I/O — so the rules are tested directly (tests/bodyScan).

/** The capture protocol these rules describe. Stored on every scan so a
 * future model knows exactly how its images were taken. */
export const PROTOCOL_VERSION = "5a.2";
/** The consent text version the user accepted (shown in the app). */
export const CONSENT_VERSION = "2026-09-28";

export const VIEWS = ["front", "side", "back"] as const;
export type View = (typeof VIEWS)[number];
export const isView = (v: unknown): v is View => typeof v === "string" && (VIEWS as readonly string[]).includes(v);

/** Quality issues the scanner can report per view (a closed set: free text
 * never reaches storage). */
export const QUALITY_ISSUES = [
  "no_person", "multiple_people", "head_out_of_frame", "feet_out_of_frame", "too_close", "too_far",
  "off_centre", "tilted", "wrong_orientation", "arms_position", "low_light", "motion", "low_confidence",
] as const;
export type QualityIssue = (typeof QUALITY_ISSUES)[number];

/** Capture conditions recorded with each view (5a.2+). */
export type CaptureConditions = { pitchDegrees: number; rollDegrees: number; bodySpan: number; brightness?: number; protocolConfig: string };

export function validateConditions(c: CaptureConditions | undefined): string | null {
  if (c === undefined) return null;
  const f = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!f(c.pitchDegrees) || Math.abs(c.pitchDegrees) > 90 || !f(c.rollDegrees) || Math.abs(c.rollDegrees) > 90) return "Invalid phone tilt";
  if (!f(c.bodySpan) || c.bodySpan < 0 || c.bodySpan > 1.5) return "Invalid body span";
  if (c.brightness !== undefined && (!f(c.brightness) || c.brightness < 0 || c.brightness > 1)) return "Invalid brightness";
  if (typeof c.protocolConfig !== "string" || !/^[A-Za-z0-9.:,_=-]{1,80}$/.test(c.protocolConfig)) return "Invalid protocol configuration";
  return null;
}

/** Stored images: JPEG, portrait, long side 1024–4096 px, ≤ 8 MB. The app
 * stores 2048 px (see BodyScanImage in the app for why). */
export const IMAGE_LIMITS = { minLongSide: 1024, maxLongSide: 4096, maxBytes: 8_000_000, contentType: "image/jpeg" } as const;
/** An upload must be attached within this time of being uploaded. */
export const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

export type ViewMeta = {
  view: string;
  width: number;
  height: number;
  qualityScore: number;
  issues: string[];
  capturedAt: number;
};

/** Validates what the app says about one captured view. The blob itself is
 * checked separately against storage metadata (content type, size, age). */
export function validateViewMeta(m: ViewMeta, now: number): string | null {
  if (!isView(m.view)) return "Unknown view";
  for (const n of [m.width, m.height]) if (!Number.isInteger(n) || n <= 0) return "Invalid image size";
  const long = Math.max(m.width, m.height);
  if (long < IMAGE_LIMITS.minLongSide || long > IMAGE_LIMITS.maxLongSide) return "Image resolution out of range";
  if (m.height <= m.width) return "Scan images must be portrait";
  if (!Number.isFinite(m.qualityScore) || m.qualityScore < 0 || m.qualityScore > 1) return "Invalid quality score";
  if (!Array.isArray(m.issues) || m.issues.length > QUALITY_ISSUES.length) return "Invalid quality issues";
  for (const i of m.issues) if (!(QUALITY_ISSUES as readonly string[]).includes(i)) return "Invalid quality issue";
  if (!Number.isFinite(m.capturedAt) || m.capturedAt > now + 60_000 || m.capturedAt < now - UPLOAD_MAX_AGE_MS) return "Invalid capture time";
  return null;
}

/** The uploaded blob, as storage describes it. */
export function validateBlob(meta: { contentType?: string; size: number; _creationTime: number } | null, now: number): string | null {
  if (!meta) return "Image not found";
  if (meta.contentType !== IMAGE_LIMITS.contentType) return "Scan images must be JPEG";
  if (meta.size <= 0 || meta.size > IMAGE_LIMITS.maxBytes) return "Image too large";
  if (now - meta._creationTime > UPLOAD_MAX_AGE_MS) return "Upload expired — capture this view again";
  return null;
}

/** A scan can be completed once every protocol view is present. */
export function missingViews(present: Iterable<string>): View[] {
  const have = new Set(present);
  return VIEWS.filter((v) => !have.has(v));
}

/** Client-made scan id (idempotency key): a UUID. */
export const validScanId = (id: unknown): id is string => typeof id === "string" && /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(id);

// ─── Capture conditions ──────────────────────────────────────────────────────

export type CaptureInfo = {
  deviceModel: string;   // e.g. "iPhone16,1"
  osVersion: string;     // e.g. "iOS 18.1"
  appVersion: string;    // e.g. "1.0 (48)"
  camera: "front";       // 5A protocol: the front camera, the user sees themselves
  imageMaxPixel: number; // stored long side
  jpegQuality: number;
};

/** Only the fields the protocol needs, bounded — nothing else is stored. */
export function sanitizeCapture(c: unknown): CaptureInfo | null {
  const x = c as Partial<CaptureInfo> | null;
  const str = (s: unknown, max: number) => (typeof s === "string" && s.trim() && s.length <= max ? s.trim() : null);
  const deviceModel = str(x?.deviceModel, 40), osVersion = str(x?.osVersion, 40), appVersion = str(x?.appVersion, 40);
  if (!deviceModel || !osVersion || !appVersion || x?.camera !== "front") return null;
  if (!Number.isInteger(x.imageMaxPixel) || x.imageMaxPixel! < IMAGE_LIMITS.minLongSide || x.imageMaxPixel! > IMAGE_LIMITS.maxLongSide) return null;
  if (typeof x.jpegQuality !== "number" || x.jpegQuality < 0.5 || x.jpegQuality > 1) return null;
  return { deviceModel, osVersion, appVersion, camera: "front", imageMaxPixel: x.imageMaxPixel!, jpegQuality: x.jpegQuality };
}

// ─── The user's context at scan time ─────────────────────────────────────────

export type Sex = "male" | "female" | "other";

export type ScanContext = {
  heightCm?: number;
  weightKg?: number;
  /** Where the weight came from and when it was recorded. */
  weightSource?: string;
  weightRecordedAt?: number;
  sex?: Sex;
  ageYears?: number;
};

/** Whole years between an ISO birth date ("1995-04-12") and `now`. */
export function ageFromDateOfBirth(dob: string | undefined, now: number): number | undefined {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return undefined;
  const [y, m, d] = dob.split("-").map(Number);
  const today = new Date(now);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age >= 13 && age <= 120 ? age : undefined;
}

export const plausibleHeightCm = (h: unknown): h is number => typeof h === "number" && Number.isFinite(h) && h >= 100 && h <= 250;
export const plausibleWeightKg = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w >= 20 && w <= 400;

/** A snapshot of what Sombrey knew about the user when the scan was taken —
 * from their own records only (profile, weight log, onboarding). Stored on
 * the scan, so editing height or weight later never rewrites an old scan's
 * context. Values that aren't plausible are left out, never corrected. */
export function contextSnapshot(input: {
  heightCm?: number;
  sex?: string;
  dateOfBirth?: string;
  onboardingAge?: number;
  latestWeight?: { kg: number; source?: string; recordedAt: number };
  profileWeightKg?: number;
}, now: number): ScanContext {
  const out: ScanContext = {};
  if (plausibleHeightCm(input.heightCm)) out.heightCm = Math.round(input.heightCm * 10) / 10;
  if (input.latestWeight && plausibleWeightKg(input.latestWeight.kg)) {
    out.weightKg = Math.round(input.latestWeight.kg * 10) / 10;
    out.weightSource = input.latestWeight.source ?? "manual";
    out.weightRecordedAt = input.latestWeight.recordedAt;
  } else if (plausibleWeightKg(input.profileWeightKg)) {
    out.weightKg = Math.round(input.profileWeightKg * 10) / 10;
    out.weightSource = "profile";
  }
  if (input.sex === "male" || input.sex === "female" || input.sex === "other") out.sex = input.sex;
  const age = ageFromDateOfBirth(input.dateOfBirth, now);
  if (age !== undefined) out.ageYears = age;
  else if (typeof input.onboardingAge === "number" && input.onboardingAge >= 13 && input.onboardingAge <= 120) out.ageYears = Math.round(input.onboardingAge);
  return out;
}

/** What the scanner still needs from the user before a scan (asked once,
 * then editable in Settings). Circumferences are never asked for. */
export function missingProfile(ctx: ScanContext): Array<"height" | "weight" | "sex" | "age"> {
  const out: Array<"height" | "weight" | "sex" | "age"> = [];
  if (ctx.heightCm === undefined) out.push("height");
  if (ctx.weightKg === undefined) out.push("weight");
  if (ctx.sex === undefined) out.push("sex");
  if (ctx.ageYears === undefined) out.push("age");
  return out;
}
