// Sombrey commerce, Phase 6A — App Store subscriptions (convex/commerce/subscriptionState.ts).
// SYNTHETIC values only — no real Apple transaction data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVerifiedUpdate, grantsAccess, validateVerifiedUpdate, type VerifiedSubscriptionUpdate } from "../../convex/commerce/subscriptionState.ts";

const NOW = Date.UTC(2026, 9, 1);
const DAY = 86_400_000;
const u = (over: Partial<VerifiedSubscriptionUpdate> = {}): VerifiedSubscriptionUpdate => ({
  provider: "app_store", environment: "production", appStoreProductId: "test.product", originalTransactionId: "1000000000000001", latestTransactionId: "1000000000000001",
  status: "active", autoRenewEnabled: true, purchaseDate: NOW - DAY, expiresDate: NOW + 29 * DAY, signedDate: NOW - DAY,
  verification: { method: "app_store_server_api", verifiedAt: NOW - DAY }, ...over,
});

test("only verified server-side data is accepted — never a client flag", () => {
  assert.equal(validateVerifiedUpdate(u(), ["test.product"]), null);
  for (const method of ["client", "user_claim", "storekit2_client_unverified", ""]) {
    assert.match(validateVerifiedUpdate(u({ verification: { method, verifiedAt: NOW } }), ["test.product"])!, /Unverified/);
  }
  assert.match(validateVerifiedUpdate(u(), [])!, /Unknown App Store product/, "no product configured yet → nothing can be accepted");
  assert.match(validateVerifiedUpdate(u({ originalTransactionId: "abc" }), ["test.product"])!, /transaction id/);
  assert.match(validateVerifiedUpdate(u({ expiresDate: NOW - 2 * DAY }), ["test.product"])!, /expiry/);
});

test("access: active or grace period, not expired, production only", () => {
  const r = applyVerifiedUpdate(null, u()).record;
  assert.equal(grantsAccess(r, NOW), true);
  assert.equal(grantsAccess({ ...r, status: "in_grace_period" }, NOW), true);
  for (const status of ["in_billing_retry", "expired", "revoked", "refunded"] as const) assert.equal(grantsAccess({ ...r, status }, NOW), false, status);
  assert.equal(grantsAccess(r, NOW + 30 * DAY), false, "past its expiry");
  assert.equal(grantsAccess({ ...r, environment: "sandbox" }, NOW), false, "sandbox never grants access in production");
  assert.equal(grantsAccess({ ...r, environment: "sandbox" }, NOW, true), true);
});

test("history: newer signed data wins; stale data never overwrites", () => {
  const first = applyVerifiedUpdate(null, u()).record;
  const renewed = applyVerifiedUpdate(first, u({ latestTransactionId: "1000000000000002", signedDate: NOW, expiresDate: NOW + 60 * DAY }));
  assert.ok(renewed.changed && renewed.record.latestTransactionId === "1000000000000002");
  const stale = applyVerifiedUpdate(renewed.record, u({ status: "expired", signedDate: NOW - 5 * DAY }));
  assert.equal(stale.changed, false);
  assert.equal(stale.record.status, "active");
  assert.throws(() => applyVerifiedUpdate(first, u({ originalTransactionId: "2000000000000001" })), /Different subscription/);
});
