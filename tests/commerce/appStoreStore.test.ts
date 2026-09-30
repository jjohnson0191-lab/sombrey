// Sombrey commerce, Phase 6C — recording verified Apple data (subscriptionStore.ts):
// idempotency, account ownership, lifecycle and history, end to end from signed
// (synthetic) Apple payloads through the real verification flow into an
// in-memory database that behaves like Convex's (serialized mutations).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appAccountTokenFor } from "../../convex/commerce/accountToken.ts";
import { verifyAppSubmission, verifyNotification } from "../../convex/commerce/appStoreFlow.ts";
import { applyNotification, linkAccountToken, SUBMISSIONS_PER_HOUR, toSubscriptionRecord, writeVerifiedSubscription, type StoreConfig } from "../../convex/commerce/subscriptionStore.ts";
import { computeEntitlements } from "../../convex/commerce/entitlements.ts";
import { COMMERCE_CONFIG, type CommerceConfig } from "../../convex/commerce/config.ts";
import type { VerifiedSubscriptionUpdate } from "../../convex/commerce/subscriptionState.ts";
import { BUNDLE, DAY, MemoryDb, PRODUCT, T0, makeChain, notification, renewal, signJws, statusSource, transaction, verifierFor } from "./appStoreHarness.ts";

const apple = makeChain("Apple-stand-in");
const verifier = verifierFor(apple);
const aliceToken = (await appAccountTokenFor("user_alice"))!;
const bobToken = (await appAccountTokenFor("user_bob"))!;
const ALICE = "users:alice" as never, BOB = "users:bob" as never;
const CONFIG: StoreConfig = { membershipProductId: "sombrey_membership_monthly", appStoreProductIds: [PRODUCT], configVersion: "test" };
const expected = { bundleId: BUNDLE, productIds: [PRODUCT], environments: ["Sandbox" as const] };
const strict: CommerceConfig = { ...structuredClone(COMMERCE_CONFIG), legacyAccessGrantsSubscriberCapabilities: false, pairedDeviceCountsAsBandOwnership: false };

const tx = (over: object = {}) => transaction({ appAccountToken: aliceToken, ...over });
const apiNow = (t: object = {}, r: object = {}, status = 1, signedDate = T0 + 1500) => statusSource(() => [{
  status, originalTransactionId: "2000000000000001",
  signedTransactionInfo: signJws(tx({ signedDate, ...t }), apple), signedRenewalInfo: signJws(renewal({ signedDate, ...r }), apple),
}]);

/** What submitTransaction does, minus Convex: verify with "Apple", then record. */
async function appSubmits(db: MemoryDb, userId: never, token: string, statuses = apiNow(), clientTx: object = tx()) {
  const v = await verifyAppSubmission({ verifier, statuses, now: T0 + 2000 },
    { signedTransaction: signJws(clientTx, apple), expected: { ...expected, expectedAccountToken: token } });
  if (!v.ok) return { verified: v };
  return db.serial(() => writeVerifiedSubscription(db as never, { userId, update: v.update, event: "verified_with_apple", source: { kind: "app_submission" } }, CONFIG, T0 + 2000))
    .then((w) => ({ verified: v, written: w }), (e) => ({ verified: v, error: e as Error }));
}

/** What processNotification does, minus Convex. */
async function appleNotifies(db: MemoryDb, signedPayload: string) {
  const v = await verifyNotification({ verifier, now: T0 + 2000 }, { signedPayload, expected });
  assert.ok(v.ok, JSON.stringify(v));
  return db.serial(() => applyNotification(db as never, { notification: v.notification, ...(v.apply ? { apply: v.apply } : {}), ...(v.skipped ? { skipped: v.skipped } : {}) }, CONFIG, T0 + 2000));
}

const subs = (db: MemoryDb) => db.rows("commerceSubscriptions");
const history = (db: MemoryDb) => db.rows("commerceSubscriptionHistory");
const access = (db: MemoryDb, userId: string, now = T0 + 2000) => computeEntitlements({
  ownership: [], legacyPremium: false, pairedDevices: 0,
  subscriptions: subs(db).filter((s) => s.userId === userId).map((s) => toSubscriptionRecord(s as never)),
}, strict, now, { allowSandbox: true }).subscriptionActive;

// ─── Idempotency ─────────────────────────────────────────────────────────────

test("the same transaction submitted twice → one subscription, one history entry", async () => {
  const db = new MemoryDb();
  const first = await appSubmits(db, ALICE, aliceToken);
  assert.equal(first.written?.result, "created");
  const again = await appSubmits(db, ALICE, aliceToken, apiNow({}, {}, 1, T0 + 1600));
  assert.equal(again.written?.result, "unchanged");
  assert.equal(subs(db).length, 1);
  assert.equal(history(db).length, 1);
  assert.equal(subs(db)[0].lastVerifiedAt, T0 + 2000);
  assert.equal(db.rows("commerceEvents").filter((e) => e.name === "subscription_activated").length, 1, "activation recorded once");
});

test("the same notification delivered twice → the second is recognised and changes nothing", async () => {
  const db = new MemoryDb();
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  const n = notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal());
  assert.deepEqual(await appleNotifies(db, n), { outcome: "applied" });
  assert.deepEqual(await appleNotifies(db, n), { outcome: "duplicate" });
  assert.equal(subs(db).length, 1);
  assert.equal(history(db).length, 1);
  assert.equal(db.rows("commerceAppStoreNotifications").length, 1, "one row per notificationUUID");
});

test("app submission then notification, and notification then app submission → one record, no duplicate history", async () => {
  const a = new MemoryDb();
  await appSubmits(a, ALICE, aliceToken);
  const later = await appleNotifies(a, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal()));
  assert.equal(later.outcome, "unchanged", "same state Apple already confirmed");
  assert.equal(subs(a).length, 1);
  assert.equal(history(a).length, 1);

  const b = new MemoryDb();
  await b.serial(() => linkAccountToken(b as never, ALICE, aliceToken, T0));
  assert.equal((await appleNotifies(b, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal()))).outcome, "applied");
  const after = await appSubmits(b, ALICE, aliceToken, apiNow({}, {}, 1, T0 + 6000));
  assert.equal(after.written?.result, "unchanged");
  assert.equal(subs(b).length, 1);
  assert.equal(history(b).length, 1);
});

test("concurrent/repeated processing from several devices and retries → still one subscription", async () => {
  const db = new MemoryDb();
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  const n = notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal());
  await Promise.all([
    ...Array.from({ length: 5 }, () => appSubmits(db, ALICE, aliceToken)),
    ...Array.from({ length: 5 }, () => appleNotifies(db, n)),
  ]);
  assert.equal(subs(db).length, 1);
  assert.equal(history(db).length, 1);
  assert.equal(db.rows("commerceAppStoreNotifications").length, 1);
});

test("older signed data arriving late never overwrites newer (retry after timeout, out-of-order delivery)", async () => {
  const db = new MemoryDb();
  await appSubmits(db, ALICE, aliceToken, apiNow({ expiresDate: T0 - 1, purchaseDate: T0 - 30 * DAY }, { autoRenewStatus: 0 }, 2, T0 + 9000));
  assert.equal(subs(db)[0].status, "expired");
  const late = await appleNotifies(db, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal())); // signed T0+5000
  assert.equal(late.outcome, "stale");
  assert.equal(subs(db)[0].status, "expired");
});

// ─── Account ownership ───────────────────────────────────────────────────────

test("a subscription belongs to the account whose token Apple signed — no one else can take it", async () => {
  const db = new MemoryDb();
  await appSubmits(db, ALICE, aliceToken);
  const bob = await appSubmits(db, BOB, bobToken);
  assert.equal(bob.verified.ok, false, "Bob's token doesn't match Alice's purchase");
  // Even a trusted caller can't move it: the store refuses a different user…
  const update = (await verifyAppSubmission({ verifier, statuses: apiNow(), now: T0 + 2000 },
    { signedTransaction: signJws(tx(), apple), expected: { ...expected, expectedAccountToken: aliceToken } }));
  assert.ok(update.ok);
  await assert.rejects(writeVerifiedSubscription(db as never, { userId: BOB, update: update.update, event: "verified_with_apple", source: { kind: "app_submission" } }, CONFIG, T0),
    /another account/);
  // …or a different token for the same subscription.
  const rebound: VerifiedSubscriptionUpdate = { ...update.update, appAccountToken: bobToken, signedDate: T0 + 99_000 };
  await assert.rejects(writeVerifiedSubscription(db as never, { userId: ALICE, update: rebound, event: "verified_with_apple", source: { kind: "app_submission" } }, CONFIG, T0),
    /another account/);
  assert.equal(subs(db)[0].userId, ALICE);
  assert.equal(subs(db)[0].appAccountToken, aliceToken);
});

test("reinstall and a second device: same account, same token → the same subscription, nothing new to buy", async () => {
  const db = new MemoryDb();
  await appSubmits(db, ALICE, aliceToken);
  const reinstall = await appSubmits(db, ALICE, (await appAccountTokenFor("user_alice"))!, apiNow({}, {}, 1, T0 + 1700));
  const secondDevice = await appSubmits(db, ALICE, (await appAccountTokenFor("user_alice"))!, apiNow({}, {}, 1, T0 + 1800));
  assert.equal(reinstall.written?.result, "unchanged");
  assert.equal(secondDevice.written?.result, "unchanged");
  assert.equal(subs(db).length, 1);
  assert.equal(access(db, ALICE), true);
});

test("same Apple ID, different Sombrey account: the purchase stays with the account that bought it", async () => {
  const db = new MemoryDb();
  await appSubmits(db, ALICE, aliceToken);
  // Bob signs into Sombrey on the phone whose Apple ID bought Alice's membership, and restores.
  const restore = await appSubmits(db, BOB, bobToken);
  assert.ok(!restore.verified.ok && restore.verified.reason === "wrong_account");
  assert.equal(access(db, BOB), false);
  assert.equal(access(db, ALICE), true);
});

test("notifications are matched through the verified token; unknown tokens are kept, not guessed", async () => {
  const db = new MemoryDb();
  const early = await appleNotifies(db, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal()));
  assert.equal(early.outcome, "unmatched", "no account has linked this token yet");
  assert.equal(subs(db).length, 0);
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  assert.equal((await appleNotifies(db, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal()))).outcome, "applied");
  assert.equal(subs(db)[0].userId, ALICE);
  // A token can't be linked to two accounts.
  await assert.rejects(linkAccountToken(db as never, BOB, aliceToken, T0), /conflict/);
});

test("per-account submission budget (each submission is an Apple API request)", async () => {
  const db = new MemoryDb();
  for (let i = 0; i < SUBMISSIONS_PER_HOUR; i++) assert.equal((await linkAccountToken(db as never, ALICE, aliceToken, T0, { countSubmission: true })).allowed, true);
  assert.equal((await linkAccountToken(db as never, ALICE, aliceToken, T0 + 1, { countSubmission: true })).allowed, false);
  assert.equal((await linkAccountToken(db as never, ALICE, aliceToken, T0 + 3_600_000, { countSubmission: true })).allowed, true, "a new hour");
  assert.equal(db.rows("commerceAppAccountTokens").length, 1);
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

test("lifecycle: purchase → renewal → cancellation → expiry, with auditable history", async () => {
  const db = new MemoryDb();
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  const at = (signedDate: number) => ({ signedDate });
  const steps: Array<[string, string | undefined, object, object, number, string, boolean]> = [
    ["SUBSCRIBED", "INITIAL_BUY", tx(), renewal(), T0 + 5000, "active", true],
    ["DID_RENEW", undefined, tx({ transactionId: "2000000000000002", purchaseDate: T0 + DAY, expiresDate: T0 + 60 * DAY }), renewal(), T0 + 6000, "active", true],
    ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", tx({ transactionId: "2000000000000002", purchaseDate: T0 + DAY, expiresDate: T0 + 60 * DAY }), renewal({ autoRenewStatus: 0 }), T0 + 7000, "active", true],
    ["EXPIRED", "VOLUNTARY", tx({ transactionId: "2000000000000002", purchaseDate: T0 - 60 * DAY, expiresDate: T0 - 1 }), renewal({ autoRenewStatus: 0 }), T0 + 8000, "expired", false],
  ];
  for (const [type, subtype, t, r, signedDate, status, hasAccess] of steps) {
    assert.equal((await appleNotifies(db, notification(apple, type, subtype, t, r, at(signedDate)))).outcome, "applied", type);
    assert.equal(subs(db)[0].status, status, type);
    assert.equal(access(db, ALICE), hasAccess, `${type} access`);
  }
  assert.deepEqual(history(db).map((h) => h.event), ["purchased", "renewed", "auto_renew_disabled", "expired"]);
  assert.deepEqual(history(db).map((h) => h.status), ["active", "active", "active", "expired"]);
  assert.equal(history(db)[1].latestTransactionId, "2000000000000002");
  assert.equal(history(db)[2].autoRenewEnabled, false);
  assert.ok(history(db).every((h) => h.source === "server_notification" && typeof h.notificationUUID === "string"));
  assert.deepEqual(db.rows("commerceEvents").map((e) => e.name), ["subscription_activated", "subscription_renewed", "subscription_cancelled", "subscription_expired"]);
  assert.equal(subs(db).length, 1, "one current record; the past lives in history");
});

test("lifecycle: grace period keeps access until it ends; billing retry doesn't; recovery restores it", async () => {
  const db = new MemoryDb();
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  const lapsed = tx({ purchaseDate: T0 - 30 * DAY, expiresDate: T0 - 1 });
  await appleNotifies(db, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal(), { signedDate: T0 + 5000 }));
  await appleNotifies(db, notification(apple, "DID_FAIL_TO_RENEW", "GRACE_PERIOD", lapsed, renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: T0 + 6 * DAY }), { signedDate: T0 + 6000 }));
  assert.equal(subs(db)[0].status, "in_grace_period");
  assert.equal(access(db, ALICE), true, "Apple's grace period: access continues");
  assert.equal(access(db, ALICE, T0 + 7 * DAY), false, "…until the grace period ends");
  await appleNotifies(db, notification(apple, "GRACE_PERIOD_EXPIRED", undefined, lapsed, renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: T0 - 1 }), { signedDate: T0 + 7000 }));
  assert.equal(subs(db)[0].status, "in_billing_retry");
  assert.equal(access(db, ALICE), false);
  await appleNotifies(db, notification(apple, "DID_RENEW", "BILLING_RECOVERY", tx({ transactionId: "2000000000000003", expiresDate: T0 + 30 * DAY }), renewal(), { signedDate: T0 + 8000 }));
  assert.equal(subs(db)[0].status, "active");
  assert.equal(access(db, ALICE), true);
  assert.deepEqual(history(db).map((h) => h.event), ["purchased", "grace_period", "grace_period_expired", "billing_recovered"]);
});

test("lifecycle: refund and revocation end access immediately; a refund reversal is Apple's to announce", async () => {
  const db = new MemoryDb();
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  await appleNotifies(db, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal(), { signedDate: T0 + 5000 }));
  await appleNotifies(db, notification(apple, "REFUND", undefined, tx({ revocationDate: T0 + 5500, revocationReason: 0 }), renewal(), { signedDate: T0 + 6000 }));
  assert.equal(subs(db)[0].status, "refunded");
  assert.equal(access(db, ALICE), false);
  // The app replays the (still validly signed) pre-refund transaction: Apple's server says refunded.
  const replay = await appSubmits(db, ALICE, aliceToken, apiNow({ revocationDate: T0 + 5500, revocationReason: 0 }, {}, 5, T0 + 9000), tx());
  assert.equal(replay.written?.result, "unchanged");
  assert.equal(access(db, ALICE), false, "an old JWS can't revive a refunded subscription");
  await appleNotifies(db, notification(apple, "REFUND_REVERSED", undefined, tx(), renewal(), { signedDate: T0 + 10_000 }));
  assert.equal(subs(db)[0].status, "active");
  assert.equal(subs(db)[0].revocationDate, undefined, "the reversal clears the revocation");
  assert.equal(access(db, ALICE), true);
  const db2 = new MemoryDb();
  await db2.serial(() => linkAccountToken(db2 as never, ALICE, aliceToken, T0));
  await appleNotifies(db2, notification(apple, "REVOKE", undefined, tx({ revocationDate: T0 + 5500 }), renewal()));
  assert.equal(subs(db2)[0].status, "revoked");
  assert.equal(access(db2, ALICE), false);
});

test("history is append-only: earlier rows are never rewritten", async () => {
  const db = new MemoryDb();
  await db.serial(() => linkAccountToken(db as never, ALICE, aliceToken, T0));
  await appleNotifies(db, notification(apple, "SUBSCRIBED", "INITIAL_BUY", tx(), renewal(), { signedDate: T0 + 5000 }));
  const snapshot = structuredClone(history(db)[0]);
  await appleNotifies(db, notification(apple, "DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", tx(), renewal({ autoRenewStatus: 0 }), { signedDate: T0 + 6000 }));
  assert.deepEqual(history(db)[0], snapshot);
  assert.equal(history(db).length, 2);
});

test("sandbox subscriptions grant access only where the deployment allows it", async () => {
  const db = new MemoryDb();
  await appSubmits(db, ALICE, aliceToken);
  const records = subs(db).map((s) => toSubscriptionRecord(s as never));
  const input = { ownership: [], legacyPremium: false, pairedDevices: 0, subscriptions: records };
  assert.equal(computeEntitlements(input, strict, T0 + 2000).subscriptionActive, false, "default: sandbox never grants access");
  assert.equal(computeEntitlements(input, strict, T0 + 2000, { allowSandbox: true }).subscriptionActive, true);
});
