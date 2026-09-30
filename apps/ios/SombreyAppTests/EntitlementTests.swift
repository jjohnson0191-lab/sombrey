import Testing
import Foundation
@testable import SombreyApp

/// Commerce 6D: the app renders the SERVER's entitlement answer and never
/// decides access itself. SYNTHETIC server responses only.
struct EntitlementTests {
    static func json(state: String, ownsBand: Bool, member: Bool, features: [String: (Bool, String?)],
                     membership: String = #"{"status":"none","source":null,"autoRenew":null,"renewsOrEndsAt":null}"#) -> Data {
        let f = features.map { k, v in #""\#(k)":{"allowed":\#(v.0),"unlockedBy":\#(v.1.map { "\"\($0)\"" } ?? "null")}"# }.joined(separator: ",")
        return Data(#"""
        {"configVersion":"2026-10-provisional.2","state":"\#(state)","ownsBand":\#(ownsBand),"bandSources":[],"subscriptionActive":\#(member),
         "subscriptionSources":[],"capabilities":[],"features":{\#(f)},"membership":\#(membership),
         "offers":{"band":\#(!ownsBand),"membership":\#(!member),"membershipPurchasable":false}}
        """#.utf8)
    }

    static let free: [String: (Bool, String?)] = ["account": (true, nil), "settings": (true, nil), "band_pairing": (true, nil), "core_tracking": (true, nil), "body_scan": (true, nil)]
    static func with(_ extra: [String: (Bool, String?)]) -> [String: (Bool, String?)] { free.merging(extra) { $1 } }

    static let stateA = EntitlementResolver.state(fromServerJSON: json(state: "none", ownsBand: false, member: false, features: with([
        "vitals": (false, "band"), "wearable_data": (false, "band"), "ai_coach": (false, "membership"), "ai_meal_analysis": (false, "membership"), "advanced_intelligence": (false, "membership")])))
    static let stateB = EntitlementResolver.state(fromServerJSON: json(state: "band_owner", ownsBand: true, member: false, features: with([
        "vitals": (true, nil), "wearable_data": (true, nil), "ai_coach": (false, "membership"), "ai_meal_analysis": (false, "membership"), "advanced_intelligence": (false, "membership")])))
    static let stateC = EntitlementResolver.state(fromServerJSON: json(state: "subscriber", ownsBand: false, member: true, features: with([
        "vitals": (false, "band"), "wearable_data": (false, "band"), "ai_coach": (true, nil), "ai_meal_analysis": (true, nil), "advanced_intelligence": (true, nil)])))
    static let stateD = EntitlementResolver.state(fromServerJSON: json(state: "band_owner_subscriber", ownsBand: true, member: true, features: with([
        "vitals": (true, nil), "wearable_data": (true, nil), "ai_coach": (true, nil), "ai_meal_analysis": (true, nil), "advanced_intelligence": (true, nil)])))

    @Test func noBandNoMembershipShowsTheFreeCoreAndSaysWhatUnlocksTheRest() {
        #expect(EntitlementResolver.access(.coreTracking, in: Self.stateA) == .allowed)
        #expect(EntitlementResolver.access(.settings, in: Self.stateA) == .allowed)
        #expect(EntitlementResolver.access(.vitals, in: Self.stateA) == .locked(.band))
        #expect(EntitlementResolver.access(.wearableData, in: Self.stateA) == .locked(.band))
        #expect(EntitlementResolver.access(.aiCoach, in: Self.stateA) == .locked(.membership))
    }

    @Test func bandOwnerGetsTheBandExperienceButNotAI() {
        #expect(EntitlementResolver.access(.vitals, in: Self.stateB) == .allowed)
        #expect(EntitlementResolver.access(.wearableData, in: Self.stateB) == .allowed)
        #expect(EntitlementResolver.access(.aiCoach, in: Self.stateB) == .locked(.membership))
        #expect(EntitlementResolver.access(.aiMealAnalysis, in: Self.stateB) == .locked(.membership))
    }

    @Test func memberWithoutABandGetsAIButNoBandData() {
        #expect(EntitlementResolver.access(.aiCoach, in: Self.stateC) == .allowed)
        #expect(EntitlementResolver.access(.vitals, in: Self.stateC) == .locked(.band))
    }

    @Test func bandAndMembershipGetEverything() {
        for f in FeatureID.allCases { #expect(EntitlementResolver.access(f, in: Self.stateD) == .allowed, "\(f)") }
    }

    @Test func nothingIsAssumedWhenTheServerHasntAnsweredOrCantBeReached() {
        for f: FeatureID in [.vitals, .wearableData, .aiCoach, .aiMealAnalysis] {
            #expect(EntitlementResolver.access(f, in: .checking) == .checking)
            #expect(EntitlementResolver.access(f, in: .unavailable) == .unavailable, "offline or backend down → never access")
        }
    }

    @Test func fakeOrMalformedResponsesAreRejected() {
        #expect(EntitlementResolver.state(fromServerJSON: Data(#"{"isPremium":true}"#.utf8)) == .unavailable, "a made-up premium flag isn't an entitlement")
        #expect(EntitlementResolver.state(fromServerJSON: Data("not json".utf8)) == .unavailable)
        // A response that omits a feature, or names an unknown unlock, fails closed.
        let partial = EntitlementResolver.state(fromServerJSON: Self.json(state: "none", ownsBand: false, member: false, features: Self.free))
        #expect(EntitlementResolver.access(.aiCoach, in: partial) == .unavailable)
        let odd = EntitlementResolver.state(fromServerJSON: Self.json(state: "none", ownsBand: false, member: false, features: ["ai_coach": (false, "vip")]))
        #expect(EntitlementResolver.access(.aiCoach, in: odd) == .unavailable)
    }

    @Test func buildsWithoutTheEntitlementBackendBehaveAsBefore() {
        for f in FeatureID.allCases { #expect(EntitlementResolver.access(f, in: .notEnforced) == .allowed) }
        #expect(EntitlementGateConfig.enabled(from: "enabled"))
        #expect(EntitlementGateConfig.enabled(from: " Enabled "))
        #expect(!EntitlementGateConfig.enabled(from: nil))
        #expect(!EntitlementGateConfig.enabled(from: ""))
        #expect(!EntitlementGateConfig.enabled(from: "$(SOMBREY_COMMERCE_ENTITLEMENTS)"), "an unexpanded build setting isn't 'enabled'")
        #expect(!EntitlementGateConfig.enabled, "no build enables it yet")
    }

    @Test func lockedStatesUseSombreysLabels() {
        #expect(AccessCopy.requirementLabel(.band) == "BAND REQUIRED")
        #expect(AccessCopy.requirementLabel(.membership) == "MEMBERSHIP REQUIRED")
        #expect(AccessCopy.availabilityLabel(.band) == "AVAILABLE WITH YOUR BAND")
        #expect(AccessCopy.availabilityLabel(.membership) == "AVAILABLE WITH MEMBERSHIP")
        for f: FeatureID in [.vitals, .wearableData, .aiCoach, .aiMealAnalysis] {
            #expect(!AccessCopy.title(f).isEmpty && !AccessCopy.message(f).isEmpty)
            #expect(AccessCopy.shortName(f) != nil)
        }
        #expect(AccessCopy.shortName(.advancedIntelligence) == nil, "nothing is advertised that doesn't exist yet")
    }

    @Test func membershipTransitionsReadPlainly() {
        func m(_ status: String, source: String? = "app_store", autoRenew: Bool? = true, at: Double? = 1_790_000_000_000) -> ServerEntitlements.Membership {
            ServerEntitlements.Membership(status: status, source: source, autoRenew: autoRenew, renewsOrEndsAt: at)
        }
        #expect(AccessCopy.membershipLine(m("active")).hasPrefix("Active · renews"))
        #expect(AccessCopy.membershipLine(m("active", autoRenew: false)).hasPrefix("Active · ends"), "cancelled: still active until the period ends")
        #expect(AccessCopy.membershipLine(m("grace_period")).contains("retrying payment"))
        #expect(AccessCopy.membershipLine(m("billing_retry")).hasPrefix("Paused"))
        #expect(AccessCopy.membershipLine(m("expired", at: nil)) == "Ended")
        #expect(AccessCopy.membershipLine(m("refunded", at: nil)) == "Ended by Apple")
        #expect(AccessCopy.membershipLine(m("active", source: "legacy_premium", autoRenew: nil, at: nil)) == "Active · included with your account")
        #expect(AccessCopy.membershipLine(m("none", source: nil, autoRenew: nil, at: nil)) == "Not a member")
        #expect(AccessCopy.bandLine(ownsBand: true) != AccessCopy.bandLine(ownsBand: false))
    }
}
