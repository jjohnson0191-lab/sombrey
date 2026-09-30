// Sombrey commerce, Phase 6C — attacks on the App Store subscription flow.
// Each test is an attempt by a malicious client (or a forger posing as Apple)
// that must fail. They FAIL if any client-controlled value can grant access.
// SYNTHETIC data and throwaway certificates (appStoreHarness.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appAccountTokenFor } from "../../convex/commerce/accountToken.ts";
import { verifyAppSubmission, verifyNotification } from "../../convex/commerce/appStoreFlow.ts";
import { applyNotification, linkAccountToken, writeVerifiedSubscription, type StoreConfig } from "../../convex/commerce/subscriptionStore.ts";
import { BUNDLE, DAY, MemoryDb, PRODUCT, T0, makeChain, notification, renewal, signJws, statusSource, tamper, transaction, verifierFor } from "./appStoreHarness.ts";

const CONVEX = join(import.meta.dirname, "../../convex");
const read = (p: string) => readFileSync(join(CONVEX, p), "utf8");
const apple = makeChain("Apple-stand-in");
const attacker = makeChain("Attacker");
const verifier = verifierFor(apple);
const aliceToken = (await appAccountTokenFor("user_alice"))!;
const malloryToken = (await appAccountTokenFor("user_mallory"))!;
const MALLORY = "users:mallory" as never, ALICE = "users:alice" as never;
const CONFIG: StoreConfig = { membershipProductId: "sombrey_membership_monthly", appStoreProductIds: [PRODUCT], configVersion: "test" };
const expected = { bundleId: BUNDLE, productIds: [PRODUCT], environments: ["Sandbox" as const] };
const NOW = T0 + 2000;

/** Apple's truth for Mallory's own (expired, auto-renew off) subscription. */
const malloryExpired = () => statusSource(() => [{
  status: 2, originalTransactionId: "2000000000000001",
  signedTransactionInfo: signJws(transaction({ appAccountToken: malloryToken, purchaseDate: T0 - 31 * DAY, expiresDate: T0 - DAY, signedDate: T0 + 1500 }), apple),
  signedRenewalInfo: signJws(renewal({ autoRenewStatus: 0, signedDate: T0 + 1500 }), apple),
}]);
const submitAsMallory = (jws: string, statuses = malloryExpired()) =>
  verifyAppSubmission({ verifier, statuses, now: NOW }, { signedTransaction: jws, expected: { ...expected, expectedAccountToken: malloryToken } });

// ─── The client's only input is a signed string ──────────────────────────────

test("submitTransaction accepts only Apple's signed transaction; the account comes from the auth token", () => {
  const src = read("commerce/appStore.ts");
  const submit = src.slice(src.indexOf("export const submitTransaction"), src.indexOf("export const processNotification"));
  assert.match(submit, /args: \{ signedTransaction: v\.string\(\) \}/, "no price, expiry, status, product, active flag or account id argument");
  assert.match(submit, /appAccountTokenFor\(identity\.subject\)/, "the expected token is derived from the authenticated user");
  assert.deepEqual([...submit.matchAll(/args\.(\w+)/g)].map((m) => m[1]), ["signedTransaction"]);
  assert.match(submit, /internal\.commerce\.helpers\.getCurrentUserInternal/, "the user row comes from the identity, not an argument");
  const exported = [...src.matchAll(/export const (\w+) = (\w+)\(/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(exported, ["submitTransaction:action", "processNotification:internalAction"], "the notification processor is internal");
});

test("the notification endpoint passes only the signed payload to an internal action", () => {
  const http = read("http.ts");
  const route = http.slice(http.indexOf('path: "/apple/app-store-notifications"'));
  assert.match(route, /ctx\.runAction\(internal\.commerce\.appStore\.processNotification, \{ signedPayload \}\)/);
  assert.ok(!/runMutation/.test(route), "the route itself writes nothing");
});

// ─── Attacks ─────────────────────────────────────────────────────────────────

test("attack: mark itself subscribed / forge an active state with a self-signed transaction", async () => {
  const forged = signJws(transaction({ appAccountToken: malloryToken, expiresDate: T0 + 3650 * DAY, price: 0 }), attacker);
  const r = await submitAsMallory(forged);
  assert.ok(!r.ok && r.kind === "rejected" && r.reason === "invalid_signature");
  // Even Apple's real chain in the header doesn't help without Apple's key.
  const borrowed = signJws(transaction({ appAccountToken: malloryToken }), attacker, { x5c: [apple.leaf, apple.intermediate, apple.root] });
  const r2 = await submitAsMallory(borrowed);
  assert.ok(!r2.ok && r2.kind === "rejected");
});

test("attack: alter price, extend expiry, change product, forge status — by editing a genuine transaction", async () => {
  const genuine = signJws(transaction({ appAccountToken: malloryToken }), apple);
  for (const edit of [
    { price: 1 }, { expiresDate: T0 + 3650 * DAY }, { productId: "com.sombrey.lifetime" }, { type: "Non-Consumable" },
    { environment: "Production" }, { appAccountToken: aliceToken }, { originalTransactionId: "1000000000000001" },
  ]) {
    const r = await submitAsMallory(tamper(genuine, { ...transaction({ appAccountToken: malloryToken }), ...edit }));
    assert.ok(!r.ok && r.kind === "rejected", JSON.stringify(edit));
  }
});

test("no client-controlled value reaches the record: whatever the app's JWS says, the state is Apple's", async () => {
  // Worst case: every variant below is GENUINELY signed (e.g. an older, real
  // transaction the attacker kept). The recorded update must still be exactly
  // Apple's current state.
  const variants = [
    {}, { expiresDate: T0 + 3650 * DAY }, { purchaseDate: T0 + 10 * DAY }, { price: 1, currency: "XXX" },
    { transactionId: "2000000000000099" }, { signedDate: T0 + 999_999 }, { transactionReason: "RENEWAL" },
  ];
  const updates = [];
  for (const v of variants) {
    const r = await submitAsMallory(signJws(transaction({ appAccountToken: malloryToken, ...v }), apple));
    assert.ok(r.ok, JSON.stringify(v));
    updates.push(r.update);
  }
  for (const u of updates) assert.deepEqual(u, updates[0]);
  assert.equal(updates[0].status, "expired", "Apple says expired → expired, whatever the phone sent");
  assert.equal(updates[0].expiresDate, T0 - DAY);
  assert.equal(updates[0].autoRenewEnabled, false);
});

test("attack: submit another user's transaction / attach an Apple purchase to the wrong Sombrey account", async () => {
  const alicesPurchase = signJws(transaction({ appAccountToken: aliceToken }), apple);
  const r = await submitAsMallory(alicesPurchase, statusSource(() => [{
    status: 1, originalTransactionId: "2000000000000001",
    signedTransactionInfo: signJws(transaction({ appAccountToken: aliceToken }), apple), signedRenewalInfo: signJws(renewal(), apple),
  }]));
  assert.ok(!r.ok && r.reason === "wrong_account");
  // …and the Apple server isn't even asked.
  const statuses = statusSource(() => []);
  await submitAsMallory(alicesPurchase, statuses);
  assert.equal(statuses.calls, 0);
  // A purchase with no token (e.g. bought outside the app) can't be claimed either.
  const tokenless = await submitAsMallory(signJws(transaction(), apple));
  assert.ok(!tokenless.ok && tokenless.reason === "missing_account_token");
});

test("attack: bypass the account-token check with casing, whitespace or a look-alike token", async () => {
  for (const t of [aliceToken.toUpperCase(), ` ${aliceToken}`, aliceToken.replace(/.$/, "0"), "00000000-0000-0000-0000-000000000000", ""]) {
    const r = await submitAsMallory(signJws(transaction({ appAccountToken: t }), apple));
    assert.ok(!r.ok && r.kind === "rejected", t);
  }
});

test("attack: replay a transaction to create duplicate records or revive a lapsed subscription", async () => {
  const db = new MemoryDb();
  const old = signJws(transaction({ appAccountToken: malloryToken }), apple); // genuinely signed, from when it was active
  for (let i = 0; i < 20; i++) {
    const r = await submitAsMallory(old);
    assert.ok(r.ok);
    await db.serial(() => writeVerifiedSubscription(db as never, { userId: MALLORY, update: r.update, event: "verified_with_apple", source: { kind: "app_submission" } }, CONFIG, NOW));
  }
  assert.equal(db.rows("commerceSubscriptions").length, 1);
  assert.equal(db.rows("commerceSubscriptionHistory").length, 1);
  assert.equal(db.rows("commerceSubscriptions")[0].status, "expired");
});

test("attack: forge an Apple notification (renewal, cancellation, reactivation) or replay a real one", async () => {
  const db = new MemoryDb();
  await linkAccountToken(db as never, MALLORY, malloryToken, T0);
  const mtx = transaction({ appAccountToken: malloryToken, expiresDate: T0 + 3650 * DAY });
  for (const [type, subtype] of [["DID_RENEW", undefined], ["SUBSCRIBED", "RESUBSCRIBE"], ["REFUND_REVERSED", undefined], ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED"]] as const) {
    const forged = notification(attacker, type, subtype, mtx, renewal());
    const v = await verifyNotification({ verifier, now: NOW }, { signedPayload: forged, expected });
    assert.ok(!v.ok && v.kind === "forged", type);
  }
  // A genuine Apple envelope wrapping an attacker-signed transaction.
  const wrapped = signJws({
    notificationType: "DID_RENEW", notificationUUID: "44444444-4444-4444-8444-444444444444", signedDate: T0 + 9000,
    data: { appAppleId: 1234567890, bundleId: BUNDLE, environment: "Sandbox", signedTransactionInfo: signJws(mtx, attacker), signedRenewalInfo: signJws(renewal(), apple) },
  }, apple);
  const w = await verifyNotification({ verifier, now: NOW }, { signedPayload: wrapped, expected });
  assert.ok(w.ok && !w.apply && w.skipped?.outcome === "rejected");
  // Replaying a genuine notification changes nothing the second time.
  const real = notification(apple, "SUBSCRIBED", "INITIAL_BUY", transaction({ appAccountToken: malloryToken }), renewal());
  const v = await verifyNotification({ verifier, now: NOW }, { signedPayload: real, expected });
  assert.ok(v.ok && v.apply);
  const args = { notification: v.notification, apply: v.apply };
  assert.equal((await applyNotification(db as never, args, CONFIG, NOW)).outcome, "applied");
  for (let i = 0; i < 5; i++) assert.equal((await applyNotification(db as never, args, CONFIG, NOW)).outcome, "duplicate");
  assert.equal(db.rows("commerceSubscriptionHistory").length, 1);
});

test("attack: a genuine notification for someone else's subscription can't be steered to the attacker", async () => {
  const db = new MemoryDb();
  await linkAccountToken(db as never, ALICE, aliceToken, T0);
  await linkAccountToken(db as never, MALLORY, malloryToken, T0);
  const v = await verifyNotification({ verifier, now: NOW }, {
    signedPayload: notification(apple, "SUBSCRIBED", "INITIAL_BUY", transaction({ appAccountToken: aliceToken }), renewal()), expected,
  });
  assert.ok(v.ok && v.apply);
  await applyNotification(db as never, { notification: v.notification, apply: v.apply }, CONFIG, NOW);
  assert.equal(db.rows("commerceSubscriptions")[0].userId, ALICE, "matched by Apple's signed token, not by anything the request says");
});

test("attack: call backend-only subscription functions", () => {
  const internal = read("commerce/internal.ts");
  for (const fn of ["applyVerifiedSubscription", "applyAppStoreNotification", "reserveAppStoreSubmission"]) {
    assert.match(internal, new RegExp(`export const ${fn} = internalMutation\\(`), `${fn} is internal — not in the client API`);
  }
  // Nothing public writes subscriptions: every public commerce function is listed and checked in security.test.ts.
  const access = read("commerce/access.ts");
  assert.ok(!/commerceSubscriptions"\)\.(insert|patch)|insert\("commerceSubscriptions/.test(access));
});

test("attack: stale or out-of-order Apple data can't roll the state back", async () => {
  const db = new MemoryDb();
  await linkAccountToken(db as never, MALLORY, malloryToken, T0);
  const refund = await verifyNotification({ verifier, now: NOW }, {
    signedPayload: notification(apple, "REFUND", undefined, transaction({ appAccountToken: malloryToken, revocationDate: T0 + 100, revocationReason: 0 }), renewal(), { signedDate: T0 + 9000 }), expected,
  });
  const olderActive = await verifyNotification({ verifier, now: NOW }, {
    signedPayload: notification(apple, "DID_RENEW", undefined, transaction({ appAccountToken: malloryToken }), renewal(), { signedDate: T0 + 8000 }), expected,
  });
  assert.ok(refund.ok && refund.apply && olderActive.ok && olderActive.apply);
  await applyNotification(db as never, { notification: refund.notification, apply: refund.apply }, CONFIG, NOW);
  assert.equal((await applyNotification(db as never, { notification: olderActive.notification, apply: olderActive.apply }, CONFIG, NOW)).outcome, "stale");
  assert.equal(db.rows("commerceSubscriptions")[0].status, "refunded");
});

test("nothing is accepted while the product isn't configured", async () => {
  const db = new MemoryDb();
  const r = await submitAsMallory(signJws(transaction({ appAccountToken: malloryToken }), apple));
  assert.ok(r.ok);
  await assert.rejects(writeVerifiedSubscription(db as never, { userId: MALLORY, update: r.update, event: "verified_with_apple", source: { kind: "app_submission" } },
    { ...CONFIG, appStoreProductIds: [] }, NOW), /Unknown App Store product/);
  assert.equal(db.rows("commerceSubscriptions").length, 0);
});

test("no signed payloads, prices or payment data are stored", async () => {
  const schema = read("schema.ts");
  const tables = ["commerceSubscriptions", "commerceSubscriptionHistory", "commerceAppStoreNotifications", "commerceAppAccountTokens"];
  for (const t of tables) {
    const body = schema.slice(schema.indexOf(`  ${t}: defineTable`), schema.indexOf("})", schema.indexOf(`  ${t}: defineTable`)));
    assert.ok(body.length > 20, t);
    assert.ok(!/signed(Payload|Transaction|Renewal)|jws|price|card|currency/i.test(body.replace(/\/\/.*$/gm, "")), `${t} stores no payloads or payment data`);
  }
  const store = read("commerce/subscriptionStore.ts");
  assert.ok(!/signedPayload|signedTransaction/.test(store));
});
