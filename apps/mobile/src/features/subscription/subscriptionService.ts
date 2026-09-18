/**
 * Subscription boundary — interface only, per Phase 3 scope (no StoreKit
 * implementation). Screens (Subscription/Paywall, Profile > Subscription)
 * are written against this shape so wiring in real StoreKit 2 + the
 * Convex entitlement backend (App Store Server Notifications V2 handler
 * — see the Phase 2 architecture report) later doesn't require touching
 * every call site.
 *
 * Target price: $25/month, no annual plan (product decision, not this
 * file's concern — this file has no pricing logic at all).
 */

export type EntitlementStatus = "active" | "inactive" | "expired" | "unknown";

export interface SombreyEntitlement {
  status: EntitlementStatus;
  productId?: string;
  expiresAt?: number;
}

export interface SombreyPurchaseService {
  getEntitlement(): Promise<SombreyEntitlement>;
  /** Opens Apple's native subscription-management surface. Distinct from
   * account deletion — see features/account/accountDeletionService.ts's
   * header comment for why these must never be conflated in the UI. */
  manageSubscription(): Promise<void>;
  restorePurchases(): Promise<void>;
}

/**
 * Not implemented in Phase 3. Every method rejects clearly rather than
 * pretending a purchase flow exists — StoreKit 2 is a later, dedicated
 * phase.
 */
export const sombreyPurchaseService: SombreyPurchaseService = {
  async getEntitlement() {
    return { status: "unknown" };
  },
  async manageSubscription() {
    throw new Error("StoreKit 2 is not implemented yet — see the Phase 3 report.");
  },
  async restorePurchases() {
    throw new Error("StoreKit 2 is not implemented yet — see the Phase 3 report.");
  },
};
