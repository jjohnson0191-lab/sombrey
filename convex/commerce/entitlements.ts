// Sombrey commerce — Phase 6A: entitlements (pure rules).
//
// "What is this user allowed to access?" — answered from facts, never from a
// user-editable flag:
//   • Band ownership   — ownership records (orders; legacy pairings if the
//                        config says so; audited staff grants)
//   • subscription     — VERIFIED App Store records (subscriptionState.ts)
//   • legacy access    — the existing hasPremiumAccess() paths (GOAT WALK web
//                        Premium via Hercules, coaching tiers, admin grants,
//                        staff roles), honoured as subscriber-level while the
//                        config flag is on (decision pending — docs §8)
// → a commercial state (none / band_owner / subscriber / band_owner_subscriber)
// → capabilities from the config's capability matrix (Phase 6D refines it).
//
// Nothing here gates a screen yet — Phase 6D does that by asking `has()`.
// Pure — tested in tests/commerce/entitlements.test.ts.

import type { Capability, CommerceConfig, CommercialState } from "./config.ts";
import { ownsBand, type OwnershipRecord } from "./ownership.ts";
import { grantsAccess, type SubscriptionRecord } from "./subscriptionState.ts";

export type EntitlementInput = {
  ownership: Array<Pick<OwnershipRecord, "status" | "source">>;
  subscriptions: SubscriptionRecord[];
  /** The existing premium paths (lib/roles.ts hasPremiumAccess). */
  legacyPremium: boolean;
  /** Paired Bands (wearableDevices) — not proof of purchase. */
  pairedDevices: number;
};

export type Entitlements = {
  configVersion: string;
  state: CommercialState;
  ownsBand: boolean;
  bandSources: string[];
  subscriptionActive: boolean;
  subscriptionSources: string[];
  capabilities: Capability[];
};

export function computeEntitlements(input: EntitlementInput, config: CommerceConfig, now: number,
  opts: { allowSandbox?: boolean } = {}): Entitlements {
  const bandSources: string[] = [];
  if (ownsBand(input.ownership.filter((r) => r.source === "order"), { countLegacyPairing: false })) bandSources.push("order");
  if (ownsBand(input.ownership.filter((r) => r.source === "staff_grant"), { countLegacyPairing: false })) bandSources.push("staff_grant");
  if (config.pairedDeviceCountsAsBandOwnership && (input.pairedDevices > 0 || ownsBand(input.ownership.filter((r) => r.source === "legacy_pairing"), { countLegacyPairing: true }))) {
    bandSources.push("legacy_pairing");
  }
  const subscriptionSources: string[] = [];
  if (input.subscriptions.some((s) => grantsAccess(s, now, opts.allowSandbox ?? false))) subscriptionSources.push("app_store");
  if (config.legacyAccessGrantsSubscriberCapabilities && input.legacyPremium) subscriptionSources.push("legacy_premium");

  const band = bandSources.length > 0, sub = subscriptionSources.length > 0;
  const state: CommercialState = band && sub ? "band_owner_subscriber" : band ? "band_owner" : sub ? "subscriber" : "none";
  return {
    configVersion: config.version,
    state, ownsBand: band, bandSources,
    subscriptionActive: sub, subscriptionSources,
    capabilities: [...config.capabilityMatrix[state]],
  };
}

/** The question Phase 6D's gates ask. */
export function has(e: Pick<Entitlements, "capabilities">, capability: Capability): boolean {
  return e.capabilities.includes(capability);
}
