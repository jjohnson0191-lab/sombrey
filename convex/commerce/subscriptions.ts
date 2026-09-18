"use node";

import { action, internalAction } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import Hercules from "@usehercules/sdk";

// ─── GOAT WALK Premium — single public subscription ───────────────────────────

export const PREMIUM_FEATURE_ID = "feat_goatwalk_premium";
export const PREMIUM_VARIANT_ID = "var_goatwalk_premium_monthly";

// Legacy feature IDs — kept for backward compatibility with existing subscribers
export const LEGACY_FEATURES = {
  selfGuided: "feat_p4zbLVDe82dG",
  semiGuided: "feat_bKGoIMXWN437",
  fullGuided: "feat_FC0XdSTVGpb2",
} as const;

function getClient() {
  return new Hercules({
    apiKey: process.env.HERCULES_API_KEY,
    apiVersion: "2025-12-09",
  });
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

export const checkout = action({
  args: {
    variantId: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string | null | undefined }> => {
    const user = await ctx.runQuery(internal.commerce.helpers.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    const client = getClient();
    let customerId = user.customerId;

    if (!customerId) {
      const customer = await client.commerce.customers.create({
        name: user.name,
        email: user.email ?? undefined,
      });
      customerId = customer.id;
      await ctx.runMutation(internal.commerce.helpers.saveCustomerId, {
        userId: user._id,
        customerId,
      });
    }

    const session = await client.commerce.checkout({
      customer_id: customerId,
      line_items: [{ variant_id: args.variantId, quantity: 1 }],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    });

    return { url: session.url };
  },
});

// ─── Check premium access ─────────────────────────────────────────────────────

/**
 * Check if the current user has Premium access.
 * Returns true for: active Premium subscribers, coaching clients (any tier),
 * and legacy paid subscribers.
 */
export const checkPremiumAccess = action({
  args: {},
  handler: async (ctx): Promise<{ hasAccess: boolean; customerId: string | null }> => {
    const user = await ctx.runQuery(internal.commerce.helpers.getCurrentUserInternal);
    if (!user) return { hasAccess: false, customerId: null };

    // Admin-granted premium access bypasses Commerce entirely
    if (user.adminGrantedPremium === true) {
      return { hasAccess: true, customerId: user.customerId ?? null };
    }

    // Coaching clients always have premium access
    const tier = user.subscriptionTier as string;
    if (
      tier === "coaching_client" ||
      tier === "semi_guided" ||
      tier === "full_guided"
    ) {
      return { hasAccess: true, customerId: user.customerId ?? null };
    }

    if (!user.customerId) return { hasAccess: false, customerId: null };

    const client = getClient();

    // Check new Premium feature
    const premiumResult = await client.commerce.check({
      customer_id: user.customerId,
      resource_id: PREMIUM_FEATURE_ID,
    });
    if (premiumResult.has_access) return { hasAccess: true, customerId: user.customerId };

    // Check legacy features for existing subscribers
    const [selfResult, semiResult, fullResult] = await Promise.all([
      client.commerce.check({ customer_id: user.customerId, resource_id: LEGACY_FEATURES.selfGuided }),
      client.commerce.check({ customer_id: user.customerId, resource_id: LEGACY_FEATURES.semiGuided }),
      client.commerce.check({ customer_id: user.customerId, resource_id: LEGACY_FEATURES.fullGuided }),
    ]);

    const hasLegacyAccess = selfResult.has_access || semiResult.has_access || fullResult.has_access;
    return { hasAccess: hasLegacyAccess, customerId: user.customerId };
  },
});

// ─── Legacy checkAccess (kept for backward compatibility) ─────────────────────

export const checkAccess = action({
  args: { featureId: v.string() },
  handler: async (ctx, args): Promise<{ hasAccess: boolean; customerId: string | null }> => {
    const user = await ctx.runQuery(internal.commerce.helpers.getCurrentUserInternal);
    if (!user?.customerId) return { hasAccess: false, customerId: null };

    const client = getClient();
    const result = await client.commerce.check({
      customer_id: user.customerId,
      resource_id: args.featureId,
    });

    return { hasAccess: result.has_access, customerId: user.customerId };
  },
});

// ─── Billing portal ───────────────────────────────────────────────────────────

export const getBillingPortalUrl = action({
  args: { returnUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const user = await ctx.runQuery(internal.commerce.helpers.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    if (!user.customerId) throw new ConvexError({ code: "NOT_FOUND", message: "No billing account found" });

    const client = getClient();
    const portal = await client.commerce.customers.billingPortal(user.customerId, {
      return_url: args.returnUrl,
    });
    return { url: portal.url };
  },
});

// ─── Sync subscription status to DB ──────────────────────────────────────────

/**
 * #16 — Subscription status sync.
 *
 * After a successful Commerce checkout the user is redirected back to the app.
 * This action re-checks the authoritative Commerce access state and writes it
 * into `users.subscriptionTier` so every backend gate (getFitnessContext, etc.)
 * immediately sees the correct tier without the user having to sign out.
 *
 * The frontend calls this once when it detects a post-purchase redirect
 * (e.g. ?success=1 in the URL).  It is safe to call at any time — it is
 * idempotent and only ever reads from Commerce then writes to the DB.
 *
 * Authorization: operates on the authenticated caller only.
 * Spoofing: the tier is determined entirely by the live Commerce check, not by
 * any client-supplied value.
 */
export const syncSubscriptionStatus = action({
  args: {},
  handler: async (ctx): Promise<{ subscriptionTier: string }> => {
    const user = await ctx.runQuery(internal.commerce.helpers.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

    // Coaching clients and admin-granted users don't change tier via Commerce
    const tier = user.subscriptionTier as string;
    if (
      user.adminGrantedPremium === true ||
      tier === "coaching_client" ||
      tier === "semi_guided" ||
      tier === "full_guided"
    ) {
      return { subscriptionTier: tier };
    }

    if (!user.customerId) {
      return { subscriptionTier: user.subscriptionTier ?? "free" };
    }

    const client = getClient();

    // Check live Commerce state
    let hasAccess = false;
    try {
      const premiumResult = await client.commerce.check({
        customer_id: user.customerId,
        resource_id: PREMIUM_FEATURE_ID,
      });
      hasAccess = premiumResult.has_access;

      if (!hasAccess) {
        // Also check legacy features
        const [selfResult, semiResult, fullResult] = await Promise.all([
          client.commerce.check({ customer_id: user.customerId, resource_id: LEGACY_FEATURES.selfGuided }),
          client.commerce.check({ customer_id: user.customerId, resource_id: LEGACY_FEATURES.semiGuided }),
          client.commerce.check({ customer_id: user.customerId, resource_id: LEGACY_FEATURES.fullGuided }),
        ]);
        hasAccess = selfResult.has_access || semiResult.has_access || fullResult.has_access;
      }
    } catch {
      // If Commerce is unreachable, preserve existing tier to avoid false downgrades
      return { subscriptionTier: user.subscriptionTier ?? "free" };
    }

    const newTier = hasAccess ? "premium" : "free";

    // Only write if the tier actually changed to avoid unnecessary DB writes
    if (user.subscriptionTier !== newTier) {
      await ctx.runMutation(internal.commerce.helpers.updateSubscriptionTier, {
        userId: user._id,
        subscriptionTier: newTier,
      });
    }

    return { subscriptionTier: newTier };
  },
});

// ─── Ensure customer exists (scheduled on new user creation) ──────────────────

export const ensureCustomer = internalAction({
  args: { userId: v.id("users"), name: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const client = getClient();
    const customer = await client.commerce.customers.create({
      name: args.name,
      email: args.email,
    });
    await ctx.runMutation(internal.commerce.helpers.saveCustomerId, {
      userId: args.userId,
      customerId: customer.id,
    });
  },
});
