import SwiftUI

/// "Wearable / Band" — the permanent way to pair/reconnect/forget a
/// Sombrey Band for anyone who chose "Continue without Band" during
/// onboarding, or whose band disconnected. Reuses `BandPairingView` and
/// `WearableManager` entirely — no second pairing system, no direct
/// Bluetooth calls here.
struct WearableBandSection: View {
    @Environment(WearableManager.self) private var wearableManager
    @State private var showingPairing = false
    @State private var isActing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("WEARABLE / BAND")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)

            statusRow

            if let name = wearableManager.pairedDevice?.nickname ?? wearableManager.pairedDevice?.model, wearableManager.pairedDevice != nil {
                Text(name)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }

            actionButton
                .padding(.top, 4)

            if wearableManager.pairedDevice != nil {
                Button(isActing ? "Forgetting…" : "Forget Band") {
                    isActing = true
                    Task {
                        await wearableManager.unpair()
                        isActing = false
                    }
                }
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.danger)
                .disabled(isActing)
            }

            if wearableManager.displayState == .unavailable {
                Text("Bluetooth is off. Turn it on in Settings to connect your band.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
        .fullScreenCover(isPresented: $showingPairing) {
            BandPairingView { showingPairing = false }
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(wearableManager.displayState == .connected ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
                .frame(width: 7, height: 7)
            Text(statusText)
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
            if wearableManager.displayState == .connected, let battery = wearableManager.status?.batteryPct {
                Text("· \(Int(battery.rounded()))%")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }

    private var statusText: String {
        switch wearableManager.displayState {
        case .connected: return "Sombrey Band — Connected"
        case .syncing: return "Sombrey Band — Syncing"
        case .connecting: return "Pairing…"
        case .searching: return "Searching…"
        case .reconnecting: return "Reconnecting…"
        case .notPaired: return "No band connected"
        case .disconnected: return "Sombrey Band — Disconnected"
        case .error: return "Connection error"
        case .unavailable: return "Bluetooth unavailable"
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        switch wearableManager.displayState {
        case .notPaired:
            Button("Connect Sombrey Band") { showingPairing = true }
                .buttonStyle(.outlineCTA)
        case .disconnected, .error:
            Button(isActing ? "Reconnecting…" : "Reconnect Sombrey Band") {
                isActing = true
                Task {
                    await wearableManager.reconnect()
                    isActing = false
                }
            }
            .buttonStyle(.outlineCTA)
            .disabled(isActing)
        case .connected, .syncing, .connecting, .searching, .reconnecting:
            EmptyView()
        case .unavailable:
            EmptyView()
        }
    }
}
