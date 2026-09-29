// Body Scan access helpers shared by convex/bodyScans.ts and
// convex/bodyScanValidation.ts: the caller from the auth token (never a
// client-supplied id) and their own scan (another user's scan is reported
// exactly like one that doesn't exist).
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { validScanId } from "./rules";

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

export async function ownScan(ctx: QueryCtx | MutationCtx, userId: Id<"users">, scanId: string): Promise<Doc<"bodyScans">> {
  if (!validScanId(scanId)) throw new ConvexError({ code: "NOT_FOUND", message: "Scan not found" });
  const scan = await ctx.db.query("bodyScans").withIndex("by_user_and_scanId", (q) => q.eq("userId", userId).eq("scanId", scanId)).unique();
  if (!scan) throw new ConvexError({ code: "NOT_FOUND", message: "Scan not found" });
  return scan;
}

/** A scan's measurement set from the newest CV version and method, or null. */
export async function latestMeasurements(ctx: QueryCtx | MutationCtx, scanDocId: Id<"bodyScans">): Promise<Doc<"bodyScanMeasurements"> | null> {
  const rows = await ctx.db.query("bodyScanMeasurements").withIndex("by_scan_and_versions", (q) => q.eq("scanDocId", scanDocId)).collect();
  if (!rows.length) return null;
  return rows.reduce((a, b) => (b.cvVersion > a.cvVersion || (b.cvVersion === a.cvVersion && b.methodVersion > a.methodVersion) ? b : a));
}
