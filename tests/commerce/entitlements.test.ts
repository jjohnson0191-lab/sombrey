// Sombrey commerce, Phase 6A — entitlements and Band ownership (entitlements.ts, ownership.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMERCE_CONFIG, type CommerceConfig } from "../../convex/commerce/config.ts";
import { computeEntitlements, has } from "../../convex/commerce/entitlements.ts";
import { ACTIVATION_METHODS, OWNED_STATUSES, ownsBand, transitionOwnership, type OwnershipRecord } from "../../convex/commerce/ownership.ts";
import { applyVerifiedUpdate } from "../../convex/commerce/subscriptionState.ts";

const NOW = Date.UTC(2026, 9, 1);
const sub = (status: "active" | "expired" = "active") => applyVerifiedUpdate(null, {
  provider: "app_store", environment: "production", appStoreProductId: "p", originalTransactionId: "1", latestTransactionId: "1", status, autoRenewEnabled: true,
  purchaseDate: NOW - 1000, expiresDate: NOW + 1000, signedDate: NOW - 1000, verification: { method: "app_store_server_api", verifiedAt: NOW - 1000 },
}).record;
const strict: CommerceConfig = { ...structuredClone(COMMERCE_CONFIG), legacyAccessGrantsSubscriberCapabilities: false, pairedDeviceCountsAsBandOwnership: false };
const base = { ownership: [], subscriptions: [], legacyPremium: false, pairedDevices: 0 };

test("four commercial states, not a single isSubscribed flag", () => {
  const none = computeEntitlements(base, strict, NOW);
  assert.deepEqual([none.state, none.capabilities], ["none", []]);
  const band = computeEntitlements({ ...base, ownership: [{ status: "delivered", source: "order" }] }, strict, NOW);
  assert.deepEqual([band.state, band.capabilities], ["band_owner", ["band_experience", "vitals"]]);
  assert.ok(has(band, "vitals") && !has(band, "ai_intelligence"), "a Band without a subscription: device + Vitals, no AI intelligence");
  const subscriber = computeEntitlements({ ...base, subscriptions: [sub()] }, strict, NOW);
  assert.deepEqual([subscriber.state, subscriber.subscriptionSources], ["subscriber", ["app_store"]]);
  assert.ok(has(subscriber, "ai_intelligence"));
  const both = computeEntitlements({ ...base, ownership: [{ status: "connected", source: "order" }], subscriptions: [sub()] }, strict, NOW);
  assert.equal(both.state, "band_owner_subscriber");
  assert.deepEqual(both.capabilities, ["band_experience", "vitals", "ai_intelligence", "advanced_features"]);
});

test("a subscription counts only while verified and active; a Band only while owned", () => {
  assert.equal(computeEntitlements({ ...base, subscriptions: [sub("expired")] }, strict, NOW).state, "none");
  assert.equal(computeEntitlements({ ...base, subscriptions: [sub()] }, strict, NOW + 5000).state, "none", "expired by date");
  for (const s of ["returned", "cancelled"] as const) assert.equal(computeEntitlements({ ...base, ownership: [{ status: s, source: "order" }] }, strict, NOW).state, "none", s);
  assert.equal(computeEntitlements({ ...base, ownership: [{ status: "purchased", source: "order" }] }, strict, NOW).state, "band_owner", "PROVISIONAL: paid-for counts as owned");
});

test("legacy access and paired Bands follow the config flags (decisions pending)", () => {
  assert.equal(computeEntitlements({ ...base, legacyPremium: true }, strict, NOW).state, "none");
  const legacy = computeEntitlements({ ...base, legacyPremium: true }, COMMERCE_CONFIG, NOW);
  assert.deepEqual([legacy.state, legacy.subscriptionSources], ["subscriber", ["legacy_premium"]]);
  assert.equal(computeEntitlements({ ...base, pairedDevices: 1 }, strict, NOW).state, "none", "a pairing isn't proof of purchase");
  const paired = computeEntitlements({ ...base, pairedDevices: 1 }, COMMERCE_CONFIG, NOW);
  assert.deepEqual([paired.state, paired.bandSources], ["band_owner", ["legacy_pairing"]]);
  assert.equal(paired.configVersion, COMMERCE_CONFIG.version);
});

test("ownership: ordered ≠ owned ≠ connected; activation isn't possible until a method exists", () => {
  const r: OwnershipRecord = { status: "purchased", source: "order", history: [{ status: "purchased", at: 1, by: "provider" }] };
  const skip = transitionOwnership(r, "connected", 2, "system");
  assert.ok(!skip.ok, "purchased can't jump to connected");
  let cur = r;
  for (const to of ["processing", "shipped", "delivered"] as const) {
    const t = transitionOwnership(cur, to, 3, "provider");
    assert.ok(t.ok); if (t.ok) cur = t.record;
  }
  assert.deepEqual(Object.keys(ACTIVATION_METHODS), [], "no activation mechanism chosen (Phase 6G)");
  const act = transitionOwnership(cur, "activated", 4, "system", { method: "device_code" });
  assert.deepEqual(act, { ok: false, error: "No activation method is available yet" });
  const ret = transitionOwnership(cur, "returned", 5, "staff");
  assert.ok(ret.ok && ret.record.history.map((h) => h.status).join(">") === "purchased>processing>shipped>delivered>returned");
  assert.ok(!OWNED_STATUSES.includes("returned"));
  assert.equal(ownsBand([{ status: "delivered", source: "legacy_pairing" }], { countLegacyPairing: false }), false);
});
