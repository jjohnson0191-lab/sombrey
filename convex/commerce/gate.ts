// Sombrey commerce — Phase 6D: server-side access decisions and enforcement.
//
//   entitlementsFor   the ONE place a user's entitlements are computed from
//                     stored facts (ownership records, verified App Store
//                     records, legacy premium). commerce/access:myEntitlements
//                     returns it; nothing on the client decides access.
//   assertFeature     for queries/mutations: throws FEATURE_LOCKED when the
//                     user's entitlements don't include the feature.
//   requireFeature    the same for actions (internal query; the user comes
//                     from the caller's auth identity — never an argument).
//
// The app hides locked surfaces, but the paid ones (AI) are refused HERE too,
// so a modified client gains nothing.

import { ConvexError, v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { hasPremiumAccess } from "../lib/roles.js";
import { COMMERCE_CONFIG, FEATURE_IDS, type FeatureId } from "./config";
import { computeEntitlements, type Entitlements } from "./entitlements";
import { toSubscriptionRecord } from "./subscriptionStore";
import { sandboxGrantsAccess } from "./appStoreConfig";

export async function entitlementsFor(ctx: QueryCtx | MutationCtx, user: Doc<"users">): Promise<Entitlements> {
  const ownership = await ctx.db.query("bandOwnership").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
  const subscriptions = await ctx.db.query("commerceSubscriptions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
  const paired = await ctx.db.query("wearableDevices").withIndex("by_user", (q) => q.eq("userId", user._id)).take(10);
  return computeEntitlements({
    ownership: ownership.map((o) => ({ status: o.status, source: o.source, ...(o.productId ? { productId: o.productId } : {}) })),
    subscriptions: subscriptions.map(toSubscriptionRecord),
    legacyPremium: hasPremiumAccess(user),
    pairedDevices: paired.length,
  }, COMMERCE_CONFIG, Date.now(), { allowSandbox: sandboxGrantsAccess(process.env) });
}

function locked(feature: FeatureId, e: Entitlements): ConvexError<{ code: "FEATURE_LOCKED"; feature: FeatureId; unlockedBy: string | null; message: string }> {
  const unlockedBy = e.features[feature].unlockedBy;
  const message = unlockedBy === "band" ? "This needs a Sombrey Band." : unlockedBy === "membership" ? "This needs Sombrey Membership." : "This needs a Sombrey Band and Membership.";
  return new ConvexError({ code: "FEATURE_LOCKED" as const, feature, unlockedBy, message });
}

export async function assertFeature(ctx: QueryCtx | MutationCtx, user: Doc<"users">, feature: FeatureId): Promise<void> {
  const e = await entitlementsFor(ctx, user);
  if (!e.features[feature]?.allowed) throw locked(feature, e);
}

/** For actions: `await ctx.runQuery(internal.commerce.gate.requireFeature, { feature })`. */
export const requireFeature = internalQuery({
  args: { feature: v.string() },
  handler: async (ctx, args) => {
    if (!(FEATURE_IDS as string[]).includes(args.feature)) throw new ConvexError({ code: "INVALID", message: "Unknown feature" });
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    await assertFeature(ctx, user, args.feature as FeatureId);
    return null;
  },
});
