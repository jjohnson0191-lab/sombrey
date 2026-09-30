"use node";
// Sombrey commerce — Phase 6C: App Store subscriptions, verified on the server.
//
//   submitTransaction    (client, authenticated) the app hands over Apple's
//                        signed transaction after a purchase, a restore, an
//                        update or at launch. The server verifies it with Apple
//                        and records what APPLE says — never what the app says.
//   processNotification  (internal, from the HTTP route in convex/http.ts)
//                        a signed App Store Server Notification V2.
//
// Apple
//   ↓ StoreKit 2 (device) ─ signed JWS ─► submitTransaction ─► verify signature (Apple root)
//                                                           ─► account token = uuidv5(Clerk id of the CALLER)
//                                                           ─► App Store Server API: current status (signed)
//   ↓ App Store Server Notifications ──► /apple/app-store-notifications ─► processNotification ─► verify
//                                                           ↓
//                         internal.commerce.internal.applyVerifiedSubscription / applyAppStoreNotification
//                                                           ↓
//                         commerceSubscriptions (+ history) ─► commerce/access:myEntitlements ─► app
//
// The only client input is the signed transaction string. Price, expiry,
// status, product, environment and the account are all read from Apple's
// verified data or from the authenticated identity. Errors returned to the
// app are coarse codes; details go to the server log only (never payloads).

import { ConvexError, v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { COMMERCE_CONFIG } from "./config";
import { APPLE_ROOT_CA_G3_BASE64, readAppStoreServerConfig } from "./appStoreConfig";
import { appAccountTokenFor } from "./accountToken";
import { verifyAppSubmission, verifyNotification } from "./appStoreFlow";
import { createAppleVerifier, createStatusSource } from "./appStoreVerifier";

function loadAppStore() {
  const cfg = readAppStoreServerConfig(process.env, COMMERCE_CONFIG.products.membership.appStoreProductId);
  if (!cfg.ok) return null;
  const c = cfg.config;
  return {
    config: c,
    verifier: createAppleVerifier({
      roots: [Buffer.from(APPLE_ROOT_CA_G3_BASE64, "base64")], bundleId: c.bundleId, environments: c.environments,
      appAppleId: c.appAppleId, onlineChecks: true,
    }),
    statuses: c.api ? createStatusSource(c.api, c.bundleId) : null,
  };
}

export type SubmitResult = {
  /** recorded / unchanged: Apple confirmed the state and Sombrey stored it.
   * This is NOT access — the app reads access from commerce/access:myEntitlements. */
  result: "recorded" | "unchanged" | "not_configured" | "rejected" | "retry_later";
  /** Only for "rejected": a coarse, user-safe reason. */
  reason?: "other_account" | "not_verifiable";
};

export const submitTransaction = action({
  args: { signedTransaction: v.string() },
  handler: async (ctx, args): Promise<SubmitResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.runQuery(internal.commerce.helpers.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const expectedAccountToken = await appAccountTokenFor(identity.subject);
    if (!expectedAccountToken) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const appStore = loadAppStore();
    if (!appStore) return { result: "not_configured" };
    const budget = await ctx.runMutation(internal.commerce.internal.reserveAppStoreSubmission, { userId: user._id, appAccountToken: expectedAccountToken });
    if (!budget.allowed) return { result: "retry_later" };

    const c = appStore.config;
    const verified = await verifyAppSubmission(
      { verifier: appStore.verifier, statuses: appStore.statuses, now: Date.now() },
      { signedTransaction: args.signedTransaction, expected: { bundleId: c.bundleId, productIds: c.productIds, environments: c.environments, expectedAccountToken } },
    );
    if (!verified.ok) {
      console.warn(`[appStore] submission ${verified.kind}: ${verified.reason}`);
      if (verified.kind !== "rejected") return { result: verified.kind };
      return { result: "rejected", reason: verified.reason === "wrong_account" ? "other_account" : "not_verifiable" };
    }
    try {
      const w = await ctx.runMutation(internal.commerce.internal.applyVerifiedSubscription, { userId: user._id, update: verified.update });
      return { result: w.changed ? "recorded" : "unchanged" };
    } catch (e) {
      if (e instanceof ConvexError && (e.data as { code?: string })?.code === "FORBIDDEN") {
        console.warn("[appStore] submission rejected: subscription bound to another account");
        return { result: "rejected", reason: "other_account" };
      }
      throw e;
    }
  },
});

/** HTTP status for Apple: 200 = received (Apple stops retrying), 503 = try
 * again later (not configured yet / Apple unreachable), 400 = not a valid
 * signed notification. */
export const processNotification = internalAction({
  args: { signedPayload: v.string() },
  handler: async (ctx, args): Promise<{ httpStatus: 200 | 400 | 503; outcome: string }> => {
    const appStore = loadAppStore();
    if (!appStore) return { httpStatus: 503, outcome: "not_configured" };
    const c = appStore.config;
    const r = await verifyNotification(
      { verifier: appStore.verifier, now: Date.now() },
      { signedPayload: args.signedPayload, expected: { bundleId: c.bundleId, productIds: c.productIds, environments: c.environments } },
    );
    if (!r.ok) {
      console.warn(`[appStore] notification ${r.kind}: ${r.reason}`);
      return { httpStatus: r.kind === "retry_later" ? 503 : 400, outcome: r.kind };
    }
    const { outcome } = await ctx.runMutation(internal.commerce.internal.applyAppStoreNotification, {
      notification: r.notification,
      ...(r.apply ? { apply: r.apply } : {}),
      ...(r.skipped ? { skipped: r.skipped } : {}),
    });
    if (r.skipped) console.info(`[appStore] notification ${r.notification.notificationType} ${outcome}: ${r.skipped.reason}`);
    return { httpStatus: 200, outcome };
  },
});
