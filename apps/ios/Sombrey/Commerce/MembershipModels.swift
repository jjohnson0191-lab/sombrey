import Foundation
import CryptoKit
import os

// Sombrey Membership — Phase 6B: the StoreKit-independent core.
//
// Everything here is plain value logic: the product configuration, the
// membership status model, how StoreKit observations resolve into that
// status, purchase/restore outcomes, structured errors, duplicate-delivery
// handling, the account token and the handoff record for the server (6C).
// `MembershipManager` (MembershipManager.swift) is the thin StoreKit 2
// adapter that turns Apple's types into these facts.
//
// Two rules hold throughout:
//   • an UNVERIFIED transaction never produces an active membership;
//   • this is the phone's LOCAL reading of Apple's entitlement. The Sombrey
//     entitlement (convex/commerce, myEntitlements) is only granted from
//     server-verified Apple data (Phase 6C) — nothing here writes to Convex.
//
// Plain logic (Foundation + CryptoKit) — tested in SombreyAppTests/MembershipTests.swift.

// MARK: - Product configuration

/// Where the App Store product id comes from: the `SombreyMembershipProductID`
/// Info.plist key, filled from the `SOMBREY_MEMBERSHIP_PRODUCT_ID` build
/// setting (Secrets.xcconfig). EMPTY until the product exists in App Store
/// Connect — then the app shows no purchasable product (never a fake one).
/// The same id goes into convex/commerce/config.ts `appStoreProductId` (6C).
enum MembershipProductConfig {
    static let infoPlistKey = "SombreyMembershipProductID"
    /// The id used ONLY by the local StoreKit testing file
    /// (Sombrey/Resources/SombreyStoreKitTesting.storekit). Never an App Store id.
    static let storeKitTestingProductID = "sombrey.storekit_testing.membership_monthly"

    /// The configured product id, or nil (not configured / unexpanded / malformed).
    static func productID(from raw: String?) -> String? {
        guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty, !s.contains("$(") else { return nil }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        guard s.count <= 100, s.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        return s
    }

    static var configuredProductID: String? {
        productID(from: Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String)
    }
}

// MARK: - StoreKit-independent facts

/// What the app knows about one App Store transaction (no signed payload).
struct MembershipTransactionFacts: Equatable, Sendable {
    let transactionID: String
    let originalTransactionID: String
    let productID: String
    let purchaseDate: Date
    let expirationDate: Date?
    let revocationDate: Date?
    let isUpgraded: Bool
    /// "production", "sandbox" or "xcode" (local StoreKit testing).
    let environment: String
    let appAccountToken: UUID?
}

/// Mirrors StoreKit's `VerificationResult`: Apple's signature checked on device.
enum MembershipVerified<T: Equatable & Sendable>: Equatable, Sendable {
    case verified(T)
    case unverified(T, reason: String)

    var verifiedValue: T? { if case .verified(let v) = self { return v } else { return nil } }
    var value: T {
        switch self {
        case .verified(let v), .unverified(let v, _): return v
        }
    }
}

/// Mirrors `Product.SubscriptionInfo.RenewalState`.
enum MembershipRenewalState: String, Equatable, Sendable {
    case subscribed, expired, inBillingRetryPeriod, inGracePeriod, revoked
}

/// One subscription-status observation (StoreKit `Product.SubscriptionInfo.Status`).
struct MembershipStatusObservation: Equatable, Sendable {
    let state: MembershipRenewalState
    let transaction: MembershipVerified<MembershipTransactionFacts>
    /// From verified renewal info; nil when unknown or unverified.
    let willAutoRenew: Bool?
}

/// What StoreKit said about a product request.
struct MembershipProductFacts: Equatable, Sendable {
    let id: String
    let isAutoRenewable: Bool
    let displayName: String
    /// Apple's localized price string — the only price the app ever shows.
    let displayPrice: String
    let price: Decimal
    let currencyCode: String?
    /// e.g. (1, "month").
    let period: (value: Int, unit: String)?

    static func == (a: Self, b: Self) -> Bool {
        a.id == b.id && a.isAutoRenewable == b.isAutoRenewable && a.displayName == b.displayName && a.displayPrice == b.displayPrice
            && a.price == b.price && a.currencyCode == b.currencyCode && a.period?.value == b.period?.value && a.period?.unit == b.period?.unit
    }
}

// MARK: - States

enum MembershipError: Error, Equatable, Sendable {
    case notConfigured          // no App Store product id in this build
    case productUnavailable     // Apple has no such product (or not in this storefront)
    case wrongProductType       // the id isn't an auto-renewable subscription
    case storeUnavailable       // network / App Store unreachable
    case notSignedIn            // no Sombrey account to associate the purchase with
    case userCancelled
    case pending                // Ask to Buy / SCA — waiting on someone else
    case unverified             // Apple's signature didn't verify
    case revoked
    case expired
    case purchaseNotAllowed     // parental controls / device restrictions
    case unknown(code: String)  // anything else — never shown raw

    /// Calm, plain words a future Sombrey surface can show (never a raw StoreKit error).
    var userMessage: String {
        switch self {
        case .notConfigured, .productUnavailable, .wrongProductType: return "Membership isn't available right now."
        case .storeUnavailable: return "The App Store can't be reached. Check your connection and try again."
        case .notSignedIn: return "Sign in to your Sombrey account first."
        case .userCancelled: return "Purchase cancelled. You haven't been charged."
        case .pending: return "Your purchase is waiting for approval. It will start once it's approved."
        case .unverified: return "Apple couldn't confirm this purchase. You haven't been given access. Try restoring purchases."
        case .revoked: return "This membership was refunded or revoked by Apple."
        case .expired: return "Your membership has ended."
        case .purchaseNotAllowed: return "Purchases aren't allowed on this device."
        case .unknown: return "Something went wrong with the App Store. Try again."
        }
    }
}

enum MembershipProductState: Equatable, Sendable {
    case idle
    case loading
    case available(MembershipProductFacts)
    case unavailable(MembershipError)   // notConfigured / productUnavailable / wrongProductType
    case error(MembershipError)         // storeUnavailable / unknown

    /// Only a loaded, verified-type product can be offered for purchase.
    var purchasable: MembershipProductFacts? { if case .available(let p) = self { return p } else { return nil } }
}

struct ActiveMembership: Equatable, Sendable {
    let productID: String
    let originalTransactionID: String
    let expiresAt: Date?
    let willAutoRenew: Bool?
    let inGracePeriod: Bool
    let environment: String
}

/// The phone's reading of Apple's entitlement — honest, including uncertainty.
enum MembershipStatus: Equatable, Sendable {
    case unavailable(MembershipError)   // can't be determined in this build (e.g. not configured)
    case loading
    case notSubscribed
    case active(ActiveMembership)
    case pending                        // a purchase awaits approval
    case billingRetry(expiredAt: Date?) // Apple is retrying payment; no access
    case expired(at: Date?)
    case revoked(at: Date?)
    case unverified                     // Apple data failed verification — never access
    case error(MembershipError)         // StoreKit couldn't answer; state unknown

    /// Only a verified, current subscription counts — locally. Sombrey access
    /// itself is decided by the server (Phase 6C/6D).
    var hasVerifiedAppleEntitlement: Bool { if case .active = self { return true } else { return false } }
}

enum MembershipPurchaseOutcome: Equatable, Sendable {
    case purchased(MembershipTransactionFacts)
    case cancelled
    case pending
    case failed(MembershipError)
}

enum MembershipRestoreOutcome: Equatable, Sendable {
    case restored(ActiveMembership)
    case nothingToRestore
    case failed(MembershipError)
}

// MARK: - Resolution rules

enum MembershipResolver {
    /// A product request's result → the product state.
    static func productState(requested id: String?, found: [MembershipProductFacts]) -> MembershipProductState {
        guard let id else { return .unavailable(.notConfigured) }
        guard let p = found.first(where: { $0.id == id }) else { return .unavailable(.productUnavailable) }
        guard p.isAutoRenewable else { return .unavailable(.wrongProductType) }
        return .available(p)
    }

    /// Subscription-status observations (preferred) or the current entitlement
    /// → the membership status. Unverified data never yields `.active`.
    static func status(productID: String, statuses: [MembershipStatusObservation],
                       currentEntitlement: MembershipVerified<MembershipTransactionFacts>?, now: Date) -> MembershipStatus {
        let mine = statuses.filter { $0.transaction.value.productID == productID }
        if let best = mine.max(by: { rank($0.state) < rank($1.state) }) {
            guard let t = best.transaction.verifiedValue else { return .unverified }
            if t.revocationDate != nil { return .revoked(at: t.revocationDate) }
            switch best.state {
            case .subscribed, .inGracePeriod:
                if let exp = t.expirationDate, exp <= now, best.state != .inGracePeriod { return .expired(at: exp) }
                return .active(ActiveMembership(productID: t.productID, originalTransactionID: t.originalTransactionID, expiresAt: t.expirationDate,
                                                willAutoRenew: best.willAutoRenew, inGracePeriod: best.state == .inGracePeriod, environment: t.environment))
            case .inBillingRetryPeriod: return .billingRetry(expiredAt: t.expirationDate)
            case .expired: return .expired(at: t.expirationDate)
            case .revoked: return .revoked(at: t.revocationDate)
            }
        }
        guard let e = currentEntitlement, e.value.productID == productID else { return .notSubscribed }
        guard let t = e.verifiedValue else { return .unverified }
        if t.revocationDate != nil { return .revoked(at: t.revocationDate) }
        if t.isUpgraded { return .notSubscribed }
        if let exp = t.expirationDate, exp <= now { return .expired(at: exp) }
        return .active(ActiveMembership(productID: t.productID, originalTransactionID: t.originalTransactionID, expiresAt: t.expirationDate,
                                        willAutoRenew: nil, inGracePeriod: false, environment: t.environment))
    }

    private static func rank(_ s: MembershipRenewalState) -> Int {
        switch s {
        case .subscribed: return 5
        case .inGracePeriod: return 4
        case .inBillingRetryPeriod: return 3
        case .expired: return 2
        case .revoked: return 1
        }
    }

    /// A purchase result → the outcome. An unverified success is a failure.
    static func purchaseOutcome(_ result: MembershipPurchaseResultFacts, productID: String) -> MembershipPurchaseOutcome {
        switch result {
        case .userCancelled: return .cancelled
        case .pending: return .pending
        case .success(.unverified): return .failed(.unverified)
        case .success(.verified(let t)):
            guard t.productID == productID else { return .failed(.unknown(code: "unexpected_product")) }
            if t.revocationDate != nil { return .failed(.revoked) }
            return .purchased(t)
        }
    }

    /// Restore = the status after `AppStore.sync()`.
    static func restoreOutcome(_ status: MembershipStatus) -> MembershipRestoreOutcome {
        switch status {
        case .active(let a): return .restored(a)
        case .error(let e), .unavailable(let e): return .failed(e)
        case .unverified: return .failed(.unverified)
        case .notSubscribed, .expired, .revoked, .billingRetry, .pending, .loading: return .nothingToRestore
        }
    }
}

/// Mirrors `Product.PurchaseResult`.
enum MembershipPurchaseResultFacts: Equatable, Sendable {
    case success(MembershipVerified<MembershipTransactionFacts>)
    case userCancelled
    case pending
}

// MARK: - Repeated deliveries

/// Transactions already handled this launch — Apple may deliver the same
/// transaction more than once (purchase result + `Transaction.updates`,
/// unfinished transactions again after relaunch). Handling is idempotent:
/// the second delivery of a transaction id is skipped. (The server dedupes
/// independently by transaction id in 6C.)
struct MembershipTransactionLedger: Sendable {
    private var seen: Set<String> = []
    private let limit = 500

    /// True the first time a transaction id is seen.
    mutating func firstDelivery(of transactionID: String) -> Bool {
        if seen.contains(transactionID) { return false }
        if seen.count >= limit { seen.removeAll() }
        seen.insert(transactionID)
        return true
    }
}

// MARK: - Account association

/// The `appAccountToken` for a Sombrey account: a name-based UUID (RFC 4122
/// version 5, SHA-1) of the account's stable Clerk user id in a fixed Sombrey
/// namespace. The same account always yields the same token on any device;
/// different accounts yield different tokens; the token doesn't reveal the id
/// (a one-way hash), and no email or name is involved. The server (6C)
/// recomputes it from the authenticated user to match Apple's transactions
/// to accounts.
enum MembershipAccountToken {
    static let namespace = UUID(uuidString: "155EA3DB-9DE4-4877-A417-FC8CDA0354AF")!
    static let prefix = "sombrey:clerk:"

    static func make(accountID: String) -> UUID? {
        let id = accountID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.count <= 200 else { return nil }
        var data = withUnsafeBytes(of: namespace.uuid) { Data($0) }
        data.append(Data((prefix + id).utf8))
        var bytes = Array(Insecure.SHA1.hash(data: data).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50   // version 5
        bytes[8] = (bytes[8] & 0x3F) | 0x80   // RFC 4122 variant
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}

// MARK: - Server handoff (Phase 6C)

/// What the server needs to verify a transaction itself: Apple's signed JWS
/// (verified server-side against Apple's certificate chain in 6C) plus a few
/// unsigned hints for routing. The phone's own verification is never trusted
/// by the server.
struct MembershipTransactionHandoff: Equatable, Sendable {
    enum Trigger: String, Sendable { case purchase, update, restore, launch }
    let signedTransaction: String       // JWS — never logged
    let transactionID: String
    let originalTransactionID: String
    let productID: String
    let environment: String
    let appAccountToken: UUID?
    let trigger: Trigger
    let observedAt: Date
}

/// The seam Phase 6C fills with a real Convex action that verifies and stores
/// the transaction. Nothing may write subscription state from the client.
protocol MembershipServerHandoff: Sendable {
    func submit(_ handoff: MembershipTransactionHandoff) async
}

/// Phase 6B: no server verification exists yet, so verified transactions are
/// held (latest per original transaction, in memory) and nothing is sent.
actor AwaitingServerVerification: MembershipServerHandoff {
    private(set) var pending: [String: MembershipTransactionHandoff] = [:]
    func submit(_ handoff: MembershipTransactionHandoff) async {
        pending[handoff.originalTransactionID] = handoff
        CommerceDiagnostics.log("handoff held for server verification (6C): trigger=\(handoff.trigger.rawValue) env=\(handoff.environment)")
    }
}

// MARK: - Diagnostics

/// Subscription lifecycle logging (Console.app: subsystem com.sombrey.app,
/// category "commerce"). Never logs signed payloads, card or payment data, or
/// account ids; transaction ids only as a short suffix.
enum CommerceDiagnostics {
    private static let logger = Logger(subsystem: "com.sombrey.app", category: "commerce")
    static func log(_ message: String) { logger.log("\(message, privacy: .public)") }
    static func error(_ message: String) { logger.error("\(message, privacy: .public)") }
    /// "…1234" — enough to correlate, not enough to identify.
    static func redact(_ id: String) -> String { id.count <= 4 ? "…" : "…" + id.suffix(4) }
}
