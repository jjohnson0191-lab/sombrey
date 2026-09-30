#if DEBUG
import SwiftUI

// Sombrey Membership — Phase 6B DEVELOPMENT-ONLY diagnostics surface.
//
// Compiled into DEBUG builds only (never TestFlight / App Store, which build
// Release) and not linked from any screen: present it temporarily from a
// local Xcode run (or its preview) together with the StoreKit testing file
// (apps/ios/StoreKitTesting, docs/COMMERCE_6B.md §9) to exercise loading,
// purchase, cancellation, Ask-to-Buy, refunds and restore. It is NOT the
// membership UI — that is Phase 6D.

struct MembershipDiagnosticsView: View {
    let membership: MembershipManager
    @State private var lastOutcome = "—"

    var body: some View {
        List {
            Section("Configuration") {
                row("Product id", membership.productID ?? "not configured")
                row("Server verification", "not built (Phase 6C) — nothing is sent")
            }
            Section("Product") {
                row("State", describe(membership.product))
                Button("Load product") { Task { await membership.loadProduct() } }
            }
            Section("Apple entitlement (local reading)") {
                row("Status", String(describing: membership.status))
                Button("Refresh") { Task { await membership.refreshStatus() } }
            }
            Section("Actions") {
                Button(membership.isPurchasing ? "Purchasing…" : "Purchase") {
                    Task { lastOutcome = String(describing: await membership.purchase()) }
                }
                .disabled(membership.product.purchasable == nil || membership.isPurchasing)
                Button("Restore purchases") { Task { lastOutcome = String(describing: await membership.restorePurchases()) } }
                row("Last outcome", lastOutcome)
            }
        }
        .font(.system(size: 13, design: .monospaced))
        .navigationTitle("Membership (DEV)")
    }

    private func row(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).foregroundStyle(.secondary)
            Text(v).textSelection(.enabled)
        }
    }

    private func describe(_ p: MembershipProductState) -> String {
        if case .available(let f) = p { return "available · \(f.displayName) · \(f.displayPrice) · \(f.period.map { "\($0.value) \($0.unit)" } ?? "?")" }
        return String(describing: p)
    }
}

#Preview("Membership diagnostics (DEV)") {
    NavigationStack { MembershipDiagnosticsView(membership: MembershipManager(accountID: { "user_preview" })) }
}
#endif
