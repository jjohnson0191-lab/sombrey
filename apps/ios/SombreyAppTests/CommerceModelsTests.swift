import Testing
import Foundation
@testable import SombreyApp

/// Commerce 6H: the app words SERVER answers and never decides anything.
/// SYNTHETIC server responses only.
struct CommerceModelsTests {
    static func device(_ status: String, paired: Bool = false, id: String = "…0A1B") -> OwnedDeviceDTO {
        OwnedDeviceDTO(productName: "Sombrey Band", generation: "V1", identifier: id, status: status, activatedAt: 1, endedAt: nil, pairedOnThisAccount: paired)
    }

    @Test func pricesComeFromTheServerOrReadUnavailable() {
        let us = Locale(identifier: "en_US")
        #expect(PriceText.format(cents: 10000, currency: "USD", locale: us) == "$100.00")
        for (cents, currency): (Int?, String?) in [(nil, "USD"), (0, "USD"), (-100, "USD"), (10000, nil), (10000, "usd"), (10000, "DOLLARS")] {
            #expect(PriceText.format(cents: cents, currency: currency, locale: us) == "Price unavailable")
        }
    }

    @Test func checkoutOpensOnlyWhenTheServerSaysSo() {
        #expect(BandCheckout.state(checkoutAvailable: nil, ownsBand: false) == .unavailable)
        #expect(BandCheckout.state(checkoutAvailable: false, ownsBand: false) == .unavailable, "a price alone never opens checkout")
        #expect(BandCheckout.state(checkoutAvailable: true, ownsBand: false) == .available)
        #expect(BandCheckout.state(checkoutAvailable: true, ownsBand: true) == .alreadyOwned)
        #expect(BandCheckout.unavailable.note.contains("isn't open"))
    }

    @Test func bandOwnershipIsTheServersNotThePairings() {
        #expect(BandOwnership.from(ownsBand: nil, devices: [Self.device("activated", paired: true)]) == .unavailable, "no server answer → unavailable, whatever is paired")
        #expect(BandOwnership.from(ownsBand: false, devices: [Self.device("activated", paired: true)]) == .notOwned, "a paired or listed device doesn't make an owner")
        #expect(BandOwnership.from(ownsBand: true, devices: [Self.device("activated"), Self.device("replaced")]) == .owned(active: 1))
        #expect(BandOwnership.from(ownsBand: true, devices: nil) == .owned(active: 0), "a staff-granted Band with no device record")
    }

    @Test func devicesReadPlainlyAndNeverShowAFullIdentifier() {
        #expect(DeviceCopy.title(Self.device("activated")) == "Sombrey Band V1")
        #expect(DeviceCopy.status(Self.device("activated")) == "Active")
        #expect(DeviceCopy.status(Self.device("replaced")) == "Replaced")
        #expect(DeviceCopy.status(Self.device("returned")) == "Returned")
        #expect(DeviceCopy.status(Self.device("deactivated")) == "No longer active")
        #expect(DeviceCopy.status(Self.device("mystery")) == "Status unavailable")
        #expect(DeviceCopy.pairing(Self.device("activated", paired: true)) == "Paired")
        #expect(DeviceCopy.pairing(Self.device("returned", paired: true)) == nil)
        #expect(!DeviceCopy.showsIdentifier(among: [Self.device("activated")]))
        #expect(DeviceCopy.showsIdentifier(among: [Self.device("activated"), Self.device("activated", id: "…9C2D")]), "only to tell several Bands apart — and it's the server's redacted form")
    }

    @Test func activationSucceedsOnlyWhenTheServerConfirms() {
        #expect(ActivationCopy.outcome("activated").success)
        #expect(ActivationCopy.outcome("already_active").success)
        for status in ["invalid_code", "too_many_attempts", "not_delivered", "not_paid", "already_activated", "not_eligible_for_account", "not_activatable", "activation_unavailable", "", "something_new"] {
            #expect(!ActivationCopy.outcome(status).success, "\(status)")
            #expect(!ActivationCopy.outcome(status).message.isEmpty)
        }
        #expect(ActivationCopy.looksLikeACode("ABCD-EFGH-JKMN"))
        #expect(ActivationCopy.looksLikeACode(" abcd efgh jkmn "))
        #expect(!ActivationCopy.looksLikeACode("ABCD"))
        #expect(!ActivationCopy.looksLikeACode("UUUU-UUUU-UUUU"))
    }

    @Test func orderStagesAreHumanAndUnknownsAreHonest() {
        #expect(OrderStatusCopy.stage("paid") == "Order confirmed")
        #expect(OrderStatusCopy.stage("fulfillment_pending") == "Preparing")
        #expect(OrderStatusCopy.stage("return_in_transit") == "Return on its way")
        #expect(OrderStatusCopy.stage("refunded") == "Refunded")
        #expect(OrderStatusCopy.stage("draft") == "Checkout not finished")
        #expect(OrderStatusCopy.stage("teleported") == "Status unavailable")
        let o = OrderSummaryDTO(orderId: "o1", orderNumber: "SB-AAAA2222", createdAt: 1, stage: "shipped", currency: "USD",
                                lines: [.init(productId: "sombrey_band", displayName: "Sombrey Band", quantity: 2)], totalCents: nil)
        #expect(OrderStatusCopy.items(o) == "Sombrey Band × 2")
    }

    @Test func trackingIsShownOnlyWhenTheCarrierActuallyGaveIt() {
        func ship(_ tracking: String, number: String? = nil, carrier: String? = nil, url: String? = nil, eta: Double? = nil) -> OrderTrackingDTO.Shipment {
            .init(tracking: tracking, status: "in_transit", carrier: carrier, trackingNumber: number, trackingUrl: url, estimatedDeliveryAt: eta, lastUpdateAt: nil)
        }
        #expect(TrackingCopy.line(ship("unavailable")) == nil)
        #expect(TrackingCopy.line(ship("available", number: nil, carrier: "C")) == nil)
        #expect(TrackingCopy.line(ship("available", number: "TRK1", carrier: nil)) == nil)
        let l = TrackingCopy.line(ship("available", number: "TRK1", carrier: "TestCarrier", url: "http://insecure.example"))
        #expect(l?.number == "TRK1" && l?.url == nil && l?.eta == nil, "no http links, no invented ETA")
        #expect(TrackingCopy.line(ship("available", number: "TRK1", carrier: "C", url: "https://carrier.example/t", eta: 1_790_000_000_000))?.eta != nil)
        #expect(TrackingCopy.unavailable == "Tracking information unavailable")
    }

    @Test func returnsAndRefundsReadFromTheServer() {
        #expect(ReturnCopy.options(.init(eligible: true, reason: nil, windowEndsAt: 1_790_000_000_000))?.hasPrefix("Return available until") == true)
        #expect(ReturnCopy.options(.init(eligible: false, reason: "outside_return_window", windowEndsAt: 1)) == "The 30-day return window has closed.")
        #expect(ReturnCopy.options(.init(eligible: false, reason: "return_already_started", windowEndsAt: 1)) == nil)
        #expect(ReturnCopy.status("refunded") == "Refunded")
        #expect(ReturnCopy.status("refund_approved").contains("waiting"), "approval isn't a refund")
        #expect(ReturnCopy.status("??") == "Return status unavailable")
    }

    @Test func restoreFeedbackIsCalmAndHonest() {
        let active = ActiveMembership(productID: "p", originalTransactionID: "1", expiresAt: nil, willAutoRenew: true, inGracePeriod: false, environment: "sandbox")
        #expect(RestoreCopy.message(.restored(active)).contains("as soon as Sombrey has confirmed"), "restored on the phone isn't membership until the server confirms")
        #expect(RestoreCopy.message(.nothingToRestore).contains("no Sombrey Membership"))
        #expect(RestoreCopy.message(.failed(.unverified)).contains("couldn't verify"))
        #expect(RestoreCopy.message(.failed(.storeUnavailable)).contains("isn't available"))
    }

    /// 6I: a failed refresh never erases loaded data and never presents it as current.
    @Test func failedRefreshKeepsWhatWasLoadedAndSaysSo() {
        #expect(LoadPresentation.of(hasValue: false, isEmpty: true, failed: false) == .loading)
        #expect(LoadPresentation.of(hasValue: false, isEmpty: true, failed: true) == .unavailable)
        #expect(LoadPresentation.of(hasValue: true, isEmpty: true, failed: false) == .empty)
        #expect(LoadPresentation.of(hasValue: true, isEmpty: false, failed: false) == .current)
        #expect(LoadPresentation.of(hasValue: true, isEmpty: false, failed: true) == .lastLoaded, "loaded orders stay on screen after an error")
        #expect(LoadPresentation.of(hasValue: true, isEmpty: true, failed: true) == .lastLoaded)
        #expect(CommerceUnavailable.lastLoadedOrders.contains("last loaded"))
        #expect(CommerceUnavailable.lastConfirmed.contains("last confirmed"))
    }

    @Test func cancelledMembershipStaysActiveUntilItEnds() {
        let cancelled = ServerEntitlements.Membership(status: "active", source: "app_store", autoRenew: false, renewsOrEndsAt: 1_790_000_000_000)
        #expect(AccessCopy.membershipLine(cancelled).hasPrefix("Active · ends"))
        let ended = ServerEntitlements.Membership(status: "expired", source: "app_store", autoRenew: false, renewsOrEndsAt: nil)
        #expect(AccessCopy.membershipLine(ended) == "Ended")
    }
}
