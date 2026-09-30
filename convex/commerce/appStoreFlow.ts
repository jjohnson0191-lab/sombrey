// Sombrey commerce — Phase 6C: the two server-side verification flows.
//
//   verifyAppSubmission   the app sends ONLY Apple's signed transaction (JWS).
//                         1. verify Apple's signature (bundle id, environment)
//                         2. check product, type and that Apple's appAccountToken
//                            is the one derived from the AUTHENTICATED user
//                         3. ask Apple (App Store Server API) for the current
//                            status of that subscription; verify those signed
//                            payloads and repeat the checks on them
//                         → a VerifiedSubscriptionUpdate built only from (3).
//                         The client's JWS proves WHICH subscription and WHOSE;
//                         it never decides the state, so replaying an old JWS
//                         can't revive a lapsed or refunded subscription.
//   verifyNotification    an App Store Server Notification's signedPayload:
//                         verify, identify (notificationUUID), classify, verify
//                         the transaction/renewal info inside, check them, and
//                         derive the state.
//
// Cryptography is injected (appStoreVerifier.ts in production; the same
// library with a test certificate chain in tests/commerce). No Convex imports.

import type { AppleEnvironment } from "./appStoreConfig.ts";
import {
  buildVerifiedUpdate, checkRenewalInfo, checkTransaction, classifyNotification, deriveStatus,
  type AppleRenewalInfo, type AppleTransaction, type Expectations, type HistoryEvent, type RejectReason,
} from "./appStoreRules.ts";
import type { VerifiedSubscriptionUpdate } from "./subscriptionState.ts";

export type VerifyFailure = "malformed" | "invalid_signature" | "wrong_bundle" | "wrong_environment" | "retryable" | "api_unauthorized";

export class AppleVerificationError extends Error {
  readonly reason: VerifyFailure;
  constructor(reason: VerifyFailure) {
    super(`Apple verification failed: ${reason}`);
    this.name = "AppleVerificationError";
    this.reason = reason;
  }
}

export type AppleNotification = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  signedDate?: number;
  data?: { environment?: string; bundleId?: string; signedTransactionInfo?: string; signedRenewalInfo?: string };
  summary?: { environment?: string };
};

export interface AppleVerifier {
  transaction(jws: string): Promise<AppleTransaction>;
  renewalInfo(jws: string): Promise<AppleRenewalInfo>;
  notification(jws: string): Promise<AppleNotification>;
}

export type AppleStatusItem = { status: number; originalTransactionId: string; signedTransactionInfo: string; signedRenewalInfo: string };
/** App Store Server API: every subscription status for a transaction's customer. */
export type AppleStatusSource = (env: AppleEnvironment, transactionId: string) => Promise<AppleStatusItem[] | "not_found">;

/** Signed Apple payloads are a few KB; anything far larger isn't one. */
export const MAX_SIGNED_PAYLOAD = 64 * 1024;

export type SubmissionResult =
  | { ok: true; update: VerifiedSubscriptionUpdate }
  | { ok: false; kind: "not_configured" | "rejected" | "retry_later"; reason: VerifyFailure | RejectReason | "api_not_configured" | "unknown_to_apple" | "no_status" };

function verifyFailed(e: unknown): SubmissionResult {
  const reason = e instanceof AppleVerificationError ? e.reason : "invalid_signature";
  if (reason === "retryable") return { ok: false, kind: "retry_later", reason };
  if (reason === "api_unauthorized") return { ok: false, kind: "not_configured", reason };
  return { ok: false, kind: "rejected", reason };
}

export async function verifyAppSubmission(
  deps: { verifier: AppleVerifier; statuses: AppleStatusSource | null; now: number },
  input: { signedTransaction: string; expected: Expectations & { expectedAccountToken: string } },
): Promise<SubmissionResult> {
  const jws = input.signedTransaction;
  if (typeof jws !== "string" || !jws || jws.length > MAX_SIGNED_PAYLOAD) return { ok: false, kind: "rejected", reason: "malformed" };
  // 1–2: the client's JWS — which subscription, and is it this account's?
  let clientTx: AppleTransaction;
  try { clientTx = await deps.verifier.transaction(jws); } catch (e) { return verifyFailed(e); }
  const claimed = checkTransaction(clientTx, input.expected);
  if (!claimed.ok) return { ok: false, kind: "rejected", reason: claimed.reason };
  // 3: Apple's current status for it.
  if (!deps.statuses) return { ok: false, kind: "not_configured", reason: "api_not_configured" };
  let items: AppleStatusItem[] | "not_found";
  try { items = await deps.statuses(claimed.tx.environment, claimed.tx.transactionId); } catch (e) { return verifyFailed(e); }
  if (items === "not_found") return { ok: false, kind: "rejected", reason: "unknown_to_apple" };
  const item = items.find((i) => i.originalTransactionId === claimed.tx.originalTransactionId);
  if (!item) return { ok: false, kind: "rejected", reason: "no_status" };
  let tx: AppleTransaction, renewal: AppleRenewalInfo;
  try {
    tx = await deps.verifier.transaction(item.signedTransactionInfo);
    renewal = await deps.verifier.renewalInfo(item.signedRenewalInfo);
  } catch (e) { return verifyFailed(e); }
  const current = checkTransaction(tx, input.expected);
  if (!current.ok) return { ok: false, kind: "rejected", reason: current.reason };
  if (current.tx.originalTransactionId !== claimed.tx.originalTransactionId) return { ok: false, kind: "rejected", reason: "no_status" };
  const renewalProblem = checkRenewalInfo(renewal, current.tx);
  if (renewalProblem) return { ok: false, kind: "rejected", reason: renewalProblem };
  const status = deriveStatus(tx, renewal, deps.now, { apiStatus: item.status });
  const signedDate = Math.max(tx.signedDate ?? 0, renewal.signedDate ?? 0);
  return { ok: true, update: buildVerifiedUpdate(tx, current.tx, renewal, status, signedDate, "app_store_server_api", deps.now) };
}

export type NotificationResult =
  | { ok: false; kind: "forged" | "retry_later"; reason: string }
  | {
    ok: true;
    notification: { notificationUUID: string; notificationType: string; subtype?: string; environment: "production" | "sandbox"; signedDate: number };
    apply?: { update: VerifiedSubscriptionUpdate; event: HistoryEvent };
    skipped?: { outcome: "ignored" | "rejected"; reason: string; originalTransactionId?: string };
  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE = /^[A-Z_]{2,40}$/;

export async function verifyNotification(
  deps: { verifier: AppleVerifier; now: number },
  input: { signedPayload: unknown; expected: Omit<Expectations, "expectedAccountToken"> },
): Promise<NotificationResult> {
  const jws = input.signedPayload;
  if (typeof jws !== "string" || !jws || jws.length > MAX_SIGNED_PAYLOAD) return { ok: false, kind: "forged", reason: "malformed" };
  let n: AppleNotification;
  try { n = await deps.verifier.notification(jws); } catch (e) {
    const reason = e instanceof AppleVerificationError ? e.reason : "invalid_signature";
    return { ok: false, kind: reason === "retryable" ? "retry_later" : "forged", reason };
  }
  const env = n.data?.environment ?? n.summary?.environment;
  if (typeof n.notificationUUID !== "string" || !UUID.test(n.notificationUUID) || typeof n.notificationType !== "string" || !TYPE.test(n.notificationType)
    || typeof n.signedDate !== "number" || !(n.signedDate > 0) || (env !== "Production" && env !== "Sandbox")
    || (n.subtype !== undefined && (typeof n.subtype !== "string" || !TYPE.test(n.subtype)))) {
    return { ok: false, kind: "forged", reason: "malformed" };
  }
  const notification = {
    notificationUUID: n.notificationUUID.toLowerCase(), notificationType: n.notificationType, ...(n.subtype ? { subtype: n.subtype } : {}),
    environment: env === "Production" ? "production" as const : "sandbox" as const, signedDate: n.signedDate,
  };
  const kind = classifyNotification(n.notificationType, n.subtype);
  if (kind.action === "ignore") return { ok: true, notification, skipped: { outcome: "ignored", reason: "no_membership_effect" } };
  if (!n.data?.signedTransactionInfo || !n.data?.signedRenewalInfo) return { ok: true, notification, skipped: { outcome: "rejected", reason: "missing_transaction_data" } };
  let t: AppleTransaction, r: AppleRenewalInfo;
  try {
    t = await deps.verifier.transaction(n.data.signedTransactionInfo);
    r = await deps.verifier.renewalInfo(n.data.signedRenewalInfo);
  } catch (e) {
    const reason = e instanceof AppleVerificationError ? e.reason : "invalid_signature";
    if (reason === "retryable") return { ok: false, kind: "retry_later", reason };
    return { ok: true, notification, skipped: { outcome: "rejected", reason: `inner_${reason}` } };
  }
  const checked = checkTransaction(t, { ...input.expected, expectedAccountToken: null });
  const originalTransactionId = typeof t.originalTransactionId === "string" && /^[0-9]{1,30}$/.test(t.originalTransactionId) ? t.originalTransactionId : undefined;
  if (!checked.ok) return { ok: true, notification, skipped: { outcome: "rejected", reason: checked.reason, ...(originalTransactionId ? { originalTransactionId } : {}) } };
  const renewalProblem = checkRenewalInfo(r, checked.tx);
  if (renewalProblem) return { ok: true, notification, skipped: { outcome: "rejected", reason: renewalProblem, originalTransactionId: checked.tx.originalTransactionId } };
  const status = deriveStatus(t, r, deps.now, { notificationType: n.notificationType });
  return {
    ok: true, notification,
    apply: { update: buildVerifiedUpdate(t, checked.tx, r, status, n.signedDate, "app_store_server_notification", deps.now), event: kind.event },
  };
}
