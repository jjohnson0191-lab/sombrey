import SwiftUI

/// Wearable status — approved V1 treatment. Not a chip, not a dot, not an
/// icon: the environment's own light carries the state (a small swatch of
/// the same tonal field, warm and steady when connected, dimmed and
/// cooled when disconnected), with a plain text label alongside — color
/// is never the only signal. Ported from
/// `apps/mobile/src/ui/WearableStatusBadge.tsx`.
struct WearableStatusBadge: View {
    let state: WearableConnectionState
    var batteryPct: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweep = false

    private var swatch: LinearGradient {
        switch state {
        case .connected, .syncing:
            return LinearGradient(colors: [StudioColor.env2, StudioColor.env3, StudioColor.env5],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
        case .connecting:
            return LinearGradient(colors: [StudioColor.env2, StudioColor.env3],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
        case .disconnected, .error:
            return LinearGradient(colors: [Color(hex: 0x4C555E), Color(hex: 0x6E766D), Color(hex: 0x8B8E82)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private var label: String {
        switch state {
        case .connected: return "Connected"
        case .syncing: return "Syncing"
        case .connecting: return "Connecting"
        case .disconnected: return "Disconnected"
        case .error: return "Connection error"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Capsule()
                .fill(swatch)
                .frame(width: 32, height: 16)
                .overlay {
                    // `si-sweep-once`: a single light sweep while syncing.
                    if state == .syncing {
                        Capsule()
                            .fill(LinearGradient(colors: [.clear, .white.opacity(0.55), .clear],
                                                  startPoint: .leading, endPoint: .trailing))
                            .frame(width: 13)
                            .offset(x: sweep ? 45 : -45)
                            .onAppear {
                                withAnimation(StudioMotion.resolve(StudioMotion.sweepOnce, reduceMotion: reduceMotion)) {
                                    sweep = true
                                }
                            }
                    }
                }
                .clipShape(Capsule())
            Group {
                if let batteryPct, state != .disconnected, state != .error {
                    Text("\(label) · \(Int(batteryPct.rounded()))%")
                } else {
                    Text(label)
                }
            }
            .font(StudioFont.body(12))
            .foregroundStyle(StudioColor.inkSoft)
        }
    }
}
