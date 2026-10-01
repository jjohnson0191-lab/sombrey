// Sombrey commerce, Phase 6D — access, entitlements and feature gating.
// The four customer states, every membership transition, ownership persistence,
// restore/new device, offers, legacy access and client-manipulation attempts.
// SYNTHETIC data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMERCE_CONFIG, FEATURE_IDS, validateCommerceConfig, type CommerceConfig, type FeatureId } from "../../convex/commerce/config.ts";
import { computeEntitlements, unlockFor, type EntitlementInput } from "../../convex/commerce/entitlements.ts";
import { applyVerifiedUpdate, type SubscriptionRecord, type VerifiedSubscriptionUpdate } from "../../convex/commerce/subscriptionState.ts";
import { validateEvent } from "../../convex/commerce/events.ts";

const NOW = Date.UTC(2026, 9, 1);
const DAY = 86_400_000;
const CONVEX = join(import.meta.dirname, "../../convex");
const read = (p: string) => readFileSync(join(CONVEX, p), "utf8");

const update = (over: Partial<VerifiedSubscriptionUpdate> = {}): VerifiedSubscriptionUpdate => ({
  provider: "app_store", environment: "production", appStoreProductId: "p", originalTransactionId: "1", latestTransactionId: "1",
  status: "active", autoRenewEnabled: true, purchaseDate: NOW - DAY, expiresDate: NOW + 29 * DAY, signedDate: NOW - DAY,
  verification: { method: "app_store_server_notification", verifiedAt: NOW - DAY }, ...over,
});
const sub = (over: Partial<VerifiedSubscriptionUpdate> = {}): SubscriptionRecord => applyVerifiedUpdate(null, update(over)).record;
const band = [{ status: "delivered" as const, source: "order" as const }];
const none: EntitlementInput = { ownership: [], subscriptions: [], legacyPremium: false, pairedDevices: 0 };
const strict: CommerceConfig = { ...structuredClone(COMMERCE_CONFIG), legacyAccessGrantsSubscriberCapabilities: false };
const ent = (i: Partial<EntitlementInput>, now = NOW, config = strict) => computeEntitlements({ ...none, ...i }, config, now);
const allowed = (e: ReturnType<typeof ent>) => FEATURE_IDS.filter((f) => e.features[f].allowed).sort();

const FREE: FeatureId[] = ["account", "band_pairing", "body_scan", "core_tracking", "settings"];

// ─── The four states ─────────────────────────────────────────────────────────

test("State A — no Band, no membership: the free core only; Band and AI surfaces locked, with what unlocks them", () => {
  const e = ent({});
  assert.equal(e.state, "none");
  assert.deepEqual(allowed(e), FREE.slice().sort());
  assert.deepEqual(e.features.vitals, { allowed: false, unlockedBy: "band" });
  assert.deepEqual(e.features.wearable_data, { allowed: false, unlockedBy: "band" });
  assert.deepEqual(e.features.ai_coach, { allowed: false, unlockedBy: "membership" });
  assert.deepEqual(e.features.ai_meal_analysis, { allowed: false, unlockedBy: "membership" });
  assert.deepEqual(e.offers, { band: true, membership: true, membershipPurchasable: false }, "membership isn't purchasable until the App Store product exists");
  assert.equal(e.membership.status, "none");
});

test("State B — Band owner, no membership: Band experience, Vitals and wearable data; no AI", () => {
  const e = ent({ ownership: band });
  assert.equal(e.state, "band_owner");
  assert.deepEqual(allowed(e), [...FREE, "vitals", "wearable_data"].sort());
  assert.equal(e.features.ai_coach.allowed, false, "owning the Band is not membership");
  assert.equal(e.features.ai_coach.unlockedBy, "membership");
  assert.deepEqual(e.offers, { band: false, membership: true, membershipPurchasable: false });
});

test("State C — member, no Band: AI features that don't need hardware; no Band-derived data", () => {
  const e = ent({ subscriptions: [sub()] });
  assert.equal(e.state, "subscriber");
  assert.deepEqual(allowed(e), [...FREE, "advanced_intelligence", "ai_coach", "ai_meal_analysis"].sort());
  assert.deepEqual(e.features.vitals, { allowed: false, unlockedBy: "band" }, "no Band → no physiology, whatever the membership");
  assert.equal(e.features.wearable_data.allowed, false);
  assert.deepEqual(e.offers, { band: true, membership: false, membershipPurchasable: false });
  assert.deepEqual(e.membership, { status: "active", source: "app_store", autoRenew: true, renewsOrEndsAt: NOW + 29 * DAY });
});

test("State D — Band owner and member: everything that exists", () => {
  const e = ent({ ownership: band, subscriptions: [sub()] });
  assert.equal(e.state, "band_owner_subscriber");
  assert.deepEqual(allowed(e), [...FEATURE_IDS].sort());
  assert.deepEqual(e.offers, { band: false, membership: false, membershipPurchasable: false });
});

// ─── The matrix ──────────────────────────────────────────────────────────────

test("feature matrix: valid, versioned, every paid feature unlockable, account/settings/pairing always free", () => {
  assert.deepEqual(validateCommerceConfig(COMMERCE_CONFIG), []);
  assert.match(COMMERCE_CONFIG.version, /^2026-10-provisional\.\d+$/);
  assert.deepEqual([...FEATURE_IDS].sort(), ["account", "advanced_intelligence", "ai_coach", "ai_meal_analysis", "band_pairing", "body_scan", "core_tracking", "settings", "vitals", "wearable_data"]);
  const broken = structuredClone(COMMERCE_CONFIG);
  broken.featureMatrix.settings = { requires: ["ai_intelligence"], covers: "x" };
  assert.ok(validateCommerceConfig(broken).some((p) => p.includes("settings")));
  const unknown = structuredClone(COMMERCE_CONFIG);
  (unknown.featureMatrix.vitals.requires as string[]) = ["teleportation"];
  assert.ok(validateCommerceConfig(unknown).some((p) => p.includes("unknown teleportation")));
  assert.equal(unlockFor([], COMMERCE_CONFIG), null);
  assert.equal(unlockFor(["vitals", "ai_intelligence"], COMMERCE_CONFIG), "band_and_membership");
});

test("the matrix is the only place rules live: changing it changes access, no code change needed", () => {
  const experiment = structuredClone(COMMERCE_CONFIG);
  experiment.featureMatrix.ai_meal_analysis = { requires: [], covers: "free in an experiment" };
  experiment.legacyAccessGrantsSubscriberCapabilities = false;
  assert.equal(computeEntitlements(none, experiment, NOW).features.ai_meal_analysis.allowed, true);
  assert.equal(computeEntitlements(none, strict, NOW).features.ai_meal_analysis.allowed, false);
});

test("the app and the server name the same features (Swift FeatureID mirrors config.ts)", () => {
  const swift = readFileSync(join(import.meta.dirname, "../../apps/ios/Sombrey/Commerce/EntitlementModels.swift"), "utf8");
  const cases = [...swift.slice(swift.indexOf("enum FeatureID"), swift.indexOf("}", swift.indexOf("enum FeatureID"))).matchAll(/case (\w+) = "(\w+)"/g)].map((m) => m[2]).sort();
  assert.deepEqual(cases, [...FEATURE_IDS].sort());
});

// ─── Transitions ─────────────────────────────────────────────────────────────

test("cancellation: auto-renew off keeps membership until the period ends, then expires", () => {
  const cancelled = sub({ autoRenewEnabled: false });
  const during = ent({ ownership: band, subscriptions: [cancelled] });
  assert.equal(during.features.ai_coach.allowed, true);
  assert.deepEqual([during.membership.status, during.membership.autoRenew], ["active", false]);
  const after = ent({ ownership: band, subscriptions: [cancelled] }, NOW + 30 * DAY);
  assert.equal(after.state, "band_owner");
  assert.equal(after.membership.status, "expired", "past its expiry even before Apple's EXPIRED notification");
  assert.equal(after.features.ai_coach.allowed, false);
  assert.equal(after.features.vitals.allowed, true, "the Band experience stays");
});

test("expiry, billing retry, grace period, revocation and refund", () => {
  const cases: Array<[Partial<VerifiedSubscriptionUpdate>, string, boolean]> = [
    [{ status: "expired", expiresDate: NOW - DAY, purchaseDate: NOW - 31 * DAY }, "expired", false],
    [{ status: "in_billing_retry", expiresDate: NOW - DAY, purchaseDate: NOW - 31 * DAY }, "billing_retry", false],
    [{ status: "in_grace_period", expiresDate: NOW - DAY, purchaseDate: NOW - 31 * DAY, gracePeriodExpiresDate: NOW + 5 * DAY }, "grace_period", true],
    [{ status: "revoked", revocationDate: NOW - 1 }, "revoked", false],
    [{ status: "refunded", revocationDate: NOW - 1 }, "refunded", false],
  ];
  for (const [over, status, ai] of cases) {
    const e = ent({ ownership: band, subscriptions: [sub(over)] });
    assert.equal(e.membership.status, status, JSON.stringify(over));
    assert.equal(e.features.ai_coach.allowed, ai, status);
    assert.equal(e.features.vitals.allowed, true, `${status}: Band access is independent of membership`);
    assert.equal(e.ownsBand, true);
  }
  const graceOver = ent({ subscriptions: [sub({ status: "in_grace_period", expiresDate: NOW - DAY, purchaseDate: NOW - 31 * DAY, gracePeriodExpiresDate: NOW + DAY })] }, NOW + 2 * DAY);
  assert.equal(graceOver.membership.status, "billing_retry", "grace period over → no access");
});

test("renewal and refund reversal restore membership (the newer verified record wins)", () => {
  const expired = sub({ status: "expired", expiresDate: NOW - DAY, purchaseDate: NOW - 31 * DAY });
  const renewed = applyVerifiedUpdate(expired, update({ latestTransactionId: "2", purchaseDate: NOW, expiresDate: NOW + 30 * DAY, signedDate: NOW })).record;
  assert.equal(ent({ subscriptions: [renewed] }).features.ai_coach.allowed, true);
  const refunded = sub({ status: "refunded", revocationDate: NOW - 1 });
  const reversed = applyVerifiedUpdate(refunded, update({ signedDate: NOW })).record;
  assert.equal(reversed.revocationDate, undefined);
  assert.equal(ent({ subscriptions: [reversed] }).membership.status, "active");
});

test("expiry never touches Band ownership or data: entitlements are computed, never destructive", () => {
  // Nothing in the commerce layer deletes user data or ownership on a subscription change.
  for (const f of ["commerce/entitlements.ts", "commerce/gate.ts", "commerce/subscriptionStore.ts", "commerce/internal.ts", "commerce/appStore.ts"]) {
    const src = read(f);
    assert.ok(!/\.delete\(|purgeDocs|storage\.delete/.test(src), `${f} deletes something`);
  }
  const store = read("commerce/subscriptionStore.ts");
  assert.ok(!/bandOwnership|wearable|measurements|readiness|sleep/.test(store.replace(/\/\/.*$/gm, "")), "subscription changes don't reach Band or health tables");
});

test("several App Store records: the one that grants access describes the membership; sandbox needs the deployment flag", () => {
  const oldExpired = sub({ originalTransactionId: "9", latestTransactionId: "9", status: "expired", expiresDate: NOW - 90 * DAY, purchaseDate: NOW - 120 * DAY });
  assert.equal(ent({ subscriptions: [oldExpired, sub()] }).membership.status, "active");
  const sandbox = sub({ environment: "sandbox" });
  assert.equal(ent({ subscriptions: [sandbox] }).state, "none");
  assert.equal(ent({ subscriptions: [sandbox] }).membership.status, "none", "sandbox records don't describe production membership");
  assert.equal(computeEntitlements({ ...none, subscriptions: [sandbox] }, strict, NOW, { allowSandbox: true }).state, "subscriber");
});

// ─── Restore / new device / legacy ───────────────────────────────────────────

test("restore, reinstall and a new iPhone: the answer depends only on the account's server records", () => {
  const records = { ownership: band, subscriptions: [sub()] };
  const first = ent(records);
  assert.deepEqual(ent(structuredClone(records)), first, "deterministic for the same facts — no device input exists");
  const access = read("commerce/access.ts");
  const my = access.slice(access.indexOf("export const myEntitlements"), access.indexOf("/** The user's own orders"));
  assert.match(my, /args: \{\}/, "no client input — not even a device id");
  assert.match(my, /entitlementsFor\(ctx, await requireUser\(ctx\)\)/);
});

test("legacy access (GOAT WALK Premium, coaching tiers, admin grants, staff roles) keeps subscriber capabilities — never a Band, never an App Store record", () => {
  const e = computeEntitlements({ ...none, legacyPremium: true }, COMMERCE_CONFIG, NOW);
  assert.equal(e.state, "subscriber");
  assert.deepEqual(e.membership, { status: "active", source: "legacy_premium", autoRenew: null, renewsOrEndsAt: null });
  assert.equal(e.features.ai_coach.allowed, true);
  assert.equal(e.features.vitals.allowed, false);
  assert.equal(e.ownsBand, false);
  const store = read("commerce/subscriptionStore.ts") + read("commerce/gate.ts");
  assert.ok(!/subscriptionTier|adminGrantedPremium/.test(store), "legacy flags are read, never converted into commerce records");
});

// ─── Security ────────────────────────────────────────────────────────────────

test("fake Band owner: a Bluetooth pairing (any client can register a device) isn't ownership", () => {
  assert.equal(ent({ pairedDevices: 5 }, NOW, COMMERCE_CONFIG).ownsBand, false);
  const wearable = read("wearable.ts");
  assert.ok(!/bandOwnership/.test(wearable), "registering a device never writes ownership");
  // Ownership rows are written only by internal functions.
  const internal = read("commerce/internal.ts");
  assert.match(internal, /export const grantBandOwnership = internalMutation\(/);
  assert.match(internal, /args: \{ userId: v\.id\("users"\), source: v\.union\(v\.literal\("staff_grant"\), v\.literal\("legacy_pairing"\)\) \}/, "a grant can't impersonate an order");
});

test("fake subscriber / self-granted AI: the AI endpoints check entitlements on the server", () => {
  const coach = read("ai/sombreyCoach.ts");
  const chat = coach.slice(coach.indexOf("export const chat"));
  assert.ok(chat.indexOf("requireFeature") > 0 && chat.indexOf("requireFeature") < chat.indexOf("getSombreyContext"), "checked before any context or model call");
  assert.match(chat, /requireFeature, \{ feature: "ai_coach" \}/);
  const photos = read("mealPhotos.ts");
  for (const fn of ["generateUploadUrl", "startAnalysis"]) {
    const body = photos.slice(photos.indexOf(`export const ${fn}`), photos.indexOf("export const", photos.indexOf(`export const ${fn}`) + 10));
    assert.match(body, /assertFeature\(ctx, [^,]+, "ai_meal_analysis"\)/, fn);
  }
  const gate = read("commerce/gate.ts");
  const req = gate.slice(gate.indexOf("export const requireFeature"));
  assert.match(req, /args: \{ feature: v\.string\(\) \}/, "the only argument is WHICH feature — the user comes from the auth identity");
  assert.match(req, /ctx\.auth\.getUserIdentity\(\)/);
  assert.match(gate, /code: "FEATURE_LOCKED"/);
});

test("no client path can modify entitlement inputs", () => {
  const access = read("commerce/access.ts");
  assert.ok(!/insert\("(bandOwnership|commerceSubscriptions|commerceOrders)"|\.patch\(/.test(access));
  const gate = read("commerce/gate.ts");
  assert.ok(!/export const \w+ = (mutation|query|action)\(/.test(gate), "gate.ts exposes nothing public");
  assert.ok(!/\.insert\(|\.patch\(/.test(gate), "gate.ts only reads");
});

test("analytics: the app may report a locked feature (no PII, no amounts) but never a server event", () => {
  const known = [COMMERCE_CONFIG.products.band.id, COMMERCE_CONFIG.products.membership.id];
  assert.equal(validateEvent({ name: "feature_access_denied", platform: "ios", source: "ai_coach" }, "client", known), null);
  assert.match(validateEvent({ name: "feature_access_denied", platform: "ios", source: "someone@example.com" }, "client", known)!, /short label/);
  assert.match(validateEvent({ name: "feature_access_denied", platform: "ios", amountCents: 3000, currency: "USD" }, "client", known)!, /amounts/);
  for (const name of ["subscription_activated", "band_checkout_completed", "band_order_completed"]) {
    assert.match(validateEvent({ name, platform: "ios" }, "client", known)!, /only be recorded by Sombrey's servers/);
  }
});
