// Row → domain-record mapping shared by the commerce functions.
import type { Doc } from "../_generated/dataModel";
import type { SubscriptionRecord, VerificationMethod } from "./subscriptionState";

export function toSubscriptionRecord(s: Doc<"commerceSubscriptions">): SubscriptionRecord {
  return {
    provider: s.provider, environment: s.environment, appStoreProductId: s.appStoreProductId,
    originalTransactionId: s.originalTransactionId, latestTransactionId: s.latestTransactionId,
    status: s.status, autoRenewEnabled: s.autoRenewEnabled, purchaseDate: s.purchaseDate, expiresDate: s.expiresDate,
    signedDate: s.signedDate, ...(s.revocationDate !== undefined ? { revocationDate: s.revocationDate } : {}),
    lastVerifiedAt: s.lastVerifiedAt, verificationMethod: s.verificationMethod as VerificationMethod,
  };
}
