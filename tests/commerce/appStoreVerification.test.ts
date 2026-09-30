// Sombrey commerce, Phase 6C — Apple verification (appStoreFlow.ts, appStoreRules.ts,
// appStoreVerifier.ts with Apple's own library, accountToken.ts, appStoreConfig.ts).
// SYNTHETIC data and a throwaway certificate chain (appStoreHarness.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT_TOKEN_NAMESPACE, ACCOUNT_TOKEN_PREFIX, appAccountTokenFor, normalizeAccountToken } from "../../convex/commerce/accountToken.ts";
import { APPLE_BUNDLE_ID, APPLE_ROOT_CA_G3_BASE64, APPLE_ROOT_CA_G3_SHA256, readAppStoreServerConfig, sandboxGrantsAccess } from "../../convex/commerce/appStoreConfig.ts";
import { verifyAppSubmission, verifyNotification, MAX_SIGNED_PAYLOAD } from "../../convex/commerce/appStoreFlow.ts";
import { classifyNotification, INFORMATIONAL_NOTIFICATIONS } from "../../convex/commerce/appStoreRules.ts";
import { COMMERCE_CONFIG } from "../../convex/commerce/config.ts";
import {
  APP_APPLE_ID, BUNDLE, DAY, PRODUCT, T0, makeChain, notification, renewal, signJws, statusSource, tamper, transaction, verifierFor,
} from "./appStoreHarness.ts";

const apple = makeChain("Apple-stand-in");
const attacker = makeChain("Attacker");
const verifier = verifierFor(apple);
const ALICE = "user_alice";
const BOB = "user_bob";
const aliceToken = (await appAccountTokenFor(ALICE))!;
const bobToken = (await appAccountTokenFor(BOB))!;
const expected = (token: string) => ({ bundleId: BUNDLE, productIds: [PRODUCT], environments: ["Sandbox" as const], expectedAccountToken: token });
const NOW = T0 + 2000;

/** Apple's current status for Alice's subscription, as the Server API returns it. */
const current = (tx: object = {}, ren: object = {}, status = 1) => [{
  status, originalTransactionId: "2000000000000001",
  signedTransactionInfo: signJws(transaction({ appAccountToken: aliceToken, signedDate: T0 + 1500, ...tx }), apple),
  signedRenewalInfo: signJws(renewal({ signedDate: T0 + 1500, ...ren }), apple),
}];
const clientJws = (over: object = {}, chain = apple) => signJws(transaction({ appAccountToken: aliceToken, ...over }), chain);
const submit = (jws: string, token = aliceToken, statuses = statusSource(() => current())) =>
  verifyAppSubmission({ verifier, statuses, now: NOW }, { signedTransaction: jws, expected: expected(token) });

// ─── Account token ───────────────────────────────────────────────────────────

test("account token: the 6B algorithm, recomputed on the server (reference vector, deterministic, per account)", async () => {
  assert.equal(await appAccountTokenFor("user_test"), "96d212a9-d972-503e-8c18-87d719330709", "same vector as the Swift tests");
  assert.equal(await appAccountTokenFor(ALICE), aliceToken, "same account → same token (any device, any time)");
  assert.equal(await appAccountTokenFor(` ${ALICE} `), aliceToken);
  assert.notEqual(aliceToken, bobToken, "different accounts → different tokens");
  assert.equal(await appAccountTokenFor(""), null);
  assert.equal(await appAccountTokenFor("x".repeat(201)), null);
  assert.match(aliceToken, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "RFC 4122 v5");
  assert.equal(normalizeAccountToken(aliceToken.toUpperCase()), aliceToken, "Apple's casing doesn't matter");
  assert.equal(normalizeAccountToken("not-a-uuid"), null);
  assert.equal(normalizeAccountToken(undefined), null);
});

test("account token: namespace and prefix are identical to the iOS app's (must never change)", () => {
  const swift = readFileSync(join(import.meta.dirname, "../../apps/ios/Sombrey/Commerce/MembershipModels.swift"), "utf8");
  const ns = swift.match(/static let namespace = UUID\(uuidString: "([0-9A-F-]+)"\)/)?.[1];
  const prefix = swift.match(/static let prefix = "([^"]+)"/)?.[1];
  assert.equal(ns?.toLowerCase(), ACCOUNT_TOKEN_NAMESPACE);
  assert.equal(prefix, ACCOUNT_TOKEN_PREFIX);
  assert.equal(ACCOUNT_TOKEN_NAMESPACE, "155ea3db-9de4-4877-a417-fc8cda0354af");
  assert.equal(ACCOUNT_TOKEN_PREFIX, "sombrey:clerk:");
});

// ─── Configuration ───────────────────────────────────────────────────────────

test("configuration: not configured until the real product id and Apple settings exist; nothing invented", () => {
  assert.equal(COMMERCE_CONFIG.products.membership.appStoreProductId, null, "no App Store product id yet — none invented");
  const none = readAppStoreServerConfig({ APPLE_ALLOWED_ENVIRONMENTS: "Sandbox" }, null);
  assert.equal(none.ok, false);
  assert.equal(readAppStoreServerConfig({}, PRODUCT).ok, false, "environment required");
  assert.equal(readAppStoreServerConfig({ APPLE_ALLOWED_ENVIRONMENTS: "Production" }, PRODUCT).ok, false, "Production needs the app's Apple ID");
  assert.equal(readAppStoreServerConfig({ APPLE_ALLOWED_ENVIRONMENTS: "Sandbox,Xcode" }, PRODUCT).ok, false, "Xcode/local data is never accepted");
  const sandbox = readAppStoreServerConfig({ APPLE_ALLOWED_ENVIRONMENTS: "Sandbox" }, PRODUCT);
  assert.ok(sandbox.ok && sandbox.config.api === null && sandbox.config.bundleId === "com.sombrey.app");
  const full = readAppStoreServerConfig({
    APPLE_ALLOWED_ENVIRONMENTS: "Production, Sandbox", APPLE_APP_APPLE_ID: "123",
    APPLE_API_KEY_ID: "K", APPLE_API_ISSUER_ID: "I", APPLE_API_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
  }, PRODUCT);
  assert.ok(full.ok && full.config.environments.length === 2 && full.config.appAppleId === 123 && full.config.api?.keyId === "K");
  assert.equal(sandboxGrantsAccess({}), false, "sandbox never grants access unless the deployment says so");
  assert.equal(sandboxGrantsAccess({ COMMERCE_SANDBOX_GRANTS_ACCESS: "true" }), true);
});

test("configuration: the pinned root is Apple Root CA - G3", () => {
  const der = Buffer.from(APPLE_ROOT_CA_G3_BASE64, "base64");
  assert.equal(createHash("sha256").update(der).digest("hex").toUpperCase(), APPLE_ROOT_CA_G3_SHA256);
  const cert = new X509Certificate(der);
  assert.match(cert.subject, /CN=Apple Root CA - G3/);
  assert.match(cert.subject, /O=Apple Inc\./);
  assert.equal(APPLE_BUNDLE_ID, "com.sombrey.app");
});

// ─── App submission ──────────────────────────────────────────────────────────

test("valid transaction: verified, and the state comes from Apple's server — not from the app's copy", async () => {
  const r = await submit(clientJws({ expiresDate: T0 + 3650 * DAY, price: 0 }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.update.status, "active");
  assert.equal(r.update.expiresDate, T0 + 30 * DAY, "expiry is Apple's current one, never the submitted one");
  assert.equal(r.update.environment, "sandbox");
  assert.equal(r.update.appStoreProductId, PRODUCT);
  assert.equal(r.update.originalTransactionId, "2000000000000001");
  assert.equal(r.update.appAccountToken, aliceToken);
  assert.equal(r.update.autoRenewEnabled, true);
  assert.equal(r.update.verification.method, "app_store_server_api");
  assert.ok(!("price" in r.update) && !("currency" in r.update), "no price or payment data is recorded");
});

test("rejects: wrong bundle, product, environment, type, family sharing", async () => {
  const cases: Array<[object, string]> = [
    [{ bundleId: "com.attacker.app" }, "wrong_bundle"],
    [{ productId: "com.sombrey.lifetime" }, "wrong_product"],
    [{ environment: "Production" }, "wrong_environment"],
    [{ environment: "Xcode" }, "wrong_environment"],
    [{ type: "Consumable" }, "not_subscription"],
    [{ inAppOwnershipType: "FAMILY_SHARED" }, "family_shared"],
  ];
  for (const [over, reason] of cases) {
    const r = await submit(clientJws(over));
    assert.ok(!r.ok && r.kind === "rejected" && r.reason === reason, `${JSON.stringify(over)} → ${JSON.stringify(r)}`);
  }
});

test("rejects: invalid signatures (untrusted chain, tampered payload, alg none, missing x5c, leaf without Apple's marker)", async () => {
  const good = clientJws();
  const forgedChain = await submit(clientJws({}, attacker));
  assert.ok(!forgedChain.ok && forgedChain.reason === "invalid_signature");
  const tampered = await submit(tamper(good, transaction({ appAccountToken: aliceToken, expiresDate: T0 + 3650 * DAY })));
  assert.ok(!tampered.ok && tampered.kind === "rejected");
  const [, p] = good.split(".");
  const none = await submit(`${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p}.`);
  assert.ok(!none.ok && none.kind === "rejected");
  const noX5c = await submit(signJws(transaction({ appAccountToken: aliceToken }), apple, { x5c: [] }));
  assert.ok(!noX5c.ok && noX5c.kind === "rejected");
  const plainLeaf = makeChain("NoMarker", { leafExtension: false });
  const noMarker = await verifyAppSubmission({ verifier: verifierFor(plainLeaf), statuses: statusSource(() => current()), now: NOW },
    { signedTransaction: signJws(transaction({ appAccountToken: aliceToken }), plainLeaf), expected: expected(aliceToken) });
  assert.ok(!noMarker.ok && noMarker.reason === "invalid_signature", "Apple's leaf OID is required");
  // A chain signed by the attacker but claiming Apple's intermediate/root in x5c still fails.
  const mixed = await submit(signJws(transaction({ appAccountToken: aliceToken }), attacker, { x5c: [attacker.leaf, apple.intermediate, apple.root] }));
  assert.ok(!mixed.ok && mixed.reason === "invalid_signature");
});

test("rejects: malformed input", async () => {
  for (const bad of ["", "abc", "a.b.c", "x".repeat(MAX_SIGNED_PAYLOAD + 1), `${"e30"}.${Buffer.from("[]").toString("base64url")}.x`]) {
    const r = await submit(bad);
    assert.ok(!r.ok && r.kind === "rejected", bad.slice(0, 20));
  }
  const noIds = await submit(clientJws({ transactionId: undefined }));
  assert.ok(!noIds.ok && noIds.kind === "rejected");
});

test("account ownership: missing or another account's token is refused", async () => {
  const missing = await submit(signJws(transaction(), apple));
  assert.ok(!missing.ok && missing.reason === "missing_account_token");
  const bobSubmitsAlices = await submit(clientJws(), bobToken);
  assert.ok(!bobSubmitsAlices.ok && bobSubmitsAlices.reason === "wrong_account", "Bob can't attach Alice's purchase to his account");
  // Same Apple ID, different Sombrey account: the purchase carries the buyer's token.
  const bobAfterAlice = await submit(clientJws({ appAccountToken: aliceToken }), bobToken);
  assert.ok(!bobAfterAlice.ok && bobAfterAlice.reason === "wrong_account");
  // Apple's current data must still belong to the caller.
  const r = await submit(clientJws(), aliceToken, statusSource(() => current({ appAccountToken: bobToken })));
  assert.ok(!r.ok && r.reason === "wrong_account");
});

test("expired and revoked transactions are recorded as Apple says — never as active", async () => {
  const expired = await submit(clientJws(), aliceToken, statusSource(() => current({ expiresDate: T0 - DAY, purchaseDate: T0 - 31 * DAY }, { autoRenewStatus: 0 }, 2)));
  assert.ok(expired.ok && expired.update.status === "expired" && !expired.update.autoRenewEnabled);
  const refunded = await submit(clientJws(), aliceToken, statusSource(() => current({ revocationDate: T0 + 500, revocationReason: 0 }, {}, 5)));
  assert.ok(refunded.ok && refunded.update.status === "refunded" && refunded.update.revocationDate === T0 + 500);
  const revoked = await submit(clientJws(), aliceToken, statusSource(() => current({ revocationDate: T0 + 500 }, {}, 5)));
  assert.ok(revoked.ok && revoked.update.status === "revoked");
  const grace = await submit(clientJws(), aliceToken, statusSource(() => current({ expiresDate: T0 - 1 }, { isInBillingRetryPeriod: true, gracePeriodExpiresDate: T0 + 6 * DAY }, 4)));
  assert.ok(grace.ok && grace.update.status === "in_grace_period" && grace.update.gracePeriodExpiresDate === T0 + 6 * DAY);
  const retry = await submit(clientJws(), aliceToken, statusSource(() => current({ expiresDate: T0 - 1 }, { isInBillingRetryPeriod: true }, 3)));
  assert.ok(retry.ok && retry.update.status === "in_billing_retry");
});

test("Apple unreachable / unknown / not configured → no record, a calm outcome", async () => {
  const noApi = await verifyAppSubmission({ verifier, statuses: null, now: NOW }, { signedTransaction: clientJws(), expected: expected(aliceToken) });
  assert.ok(!noApi.ok && noApi.kind === "not_configured");
  const notFound = await submit(clientJws(), aliceToken, statusSource(() => "not_found"));
  assert.ok(!notFound.ok && notFound.kind === "rejected");
  const otherSub = await submit(clientJws(), aliceToken, statusSource(() => current({ originalTransactionId: "999" }).map((i) => ({ ...i, originalTransactionId: "999" }))));
  assert.ok(!otherSub.ok && otherSub.reason === "no_status");
  const { AppleVerificationError } = await import("../../convex/commerce/appStoreFlow.ts");
  const down = await verifyAppSubmission({ verifier, statuses: async () => { throw new AppleVerificationError("retryable"); }, now: NOW },
    { signedTransaction: clientJws(), expected: expected(aliceToken) });
  assert.ok(!down.ok && down.kind === "retry_later");
});

// ─── Notifications ───────────────────────────────────────────────────────────

const nExpected = { bundleId: BUNDLE, productIds: [PRODUCT], environments: ["Sandbox" as const] };
const verifyN = (payload: unknown, v = verifier) => verifyNotification({ verifier: v, now: NOW }, { signedPayload: payload, expected: nExpected });
const tx = (over: object = {}) => transaction({ appAccountToken: aliceToken, ...over });

test("notifications: the lifecycle Sombrey supports, derived from Apple's signed data", async () => {
  const cases: Array<[string, string | undefined, object, object, string, string, boolean?]> = [
    ["SUBSCRIBED", "INITIAL_BUY", tx(), renewal(), "purchased", "active"],
    ["SUBSCRIBED", "RESUBSCRIBE", tx(), renewal(), "resubscribed", "active"],
    ["DID_RENEW", undefined, tx({ transactionId: "2000000000000002", purchaseDate: T0 + 30 * DAY, expiresDate: T0 + 60 * DAY }), renewal(), "renewed", "active"],
    ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", tx(), renewal({ autoRenewStatus: 0 }), "auto_renew_disabled", "active", false],
    ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_ENABLED", tx(), renewal(), "auto_renew_enabled", "active", true],
    ["DID_FAIL_TO_RENEW", "GRACE_PERIOD", tx({ expiresDate: T0 - 1, purchaseDate: T0 - 30 * DAY }), renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: T0 + 6 * DAY }), "grace_period", "in_grace_period"],
    ["DID_FAIL_TO_RENEW", undefined, tx({ expiresDate: T0 - 1, purchaseDate: T0 - 30 * DAY }), renewal({ isInBillingRetryPeriod: true }), "billing_retry", "in_billing_retry"],
    ["GRACE_PERIOD_EXPIRED", undefined, tx({ expiresDate: T0 - 1, purchaseDate: T0 - 30 * DAY }), renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: T0 - 1 }), "grace_period_expired", "in_billing_retry"],
    ["EXPIRED", "VOLUNTARY", tx({ expiresDate: T0 - 1, purchaseDate: T0 - 30 * DAY }), renewal({ autoRenewStatus: 0 }), "expired", "expired", false],
    ["REFUND", undefined, tx({ revocationDate: T0 + 100, revocationReason: 0 }), renewal(), "refunded", "refunded"],
    ["REVOKE", undefined, tx({ revocationDate: T0 + 100 }), renewal(), "revoked", "revoked"],
  ];
  for (const [type, subtype, t, r, event, status, autoRenew] of cases) {
    const res = await verifyN(notification(apple, type, subtype, t, r));
    assert.ok(res.ok && res.apply, `${type}/${subtype}: ${JSON.stringify(res)}`);
    assert.equal(res.apply.event, event, `${type}/${subtype} event`);
    assert.equal(res.apply.update.status, status, `${type}/${subtype} status`);
    assert.equal(res.apply.update.verification.method, "app_store_server_notification");
    assert.equal(res.apply.update.signedDate, T0 + 5000, "ordered by Apple's notification signing time");
    if (autoRenew !== undefined) assert.equal(res.apply.update.autoRenewEnabled, autoRenew);
  }
});

test("notifications: informational and unknown types are recorded, change nothing", async () => {
  for (const type of INFORMATIONAL_NOTIFICATIONS) assert.deepEqual(classifyNotification(type), { action: "ignore" }, type);
  assert.deepEqual(classifyNotification("SOMETHING_NEW_FROM_APPLE"), { action: "ignore" });
  const t = await verifyN(signJws({ notificationType: "TEST", notificationUUID: "11111111-1111-4111-8111-111111111111", signedDate: T0 + 10,
    data: { appAppleId: APP_APPLE_ID, bundleId: BUNDLE, environment: "Sandbox" } }, apple));
  assert.ok(t.ok && !t.apply && t.skipped?.outcome === "ignored");
});

test("notifications: forged or malformed ones are refused before anything is read", async () => {
  const forged = await verifyN(notification(attacker, "DID_RENEW", undefined, tx({ expiresDate: T0 + 3650 * DAY }), renewal()));
  assert.ok(!forged.ok && forged.kind === "forged", "signed by someone other than Apple");
  const real = notification(apple, "EXPIRED", "VOLUNTARY", tx({ expiresDate: T0 - 1 }), renewal());
  const tampered = await verifyN(tamper(real, { notificationType: "DID_RENEW" }));
  assert.ok(!tampered.ok && tampered.kind === "forged", "a real notification with an edited payload");
  const otherApp = await verifyN(notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal(), {
    data: { appAppleId: APP_APPLE_ID, bundleId: "com.other.app", environment: "Sandbox", signedTransactionInfo: signJws(tx(), apple), signedRenewalInfo: signJws(renewal(), apple) },
  }));
  assert.ok(!otherApp.ok && otherApp.kind === "forged", "another app's notification");
  for (const junk of [undefined, 42, "", "not.a.jws", { signedPayload: "x" }]) {
    const r = await verifyN(junk);
    assert.ok(!r.ok && r.kind === "forged");
  }
  const noUuid = await verifyN(signJws({ notificationType: "DID_RENEW", signedDate: T0, data: { appAppleId: APP_APPLE_ID, bundleId: BUNDLE, environment: "Sandbox" } }, apple));
  assert.ok(!noUuid.ok, "a notification must carry Apple's notificationUUID");
  // Production notifications must also carry THIS app's Apple ID.
  const prodVerifier = verifierFor(apple, ["Production"]);
  const prod = signJws({ notificationType: "TEST", notificationUUID: "22222222-2222-4222-8222-222222222222", signedDate: T0 + 10,
    data: { appAppleId: 999, bundleId: BUNDLE, environment: "Production" } }, apple);
  const wrongApp = await verifyNotification({ verifier: prodVerifier, now: NOW }, { signedPayload: prod, expected: { ...nExpected, environments: ["Production"] } });
  assert.ok(!wrongApp.ok && wrongApp.kind === "forged");
});

test("notifications: verified envelope, but the subscription inside fails Sombrey's checks → recorded as rejected", async () => {
  const noToken = await verifyN(notification(apple, "SUBSCRIBED", "INITIAL_BUY", transaction(), renewal()));
  assert.ok(noToken.ok && !noToken.apply && noToken.skipped?.reason === "missing_account_token");
  const otherProduct = await verifyN(notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx({ productId: "other" }), renewal()));
  assert.ok(otherProduct.ok && otherProduct.skipped?.reason === "wrong_product");
  const innerForged = await verifyN(signJws({
    notificationType: "DID_RENEW", notificationUUID: "33333333-3333-4333-8333-333333333333", signedDate: T0 + 10,
    data: { appAppleId: APP_APPLE_ID, bundleId: BUNDLE, environment: "Sandbox", signedTransactionInfo: signJws(tx(), attacker), signedRenewalInfo: signJws(renewal(), apple) },
  }, apple));
  assert.ok(innerForged.ok && innerForged.skipped?.outcome === "rejected" && innerForged.skipped.reason === "inner_invalid_signature");
  const mismatchedRenewal = await verifyN(notification(apple, "DID_RENEW", undefined, tx(), renewal({ originalTransactionId: "999" })));
  assert.ok(mismatchedRenewal.ok && mismatchedRenewal.skipped?.reason === "mismatched_renewal_info");
});
