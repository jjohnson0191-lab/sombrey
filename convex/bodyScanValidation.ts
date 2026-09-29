// Sombrey Body Scan — Phase 5D validation harness (DEVELOPMENT ONLY).
//
//   enabled       → whether this deployment allows validation tooling
//   recordTruth   → one hand measurement (tape / stadiometer / scale) for a subject code
//   truths        → the operator's ground-truth entries
//   deleteTruth   → remove one entry
//   tagScan       → label one of the operator's saved scans with its capture
//                   conditions (subject, session, repeat, distance, phone height,
//                   lighting, clothing, pose)
//   tags          → the operator's tagged scans
//   untagScan     → remove a label
//   report        → the validation analysis + CSV (convex/bodyScan/validation.ts)
//   deleteAll     → wipe the operator's validation data
//
// Every function refuses unless the deployment sets
// SOMBREY_BODYSCAN_VALIDATION=enabled (development only — production never
// sets it). The caller comes from the auth token and sees only their own
// records. Ground truth lives in its own tables: it never touches the profile,
// weight history, `measurements`, Progress, coach or AI context, and scanner
// results are read, never modified.

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { latestMeasurements, ownScan, requireUser } from "./bodyScan/access";
import { buildReport, normaliseTruth, toCsv, validateTag, type TaggedScan, type Truth, type TruthMeasurement } from "./bodyScan/validation";

function validationEnabled(): boolean {
  return process.env.SOMBREY_BODYSCAN_VALIDATION === "enabled";
}

async function requireValidation(ctx: QueryCtx | MutationCtx) {
  if (!validationEnabled()) throw new ConvexError({ code: "FORBIDDEN", message: "Validation tooling is not available on this deployment" });
  return await requireUser(ctx);
}

const tagArgs = {
  subjectCode: v.string(),
  session: v.string(),
  repeat: v.string(),
  distanceM: v.number(),
  phoneHeight: v.string(),
  lighting: v.string(),
  clothing: v.string(),
  pose: v.string(),
};

export const enabled = query({
  args: {},
  handler: async (ctx) => {
    if (!validationEnabled()) return false;
    await requireUser(ctx);
    return true;
  },
});

export const recordTruth = mutation({
  args: {
    subjectCode: v.string(),
    measuredAt: v.number(),
    measurement: v.string(),
    value: v.number(),
    unit: v.string(),
    protocol: v.string(),
    operator: v.string(),
    repeat: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireValidation(ctx);
    const now = Date.now();
    const r = normaliseTruth(args, now);
    if (!r.ok) throw new ConvexError({ code: "INVALID", message: r.error });
    const id = await ctx.db.insert("bodyScanValidationTruth", { userId: user._id, ...r.truth, createdAt: now });
    return { id, value: r.truth.value, unit: r.truth.unit };
  },
});

export const truths = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireValidation(ctx);
    const rows = await ctx.db.query("bodyScanValidationTruth").withIndex("by_user", (q) => q.eq("userId", user._id)).take(2000);
    return rows
      .sort((a, b) => b.measuredAt - a.measuredAt)
      .map(({ _id, subjectCode, measuredAt, measurement, value, unit, protocol, operator, repeat }) => ({ id: _id, subjectCode, measuredAt, measurement, value, unit, protocol, operator, repeat }));
  },
});

export const deleteTruth = mutation({
  args: { id: v.id("bodyScanValidationTruth") },
  handler: async (ctx, args) => {
    const user = await requireValidation(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    await ctx.db.delete(args.id);
  },
});

export const tagScan = mutation({
  args: { scanId: v.string(), ...tagArgs },
  handler: async (ctx, { scanId, ...tag }) => {
    const user = await requireValidation(ctx);
    const scan = await ownScan(ctx, user._id, scanId);
    if (scan.status !== "complete") throw new ConvexError({ code: "INVALID", message: "Only saved scans can be tagged" });
    const problem = validateTag(tag);
    if (problem) throw new ConvexError({ code: "INVALID", message: problem });
    const existing = await ctx.db.query("bodyScanValidationTags").withIndex("by_scan", (q) => q.eq("scanDocId", scan._id)).first();
    const row = { userId: user._id, scanDocId: scan._id, ...tag, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("bodyScanValidationTags", row);
    return { tagged: true };
  },
});

export const untagScan = mutation({
  args: { scanId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireValidation(ctx);
    const scan = await ownScan(ctx, user._id, args.scanId);
    for (const t of await ctx.db.query("bodyScanValidationTags").withIndex("by_scan", (q) => q.eq("scanDocId", scan._id)).collect()) await ctx.db.delete(t._id);
  },
});

export const tags = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireValidation(ctx);
    const out = [];
    for (const t of await ctx.db.query("bodyScanValidationTags").withIndex("by_user", (q) => q.eq("userId", user._id)).take(1000)) {
      const scan = await ctx.db.get(t.scanDocId);
      if (!scan || scan.userId !== user._id) continue;
      const { subjectCode, session, repeat, distanceM, phoneHeight, lighting, clothing, pose } = t;
      out.push({ scanId: scan.scanId, createdAt: scan.createdAt, tag: { subjectCode, session, repeat, distanceM, phoneHeight, lighting, clothing, pose } });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** The operator's validation analysis: every tagged scan's newest measurement
 * set against the ground truth, plus the observations as CSV. */
export const report = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireValidation(ctx);
    const scans: TaggedScan[] = [];
    for (const t of await ctx.db.query("bodyScanValidationTags").withIndex("by_user", (q) => q.eq("userId", user._id)).take(1000)) {
      const scan = await ctx.db.get(t.scanDocId);
      if (!scan || scan.userId !== user._id || scan.status !== "complete") continue;
      const m = await latestMeasurements(ctx, scan._id);
      scans.push({
        scanId: scan.scanId, createdAt: scan.createdAt, deviceModel: scan.capture.deviceModel, depthSource: scan.capture.depth ?? "none",
        tag: { subjectCode: t.subjectCode, session: t.session, repeat: t.repeat, distanceM: t.distanceM, phoneHeight: t.phoneHeight, lighting: t.lighting, clothing: t.clothing, pose: t.pose },
        measurements: m ? { methodVersion: m.methodVersion, measurements: m.measurements, scale: m.scale } : null,
      });
    }
    const truthRows = await ctx.db.query("bodyScanValidationTruth").withIndex("by_user", (q) => q.eq("userId", user._id)).take(2000);
    const truthList: Truth[] = truthRows.map((t) => ({
      subjectCode: t.subjectCode, measuredAt: t.measuredAt, measurement: t.measurement as TruthMeasurement, value: t.value, unit: t.unit,
      protocol: t.protocol, operator: t.operator, repeat: t.repeat,
    }));
    const { report, observations } = buildReport(scans, truthList);
    return {
      report,
      csv: toCsv(observations),
      // Per scan × measurement where a ground truth exists: what the DEV screen lists.
      paired: observations.filter((o) => o.truth !== null).map((o) => ({
        scanId: o.scanId, subject: o.subject, session: o.session, repeat: o.repeat, measurement: o.measurement, status: o.status,
        scanner: o.scanner, uncertainty: o.uncertainty, truth: o.truth, signedError: o.error?.signed ?? null, distanceM: o.distanceM, depthSource: o.depthSource,
      })),
    };
  },
});

export const deleteAll = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireValidation(ctx);
    let removed = 0;
    for (const t of await ctx.db.query("bodyScanValidationTags").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) { await ctx.db.delete(t._id); removed++; }
    for (const t of await ctx.db.query("bodyScanValidationTruth").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) { await ctx.db.delete(t._id); removed++; }
    return { removed };
  },
});
