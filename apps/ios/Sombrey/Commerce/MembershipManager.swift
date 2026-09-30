import Foundation
import StoreKit
import Observation
import Combine
import ConvexMobile

// Sombrey Membership — Phase 6B/6C: the StoreKit 2 adapter.
//
//   loadProduct()            the configured auto-renewable product (Apple's price)
//   purchase()               StoreKit purchase with the account's appAccountToken
//   startTransactionUpdates  Transaction.updates — renewals, refunds, Ask-to-Buy,
//                            purchases made elsewhere, after relaunch
//   refreshStatus()          current entitlement + subscription status
//   restorePurchases()       AppStore.sync() then refresh
//   refreshServerMembership() (6C) Sombrey membership as the SERVER sees it
//
// Every StoreKit result is converted to the value facts in MembershipModels.swift
// and resolved there, so the rules are tested without StoreKit. The UI never
// touches StoreKit. Phase 6C: verified transactions go to the server
// (`ConvexMembershipServer` → commerce/appStore:submitTransaction), which
// verifies Apple's signature and asks Apple for the current status; the app
// then READS its membership from the server (commerce/access:myEntitlements).
// Nothing here writes subscription state or decides access. All Convex calls
// are gated by `CommerceBackend.available` (MembershipModels.swift).

/// Client-side commerce events (convex/commerce/events.ts: client events only —
/// the app can never record an activation, renewal or purchase completion).
enum MembershipEvents {
    enum Name: String { case productViewed = "product_viewed", purchaseInitiated = "subscription_purchase_initiated", checkoutAbandoned = "subscription_checkout_abandoned" }
    static let membershipProductID = "sombrey_membership_monthly"   // the Sombrey product id (config.ts), not Apple's

    @MainActor
    static func record(_ name: Name, source: String? = nil) async {
        guard CommerceBackend.available else { return }
        var args: [String: ConvexEncodable?] = ["name": name.rawValue, "platform": "ios", "productId": membershipProductID]
        if let source { args["source"] = source }
        try? await ConvexClientProvider.client.mutation("commerce/access:recordEvent", with: args)
    }
}

@Observable
@MainActor
final class MembershipManager {
    private(set) var product: MembershipProductState = .idle
    private(set) var status: MembershipStatus = .loading
    private(set) var isPurchasing = false
    /// 6C: Sombrey membership as the server sees it — the only one that counts.
    private(set) var serverMembership: ServerMembershipState = .unknown
    /// 6C: the last server verification problem, in calm words (nil = none).
    private(set) var serverError: MembershipError?

    let productID: String?
    /// The signed-in Sombrey account's stable id (Clerk user id), or nil.
    private let accountID: @MainActor () -> String?
    private let handoff: MembershipServerHandoff
    private var ledger = MembershipTransactionLedger()
    private var updatesTask: Task<Void, Never>?
    private var storeProduct: Product?

    init(productID: String? = MembershipProductConfig.configuredProductID,
         accountID: @escaping @MainActor () -> String?,
         handoff: MembershipServerHandoff = ConvexMembershipServer()) {
        self.productID = productID
        self.accountID = accountID
        self.handoff = handoff
        if productID == nil {
            product = .unavailable(.notConfigured)
            status = .unavailable(.notConfigured)
        }
    }

    // MARK: Lifecycle

    /// Call once at launch: Apple delivers renewals, refunds, approved Ask-to-Buy
    /// purchases and purchases made on other devices through `Transaction.updates`.
    func start() {
        guard productID != nil, updatesTask == nil else { return }
        CommerceDiagnostics.log("transaction listener started")
        updatesTask = Task.detached(priority: .background) { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update, trigger: .update)
            }
        }
        Task {
            await refreshStatus()
            await handOffCurrentEntitlement(trigger: .launch)
            await refreshServerMembership()
        }
    }

    // MARK: Product

    func loadProduct() async {
        guard let productID else { product = .unavailable(.notConfigured); return }
        product = .loading
        CommerceDiagnostics.log("product load started")
        do {
            let found = try await Product.products(for: [productID])
            storeProduct = found.first { $0.id == productID }
            product = MembershipResolver.productState(requested: productID, found: found.map(Self.facts))
            switch product {
            case .available: CommerceDiagnostics.log("product load completed")
            default: CommerceDiagnostics.error("product load: \(product)")
            }
        } catch {
            product = .error(Self.map(error))
            CommerceDiagnostics.error("product load failed: \(Self.map(error))")
        }
    }

    // MARK: Purchase

    /// Buys the membership. The app's state changes only from a VERIFIED
    /// transaction; the Sombrey entitlement changes only when the server has
    /// verified it too (6C).
    func purchase() async -> MembershipPurchaseOutcome {
        guard let productID else { return .failed(.notConfigured) }
        if storeProduct == nil { await loadProduct() }
        guard let storeProduct, product.purchasable != nil else { return .failed(.productUnavailable) }
        guard let account = accountID(), let token = MembershipAccountToken.make(accountID: account) else { return .failed(.notSignedIn) }
        isPurchasing = true
        defer { isPurchasing = false }
        CommerceDiagnostics.log("purchase initiated")
        await MembershipEvents.record(.purchaseInitiated)
        // So an App Store notification that beats the app's own report can be
        // matched to this account (the server derives the token itself).
        await ConvexMembershipServer.linkAccount()
        do {
            let result = try await storeProduct.purchase(options: [.appAccountToken(token)])
            let facts: MembershipPurchaseResultFacts
            switch result {
            case .success(let verification):
                facts = .success(Self.verifiedFacts(verification))
                await handle(verification, trigger: .purchase)
            case .userCancelled:
                facts = .userCancelled
                CommerceDiagnostics.log("purchase cancelled")
                await MembershipEvents.record(.checkoutAbandoned)
            case .pending:
                facts = .pending
                status = .pending
                CommerceDiagnostics.log("purchase pending")
            @unknown default:
                return .failed(.unknown(code: "unknown_purchase_result"))
            }
            return MembershipResolver.purchaseOutcome(facts, productID: productID)
        } catch {
            CommerceDiagnostics.error("purchase failed: \(Self.map(error))")
            return .failed(Self.map(error))
        }
    }

    // MARK: Entitlement

    func refreshStatus() async {
        guard let productID else { status = .unavailable(.notConfigured); return }
        do {
            if storeProduct == nil { storeProduct = try await Product.products(for: [productID]).first }
            var observations: [MembershipStatusObservation] = []
            for s in try await storeProduct?.subscription?.status ?? [] {
                let renewal: Bool? = { if case .verified(let r) = s.renewalInfo { return r.willAutoRenew } else { return nil } }()
                observations.append(MembershipStatusObservation(state: Self.state(s.state), transaction: Self.verifiedFacts(s.transaction), willAutoRenew: renewal))
            }
            let entitlement = await Transaction.currentEntitlement(for: productID).map(Self.verifiedFacts)
            let new = MembershipResolver.status(productID: productID, statuses: observations, currentEntitlement: entitlement, now: Date())
            if new != status { CommerceDiagnostics.log("entitlement changed: \(Self.describe(new))") }
            status = new
        } catch {
            status = .error(Self.map(error))
            CommerceDiagnostics.error("entitlement read failed: \(Self.map(error))")
        }
    }

    /// "Restore Purchases": asks Apple to sync this Apple ID's transactions,
    /// then re-reads the entitlement. Works after reinstall and on another
    /// device signed into the same Apple ID; the server links it to the
    /// Sombrey account through the transaction's appAccountToken (6C).
    func restorePurchases() async -> MembershipRestoreOutcome {
        guard productID != nil else { return .failed(.notConfigured) }
        CommerceDiagnostics.log("restore initiated")
        do {
            try await AppStore.sync()
        } catch {
            let e = Self.map(error)
            CommerceDiagnostics.error("restore failed: \(e)")
            return .failed(e)
        }
        await refreshStatus()
        await handOffCurrentEntitlement(trigger: .restore)
        await refreshServerMembership()
        let outcome = MembershipResolver.restoreOutcome(status)
        CommerceDiagnostics.log("restore completed: \(outcome)")
        return outcome
    }

    /// 6C: reads Sombrey membership from the server. A successful submission is
    /// never taken as access — only this answer is.
    func refreshServerMembership() async {
        guard CommerceBackend.available, accountID() != nil else { serverMembership = .unknown; return }
        if serverMembership == .unknown { serverMembership = .loading }
        if let e = await ConvexMembershipServer.entitlements() {
            let new = ServerMembershipState.from(subscriptionActive: e.subscriptionActive, sources: e.subscriptionSources)
            if new != serverMembership { CommerceDiagnostics.log("server membership: \(new.isMember ? "member" : "not a member")") }
            serverMembership = new
        } else {
            serverMembership = .unavailable
        }
    }

    /// A future membership surface calls this when it shows the offer.
    func noteMembershipViewed(source: String? = nil) async { await MembershipEvents.record(.productViewed, source: source) }

    // MARK: Transactions

    private func handle(_ verification: VerificationResult<Transaction>, trigger: MembershipTransactionHandoff.Trigger) async {
        switch verification {
        case .verified(let t):
            guard t.productID == productID else { return }
            var finish = true
            if ledger.firstDelivery(of: String(t.id)) {
                CommerceDiagnostics.log("verified transaction \(CommerceDiagnostics.redact(String(t.id))) trigger=\(trigger.rawValue) revoked=\(t.revocationDate != nil)")
                let result = await submitIfNew(t, jws: verification.jwsRepresentation, trigger: trigger)
                if !result.finishesTransaction {
                    // Not verified yet: leave it unfinished so Apple re-delivers it.
                    ledger.forget(String(t.id))
                    finish = false
                }
                await refreshServerMembership()
            }
            // Finishing is idempotent; unfinished transactions are re-delivered by Apple.
            if finish { await t.finish() }
        case .unverified(let t, _):
            // Never grants anything; not finished, so Apple can re-deliver it.
            CommerceDiagnostics.error("unverified transaction \(CommerceDiagnostics.redact(String(t.id))) ignored")
        }
        await refreshStatus()
    }

    /// The current VERIFIED entitlement's signed transaction, for the server to
    /// verify itself (restore, launch). Unverified entitlements are never passed on.
    private func handOffCurrentEntitlement(trigger: MembershipTransactionHandoff.Trigger) async {
        guard let productID, let v = await Transaction.currentEntitlement(for: productID), case .verified(let t) = v else { return }
        await submitIfNew(t, jws: v.jwsRepresentation, trigger: trigger)
    }

    @discardableResult
    private func submitIfNew(_ t: Transaction, jws: String, trigger: MembershipTransactionHandoff.Trigger) async -> MembershipServerResult {
        let f = Self.facts(t)
        let result = await handoff.submit(MembershipTransactionHandoff(
            signedTransaction: jws, transactionID: f.transactionID, originalTransactionID: f.originalTransactionID,
            productID: f.productID, environment: f.environment, appAccountToken: f.appAccountToken, trigger: trigger, observedAt: Date()
        ))
        serverError = result.userFacingError
        CommerceDiagnostics.log("server verification: \(Self.describe(result)) trigger=\(trigger.rawValue)")
        return result
    }

    // MARK: StoreKit → facts

    nonisolated static func facts(_ p: Product) -> MembershipProductFacts {
        let period = p.subscription.map { sub -> (Int, String) in
            let unit: String
            switch sub.subscriptionPeriod.unit {
            case .day: unit = "day"
            case .week: unit = "week"
            case .month: unit = "month"
            case .year: unit = "year"
            @unknown default: unit = "unknown"
            }
            return (sub.subscriptionPeriod.value, unit)
        }
        return MembershipProductFacts(id: p.id, isAutoRenewable: p.type == .autoRenewable, displayName: p.displayName, displayPrice: p.displayPrice,
                                      price: p.price, currencyCode: p.priceFormatStyle.currencyCode, period: period.map { (value: $0.0, unit: $0.1) })
    }

    nonisolated static func facts(_ t: Transaction) -> MembershipTransactionFacts {
        let environment: String
        switch t.environment {
        case .production: environment = "production"
        case .sandbox: environment = "sandbox"
        case .xcode: environment = "xcode"
        default: environment = "unknown"
        }
        return MembershipTransactionFacts(
            transactionID: String(t.id), originalTransactionID: String(t.originalID), productID: t.productID,
            purchaseDate: t.purchaseDate, expirationDate: t.expirationDate, revocationDate: t.revocationDate,
            isUpgraded: t.isUpgraded, environment: environment, appAccountToken: t.appAccountToken
        )
    }

    nonisolated static func verifiedFacts(_ v: VerificationResult<Transaction>) -> MembershipVerified<MembershipTransactionFacts> {
        switch v {
        case .verified(let t): return .verified(facts(t))
        case .unverified(let t, let error): return .unverified(facts(t), reason: String(describing: type(of: error)))
        }
    }

    nonisolated static func state(_ s: Product.SubscriptionInfo.RenewalState) -> MembershipRenewalState {
        switch s {
        case .subscribed: return .subscribed
        case .expired: return .expired
        case .inBillingRetryPeriod: return .inBillingRetryPeriod
        case .inGracePeriod: return .inGracePeriod
        case .revoked: return .revoked
        default: return .expired
        }
    }

    /// StoreKit errors → structured errors (never shown raw).
    nonisolated static func map(_ error: Error) -> MembershipError {
        if let e = error as? StoreKitError {
            switch e {
            case .userCancelled: return .userCancelled
            case .networkError: return .storeUnavailable
            case .notAvailableInStorefront: return .productUnavailable
            case .notEntitled: return .unverified
            case .systemError: return .unknown(code: "system_error")
            case .unknown: return .unknown(code: "storekit_unknown")
            default: return .unknown(code: "storekit_other")
            }
        }
        if let e = error as? Product.PurchaseError {
            switch e {
            case .productUnavailable: return .productUnavailable
            case .purchaseNotAllowed: return .purchaseNotAllowed
            default: return .unknown(code: "purchase_error")
            }
        }
        if error is URLError { return .storeUnavailable }
        return .unknown(code: "other")
    }

    private static func describe(_ r: MembershipServerResult) -> String {
        switch r {
        case .recorded: return "recorded"
        case .unchanged: return "unchanged"
        case .notConfigured: return "not configured"
        case .rejected(let e): return "rejected \(e)"
        case .retryLater: return "retry later"
        case .notSent: return "not sent"
        }
    }

    private static func describe(_ s: MembershipStatus) -> String {
        switch s {
        case .active(let a): return "active grace=\(a.inGracePeriod) env=\(a.environment)"
        case .unavailable(let e): return "unavailable \(e)"
        case .error(let e): return "error \(e)"
        default: return String(describing: s)
        }
    }
}

// MARK: - Sombrey server (Phase 6C)

/// The app's side of server verification. Sends ONLY Apple's signed
/// transaction to commerce/appStore:submitTransaction (authenticated by the
/// signed-in Clerk session); the server derives everything else itself.
/// Errors are never shown raw: they become `MembershipServerResult`s.
struct ConvexMembershipServer: MembershipServerHandoff {
    private struct Reply: Decodable, Sendable { let result: String; let reason: String? }
    struct Entitlements: Decodable, Sendable { let subscriptionActive: Bool; let subscriptionSources: [String] }

    func submit(_ handoff: MembershipTransactionHandoff) async -> MembershipServerResult {
        guard CommerceBackend.available, handoff.verifiableByServer else { return .notSent }
        do {
            let reply = try await Self.send(handoff.signedTransaction)
            return .from(result: reply.result, reason: reply.reason)
        } catch {
            CommerceDiagnostics.error("server verification unavailable: \(String(describing: type(of: error)))")
            return .retryLater
        }
    }

    @MainActor private static func send(_ signedTransaction: String) async throws -> Reply {
        try await ConvexClientProvider.client.action("commerce/appStore:submitTransaction", with: ["signedTransaction": signedTransaction])
    }

    /// The server's membership answer, or nil when it can't be read.
    @MainActor static func entitlements() async -> Entitlements? {
        guard CommerceBackend.available else { return nil }
        do {
            for try await e in ConvexClientProvider.client.subscribe(to: "commerce/access:myEntitlements", with: nil, yielding: Entitlements.self).values {
                return e
            }
        } catch {
            CommerceDiagnostics.error("server membership unavailable: \(String(describing: type(of: error)))")
        }
        return nil
    }

    /// Links this account's App Store token on the server before a purchase
    /// (no arguments: the server computes the token from the session).
    @MainActor static func linkAccount() async {
        guard CommerceBackend.available else { return }
        try? await ConvexClientProvider.client.mutation("commerce/access:linkAppStoreAccount")
    }
}
