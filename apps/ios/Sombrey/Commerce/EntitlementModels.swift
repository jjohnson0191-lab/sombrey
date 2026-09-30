import Foundation

// Sombrey Commerce — Phase 6D: what the app is allowed to show, as decided by
// the SERVER (commerce/access:myEntitlements, computed in convex/commerce/
// entitlements.ts from ownership records, verified App Store records and
// legacy access). The app never decides access itself: there is no feature
// matrix here, no local flag, nothing persisted. This file only decodes the
// server's answer, fails closed on anything unexpected, and words the result.
//
// Plain logic (Foundation only) — tested in SombreyAppTests/EntitlementTests.swift.

/// Every access-controlled surface, by the server's stable id
/// (convex/commerce/config.ts FeatureId — a Node test checks they match).
enum FeatureID: String, CaseIterable, Sendable {
    case account = "account"
    case settings = "settings"
    case bandPairing = "band_pairing"
    case coreTracking = "core_tracking"
    case bodyScan = "body_scan"
    case vitals = "vitals"
    case wearableData = "wearable_data"
    case aiCoach = "ai_coach"
    case aiMealAnalysis = "ai_meal_analysis"
    case advancedIntelligence = "advanced_intelligence"
}

/// What would unlock a locked feature (the server's `unlockedBy`).
enum AccessUnlock: String, Equatable, Sendable {
    case band = "band"
    case membership = "membership"
    case bandAndMembership = "band_and_membership"
}

/// The server's entitlement answer, as sent. Unknown extra fields are ignored.
struct ServerEntitlements: Decodable, Equatable, Sendable {
    struct Feature: Decodable, Equatable, Sendable {
        let allowed: Bool
        let unlockedBy: String?
    }
    struct Membership: Decodable, Equatable, Sendable {
        let status: String
        let source: String?
        let autoRenew: Bool?
        let renewsOrEndsAt: Double?
    }
    struct Offers: Decodable, Equatable, Sendable {
        let band: Bool
        let membership: Bool
        let membershipPurchasable: Bool
    }
    let configVersion: String
    let state: String
    let ownsBand: Bool
    let subscriptionActive: Bool
    let features: [String: Feature]
    let membership: Membership
    let offers: Offers
}

/// Where the app is in learning the server's answer.
enum EntitlementState: Equatable, Sendable {
    /// This build's backend has no entitlements (commerce not deployed there):
    /// access control is off and the app behaves exactly as before 6D.
    case notEnforced
    /// Waiting for the server's first answer this session.
    case checking
    case ready(ServerEntitlements)
    /// The server couldn't be reached and there's no answer from this session.
    case unavailable
}

/// What a gated surface may do right now.
enum FeatureAccess: Equatable, Sendable {
    case allowed
    case locked(AccessUnlock)
    case checking
    case unavailable
}

enum EntitlementResolver {
    /// The server's answer for one feature. Anything missing or unrecognised
    /// fails CLOSED (`.unavailable`) — the app never assumes access.
    static func access(_ feature: FeatureID, in state: EntitlementState) -> FeatureAccess {
        switch state {
        case .notEnforced: return .allowed
        case .checking: return .checking
        case .unavailable: return .unavailable
        case .ready(let e):
            guard let f = e.features[feature.rawValue] else { return .unavailable }
            if f.allowed { return .allowed }
            guard let raw = f.unlockedBy, let unlock = AccessUnlock(rawValue: raw) else { return .unavailable }
            return .locked(unlock)
        }
    }

    /// Decodes the server's JSON; malformed data is rejected (→ `.unavailable`), never trusted.
    static func state(fromServerJSON data: Data) -> EntitlementState {
        guard let e = try? JSONDecoder().decode(ServerEntitlements.self, from: data) else { return .unavailable }
        return .ready(e)
    }
}

// MARK: - Presentation (words only — no rules)

enum AccessCopy {
    /// The eyebrow on a locked surface.
    static func requirementLabel(_ unlock: AccessUnlock) -> String {
        switch unlock {
        case .band: return "BAND REQUIRED"
        case .membership: return "MEMBERSHIP REQUIRED"
        case .bandAndMembership: return "BAND + MEMBERSHIP REQUIRED"
        }
    }

    /// The eyebrow on an included surface (e.g. in Settings).
    static func availabilityLabel(_ unlock: AccessUnlock) -> String {
        switch unlock {
        case .band: return "AVAILABLE WITH YOUR BAND"
        case .membership: return "AVAILABLE WITH MEMBERSHIP"
        case .bandAndMembership: return "AVAILABLE WITH BAND + MEMBERSHIP"
        }
    }

    static func title(_ feature: FeatureID) -> String {
        switch feature {
        case .vitals: return "Vitals come from your Band"
        case .wearableData: return "Readiness and Strain come from your Band"
        case .aiCoach: return "Sombrey Coach is part of Membership"
        case .aiMealAnalysis: return "Photo analysis is part of Membership"
        case .advancedIntelligence: return "Part of Membership"
        case .account, .settings, .bandPairing, .coreTracking, .bodyScan: return "Sombrey"
        }
    }

    static func message(_ feature: FeatureID) -> String {
        switch feature {
        case .vitals: return "Heart rate, SpO2, HRV, temperature and more — measured by the Sombrey Band as you wear it."
        case .wearableData: return "Your Band reads sleep, heart and movement so Sombrey can score each day. Everything it records stays in your account."
        case .aiCoach: return "Ask about your training, recovery and nutrition, answered from your own data."
        case .aiMealAnalysis: return "Photograph a meal and Sombrey estimates it. Searching and logging foods yourself stays free."
        case .advancedIntelligence: return "Deeper intelligence built on your own data."
        case .account, .settings, .bandPairing, .coreTracking, .bodyScan: return ""
        }
    }

    /// How a paid feature is named in "what's included" lists; nil for free
    /// features and for reserved ids with no surface in the app yet.
    static func shortName(_ feature: FeatureID) -> String? {
        switch feature {
        case .vitals: return "Vitals"
        case .wearableData: return "Readiness, Strain and sleep"
        case .aiCoach: return "Sombrey Coach"
        case .aiMealAnalysis: return "AI Macro Calculator"
        case .advancedIntelligence, .account, .settings, .bandPairing, .coreTracking, .bodyScan: return nil
        }
    }

    static let checking = "Checking your access…"
    static let unavailable = "We couldn't check your access just now."

    /// "Active · renews 31 Oct" and similar — the server's membership summary in plain words.
    static func membershipLine(_ m: ServerEntitlements.Membership, now: Date = Date(), calendar: Calendar = .current) -> String {
        let date: String? = m.renewsOrEndsAt.map { ms in
            let f = DateFormatter()
            f.calendar = calendar
            f.setLocalizedDateFormatFromTemplate("d MMM")
            return f.string(from: Date(timeIntervalSince1970: ms / 1000))
        }
        switch m.status {
        case "active":
            if m.source == "legacy_premium" { return "Active · included with your account" }
            if let date { return m.autoRenew == false ? "Active · ends \(date)" : "Active · renews \(date)" }
            return "Active"
        case "grace_period": return date.map { "Active · Apple is retrying payment until \($0)" } ?? "Active · Apple is retrying payment"
        case "billing_retry": return "Paused · Apple couldn't take payment"
        case "expired": return "Ended"
        case "revoked", "refunded": return "Ended by Apple"
        default: return "Not a member"
        }
    }

    static func bandLine(ownsBand: Bool) -> String { ownsBand ? "Verified on your account" : "No Band on your account yet" }
}

/// Whether this build's backend serves entitlements: the Info.plist key
/// `SombreyCommerceEntitlements`, from the `SOMBREY_COMMERCE_ENTITLEMENTS`
/// build setting (Secrets.xcconfig / Codemagic). Set it to "enabled" ONLY
/// for a build whose Convex deployment has the Phase 6D backend. Empty (every
/// build today) = not enforced: the app behaves exactly as before 6D.
enum EntitlementGateConfig {
    static let infoPlistKey = "SombreyCommerceEntitlements"

    static func enabled(from raw: String?) -> Bool {
        raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "enabled"
    }

    static var enabled: Bool { enabled(from: Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String) }
}
