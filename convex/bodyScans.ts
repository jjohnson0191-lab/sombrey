// Sombrey Body Scan — Phase 5A: private, longitudinal capture storage.
//
//   profile        → what the scanner knows (height, weight, sex, age) + consent
//   acceptConsent  → the user accepted the Body Scan explanation (versioned)
//   updateProfile  → height / weight / sex / birth date, editable any time
//   start          → a new scan (idempotent on the app's scan id)
//   generateUploadUrl → one upload per captured view
//   attachView     → the uploaded view becomes part of the scan (retake replaces)
//   complete       → all protocol views present
//   list           → the user's scans, newest first — never a storage id or URL
//   discard/remove → delete an unfinished / any scan, blobs included
//   attachFeatures → 5B/5C on-device CV features (numbers only); 5C derives
//                    and stores the scan's measurements from them
//   measurements   → the scan's derived measurements, with provenance
//   composition    → 5E composition layer (body-fat estimate kept internal; BMI
//                    from the user's recorded values), with its input snapshot
//   compare        → 5E scan A → scan B: no meaningful / possible / meaningful change
//   recordUpload   → (internal) POST /body-scan-upload binds each upload to its
//                    owner; cleanupOrphanUploads sweeps uploads never attached
//
// SECURITY: every function resolves the user from the auth token (no client
// user ids); every scan/image access checks ownership server-side; storage
// ids never leave the server and no storage URL is ever minted — images are
// served only by the authenticated GET /body-scan-image endpoint
// (convex/http.ts), which checks ownership on every request.
//
// The scan stores the user's own recorded context (a snapshot) — never an
// estimate. Phase 5C measurements are derived from stored numbers by a
// versioned method (convex/bodyScan/measurements.ts), kept per scan with
// their uncertainty and status, and never written into the profile or the
// weight/measurement history.

import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  CAPTURE_CONFIG, CONSENT_VERSION, PROTOCOL_VERSION, VIEWS, contextSnapshot, missingProfile, missingViews,
  plausibleHeightCm, plausibleWeightKg, sanitizeCapture, validScanId, validateBlob, validateConditions, validateViewMeta,
} from "./bodyScan/rules";
import { isAbandoned, validateFeatureSet, type FeatureSet } from "./bodyScan/features";
import { MEASUREMENT_METHOD_VERSION, compareMeasurements, computeMeasurements } from "./bodyScan/measurements";
import { COMPOSITION_VERSION, computeComposition } from "./bodyScan/composition";
import { alignScans, type AlignmentInput } from "./bodyScan/features";
import { VIEW, featureMultiView, featureProcessing, featureQuality, featureScale, featureView } from "./bodyScan/validators";
import { latestMeasurements, ownScan, requireUser } from "./bodyScan/access";

const SEX = v.union(v.literal("male"), v.literal("female"), v.literal("other"));

/** What Sombrey knows about the user right now, from their own records. */
async function currentContext(ctx: QueryCtx | MutationCtx, user: Doc<"users">, now: number) {
  const onboarding = await ctx.db.query("premiumOnboarding").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
  let latestWeight: { kg: number; source?: string; recordedAt: number } | undefined;
  for await (const m of ctx.db.query("measurements").withIndex("by_user_and_date", (q) => q.eq("userId", user._id)).order("desc")) {
    if (typeof m.weight === "number") { latestWeight = { kg: m.weight, source: m.source ?? "manual", recordedAt: m.date }; break; }
  }
  return contextSnapshot({
    heightCm: user.heightCm ?? onboarding?.heightCm,
    sex: user.sex ?? onboarding?.sex,
    dateOfBirth: user.dateOfBirth,
    onboardingAge: onboarding?.age,
    latestWeight,
    profileWeightKg: user.weightKg ?? onboarding?.currentWeightKg,
  }, now);
}

async function deleteImageRow(ctx: MutationCtx, row: Doc<"bodyScanImages">) {
  await ctx.storage.delete(row.storageId);
  await ctx.db.delete(row._id);
}

async function imagesOf(ctx: QueryCtx | MutationCtx, scanDocId: Id<"bodyScans">) {
  return await ctx.db.query("bodyScanImages").withIndex("by_scan_and_view", (q) => q.eq("scanDocId", scanDocId)).collect();
}

async function featuresOf(ctx: QueryCtx | MutationCtx, scanDocId: Id<"bodyScans">) {
  return await ctx.db.query("bodyScanFeatures").withIndex("by_scan_and_version", (q) => q.eq("scanDocId", scanDocId)).collect();
}

async function measurementsOf(ctx: QueryCtx | MutationCtx, scanDocId: Id<"bodyScans">) {
  return await ctx.db.query("bodyScanMeasurements").withIndex("by_scan_and_versions", (q) => q.eq("scanDocId", scanDocId)).collect();
}

/** A scan and everything attached to it: images (and their blobs), features, measurements. */
async function deleteScanDeep(ctx: MutationCtx, scan: Doc<"bodyScans">) {
  for (const i of await imagesOf(ctx, scan._id)) await deleteImageRow(ctx, i);
  for (const f of await featuresOf(ctx, scan._id)) await ctx.db.delete(f._id);
  for (const m of await measurementsOf(ctx, scan._id)) await ctx.db.delete(m._id);
  for (const c of await ctx.db.query("bodyScanCompositions").withIndex("by_scan_and_versions", (q) => q.eq("scanDocId", scan._id)).collect()) await ctx.db.delete(c._id);
  // 5D validation tag (dev only): the scan's conditions label goes with it.
  for (const t of await ctx.db.query("bodyScanValidationTags").withIndex("by_scan", (q) => q.eq("scanDocId", scan._id)).collect()) await ctx.db.delete(t._id);
  await ctx.db.delete(scan._id);
}

/** Derives and stores, for one stored feature set, the measurements (current
 * method) and the composition layer (current version) — each once per version,
 * never overwriting an earlier version. Uses the scan's own context snapshot,
 * so a later profile edit never changes either. Returns whether anything new
 * was stored. */
async function storeMeasurements(ctx: MutationCtx, scan: Doc<"bodyScans">, features: Doc<"bodyScanFeatures">): Promise<boolean> {
  let added = false;
  let row = await ctx.db.query("bodyScanMeasurements")
    .withIndex("by_scan_and_versions", (q) => q.eq("scanDocId", scan._id).eq("cvVersion", features.cvVersion).eq("methodVersion", MEASUREMENT_METHOD_VERSION))
    .first();
  if (!row) {
    const result = computeMeasurements(features as unknown as FeatureSet, scan.context.heightCm ?? null);
    const id = await ctx.db.insert("bodyScanMeasurements", {
      userId: scan.userId,
      scanDocId: scan._id,
      cvVersion: result.cvVersion,
      methodVersion: result.methodVersion,
      computedAt: Date.now(),
      scale: result.scale,
      measurements: result.measurements,
      ...(result.profileComparison ? { profileComparison: result.profileComparison } : {}),
      validated: false,
    });
    row = (await ctx.db.get(id))!;
    added = true;
  }
  const hasComposition = await ctx.db.query("bodyScanCompositions")
    .withIndex("by_scan_and_versions", (q) => q.eq("scanDocId", scan._id).eq("measurementMethodVersion", row!.methodVersion).eq("compositionVersion", COMPOSITION_VERSION))
    .first();
  if (!hasComposition) {
    const c = scan.context;
    const composition = computeComposition(row, {
      scanAt: scan.createdAt,
      ...(c.sex ? { sex: c.sex } : {}),
      ...(c.ageYears !== undefined ? { ageYears: c.ageYears } : {}),
      ...(c.heightCm !== undefined ? { heightCm: c.heightCm } : {}),
      ...(c.weightKg !== undefined ? { weightKg: c.weightKg } : {}),
      ...(c.weightSource ? { weightSource: c.weightSource } : {}),
      ...(c.weightRecordedAt !== undefined ? { weightRecordedAt: c.weightRecordedAt } : {}),
      depthSource: scan.capture.depth ?? "none",
      captureQuality: features.quality.overallScore,
    });
    await ctx.db.insert("bodyScanCompositions", {
      userId: scan.userId,
      scanDocId: scan._id,
      cvVersion: row.cvVersion,
      measurementMethodVersion: composition.measurementMethodVersion,
      compositionVersion: composition.compositionVersion,
      computedAt: Date.now(),
      inputs: composition.inputs,
      results: composition.results,
      validated: false,
    });
    added = true;
  }
  return added;
}

/** Validated minimum detectable change per measurement, by method version —
 * EMPTY until the 5D repeatability study produces it. Until then no change is
 * ever classified "meaningful" (see compareMeasurements). */
const VALIDATED_MDC: Record<string, Record<string, number>> = {};

// ─── Profile & consent ────────────────────────────────────────────────────────

export const profile = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const context = await currentContext(ctx, user, Date.now());
    return {
      captureConfig: CAPTURE_CONFIG,
      context,
      missing: missingProfile(context),
      consent: {
        currentVersion: CONSENT_VERSION,
        acceptedVersion: user.bodyScanConsentVersion ?? null,
        accepted: user.bodyScanConsentVersion === CONSENT_VERSION,
      },
      protocolVersion: PROTOCOL_VERSION,
    };
  },
});

export const acceptConsent = mutation({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.version !== CONSENT_VERSION) throw new ConvexError({ code: "INVALID", message: "Please review the latest Body Scan explanation" });
    await ctx.db.patch(user._id, { bodyScanConsentVersion: CONSENT_VERSION, bodyScanConsentAt: Date.now() });
  },
});

/** Height, weight, sex, birth date — asked once (only what's missing), then
 * editable any time. A weight goes into the weight history (measurements),
 * so earlier weights and earlier scans' snapshots are never rewritten. */
export const updateProfile = mutation({
  args: {
    heightCm: v.optional(v.number()),
    weightKg: v.optional(v.number()),
    sex: v.optional(SEX),
    dateOfBirth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const patch: Partial<Doc<"users">> = {};
    if (args.heightCm !== undefined) {
      if (!plausibleHeightCm(args.heightCm)) throw new ConvexError({ code: "INVALID", message: "Enter a height between 100 and 250 cm" });
      patch.heightCm = Math.round(args.heightCm * 10) / 10;
    }
    if (args.weightKg !== undefined) {
      if (!plausibleWeightKg(args.weightKg)) throw new ConvexError({ code: "INVALID", message: "Enter a weight between 20 and 400 kg" });
      const kg = Math.round(args.weightKg * 10) / 10;
      patch.weightKg = kg;
      if (user.startingWeightKg === undefined) patch.startingWeightKg = kg;
      await ctx.db.insert("measurements", { userId: user._id, date: now, weight: kg, source: "manual" });
    }
    if (args.sex !== undefined) patch.sex = args.sex;
    if (args.dateOfBirth !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateOfBirth) || Number.isNaN(Date.parse(args.dateOfBirth))) {
        throw new ConvexError({ code: "INVALID", message: "Enter a valid date of birth" });
      }
      const t = Date.parse(args.dateOfBirth);
      if (t > now || t < now - 120 * 365.25 * 86_400_000) throw new ConvexError({ code: "INVALID", message: "Enter a valid date of birth" });
      patch.dateOfBirth = args.dateOfBirth;
    }
    if (Object.keys(patch).length) await ctx.db.patch(user._id, patch);
  },
});

// ─── Capture ──────────────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (user.bodyScanConsentVersion !== CONSENT_VERSION) throw new ConvexError({ code: "CONSENT_REQUIRED", message: "Body Scan consent required" });
    return await ctx.storage.generateUploadUrl();
  },
});

/** Starts a scan — or returns the one already started with this scan id
 * (a retried request never makes a second scan). */
export const start = mutation({
  args: {
    scanId: v.string(),
    capture: v.object({
      deviceModel: v.string(), osVersion: v.string(), appVersion: v.string(),
      camera: v.union(v.literal("front"), v.literal("rear")),
      depth: v.optional(v.union(v.literal("none"), v.literal("truedepth"), v.literal("lidar"))),
      imageMaxPixel: v.number(), jpegQuality: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!validScanId(args.scanId)) throw new ConvexError({ code: "INVALID", message: "Invalid scan id" });
    const existing = await ctx.db.query("bodyScans").withIndex("by_user_and_scanId", (q) => q.eq("userId", user._id).eq("scanId", args.scanId)).unique();
    if (existing) return { scanId: existing.scanId, status: existing.status };
    if (user.bodyScanConsentVersion !== CONSENT_VERSION) throw new ConvexError({ code: "CONSENT_REQUIRED", message: "Body Scan consent required" });
    const capture = sanitizeCapture(args.capture);
    if (!capture) throw new ConvexError({ code: "INVALID", message: "Invalid capture information" });
    const now = Date.now();
    await ctx.db.insert("bodyScans", {
      userId: user._id,
      scanId: args.scanId,
      status: "capturing",
      protocolVersion: PROTOCOL_VERSION,
      consentVersion: CONSENT_VERSION,
      createdAt: now,
      capture,
      context: await currentContext(ctx, user, now),
    });
    return { scanId: args.scanId, status: "capturing" as const };
  },
});

/** A captured view joins the scan. Retaking a view replaces it (the old
 * image is deleted). Re-sending the same upload is a no-op. An upload that
 * fails validation is deleted and the refusal is RETURNED ({ ok: false }),
 * not thrown — a thrown error would roll the deletion back and leave the
 * image in storage. Authorisation failures still throw (and touch nothing). */
export const attachView = mutation({
  args: {
    scanId: v.string(),
    view: VIEW,
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    qualityScore: v.number(),
    issues: v.array(v.string()),
    capturedAt: v.number(),
    conditions: v.optional(v.object({
      pitchDegrees: v.number(),
      rollDegrees: v.number(),
      bodySpan: v.number(),
      brightness: v.optional(v.number()),
      protocolConfig: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    // An upload already attached somewhere is either this exact view (a
    // retried request: fine) or not ours to touch.
    const attached = await ctx.db.query("bodyScanImages").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).unique();
    const scan = await ownScan(ctx, user._id, args.scanId);
    if (attached) {
      if (attached.userId === user._id && attached.scanDocId === scan._id && attached.view === args.view) return { ok: true as const, view: args.view, replaced: false };
      throw new ConvexError({ code: "INVALID", message: "That image can't be used" });
    }
    // 5E: uploads through the authenticated endpoint carry an owner. Someone
    // else's in-flight upload is refused and left alone (it's theirs).
    const ledger = await ctx.db.query("bodyScanUploads").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).unique();
    if (ledger && ledger.userId !== user._id) throw new ConvexError({ code: "INVALID", message: "That image can't be used" });
    if (ledger) await ctx.db.delete(ledger._id);
    const refuse = async (error: string) => {
      // An unattached upload from this request: removed so it never lingers.
      if (await ctx.db.system.get(args.storageId)) await ctx.storage.delete(args.storageId);
      return { ok: false as const, view: args.view, error };
    };
    if (scan.status !== "capturing") return await refuse("This scan is already saved — start a new scan to capture again");
    const metaProblem = validateViewMeta({ view: args.view, width: args.width, height: args.height, qualityScore: args.qualityScore, issues: args.issues, capturedAt: args.capturedAt }, now);
    if (metaProblem) return await refuse(metaProblem);
    const conditionsProblem = validateConditions(args.conditions);
    if (conditionsProblem) return await refuse(conditionsProblem);
    const blob = await ctx.db.system.get(args.storageId);
    const blobProblem = validateBlob(blob, now);
    if (blobProblem || !blob) return await refuse(blobProblem ?? "Image not found");

    let replaced = false;
    for (const old of await ctx.db.query("bodyScanImages").withIndex("by_scan_and_view", (q) => q.eq("scanDocId", scan._id).eq("view", args.view)).collect()) {
      await deleteImageRow(ctx, old);
      replaced = true;
    }
    await ctx.db.insert("bodyScanImages", {
      userId: user._id,
      scanDocId: scan._id,
      view: args.view,
      storageId: args.storageId,
      width: args.width,
      height: args.height,
      bytes: blob.size,
      qualityScore: Math.round(args.qualityScore * 1000) / 1000,
      issues: args.issues,
      capturedAt: args.capturedAt,
      createdAt: now,
      ...(args.conditions ? { conditions: args.conditions } : {}),
    });
    return { ok: true as const, view: args.view, replaced };
  },
});

/** Saves the scan once front, side and back are all present. Idempotent. */
export const complete = mutation({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    if (scan.status === "complete") return { status: "complete" as const };
    const missing = missingViews((await imagesOf(ctx, scan._id)).map((i) => i.view));
    if (missing.length) throw new ConvexError({ code: "INCOMPLETE", message: `Missing view: ${missing.join(", ")}` });
    await ctx.db.patch(scan._id, { status: "complete", completedAt: Date.now() });
    return { status: "complete" as const };
  },
});

// ─── Reading ──────────────────────────────────────────────────────────────────

/** The user's scans, newest first: protocol, context snapshot, and per-view
 * capture details. Never a storage id or URL — the app loads each image
 * from the authenticated endpoint. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const scans = await ctx.db.query("bodyScans").withIndex("by_user_and_created", (q) => q.eq("userId", user._id)).order("desc").take(200);
    return await Promise.all(scans.map(async (s) => ({
      scanId: s.scanId,
      status: s.status,
      protocolVersion: s.protocolVersion,
      createdAt: s.createdAt,
      completedAt: s.completedAt ?? null,
      context: s.context,
      // Which CV versions have processed this scan — never the values.
      featureVersions: (await featuresOf(ctx, s._id)).map((f) => f.cvVersion),
      views: (await imagesOf(ctx, s._id))
        .sort((a, b) => VIEWS.indexOf(a.view) - VIEWS.indexOf(b.view))
        .map((i) => ({ view: i.view, width: i.width, height: i.height, qualityScore: i.qualityScore, issues: i.issues, capturedAt: i.capturedAt })),
    })));
  },
});

/** For GET /body-scan-image only: the storage id of one view of one scan,
 * if — and only if — it belongs to the authenticated caller. */
export const imageForOwner = internalQuery({
  args: { tokenIdentifier: v.string(), scanId: v.string(), view: v.string() },
  handler: async (ctx, args) => {
    if (!validScanId(args.scanId) || !(VIEWS as readonly string[]).includes(args.view)) return null;
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.tokenIdentifier)).unique();
    if (!user) return null;
    const scan = await ctx.db.query("bodyScans").withIndex("by_user_and_scanId", (q) => q.eq("userId", user._id).eq("scanId", args.scanId)).unique();
    if (!scan) return null;
    const image = await ctx.db.query("bodyScanImages").withIndex("by_scan_and_view", (q) => q.eq("scanDocId", scan._id).eq("view", args.view as "front" | "side" | "back")).first();
    if (!image || image.userId !== user._id) return null;
    return image.storageId;
  },
});

// ─── Deleting ─────────────────────────────────────────────────────────────────

/** Leaving a scan before saving it: the scan and its images are removed. */
export const discard = mutation({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!validScanId(args.scanId)) return;
    const scan = await ctx.db.query("bodyScans").withIndex("by_user_and_scanId", (q) => q.eq("userId", user._id).eq("scanId", args.scanId)).unique();
    if (!scan || scan.status !== "capturing") return;
    await deleteScanDeep(ctx, scan);
  },
});

/** Deletes a scan: every image blob, every image row, the scan. After this
 * the endpoint serves nothing for it. */
export const remove = mutation({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    await deleteScanDeep(ctx, scan);
  },
});

// ─── Phase 5B: computer-vision features ───────────────────────────────────────


/** The phone's on-device CV results for a saved scan — structured numbers
 * only (convex/bodyScan/features.ts). One row per CV version: re-sending the
 * same version is a no-op, and a newer version is stored alongside, never
 * over, an older one. */
export const attachFeatures = mutation({
  args: {
    scanId: v.string(),
    cvVersion: v.string(),
    processedAt: v.number(),
    processing: featureProcessing,
    scale: featureScale,
    views: v.array(featureView),
    multiView: featureMultiView,
    quality: featureQuality,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    if (scan.status !== "complete") throw new ConvexError({ code: "INVALID", message: "Save the scan before attaching features" });
    const { scanId: _scanId, ...set } = args;
    const problem = validateFeatureSet(set as FeatureSet, Date.now());
    if (problem) throw new ConvexError({ code: "INVALID", message: problem });
    // Every view described must be a view this scan actually has.
    const views = new Set((await imagesOf(ctx, scan._id)).map((i) => i.view));
    if (args.views.some((fv) => !views.has(fv.view))) throw new ConvexError({ code: "INVALID", message: "Features for a view the scan doesn't have" });
    // 5C evidence is only ever for a view the scan has, and a metric source
    // must be the depth source the scan was captured with.
    if ((args.scale.evidence ?? []).some((e) => !views.has(e.view))) throw new ConvexError({ code: "INVALID", message: "Scale evidence for a view the scan doesn't have" });
    if (args.scale.kind !== "none" && args.scale.kind !== scan.capture.depth) throw new ConvexError({ code: "INVALID", message: "Scale source doesn't match the scan's capture" });
    const existing = await ctx.db.query("bodyScanFeatures").withIndex("by_scan_and_version", (q) => q.eq("scanDocId", scan._id).eq("cvVersion", args.cvVersion)).first();
    if (existing) return { stored: false, cvVersion: args.cvVersion };
    const id = await ctx.db.insert("bodyScanFeatures", { userId: user._id, scanDocId: scan._id, createdAt: Date.now(), ...set });
    await storeMeasurements(ctx, scan, (await ctx.db.get(id))!);
    return { stored: true, cvVersion: args.cvVersion };
  },
});

/** The owner's stored feature sets for one scan (all CV versions). For
 * engineering verification and future comparison — the app doesn't show
 * these values to the user. */
export const features = query({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    return (await featuresOf(ctx, scan._id)).map(({ _id, _creationTime, userId: _u, scanDocId: _s, ...f }) => f);
  },
});

/** The scan's measurements from the newest CV version and method, for the
 * owner: every entry with its status, ≈95 % range, heuristic confidence,
 * method and reasons (the app shows only "available" ones, and labels them
 * as unvalidated estimates). null until features have been processed. */
export const measurements = query({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    const newest = await latestMeasurements(ctx, scan._id);
    if (!newest) return null;
    const { _id, _creationTime, userId: _u, scanDocId: _s, ...m } = newest;
    return { ...m, snapshotHeightCm: scan.context.heightCm ?? null };
  },
});

/** After a new measurement method ships: derive its results for stored
 * feature sets (older method rows are kept). Internal only; batched. */
export const recomputeMeasurements = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let added = 0;
    for (const f of await ctx.db.query("bodyScanFeatures").take(Math.min(args.limit ?? 100, 500))) {
      const scan = await ctx.db.get(f.scanDocId);
      if (scan && (await storeMeasurements(ctx, scan, f))) added++;
    }
    return { added, methodVersion: MEASUREMENT_METHOD_VERSION };
  },
});

/** The scan's composition layer (newest measurement method / composition
 * version), for the owner. Every result keeps its status, range components,
 * validation status and whether it may be displayed — the app shows only
 * displayable ones; in c1 no body-fat estimate is displayable. */
export const composition = query({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    const rows = await ctx.db.query("bodyScanCompositions").withIndex("by_scan_and_versions", (q) => q.eq("scanDocId", scan._id)).collect();
    if (!rows.length) return null;
    const newest = rows.reduce((a, b) => (
      b.measurementMethodVersion > a.measurementMethodVersion ||
      (b.measurementMethodVersion === a.measurementMethodVersion && b.compositionVersion > a.compositionVersion) ? b : a));
    const { _id, _creationTime, userId: _u, scanDocId: _s, ...c } = newest;
    return c;
  },
});

async function alignmentInput(ctx: QueryCtx, scan: Doc<"bodyScans">): Promise<AlignmentInput | null> {
  const f = (await featuresOf(ctx, scan._id)).sort((a, b) => (a.cvVersion < b.cvVersion ? 1 : -1))[0];
  if (!f) return null;
  const images = await imagesOf(ctx, scan._id);
  return {
    depthSource: scan.capture.depth ?? "none",
    protocolVersion: scan.protocolVersion,
    views: f.views.map((v) => {
      const cond = images.find((i) => i.view === v.view)?.conditions;
      return {
        view: v.view,
        ...(cond ? { bodySpan: cond.bodySpan, pitchDegrees: cond.pitchDegrees } : {}),
        ...(v.silhouette ? { heightFraction: v.silhouette.heightFraction } : {}),
        ratios: v.ratios,
      };
    }),
  };
}

/** Scan A → scan B for the owner: alignment (align.1), then per measurement
 * no_meaningful_change / possible_change / meaningful_change. "Meaningful"
 * needs a validated MDC — none exists yet, so it can't occur. Unvalidated. */
export const compare = query({
  args: { scanIdA: v.string(), scanIdB: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const a = await ownScan(ctx, user._id, args.scanIdA);
    const b = await ownScan(ctx, user._id, args.scanIdB);
    const [ma, mb] = [await latestMeasurements(ctx, a._id), await latestMeasurements(ctx, b._id)];
    if (!ma || !mb) return { comparable: false as const, reasons: ["not_processed"], validated: false as const };
    const [ia, ib] = [await alignmentInput(ctx, a), await alignmentInput(ctx, b)];
    const alignment = ia && ib ? alignScans(ia, ib) : null;
    const mdc = VALIDATED_MDC[ma.methodVersion];
    const result = compareMeasurements(ma, mb, { ...(mdc ? { mdc, mdcValidated: true } : {}), ...(alignment ? { alignment } : {}) });
    return {
      ...result,
      validated: false as const,
      methodVersion: ma.methodVersion,
      alignment: alignment ? { method: alignment.method, comparable: alignment.comparable, reasons: alignment.reasons } : null,
      mdcValidated: Boolean(mdc),
    };
  },
});

// ─── Uploads (5E): owner-bound, orphans swept ─────────────────────────────────

/** For POST /body-scan-upload: may this signed-in user upload a scan image? */
export const uploadPermission = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.tokenIdentifier)).unique();
    if (!user) return { ok: false as const, status: 404 };
    if (user.bodyScanConsentVersion !== CONSENT_VERSION) return { ok: false as const, status: 403 };
    return { ok: true as const };
  },
});

/** For POST /body-scan-upload: the blob the endpoint just stored, bound to its owner. */
export const recordUpload = internalMutation({
  args: { tokenIdentifier: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.tokenIdentifier)).unique();
    if (!user || user.bodyScanConsentVersion !== CONSENT_VERSION) {
      if (await ctx.db.system.get(args.storageId)) await ctx.storage.delete(args.storageId);
      return { ok: false as const };
    }
    await ctx.db.insert("bodyScanUploads", { userId: user._id, storageId: args.storageId, createdAt: Date.now() });
    return { ok: true as const };
  },
});

export const ORPHAN_UPLOAD_AFTER_MS = 60 * 60 * 1000;

/** Uploads never attached within an hour (the app was closed mid-save): their
 * blobs are deleted. Only blobs the upload endpoint created are ever touched,
 * and never one that became a scan image. Runs hourly (convex/crons.ts). */
export const cleanupOrphanUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_UPLOAD_AFTER_MS;
    let removed = 0;
    for (const row of await ctx.db.query("bodyScanUploads").withIndex("by_created", (q) => q.lt("createdAt", cutoff)).take(200)) {
      const attached = await ctx.db.query("bodyScanImages").withIndex("by_storage", (q) => q.eq("storageId", row.storageId)).first();
      if (!attached && (await ctx.db.system.get(row.storageId))) { await ctx.storage.delete(row.storageId); removed++; }
      await ctx.db.delete(row._id);
    }
    return { removed };
  },
});

/** Scans left unfinished for over a day (the app was closed mid-scan): the
 * scan, its images and their blobs are removed. Runs hourly (convex/crons.ts). */
export const cleanupAbandoned = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let removed = 0;
    for (const scan of await ctx.db.query("bodyScans").take(500)) {
      if (!isAbandoned(scan, now)) continue;
      await deleteScanDeep(ctx, scan);
      if (++removed >= 100) break;
    }
    return { removed };
  },
});
