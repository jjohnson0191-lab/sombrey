import SwiftUI
import StoreKit
import ConvexMobile

// Sombrey Commerce — Phase 6H: the customer's Membership, Band and Orders.
//
// Lives in Settings › Account (no new tab). Every value shown comes from the
// server (commerce/access, commerce/orderTracking, commerce/myDevices) or, for
// the membership price, from Apple. Nothing here grants access, owns a Band,
// prices anything or moves an order — when the server can't answer, the screen
// says so. Membership is bought only through StoreKit (MembershipManager); the
// Band is never an in-app purchase, and its checkout says "unavailable" until
// the server opens it. Activation is code entry + a server check — it never
// touches Bluetooth.

// MARK: - Analytics (client events only; no addresses, codes or device ids)

enum CommerceAnalytics {
    @MainActor
    static func record(_ name: String, productId: String? = nil, source: String? = nil) async {
        guard EntitlementGateConfig.enabled else { return }
        var args: [String: ConvexEncodable?] = ["name": name, "platform": "ios"]
        if let productId { args["productId"] = productId }
        if let source { args["source"] = source }
        try? await ConvexClientProvider.client.mutation("commerce/access:recordEvent", with: args)
    }
}

// MARK: - Shared pieces

/// A quiet glass section with an eyebrow — the Studio chamber, not a store card.
struct CommerceSection<Content: View>: View {
    let eyebrow: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow)
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.inkSoft)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 24) }
    }
}

/// "… unavailable" with an optional retry — never a guess.
struct CommerceNotice: View {
    let text: String
    var retry: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            Text(text).font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
            Spacer(minLength: 8)
            if let retry {
                Button("Try again", action: retry)
                    .font(StudioFont.body(13, weight: .semibold))
                    .foregroundStyle(StudioColor.accentInk)
                    .frame(minHeight: 44)
            }
        }
    }
}

private struct CommerceLoading: View {
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().tint(StudioColor.inkSoft)
            Text("Loading…").font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CommerceHeader: View {
    let title: String
    let line: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(StudioFont.hero(28, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .accessibilityAddTraits(.isHeader)
            Text(line)
                .font(StudioFont.body(14))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 8)
    }
}

private func bullets(_ items: [String]) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        ForEach(items, id: \.self) { Text("· \($0)").font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft) }
    }
}

/// What a product unlocks — from the server's feature matrix (publicConfig).
private func includes(_ config: PublicCommerceConfigDTO?, _ unlock: AccessUnlock) -> [String] {
    guard let unlocks = config?.featureUnlocks else { return [] }
    return FeatureID.allCases.compactMap { f in
        guard case .some(.some(let raw)) = unlocks[f.rawValue], raw == unlock.rawValue else { return nil }
        return AccessCopy.shortName(f)
    }
}

private func shortDate(_ ms: Double) -> String {
    let f = DateFormatter()
    f.setLocalizedDateFormatFromTemplate("d MMM yyyy")
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

// MARK: - Membership

struct MembershipView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(EntitlementStore.self) private var entitlements
    @Environment(MembershipManager.self) private var membership
    @State private var config = ConvexQuery<PublicCommerceConfigDTO>()
    @State private var message: String?
    @State private var working = false
    @State private var showingManage = false

    private var e: ServerEntitlements? { entitlements.entitlements }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    CommerceHeader(title: "Sombrey Membership", line: "Sombrey's intelligence on top of everything you track. Separate from the Band — each works on its own.")
                    CommerceSection(eyebrow: "YOUR MEMBERSHIP") { status }
                    CommerceSection(eyebrow: "INCLUDES") {
                        let items = includes(config.value, .membership)
                        if items.isEmpty { CommerceNotice(text: CommerceUnavailable.membership) } else { bullets(items) }
                        Text(price).font(StudioFont.body(13, weight: .semibold)).foregroundStyle(StudioColor.ink).padding(.top, 4)
                    }
                    actions
                    if let message {
                        Text(message).font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Membership")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .manageSubscriptionsSheet(isPresented: $showingManage)
        .task {
            config.subscribe(to: "commerce/access:publicConfig")
            if membership.productID != nil { await membership.loadProduct() }
            await CommerceAnalytics.record("product_viewed", productId: MembershipEvents.membershipProductID, source: "membership_screen")
        }
    }

    @ViewBuilder private var status: some View {
        switch entitlements.state {
        case .ready(let e):
            Text(AccessCopy.membershipLine(e.membership))
                .font(StudioFont.hero(20, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            if e.membership.status == "active", e.membership.autoRenew == false {
                Text("Cancelled — you keep Membership until then.").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft)
            }
            if e.membership.status == "expired" || e.membership.status == "revoked" || e.membership.status == "refunded" {
                Text("Your Band, your data and your history stay as they are.").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft)
            }
            if entitlements.refreshFailed { CommerceNotice(text: CommerceUnavailable.lastConfirmed) { entitlements.refresh() } }
        case .checking: CommerceLoading()
        case .unavailable: CommerceNotice(text: CommerceUnavailable.membership) { entitlements.refresh() }
        case .notEnforced: CommerceNotice(text: CommerceUnavailable.membership)
        }
    }

    /// Apple's localized price once loaded (what's charged); otherwise the server's.
    private var price: String {
        if let p = membership.product.purchasable { return "\(p.displayPrice) / month" }
        let text = PriceText.format(cents: config.value?.membership.priceCents, currency: config.value?.membership.currency)
        return text == "Price unavailable" ? text : "\(text) / month"
    }

    @ViewBuilder private var actions: some View {
        if let e, e.offers.membershipPurchasable, let product = membership.product.purchasable {
            Button { Task { await join() } } label: {
                Text(working ? "Opening the App Store…" : "Join · \(product.displayPrice)/month").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .disabled(working)
            Text("Starts when you confirm with Apple and renews monthly until you cancel. Cancel any time in your Apple ID settings.")
                .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint).fixedSize(horizontal: false, vertical: true)
        } else if e?.offers.membership == true {
            Text("Membership isn't open in the app yet.").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint)
        }
        Button { Task { await restore() } } label: { Text("Restore purchases").frame(maxWidth: .infinity) }
            .buttonStyle(.outlineCTA)
            .disabled(working)
        if e?.membership.source == "app_store" {
            Button { showingManage = true } label: { Text("Manage in Apple ID settings").frame(maxWidth: .infinity) }
                .buttonStyle(.outlineCTA)
        }
    }

    private func join() async {
        working = true
        defer { working = false }
        switch await membership.purchase() {
        case .purchased: message = "Thanks — confirming with Apple. Membership appears here as soon as it's verified."
        case .pending: message = MembershipError.pending.userMessage
        case .cancelled: message = nil
        case .failed(let error): message = error.userMessage
        }
        entitlements.refresh()
    }

    private func restore() async {
        working = true
        defer { working = false }
        await CommerceAnalytics.record("restore_purchases_started", productId: MembershipEvents.membershipProductID)
        message = RestoreCopy.message(await membership.restorePurchases())
        entitlements.refresh()
    }
}

// MARK: - Sombrey Band

struct BandView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(EntitlementStore.self) private var entitlements
    @State private var config = ConvexQuery<PublicCommerceConfigDTO>()
    @State private var devices = ConvexQuery<[OwnedDeviceDTO]>()
    @State private var showingActivation = false

    private var productName: String {
        guard let band = config.value?.band, let name = band.displayName else { return "Sombrey Band" }
        return [name, band.generation].compactMap { $0 }.joined(separator: " ")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    CommerceHeader(title: productName, line: "The Band reads your sleep, heart and movement as you wear it. Membership is separate — the Band works on its own.")
                    CommerceSection(eyebrow: "MY BAND") { myBand }
                    CommerceSection(eyebrow: "THE BAND") { product }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Sombrey Band")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .sheet(isPresented: $showingActivation) { ActivationView() }
        .task {
            config.subscribe(to: "commerce/access:publicConfig")
            devices.subscribe(to: "commerce/myDevices:myDevices")
            await CommerceAnalytics.record("product_viewed", source: "band_screen")
        }
    }

    @ViewBuilder private var myBand: some View {
        switch entitlements.state {
        case .checking: CommerceLoading()
        case .unavailable, .notEnforced: CommerceNotice(text: CommerceUnavailable.band) { entitlements.refresh() }
        case .ready(let e):
            if entitlements.refreshFailed { CommerceNotice(text: CommerceUnavailable.lastConfirmed) { entitlements.refresh() } }
            switch BandOwnership.from(ownsBand: e.ownsBand, devices: devices.value) {
            case .owned:
                let list = devices.value ?? []
                if list.isEmpty {
                    Text("Sombrey Band · on your account").font(StudioFont.hero(18, weight: .semibold)).foregroundStyle(StudioColor.ink)
                }
                ForEach(Array(list.enumerated()), id: \.offset) { _, d in deviceRow(d, showId: DeviceCopy.showsIdentifier(among: list)) }
            case .notOwned:
                Text("No Sombrey Band on your account yet.").font(StudioFont.body(14)).foregroundStyle(StudioColor.ink)
                ForEach(Array((devices.value ?? []).enumerated()), id: \.offset) { _, d in deviceRow(d, showId: false) }
            case .checking, .unavailable:
                CommerceNotice(text: CommerceUnavailable.band) { entitlements.refresh() }
            }
            if devices.errorMessage != nil { CommerceNotice(text: CommerceUnavailable.band) { devices.subscribe(to: "commerce/myDevices:myDevices") } }
            Button { showingActivation = true } label: { Text("Activate a Band").frame(maxWidth: .infinity) }
                .buttonStyle(.outlineCTA)
                .padding(.top, 6)
            Text("Pair or reconnect your Band in Settings › Band.").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint)
        }
    }

    private func deviceRow(_ d: OwnedDeviceDTO, showId: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(DeviceCopy.title(d)).font(StudioFont.hero(18, weight: .semibold)).foregroundStyle(StudioColor.ink)
                if showId { Text(d.identifier).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint) }
                Spacer()
                Text(DeviceCopy.status(d)).font(StudioFont.body(13, weight: .medium)).foregroundStyle(d.status == "activated" ? StudioColor.ink : StudioColor.inkSoft)
            }
            if let pairing = DeviceCopy.pairing(d) { Text(pairing).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft) }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var product: some View {
        if config.errorMessage != nil {
            CommerceNotice(text: CommerceUnavailable.checkout) { config.subscribe(to: "commerce/access:publicConfig") }
        } else if config.value == nil {
            CommerceLoading()
        } else {
            Text(PriceText.format(cents: config.value?.band.priceCents, currency: config.value?.band.currency))
                .font(StudioFont.hero(20, weight: .semibold)).foregroundStyle(StudioColor.ink)
            bullets(includes(config.value, .band))
            // The app has no Band checkout yet: even if the server opens one, this
            // version says so rather than pretending. Nothing is ever charged here.
            let state = BandCheckout.state(checkoutAvailable: config.value?.band.checkoutAvailable, ownsBand: entitlements.entitlements?.ownsBand)
            Text(state == .available ? "Checkout isn't available in this version of Sombrey yet." : state.note)
                .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Activation (code entry + server check; no Bluetooth)

struct ActivationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(EntitlementStore.self) private var entitlements
    @State private var code = ""
    @State private var working = false
    @State private var outcome: (success: Bool, message: String)?
    @FocusState private var focused: Bool

    private struct Reply: Decodable, Sendable { let status: String }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    CommerceHeader(title: "Activate your Band", line: "Enter the activation code from your Band's box. Activation links the Band to your Sombrey account; it doesn't change anything on the Band.")
                    TextField("XXXX-XXXX-XXXX", text: $code)
                        .font(.system(.title3, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .textContentType(.oneTimeCode)
                        .focused($focused)
                        .padding(16)
                        .frame(minHeight: 52)
                        .background { SombreyGlassChamber(cornerRadius: 18) }
                        .accessibilityLabel("Activation code")
                    Button { Task { await activate() } } label: {
                        Text(working ? "Checking…" : "Activate").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(working || !ActivationCopy.looksLikeACode(code))
                    if let outcome {
                        Text(outcome.message)
                            .font(StudioFont.body(14, weight: outcome.success ? .semibold : .regular))
                            .foregroundStyle(outcome.success ? StudioColor.ink : StudioColor.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                        if outcome.success {
                            Text("Next: pair it in Settings › Band.").font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Activate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .onAppear { focused = true }
        }
    }

    private func activate() async {
        working = true
        defer { working = false }
        await CommerceAnalytics.record("device_activation_started")
        do {
            let reply = try await Self.send(code)
            outcome = ActivationCopy.outcome(reply.status)
        } catch {
            outcome = (false, CommerceUnavailable.activation)
        }
        entitlements.refresh()
    }

    @MainActor private static func send(_ code: String) async throws -> Reply {
        try await ConvexClientProvider.client.action("commerce/myDevices:activateDevice", with: ["activationCode": code])
    }
}

// MARK: - Orders

struct OrdersView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var orders = ConvexQuery<[OrderSummaryDTO]>()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // 6I: a failed refresh keeps the orders already loaded, marked as such.
                    switch LoadPresentation.of(hasValue: orders.value != nil, isEmpty: (orders.value ?? []).isEmpty, failed: orders.errorMessage != nil) {
                    case .unavailable:
                        CommerceNotice(text: CommerceUnavailable.orders) { orders.subscribe(to: "commerce/access:myOrders") }
                    case .loading:
                        CommerceLoading()
                    case .empty:
                        Text("No orders yet.").font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft).padding(.top, 8)
                    case .current, .lastLoaded:
                        if orders.errorMessage != nil {
                            CommerceNotice(text: CommerceUnavailable.lastLoadedOrders) { orders.subscribe(to: "commerce/access:myOrders") }
                        }
                        ForEach(orders.value ?? []) { o in
                            NavigationLink { OrderDetailView(order: o) } label: { row(o) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Orders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .task { orders.subscribe(to: "commerce/access:myOrders") }
    }

    private func row(_ o: OrderSummaryDTO) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(OrderStatusCopy.items(o)).font(StudioFont.body(14, weight: .medium)).foregroundStyle(StudioColor.ink)
                Text("\(shortDate(o.createdAt)) · \(o.orderNumber)").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint)
            }
            Spacer(minLength: 8)
            Text(OrderStatusCopy.stage(o.stage)).font(StudioFont.body(13, weight: .medium)).foregroundStyle(StudioColor.inkSoft)
            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(StudioColor.inkFaint).accessibilityHidden(true)
        }
        .padding(16)
        .frame(minHeight: 60)
        .background { SombreyGlassChamber(cornerRadius: 20) }
        .accessibilityElement(children: .combine)
    }
}

struct OrderDetailView: View {
    let order: OrderSummaryDTO
    @State private var tracking = ConvexQuery<OrderTrackingDTO>()
    @State private var returns = ConvexQuery<ReturnOptionsDTO>()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CommerceSection(eyebrow: "ORDER \(order.orderNumber)") {
                    Text(OrderStatusCopy.items(order)).font(StudioFont.hero(18, weight: .semibold)).foregroundStyle(StudioColor.ink)
                    Text("Ordered \(shortDate(order.createdAt))").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint)
                    Text(OrderStatusCopy.stage(tracking.value?.stage ?? order.stage)).font(StudioFont.body(14, weight: .medium)).foregroundStyle(StudioColor.ink)
                    if let total = order.totalCents { Text("Total \(PriceText.format(cents: total, currency: order.currency))").font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft) }
                }
                // 6I: a failed refresh keeps the last loaded detail, marked as such.
                switch LoadPresentation.of(hasValue: tracking.value != nil, isEmpty: false, failed: tracking.errorMessage != nil) {
                case .unavailable:
                    CommerceSection(eyebrow: "DELIVERY") { CommerceNotice(text: CommerceUnavailable.orders) { subscribe() } }
                case .loading:
                    CommerceLoading()
                case .current, .lastLoaded, .empty:
                    if tracking.errorMessage != nil { CommerceNotice(text: CommerceUnavailable.lastLoadedOrders) { subscribe() } }
                    if let t = tracking.value {
                        progress(t)
                        trackingSection(t)
                        returnsSection(t)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .background(StudioColor.env4.ignoresSafeArea())
        .navigationTitle("Order")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            subscribe()
            await CommerceAnalytics.record("order_viewed", productId: order.lines.first?.productId)
        }
    }

    private func subscribe() {
        tracking.subscribe(to: "commerce/orderTracking:orderTracking", with: ["orderId": order.orderId])
        returns.subscribe(to: "commerce/orderTracking:returnOptions", with: ["orderId": order.orderId])
    }

    /// Progress from REAL provider state only; unreached steps stay unlit.
    @ViewBuilder private func progress(_ t: OrderTrackingDTO) -> some View {
        if t.steps.contains(where: \.reached) {
            CommerceSection(eyebrow: "PROGRESS") {
                ForEach(t.steps, id: \.step) { s in
                    HStack(spacing: 10) {
                        Circle().fill(s.reached ? StudioColor.ink : StudioColor.inkFaint.opacity(0.4)).frame(width: 8, height: 8).accessibilityHidden(true)
                        Text(TrackingCopy.step(s.step)).font(StudioFont.body(13)).foregroundStyle(s.reached ? StudioColor.ink : StudioColor.inkFaint)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(s.reached ? "Done" : "Not yet")
                }
                if t.deliveryProblem { Text("The carrier reported a delivery problem.").font(StudioFont.body(12)).foregroundStyle(StudioColor.caution) }
            }
        }
    }

    @ViewBuilder private func trackingSection(_ t: OrderTrackingDTO) -> some View {
        if t.steps.first(where: { $0.step == "confirmed" })?.reached == true {
            CommerceSection(eyebrow: "TRACKING") {
                let lines = t.shipments.compactMap(TrackingCopy.line)
                if lines.isEmpty {
                    Text(TrackingCopy.unavailable).font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
                } else {
                    ForEach(lines, id: \.number) { l in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(l.carrier) · \(l.number)").font(StudioFont.body(14, weight: .medium)).foregroundStyle(StudioColor.ink).textSelection(.enabled)
                            if let eta = l.eta { Text("Expected \(eta.formatted(date: .abbreviated, time: .omitted)) (from \(l.carrier))").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft) }
                            if let url = l.url { Link("Track with \(l.carrier)", destination: url).font(StudioFont.body(13, weight: .semibold)).foregroundStyle(StudioColor.accentInk).frame(minHeight: 44) }
                        }
                    }
                    .task { await CommerceAnalytics.record("tracking_viewed", productId: order.lines.first?.productId) }
                }
            }
        }
    }

    @ViewBuilder private func returnsSection(_ t: OrderTrackingDTO) -> some View {
        let latest = t.returns.last
        let option = returns.value.flatMap { ReturnCopy.options($0) }
        if latest != nil || option != nil {
            CommerceSection(eyebrow: "RETURNS") {
                if let latest { Text(ReturnCopy.status(latest.status)).font(StudioFont.body(14, weight: .medium)).foregroundStyle(StudioColor.ink) }
                if let option { Text(option).font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }
}
