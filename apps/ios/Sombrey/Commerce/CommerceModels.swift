import Foundation

// Sombrey Commerce — Phase 6H: the customer-facing words for commerce, from
// SERVER answers only (commerce/access:publicConfig · myEntitlements · myOrders,
// commerce/orderTracking, commerce/myDevices). Presentation, never authority:
// nothing here unlocks a feature, owns a Band, prices a product or moves an
// order. Anything missing or unrecognised reads as "unavailable", never as
// success. Plain logic (Foundation only) — tested in SombreyAppTests/CommerceModelsTests.swift.

// MARK: - Prices

enum PriceText {
    /// The server's price, formatted; "Price unavailable" if it isn't a valid price.
    static func format(cents: Int?, currency: String?, locale: Locale = .current) -> String {
        guard let cents, cents > 0, cents < 100_000_000, let currency, currency.count == 3, currency.uppercased() == currency else { return "Price unavailable" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.locale = locale
        return f.string(from: NSNumber(value: Double(cents) / 100)) ?? "Price unavailable"
    }
}

// MARK: - Band (product + ownership)

/// Whether the Band can be bought in the app right now — the server says (no
/// payment provider = no checkout). A price alone never opens checkout.
enum BandCheckout: Equatable, Sendable {
    case available
    case unavailable
    case alreadyOwned

    static func state(checkoutAvailable: Bool?, ownsBand: Bool?) -> BandCheckout {
        if ownsBand == true { return .alreadyOwned }
        return checkoutAvailable == true ? .available : .unavailable
    }

    var note: String {
        switch self {
        case .available: return "Ships to the countries Sombrey serves. Shipping and taxes are calculated at checkout."
        case .unavailable: return "Band checkout isn't open in the app yet."
        case .alreadyOwned: return "You have a Sombrey Band on your account."
        }
    }
}

/// One device from commerce/myDevices (never a full hardware identifier).
struct OwnedDeviceDTO: Decodable, Equatable, Sendable {
    let productName: String
    let generation: String
    let identifier: String          // already redacted by the server ("…A1B2")
    let status: String              // activated | replaced | returned | deactivated
    let activatedAt: Double?
    let endedAt: Double?
    let pairedOnThisAccount: Bool
}

enum DeviceCopy {
    /// "Sombrey Band V1".
    static func title(_ d: OwnedDeviceDTO) -> String { "\(d.productName) \(d.generation)" }

    static func status(_ d: OwnedDeviceDTO) -> String {
        switch d.status {
        case "activated": return "Active"
        case "replaced": return "Replaced"
        case "returned": return "Returned"
        case "deactivated": return "No longer active"
        default: return "Status unavailable"
        }
    }

    static func pairing(_ d: OwnedDeviceDTO) -> String? {
        guard d.status == "activated" else { return nil }
        return d.pairedOnThisAccount ? "Paired" : "Not paired with this iPhone yet"
    }

    /// The redacted identifier is shown only to tell several Bands apart.
    static func showsIdentifier(among devices: [OwnedDeviceDTO]) -> Bool { devices.count > 1 }
}

/// What the Band screen says about ownership. Ownership is the SERVER's
/// (entitlements.ownsBand) — a pairing or a local device never counts.
enum BandOwnership: Equatable, Sendable {
    case checking
    case unavailable
    case owned(active: Int)
    case notOwned

    static func from(ownsBand: Bool?, devices: [OwnedDeviceDTO]?) -> BandOwnership {
        guard let ownsBand else { return .unavailable }
        guard ownsBand else { return .notOwned }
        return .owned(active: (devices ?? []).filter { $0.status == "activated" }.count)
    }
}

// MARK: - Activation

enum ActivationCopy {
    /// Enables the button only; the server decides everything.
    static func looksLikeACode(_ raw: String) -> Bool {
        let s = raw.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        let allowed = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZOIL")
        return s.count == 12 && s.allSatisfy { allowed.contains($0) }
    }

    /// The server's answer (commerce/myDevices:activateDevice) in plain words.
    /// Only "activated"/"already_active" are success; anything else isn't.
    static func outcome(_ status: String) -> (success: Bool, message: String) {
        switch status {
        case "activated": return (true, "Your Sombrey Band is active.")
        case "already_active": return (true, "This Sombrey Band is already active on your account.")
        case "invalid_code": return (false, "That code doesn't match a Sombrey Band. Check it and try again.")
        case "too_many_attempts": return (false, "Too many attempts. Please try again in an hour.")
        case "not_delivered": return (false, "This Band can be activated once it has been delivered.")
        case "not_paid": return (false, "This Band's order isn't paid.")
        case "already_activated": return (false, "This Band is already active on another account.")
        case "not_eligible_for_account": return (false, "This Band belongs to a different order or account.")
        case "not_activatable", "product_not_supported": return (false, "This Band can't be activated. Contact Sombrey support.")
        default: return (false, "Activation isn't available right now. Please try again later.")
        }
    }
}

// MARK: - Orders

struct OrderSummaryDTO: Decodable, Equatable, Sendable, Identifiable {
    struct Line: Decodable, Equatable, Sendable { let productId: String; let displayName: String; let quantity: Int }
    let orderId: String
    let orderNumber: String
    let createdAt: Double
    let stage: String
    let currency: String
    let lines: [Line]
    let totalCents: Int?
    var id: String { orderId }
}

enum OrderStatusCopy {
    /// The server's order stage in customer words. Unknown → "Status unavailable".
    static func stage(_ s: String) -> String {
        switch s {
        case "draft", "quote_ready": return "Checkout not finished"
        case "payment_pending": return "Payment pending"
        case "payment_failed": return "Payment didn't go through"
        case "cancelled": return "Cancelled"
        case "paid": return "Order confirmed"
        case "fulfillment_pending": return "Preparing"
        case "shipped": return "Shipped"
        case "delivered": return "Delivered"
        case "delivery_failed": return "Delivery problem"
        case "return_requested": return "Return requested"
        case "return_authorized": return "Return approved"
        case "return_in_transit": return "Return on its way"
        case "return_received": return "Return received"
        case "refunded": return "Refunded"
        default: return "Status unavailable"
        }
    }

    static func items(_ o: OrderSummaryDTO) -> String {
        o.lines.map { "\($0.displayName) × \($0.quantity)" }.joined(separator: ", ")
    }
}

// MARK: - Tracking (real provider state only)

struct OrderTrackingDTO: Decodable, Equatable, Sendable {
    struct Step: Decodable, Equatable, Sendable { let step: String; let reached: Bool }
    struct Shipment: Decodable, Equatable, Sendable {
        let tracking: String                 // "available" | "unavailable"
        let status: String
        let carrier: String?
        let trackingNumber: String?
        let trackingUrl: String?
        let estimatedDeliveryAt: Double?
        let lastUpdateAt: Double?
    }
    struct ReturnSummary: Decodable, Equatable, Sendable { let status: String; let refunded: Bool }
    let orderNumber: String
    let stage: String
    let steps: [Step]
    let deliveryProblem: Bool
    let shipments: [Shipment]
    let returns: [ReturnSummary]
}

enum TrackingCopy {
    static let unavailable = "Tracking information unavailable"

    static func step(_ s: String) -> String {
        switch s {
        case "confirmed": return "Order confirmed"
        case "preparing": return "Preparing"
        case "shipped": return "Shipped"
        case "in_transit": return "In transit"
        case "out_for_delivery": return "Out for delivery"
        case "delivered": return "Delivered"
        default: return s
        }
    }

    /// What can honestly be shown for a shipment: carrier + number (+ https link,
    /// + the carrier's own ETA) only when the provider supplied them.
    struct ShipmentLine: Equatable { let carrier: String; let number: String; let url: URL?; let eta: Date? }

    static func line(_ s: OrderTrackingDTO.Shipment) -> ShipmentLine? {
        guard s.tracking == "available", let number = s.trackingNumber, !number.isEmpty, let carrier = s.carrier, !carrier.isEmpty else { return nil }
        let url = s.trackingUrl.flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
        return ShipmentLine(carrier: carrier, number: number, url: url, eta: s.estimatedDeliveryAt.map { Date(timeIntervalSince1970: $0 / 1000) })
    }
}

struct ReturnOptionsDTO: Decodable, Equatable, Sendable {
    let eligible: Bool
    let reason: String?
    let windowEndsAt: Double?
}

enum ReturnCopy {
    /// A return's own status (commerce/orderTracking) in customer words.
    static func status(_ s: String) -> String {
        switch s {
        case "requested": return "Return requested"
        case "authorized": return "Return approved — send it back with the label Sombrey provides"
        case "in_transit": return "Return on its way to Sombrey"
        case "received": return "Return received — being checked"
        case "refund_approved": return "Refund approved — waiting for the payment provider"
        case "refunded": return "Refunded"
        case "rejected": return "Return not accepted"
        case "cancelled": return "Return cancelled"
        default: return "Return status unavailable"
        }
    }

    static func options(_ r: ReturnOptionsDTO, calendar: Calendar = .current) -> String? {
        let date = r.windowEndsAt.map { ms -> String in
            let f = DateFormatter(); f.calendar = calendar; f.setLocalizedDateFormatFromTemplate("d MMM yyyy")
            return f.string(from: Date(timeIntervalSince1970: ms / 1000))
        }
        if r.eligible { return date.map { "Return available until \($0) — unused Bands only." } ?? "Return available — unused Bands only." }
        switch r.reason {
        case "outside_return_window": return "The 30-day return window has closed."
        case "return_already_started": return nil      // the return's own status is shown
        case "not_delivered": return "Returns open once your order is delivered."
        default: return nil
        }
    }
}

// MARK: - Membership

enum RestoreCopy {
    static func message(_ outcome: MembershipRestoreOutcome) -> String {
        switch outcome {
        case .restored: return "Restored. Your membership appears here as soon as Sombrey has confirmed it with Apple."
        case .nothingToRestore: return "There's no Sombrey Membership on this Apple ID to restore."
        case .failed(.unverified): return "Apple couldn't verify this purchase, so nothing was restored."
        case .failed(.notConfigured), .failed(.productUnavailable), .failed(.storeUnavailable): return "Restore isn't available right now. Please try again later."
        case .failed(let e): return e.userMessage
        }
    }
}

enum CommerceUnavailable {
    static let membership = "Membership status unavailable."
    static let band = "Band status unavailable."
    static let orders = "Order status unavailable."
    static let checkout = "Checkout unavailable."
    static let activation = "Activation unavailable."
    /// 6I: the server answered earlier this session but can't be reached now.
    static let lastConfirmed = "Couldn't refresh. Showing your last confirmed status."
    static let lastLoadedOrders = "Couldn't refresh. Showing your orders as last loaded."
}

/// 6I: what a server-backed screen shows while loading or after a failure.
/// A failure never erases what was already loaded, and never presents it as
/// current: it's shown with a "couldn't refresh" notice.
enum LoadPresentation: Equatable, Sendable {
    case loading
    case unavailable
    case empty
    case current
    case lastLoaded

    static func of(hasValue: Bool, isEmpty: Bool, failed: Bool) -> LoadPresentation {
        if failed { return hasValue ? .lastLoaded : .unavailable }
        guard hasValue else { return .loading }
        return isEmpty ? .empty : .current
    }
}
