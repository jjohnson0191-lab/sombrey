import Testing
import Foundation
@testable import SombreyApp

/// Sombrey Membership (StoreKit 2, Phase 6B): the StoreKit-independent rules —
/// product loading, purchase outcomes, entitlement resolution, restore,
/// repeated deliveries, account association and errors. All inputs are
/// SYNTHETIC facts (no StoreKit objects, no real transactions); StoreKit itself
/// is exercised locally with the StoreKit testing file (docs/COMMERCE_6B.md).
struct MembershipTests {
    static let pid = "sombrey.storekit_testing.membership_monthly"
    static let now = Date(timeIntervalSince1970: 1_790_000_000)

    static func product(id: String = pid, autoRenewable: Bool = true) -> MembershipProductFacts {
        MembershipProductFacts(id: id, isAutoRenewable: autoRenewable, displayName: "Sombrey Membership", displayPrice: "$30.00",
                               price: 30, currencyCode: "USD", period: (value: 1, unit: "month"))
    }

    static func tx(id: String = "2000000000000001", original: String = "2000000000000001", product: String = pid,
                   expires: TimeInterval? = 86_400 * 20, revoked: Date? = nil, upgraded: Bool = false) -> MembershipTransactionFacts {
        MembershipTransactionFacts(transactionID: id, originalTransactionID: original, productID: product, purchaseDate: now.addingTimeInterval(-86_400 * 10),
                                   expirationDate: expires.map { now.addingTimeInterval($0) }, revocationDate: revoked, isUpgraded: upgraded,
                                   environment: "xcode", appAccountToken: nil)
    }

    static func obs(_ state: MembershipRenewalState, _ t: MembershipVerified<MembershipTransactionFacts>, renew: Bool? = true) -> MembershipStatusObservation {
        MembershipStatusObservation(state: state, transaction: t, willAutoRenew: renew)
    }

    // MARK: Product configuration & loading

    @Test func productIdComesFromConfigurationNeverAPlaceholder() {
        #expect(MembershipProductConfig.productID(from: nil) == nil)
        #expect(MembershipProductConfig.productID(from: "") == nil)
        #expect(MembershipProductConfig.productID(from: "   ") == nil)
        #expect(MembershipProductConfig.productID(from: "$(SOMBREY_MEMBERSHIP_PRODUCT_ID)") == nil, "an unexpanded build setting isn't a product id")
        #expect(MembershipProductConfig.productID(from: "bad id!") == nil)
        #expect(MembershipProductConfig.productID(from: " \(Self.pid) ") == Self.pid)
        #expect(MembershipProductConfig.storeKitTestingProductID.contains("storekit_testing"), "the testing id is unmistakable")
    }

    @Test func productLoadingDistinguishesEveryCase() {
        #expect(MembershipResolver.productState(requested: nil, found: []) == .unavailable(.notConfigured))
        #expect(MembershipResolver.productState(requested: Self.pid, found: []) == .unavailable(.productUnavailable))
        #expect(MembershipResolver.productState(requested: Self.pid, found: [Self.product(id: "other")]) == .unavailable(.productUnavailable))
        #expect(MembershipResolver.productState(requested: Self.pid, found: [Self.product(autoRenewable: false)]) == .unavailable(.wrongProductType))
        let ok = MembershipResolver.productState(requested: Self.pid, found: [Self.product()])
        #expect(ok.purchasable?.displayPrice == "$30.00", "the price shown is Apple's localized string")
        #expect(MembershipProductState.unavailable(.productUnavailable).purchasable == nil, "nothing to buy when the product didn't load")
        #expect(MembershipProductState.error(.storeUnavailable).purchasable == nil)
    }

    // MARK: Purchase

    @Test func purchaseOutcomesAreHonest() {
        #expect(MembershipResolver.purchaseOutcome(.success(.verified(Self.tx())), productID: Self.pid) == .purchased(Self.tx()))
        #expect(MembershipResolver.purchaseOutcome(.userCancelled, productID: Self.pid) == .cancelled)
        #expect(MembershipResolver.purchaseOutcome(.pending, productID: Self.pid) == .pending)
        #expect(MembershipResolver.purchaseOutcome(.success(.unverified(Self.tx(), reason: "invalidSignature")), productID: Self.pid) == .failed(.unverified),
                "an unverified purchase is a failure, never access")
        #expect(MembershipResolver.purchaseOutcome(.success(.verified(Self.tx(revoked: Self.now))), productID: Self.pid) == .failed(.revoked))
        #expect(MembershipResolver.purchaseOutcome(.success(.verified(Self.tx(product: "other"))), productID: Self.pid) == .failed(.unknown(code: "unexpected_product")))
    }

    // MARK: Entitlements

    @Test func entitlementStatesFromAppleSubscriptionStatus() {
        let v = MembershipVerified.verified(Self.tx())
        guard case .active(let a) = MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, v)], currentEntitlement: nil, now: Self.now) else {
            #expect(Bool(false), "expected active"); return
        }
        #expect(a.willAutoRenew == true && a.inGracePeriod == false && a.originalTransactionID == "2000000000000001")
        if case .active(let g) = MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.inGracePeriod, v)], currentEntitlement: nil, now: Self.now) {
            #expect(g.inGracePeriod, "Apple's grace period keeps access, flagged")
        } else { #expect(Bool(false)) }
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.inBillingRetryPeriod, v)], currentEntitlement: nil, now: Self.now) == .billingRetry(expiredAt: Self.tx().expirationDate))
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.expired, .verified(Self.tx(expires: -60)))], currentEntitlement: nil, now: Self.now) == .expired(at: Self.now.addingTimeInterval(-60)))
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.revoked, .verified(Self.tx(revoked: Self.now)))], currentEntitlement: nil, now: Self.now) == .revoked(at: Self.now))
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [], currentEntitlement: nil, now: Self.now) == .notSubscribed)
        // A stale "subscribed" whose expiry has passed isn't active.
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, .verified(Self.tx(expires: -1)))], currentEntitlement: nil, now: Self.now) == .expired(at: Self.now.addingTimeInterval(-1)))
    }

    @Test func unverifiedAppleDataNeverYieldsAnActiveMembership() {
        let bad = MembershipVerified.unverified(Self.tx(), reason: "invalidSignature")
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, bad)], currentEntitlement: nil, now: Self.now) == .unverified)
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [], currentEntitlement: bad, now: Self.now) == .unverified)
        #expect(!MembershipStatus.unverified.hasVerifiedAppleEntitlement)
        #expect(!MembershipStatus.error(.storeUnavailable).hasVerifiedAppleEntitlement, "unknown isn't access")
        #expect(!MembershipStatus.pending.hasVerifiedAppleEntitlement)
    }

    @Test func currentEntitlementFallbackAndOtherProductsIgnored() {
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [], currentEntitlement: .verified(Self.tx()), now: Self.now).hasVerifiedAppleEntitlement)
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [], currentEntitlement: .verified(Self.tx(upgraded: true)), now: Self.now) == .notSubscribed)
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, .verified(Self.tx(product: "other")))], currentEntitlement: nil, now: Self.now) == .notSubscribed)
    }

    // MARK: Restore

    @Test func restoreReportsWhatAppleActuallyHas() {
        let active = ActiveMembership(productID: Self.pid, originalTransactionID: "1", expiresAt: nil, willAutoRenew: true, inGracePeriod: false, environment: "xcode")
        #expect(MembershipResolver.restoreOutcome(.active(active)) == .restored(active))
        #expect(MembershipResolver.restoreOutcome(.notSubscribed) == .nothingToRestore)
        #expect(MembershipResolver.restoreOutcome(.expired(at: nil)) == .nothingToRestore)
        #expect(MembershipResolver.restoreOutcome(.error(.storeUnavailable)) == .failed(.storeUnavailable))
        #expect(MembershipResolver.restoreOutcome(.unverified) == .failed(.unverified))
    }

    // MARK: Transaction updates

    @Test func repeatedDeliveriesAreHandledOnce() {
        var ledger = MembershipTransactionLedger()
        let first = ledger.firstDelivery(of: "2000000000000001")
        let repeated = ledger.firstDelivery(of: "2000000000000001")
        let renewal = ledger.firstDelivery(of: "2000000000000002")
        #expect(first)
        #expect(!repeated, "the purchase result and Transaction.updates deliver the same transaction")
        #expect(renewal, "a renewal is a new transaction")
        var relaunched = MembershipTransactionLedger()
        let afterRelaunch = relaunched.firstDelivery(of: "2000000000000001")
        #expect(afterRelaunch, "after relaunch Apple re-delivers unfinished transactions; handling (finish + server handoff) is idempotent")
    }

    @Test func renewalRevocationAndCancellationChangeTheStatus() {
        let renewed = MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, .verified(Self.tx(id: "2000000000000002", expires: 86_400 * 50)))], currentEntitlement: nil, now: Self.now)
        #expect(renewed.hasVerifiedAppleEntitlement)
        if case .active(let a) = MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, .verified(Self.tx()), renew: false)], currentEntitlement: nil, now: Self.now) {
            #expect(a.willAutoRenew == false, "cancelled = auto-renew off; access continues until expiry")
        } else { #expect(Bool(false)) }
        #expect(MembershipResolver.status(productID: Self.pid, statuses: [Self.obs(.subscribed, .verified(Self.tx(revoked: Self.now)))], currentEntitlement: nil, now: Self.now) == .revoked(at: Self.now), "a refund revokes")
    }

    // MARK: Account association

    @Test func accountTokenIsDeterministicDistinctAndOpaque() {
        let a1 = MembershipAccountToken.make(accountID: "user_2abcDEF")
        let a2 = MembershipAccountToken.make(accountID: "user_2abcDEF")
        let b = MembershipAccountToken.make(accountID: "user_2abcDEG")
        #expect(a1 != nil && a1 == a2, "the same Sombrey account → the same token, on any device")
        #expect(a1 != b, "different accounts → different tokens")
        #expect(MembershipAccountToken.make(accountID: "") == nil && MembershipAccountToken.make(accountID: "   ") == nil)
        let s = a1!.uuidString
        #expect(!s.lowercased().contains("abcdef") && !s.contains("user"), "the token doesn't carry the id")
        #expect(Array(s)[14] == "5", "RFC 4122 version 5 (name-based)")
        #expect(["8", "9", "A", "B"].contains(String(Array(s)[19])), "RFC 4122 variant")
        #expect(MembershipAccountToken.namespace.uuidString == "155EA3DB-9DE4-4877-A417-FC8CDA0354AF", "the namespace is fixed — changing it would orphan every purchase")
    }

    @Test func accountTokenMatchesAKnownVector() {
        // Frozen: the server (6C) must reproduce exactly this value from the same Clerk id.
        #expect(MembershipAccountToken.make(accountID: "user_test")?.uuidString == Self.tokenVector)
    }
    static let tokenVector = "96D212A9-D972-503E-8C18-87D719330709"   // = Python uuid.uuid5(namespace, "sombrey:clerk:user_test")

    // MARK: Errors

    @Test func errorsAreStructuredAndNeverRawStoreKitText() {
        let all: [MembershipError] = [.notConfigured, .productUnavailable, .wrongProductType, .storeUnavailable, .notSignedIn, .userCancelled, .pending,
                                      .unverified, .revoked, .expired, .purchaseNotAllowed, .unknown(code: "storekit_other")]
        for e in all {
            #expect(!e.userMessage.isEmpty)
            #expect(!e.userMessage.contains("StoreKit") && !e.userMessage.contains("Error"), "\(e)")
        }
        #expect(MembershipError.userCancelled.userMessage.contains("haven't been charged"))
        #expect(MembershipError.unverified.userMessage.contains("haven't been given access"))
    }

    @Test func diagnosticsRedactTransactionIds() {
        #expect(CommerceDiagnostics.redact("2000000000001234") == "…1234")
        #expect(CommerceDiagnostics.redact("12") == "…")
    }
}
