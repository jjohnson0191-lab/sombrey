// Sombrey commerce — Phase 6C: rules applied to Apple data AFTER its signature
// has been verified (convex/commerce/appStoreVerifier.ts does the cryptography).
//
//   checkTransaction      bundle id, environment, product, type, ids, dates and the
//                         account binding (appAccountToken) of a verified transaction
//   deriveStatus          Sombrey's subscription status from Apple's own fields
//   buildVerifiedUpdate   → the 6A VerifiedSubscriptionUpdate (subscriptionState.ts)
//   classifyNotification  which App Store Server Notifications change membership
//
// Every value that reaches a subscription record comes from Apple's signed
// payloads: never a client price, expiry, status, product name or account id.
//
// Pure — no Convex imports — tested in tests/commerce/appStore*.test.ts.

import type { AppleEnvironment } from "./appStoreConfig.ts";
import { normalizeAccountToken } from "./accountToken.ts";
import type { SubscriptionStatus, VerificationMethod, VerifiedSubscriptionUpdate } from "./subscriptionState.ts";

/** The fields Sombrey reads from a verified JWSTransaction. */
export type AppleTransaction = {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  type?: string;
  appAccountToken?: string;
  signedDate?: number;
  revocationReason?: number;
  revocationDate?: number;
  environment?: string;
  inAppOwnershipType?: string;
};

/** The fields Sombrey reads from a verified JWSRenewalInfo. */
export type AppleRenewalInfo = {
  originalTransactionId?: string;
  autoRenewStatus?: number;          // 1 = on, 0 = off
  isInBillingRetryPeriod?: boolean;
  gracePeriodExpiresDate?: number;
  signedDate?: number;
  environment?: string;
};

/** Why a verified transaction was refused. Internal — never shown to a user. */
export type RejectReason =
  | "malformed" | "wrong_bundle" | "wrong_environment" | "wrong_product" | "not_subscription"
  | "family_shared" | "missing_account_token" | "wrong_account" | "mismatched_renewal_info" | "missing_renewal_info";

export type Expectations = {
  bundleId: string;
  productIds: string[];
  environments: AppleEnvironment[];
  /** The token derived from the authenticated user (app submissions), or null
   * when the owner is resolved from the token itself (notifications). */
  expectedAccountToken: string | null;
};

export type CheckedTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  environment: AppleEnvironment;
  purchaseDate: number;
  expiresDate: number;
  appAccountToken: string;
};

const ID = /^[0-9]{1,30}$/;
const isDate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function checkTransaction(t: AppleTransaction | null | undefined, e: Expectations):
  { ok: true; tx: CheckedTransaction } | { ok: false; reason: RejectReason } {
  if (!t || typeof t !== "object") return { ok: false, reason: "malformed" };
  if (typeof t.transactionId !== "string" || !ID.test(t.transactionId) || typeof t.originalTransactionId !== "string" || !ID.test(t.originalTransactionId)) {
    return { ok: false, reason: "malformed" };
  }
  if (!isDate(t.purchaseDate) || !isDate(t.signedDate)) return { ok: false, reason: "malformed" };
  if (t.bundleId !== e.bundleId) return { ok: false, reason: "wrong_bundle" };
  if (!(e.environments as string[]).includes(t.environment ?? "")) return { ok: false, reason: "wrong_environment" };
  if (typeof t.productId !== "string" || !e.productIds.includes(t.productId)) return { ok: false, reason: "wrong_product" };
  if (t.type !== "Auto-Renewable Subscription" || !isDate(t.expiresDate)) return { ok: false, reason: "not_subscription" };
  // Family Sharing isn't enabled for Sombrey Membership; a shared purchase is
  // the purchaser's, not this account's.
  if (t.inAppOwnershipType !== undefined && t.inAppOwnershipType !== "PURCHASED") return { ok: false, reason: "family_shared" };
  const token = normalizeAccountToken(t.appAccountToken);
  if (!token) return { ok: false, reason: "missing_account_token" };
  if (e.expectedAccountToken !== null && token !== e.expectedAccountToken) return { ok: false, reason: "wrong_account" };
  return {
    ok: true,
    tx: {
      transactionId: t.transactionId, originalTransactionId: t.originalTransactionId, productId: t.productId,
      environment: t.environment as AppleEnvironment, purchaseDate: t.purchaseDate, expiresDate: t.expiresDate, appAccountToken: token,
    },
  };
}

/** Renewal info must describe the same subscription, in the same environment. */
export function checkRenewalInfo(r: AppleRenewalInfo | null | undefined, tx: CheckedTransaction): RejectReason | null {
  if (!r || typeof r !== "object") return "missing_renewal_info";
  if (r.originalTransactionId !== tx.originalTransactionId || r.environment !== tx.environment) return "mismatched_renewal_info";
  if (r.autoRenewStatus !== 0 && r.autoRenewStatus !== 1) return "missing_renewal_info";
  return null;
}

/** App Store Server API subscription status codes (Get All Subscription Statuses). */
export const API_STATUS = { active: 1, expired: 2, billingRetry: 3, gracePeriod: 4, revoked: 5 } as const;

/** Sombrey's status, from Apple's fields only. `apiStatus` (Server API) and
 * `notificationType` (REFUND vs REVOKE) are Apple's own words when present. */
export function deriveStatus(t: AppleTransaction, r: AppleRenewalInfo, now: number,
  apple: { apiStatus?: number; notificationType?: string } = {}): SubscriptionStatus {
  const refunded = apple.notificationType === "REFUND" || (apple.notificationType !== "REVOKE" && t.revocationReason !== undefined);
  if (t.revocationDate !== undefined || apple.apiStatus === API_STATUS.revoked) return refunded ? "refunded" : "revoked";
  const inGrace = r.gracePeriodExpiresDate !== undefined && r.gracePeriodExpiresDate > now;
  if (apple.apiStatus === API_STATUS.gracePeriod) return inGrace ? "in_grace_period" : "in_billing_retry";
  if (apple.apiStatus === API_STATUS.billingRetry) return "in_billing_retry";
  if (apple.apiStatus === API_STATUS.expired) return "expired";
  if (apple.apiStatus === API_STATUS.active) return "active";
  // Notifications: no summary status, so read the transaction and renewal info.
  if (r.isInBillingRetryPeriod) return inGrace ? "in_grace_period" : "in_billing_retry";
  if (t.expiresDate !== undefined && t.expiresDate > now) return "active";
  return "expired";
}

/** The 6A update, built only from verified Apple values. */
export function buildVerifiedUpdate(t: AppleTransaction, tx: CheckedTransaction, r: AppleRenewalInfo, status: SubscriptionStatus,
  signedDate: number, method: VerificationMethod, verifiedAt: number): VerifiedSubscriptionUpdate {
  return {
    provider: "app_store",
    environment: tx.environment === "Production" ? "production" : "sandbox",
    appStoreProductId: tx.productId,
    originalTransactionId: tx.originalTransactionId,
    latestTransactionId: tx.transactionId,
    status,
    autoRenewEnabled: r.autoRenewStatus === 1,
    purchaseDate: tx.purchaseDate,
    expiresDate: tx.expiresDate,
    signedDate,
    ...(t.revocationDate !== undefined ? { revocationDate: t.revocationDate } : {}),
    ...(status === "in_grace_period" && r.gracePeriodExpiresDate !== undefined ? { gracePeriodExpiresDate: r.gracePeriodExpiresDate } : {}),
    appAccountToken: tx.appAccountToken,
    verification: { method, verifiedAt },
  };
}

// ─── History events ──────────────────────────────────────────────────────────
// What a history row says happened. Notification events are Apple's own words
// (type/subtype); an app submission only says Sombrey verified the state with
// Apple — it never claims a renewal or cancellation Apple didn't announce.

export const HISTORY_EVENTS = [
  "purchased", "resubscribed", "renewed", "billing_recovered", "auto_renew_enabled", "auto_renew_disabled",
  "renewal_preference_changed", "billing_retry", "grace_period", "grace_period_expired", "expired",
  "refunded", "refund_reversed", "revoked", "renewal_extended", "offer_redeemed", "verified_with_apple",
] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

/** Notifications that can change Sombrey membership → their history event. */
const APPLIED: Record<string, (subtype?: string) => HistoryEvent> = {
  SUBSCRIBED: (s) => (s === "RESUBSCRIBE" ? "resubscribed" : "purchased"),
  DID_RENEW: (s) => (s === "BILLING_RECOVERY" ? "billing_recovered" : "renewed"),
  DID_CHANGE_RENEWAL_STATUS: (s) => (s === "AUTO_RENEW_ENABLED" ? "auto_renew_enabled" : "auto_renew_disabled"),
  DID_CHANGE_RENEWAL_PREF: () => "renewal_preference_changed",
  DID_FAIL_TO_RENEW: (s) => (s === "GRACE_PERIOD" ? "grace_period" : "billing_retry"),
  GRACE_PERIOD_EXPIRED: () => "grace_period_expired",
  EXPIRED: () => "expired",
  REFUND: () => "refunded",
  REFUND_REVERSED: () => "refund_reversed",
  REVOKE: () => "revoked",
  RENEWAL_EXTENDED: () => "renewal_extended",
  OFFER_REDEEMED: () => "offer_redeemed",
};

/** Recorded (so duplicates stay harmless) but change nothing in Sombrey's
 * current membership model — docs/COMMERCE_6C.md §8. */
export const INFORMATIONAL_NOTIFICATIONS = [
  "TEST", "PRICE_INCREASE", "PRICE_CHANGE", "REFUND_DECLINED", "CONSUMPTION_REQUEST", "RENEWAL_EXTENSION",
  "METADATA_UPDATE", "MIGRATION", "EXTERNAL_PURCHASE_TOKEN", "ONE_TIME_CHARGE", "RESCIND_CONSENT",
] as const;

export function classifyNotification(type: string, subtype?: string): { action: "apply"; event: HistoryEvent } | { action: "ignore" } {
  const f = APPLIED[type];
  if (!f) return { action: "ignore" };
  // EXPIRED/PRODUCT_NOT_FOR_SALE etc. still expire; SUBSCRIBED without a subtype is still a subscription.
  return { action: "apply", event: f(subtype) };
}

/** The server-side commerce event (6A catalogue) a history event implies. */
export function commerceEventFor(e: HistoryEvent, isNew: boolean, status: SubscriptionStatus):
  "subscription_activated" | "subscription_renewed" | "subscription_cancelled" | "subscription_expired" | null {
  if (e === "purchased" || e === "resubscribed") return "subscription_activated";
  if (e === "renewed" || e === "billing_recovered") return "subscription_renewed";
  if (e === "auto_renew_disabled") return "subscription_cancelled";
  if (e === "expired") return "subscription_expired";
  if (e === "verified_with_apple" && isNew && status === "active") return "subscription_activated";
  return null;
}
