// Sombrey commerce — Phase 6A: the App Store subscription domain (pure rules).
//
// The source of truth is VERIFIED Apple data — a StoreKit 2 signed transaction
// or an App Store Server Notification, verified on the server (Phase 6B).
// Nothing here can make a subscription active from a client-supplied flag:
// `applyVerifiedUpdate` only accepts updates whose verification method is a
// trusted server-side one, and the stored record is only written by internal
// functions. No Apple values are invented; there are no fixtures in production.
//
// Pure — tested in tests/commerce/subscriptions.test.ts.

export type SubscriptionStatus =
  | "active"
  | "in_grace_period"      // billing problem, Apple still grants access
  | "in_billing_retry"     // billing problem, no access
  | "expired"
  | "revoked"              // family sharing removed / refunded by Apple
  | "refunded";

export type AppStoreEnvironment = "production" | "sandbox";

/** How an update was verified. Only these are trusted. */
export const TRUSTED_VERIFICATION = ["app_store_server_api", "app_store_server_notification", "storekit2_jws_verified_server_side"] as const;
export type VerificationMethod = (typeof TRUSTED_VERIFICATION)[number];

export type VerifiedSubscriptionUpdate = {
  provider: "app_store";
  environment: AppStoreEnvironment;
  appStoreProductId: string;
  originalTransactionId: string;
  latestTransactionId: string;
  status: SubscriptionStatus;
  autoRenewEnabled: boolean;
  purchaseDate: number;
  expiresDate: number | null;
  /** When Apple signed the data — later signed data wins; stale data is ignored. */
  signedDate: number;
  revocationDate?: number;
  verification: { method: string; verifiedAt: number };
};

export type SubscriptionRecord = Omit<VerifiedSubscriptionUpdate, "verification"> & { lastVerifiedAt: number; verificationMethod: VerificationMethod };

const ID = /^[0-9]{1,30}$/;

export function validateVerifiedUpdate(u: VerifiedSubscriptionUpdate, expectedProductIds: string[]): string | null {
  if (u.provider !== "app_store") return "Unknown provider";
  if (!(TRUSTED_VERIFICATION as readonly string[]).includes(u.verification?.method)) return "Unverified subscription data is never accepted";
  if (u.environment !== "production" && u.environment !== "sandbox") return "Unknown environment";
  if (!expectedProductIds.includes(u.appStoreProductId)) return "Unknown App Store product";
  if (!ID.test(u.originalTransactionId) || !ID.test(u.latestTransactionId)) return "Invalid transaction id";
  for (const n of [u.purchaseDate, u.signedDate, u.verification.verifiedAt]) if (!Number.isFinite(n) || n <= 0) return "Invalid date";
  if (u.expiresDate !== null && (!Number.isFinite(u.expiresDate) || u.expiresDate < u.purchaseDate)) return "Invalid expiry";
  return null;
}

/** The record after a verified update: out-of-order (older signed) data never
 * overwrites newer; a different original transaction is a different record. */
export function applyVerifiedUpdate(existing: SubscriptionRecord | null, u: VerifiedSubscriptionUpdate):
  { changed: boolean; record: SubscriptionRecord } {
  if (existing && existing.originalTransactionId !== u.originalTransactionId) throw new Error("Different subscription");
  if (existing && u.signedDate < existing.signedDate) return { changed: false, record: existing };
  const { verification, ...rest } = u;
  return { changed: true, record: { ...rest, lastVerifiedAt: verification.verifiedAt, verificationMethod: verification.method as VerificationMethod } };
}

/** Does this record grant subscriber access right now? Production data only
 * (sandbox purchases never grant access in production); active or in Apple's
 * grace period, and not past its expiry. */
export function grantsAccess(r: SubscriptionRecord, now: number, allowSandbox = false): boolean {
  if (r.environment === "sandbox" && !allowSandbox) return false;
  if (r.status !== "active" && r.status !== "in_grace_period") return false;
  if (r.expiresDate !== null && r.expiresDate <= now) return false;
  return true;
}
