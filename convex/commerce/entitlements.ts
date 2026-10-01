// Sombrey commerce — Phase 6A/6D: entitlements (pure rules).
//
// "What is this user allowed to access?" — answered from facts, never from a
// user-editable flag:
//   • Band ownership   — ownership records: 6G ACTIVATION of a registered
//                        physical device (active, of a Band product); audited
//                        staff grants, including Bands paired before commerce
//                        existed ("legacy_pairing" — created only by the
//                        internal grant, never by the app). A Bluetooth pairing
//                        ALONE counts only if the config says so (6D: no); a
//                        linked pairing never counts by itself either.
//   • subscription     — VERIFIED App Store records (subscriptionState.ts)
//   • legacy access    — the existing hasPremiumAccess() paths (GOAT WALK web
//                        Premium via Hercules, coaching tiers, admin grants,
//                        staff roles), honoured as subscriber-level while the
//                        config flag is on. Never grants a Band.
// → a commercial state (none / band_owner / subscriber / band_owner_subscriber)
// → capabilities (config.capabilityMatrix)
// → per-feature access (config.featureMatrix), with what would unlock each
//   locked feature, the membership summary and which purchase entry points
//   to offer — everything the app shows, decided here (Phase 6D).
//
// Pure — tested in tests/commerce/entitlements.test.ts and access.test.ts.

import type { Capability, CommerceConfig, CommercialState, FeatureId } from "./config.ts";
import { ownsBand, type OwnershipRecord } from "./ownership.ts";
import { isBandProduct } from "./devices.ts";
import { grantsAccess, type SubscriptionRecord, type SubscriptionStatus } from "./subscriptionState.ts";

export type EntitlementInput = {
  /** 6G: activation records carry the product of the device they own. */
  ownership: Array<Pick<OwnershipRecord, "status" | "source"> & { productId?: string }>;
  subscriptions: SubscriptionRecord[];
  /** The existing premium paths (lib/roles.ts hasPremiumAccess). */
  legacyPremium: boolean;
  /** Paired Bands (wearableDevices) — not proof of purchase. */
  pairedDevices: number;
};

/** What would unlock a locked feature. */
export type Unlock = "band" | "membership" | "band_and_membership";

export type FeatureAccess = { allowed: boolean; unlockedBy: Unlock | null };

export type MembershipStatus = "none" | "active" | "grace_period" | "billing_retry" | "expired" | "revoked" | "refunded";

export type MembershipSummary = {
  status: MembershipStatus;
  source: "app_store" | "legacy_premium" | null;
  /** App Store only: whether it renews; null when unknown or not App Store. */
  autoRenew: boolean | null;
  /** App Store only: the current period's end (or the grace period's end). */
  renewsOrEndsAt: number | null;
};

export type Entitlements = {
  configVersion: string;
  state: CommercialState;
  ownsBand: boolean;
  bandSources: string[];
  subscriptionActive: boolean;
  subscriptionSources: string[];
  capabilities: Capability[];
  /** Phase 6D. */
  features: Record<FeatureId, FeatureAccess>;
  membership: MembershipSummary;
  offers: { band: boolean; membership: boolean; membershipPurchasable: boolean };
};

const STATUS_RANK: Record<SubscriptionStatus, number> = { active: 6, in_grace_period: 5, in_billing_retry: 4, refunded: 3, revoked: 2, expired: 1 };

/** The App Store subscription that best describes the user's membership now. */
function currentSubscription(subs: SubscriptionRecord[], now: number, allowSandbox: boolean): SubscriptionRecord | null {
  const eligible = subs.filter((s) => s.environment === "production" || allowSandbox);
  const granting = eligible.filter((s) => grantsAccess(s, now, allowSandbox));
  const pool = granting.length ? granting : eligible;
  return pool.sort((a, b) => (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || ((b.expiresDate ?? 0) - (a.expiresDate ?? 0)))[0] ?? null;
}

function membershipSummary(sub: SubscriptionRecord | null, granted: boolean, legacy: boolean, now: number): MembershipSummary {
  if (sub && granted) {
    const grace = sub.status === "in_grace_period";
    return { status: grace ? "grace_period" : "active", source: "app_store", autoRenew: sub.autoRenewEnabled, renewsOrEndsAt: grace ? (sub.gracePeriodExpiresDate ?? sub.expiresDate) : sub.expiresDate };
  }
  if (legacy) return { status: "active", source: "legacy_premium", autoRenew: null, renewsOrEndsAt: null };
  if (!sub) return { status: "none", source: null, autoRenew: null, renewsOrEndsAt: null };
  // Recorded but not granting: say why, in Apple's terms. An "active" record past
  // its expiry (no notification yet) is expired.
  const status: MembershipStatus =
    sub.status === "in_billing_retry" || (sub.status === "in_grace_period" && !granted) ? "billing_retry"
      : sub.status === "refunded" ? "refunded"
        : sub.status === "revoked" ? "revoked"
          : "expired";
  return { status, source: "app_store", autoRenew: sub.autoRenewEnabled, renewsOrEndsAt: sub.expiresDate !== null && sub.expiresDate > now ? sub.expiresDate : null };
}

/** Which purchase would unlock a feature, from the capability matrix alone. */
export function unlockFor(requires: Capability[], config: CommerceConfig): Unlock | null {
  if (!requires.length) return null;
  const has = (s: CommercialState) => requires.every((c) => config.capabilityMatrix[s].includes(c));
  if (has("band_owner")) return "band";
  if (has("subscriber")) return "membership";
  return "band_and_membership";
}

export function featureAccess(capabilities: Capability[], config: CommerceConfig): Record<FeatureId, FeatureAccess> {
  const out = {} as Record<FeatureId, FeatureAccess>;
  for (const [id, rule] of Object.entries(config.featureMatrix) as Array<[FeatureId, CommerceConfig["featureMatrix"][FeatureId]]>) {
    const allowed = rule.requires.every((c) => capabilities.includes(c));
    out[id] = { allowed, unlockedBy: allowed ? null : unlockFor(rule.requires, config) };
  }
  return out;
}

export function computeEntitlements(input: EntitlementInput, config: CommerceConfig, now: number,
  opts: { allowSandbox?: boolean } = {}): Entitlements {
  const allowSandbox = opts.allowSandbox ?? false;
  const bandSources: string[] = [];
  if (ownsBand(input.ownership.filter((r) => r.source === "order"), { countLegacyPairing: false })) bandSources.push("order");
  if (ownsBand(input.ownership.filter((r) => r.source === "staff_grant"), { countLegacyPairing: false })) bandSources.push("staff_grant");
  // 6G: an activated physical device — only while that ownership is active, and only for a Band product.
  if (ownsBand(input.ownership.filter((r) => r.source === "activation" && isBandProduct(config, r.productId)), { countLegacyPairing: false })) bandSources.push("activation");
  // An audited legacy_pairing record always counts; a bare pairing only if the config says so.
  if (ownsBand(input.ownership.filter((r) => r.source === "legacy_pairing"), { countLegacyPairing: true })
    || (config.pairedDeviceCountsAsBandOwnership && input.pairedDevices > 0)) {
    bandSources.push("legacy_pairing");
  }
  const sub = currentSubscription(input.subscriptions, now, allowSandbox);
  const appStoreGranted = input.subscriptions.some((s) => grantsAccess(s, now, allowSandbox));
  const legacy = config.legacyAccessGrantsSubscriberCapabilities && input.legacyPremium;
  const subscriptionSources: string[] = [];
  if (appStoreGranted) subscriptionSources.push("app_store");
  if (legacy) subscriptionSources.push("legacy_premium");

  const band = bandSources.length > 0, subscribed = subscriptionSources.length > 0;
  const state: CommercialState = band && subscribed ? "band_owner_subscriber" : band ? "band_owner" : subscribed ? "subscriber" : "none";
  const capabilities = [...config.capabilityMatrix[state]];
  const m = config.products.membership, b = config.products.band;
  return {
    configVersion: config.version,
    state, ownsBand: band, bandSources,
    subscriptionActive: subscribed, subscriptionSources,
    capabilities,
    features: featureAccess(capabilities, config),
    membership: membershipSummary(sub, appStoreGranted, legacy, now),
    offers: {
      band: !band && b.active,
      membership: !subscribed && m.active,
      membershipPurchasable: !subscribed && m.active && m.appStoreProductId !== null,
    },
  };
}

/** The question Phase 6D's gates ask. */
export function has(e: Pick<Entitlements, "capabilities">, capability: Capability): boolean {
  return e.capabilities.includes(capability);
}
