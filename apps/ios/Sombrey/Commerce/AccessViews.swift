import SwiftUI

// Sombrey Commerce — Phase 6D: how access shows up in the app.
//
//   FeatureGate          wraps a gated surface: the content when the server
//                        allows it; otherwise an intentional, calm card that
//                        says what unlocks it (never a broken or empty screen)
//   AccessGateCard       that card — Sombrey glass, one eyebrow, one line
//   SombreyAccessSheet   what Sombrey is, what the Band and Membership each
//                        unlock (from the server's matrix), status, prices
//                        (server config / Apple's price), Membership through
//                        the existing StoreKit layer, Restore Purchases
//
// No access rules here: every decision comes from EntitlementStore (server).
// Band checkout is a later phase — the sheet says so rather than faking one.

/// Shows `content` only when the server allows `feature`.
struct FeatureGate<Content: View>: View {
    let feature: FeatureID
    @ViewBuilder let content: () -> Content
    @Environment(EntitlementStore.self) private var entitlements

    var body: some View {
        switch entitlements.access(feature) {
        case .allowed:
            content()
        case .locked(let unlock):
            AccessGateCard(feature: feature, unlock: unlock)
        case .checking:
            AccessStatusCard(text: AccessCopy.checking, retry: nil)
        case .unavailable:
            AccessStatusCard(text: AccessCopy.unavailable) { entitlements.refresh() }
        }
    }
}

/// A locked surface: premium and intentional, not a paywall.
struct AccessGateCard: View {
    let feature: FeatureID
    let unlock: AccessUnlock
    @Environment(EntitlementStore.self) private var entitlements
    @State private var showingAccess = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(AccessCopy.requirementLabel(unlock))
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.accentInk)
            Text(AccessCopy.title(feature))
                .font(StudioFont.hero(20, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(AccessCopy.message(feature))
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Button { showingAccess = true } label: {
                Text(unlock == .membership ? "About Membership" : "About the Sombrey Band")
            }
            .buttonStyle(.outlineCTA)
            .padding(.top, 6)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 24) }
        .sensoryFeedback(StudioHaptic.expand, trigger: showingAccess)
        .sheet(isPresented: $showingAccess) { SombreyAccessSheet() }
        .task { await entitlements.noteLocked(feature) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("access.gate.\(feature.rawValue)")
    }
}

/// Checking / couldn't check — neutral, never "allowed".
struct AccessStatusCard: View {
    let text: String
    let retry: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            if retry == nil { ProgressView().tint(StudioColor.inkSoft) }
            Text(text)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
            Spacer(minLength: 8)
            if let retry {
                Button("Try again", action: retry)
                    .font(StudioFont.body(13, weight: .semibold))
                    .foregroundStyle(StudioColor.accentInk)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 24) }
    }
}

/// The server's public commerce configuration (prices are provisional and
/// live in convex/commerce/config.ts — never in the app).
struct PublicCommerceConfigDTO: Decodable, Equatable {
    struct Product: Decodable, Equatable { let priceCents: Int; let currency: String }
    let band: Product
    let membership: Product
    let featureUnlocks: [String: String?]
}

/// Settings › Membership & Band, and every "About…" on a locked card.
struct SombreyAccessSheet: View {
    @Environment(EntitlementStore.self) private var entitlements
    @Environment(MembershipManager.self) private var membership
    @State private var config = ConvexQuery<PublicCommerceConfigDTO>()
    @State private var message: String?
    @State private var working = false

    private var e: ServerEntitlements? { entitlements.entitlements }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SombreyLogo(size: .header, tone: .onLight)
                    .padding(.top, 20)
                Text("Sombrey")
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text("The Sombrey Band reads your body as you wear it. Membership adds Sombrey's intelligence on top. Each works on its own; together they're the full Sombrey.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)

                productBlock(
                    eyebrow: "SOMBREY BAND",
                    status: e.map { AccessCopy.bandLine(ownsBand: $0.ownsBand) },
                    price: config.value.map { Self.money($0.band) },
                    includes: includes(.band),
                    note: e?.offers.band == true ? "Band purchasing isn't open in the app yet." : nil
                )

                productBlock(
                    eyebrow: "MEMBERSHIP",
                    status: e.map { AccessCopy.membershipLine($0.membership) },
                    price: membershipPrice,
                    includes: includes(.membership),
                    note: e?.offers.membership == true && e?.offers.membershipPurchasable != true ? "Membership isn't open in the app yet." : nil
                )

                if e?.offers.membershipPurchasable == true, let product = membership.product.purchasable {
                    Button {
                        Task { await join() }
                    } label: {
                        Text(working ? "Opening the App Store…" : "Join Membership · \(product.displayPrice)/month").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(working)
                    Text("Starts when you confirm with Apple and renews monthly until you cancel. Cancel any time in your Apple ID settings.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await restore() }
                } label: {
                    Text("Restore purchases").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
                .disabled(working)

                if let message {
                    Text(message)
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if case .unavailable = entitlements.state {
                    AccessStatusCard(text: AccessCopy.unavailable) { entitlements.refresh() }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .background(StudioColor.env4.ignoresSafeArea())
        .task {
            config.subscribe(to: "commerce/access:publicConfig")
            if membership.productID != nil { await membership.loadProduct() }
        }
    }

    // MARK: Pieces

    private func productBlock(eyebrow: String, status: String?, price: String?, includes: [String], note: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(eyebrow)
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                Spacer()
                if let price {
                    Text(price)
                        .font(StudioFont.body(13, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                }
            }
            if let status {
                Text(status)
                    .font(StudioFont.hero(18, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
            }
            ForEach(includes, id: \.self) { item in
                Text("· \(item)")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            if let note {
                Text(note)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkFaint)
                    .padding(.top, 2)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 24) }
    }

    /// What the Band / Membership unlocks — from the server's matrix.
    private func includes(_ unlock: AccessUnlock) -> [String] {
        guard let unlocks = config.value?.featureUnlocks else { return [] }
        return FeatureID.allCases.compactMap { f in
            guard case .some(.some(let raw)) = unlocks[f.rawValue], raw == unlock.rawValue else { return nil }
            return AccessCopy.shortName(f)
        }
    }

    /// Apple's localized price once the product has loaded (what's charged); otherwise the configured one.
    private var membershipPrice: String? {
        if let p = membership.product.purchasable { return "\(p.displayPrice) / month" }
        return config.value.map { "\(Self.money($0.membership)) / month" }
    }

    static func money(_ p: PublicCommerceConfigDTO.Product) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = p.currency
        return f.string(from: NSNumber(value: Double(p.priceCents) / 100)) ?? "\(p.currency) \(p.priceCents / 100)"
    }

    // MARK: Actions (the existing StoreKit layer — no second payment path)

    private func join() async {
        working = true
        defer { working = false }
        switch await membership.purchase() {
        case .purchased: message = "Thanks — confirming with Apple. Membership appears here as soon as it's verified."
        case .pending: message = MembershipError.pending.userMessage
        case .cancelled: message = nil
        case .failed(let e): message = e.userMessage
        }
    }

    private func restore() async {
        working = true
        defer { working = false }
        switch await membership.restorePurchases() {
        case .restored: message = "Restored. Membership appears here as soon as Sombrey has confirmed it with Apple."
        case .nothingToRestore: message = "There's no Sombrey Membership on this Apple ID to restore."
        case .failed(let e): message = e.userMessage
        }
        entitlements.refresh()
    }
}
