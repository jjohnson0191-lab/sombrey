import SwiftUI

/// PLACEHOLDER — mirrors `apps/mobile/src/ui/MetricCircle.tsx` exactly,
/// including its placeholder status. Renders a plain flat matte circle
/// with the value and unit; no translucent glass, no perimeter light, no
/// motion. The real "translucent illuminated circular material + soft
/// colored perimeter light" system is deferred until after real
/// QCBandSDK integration defines actual per-metric thresholds and
/// cadence — this exists so screens have a real, laid-out slot to
/// upgrade in place, not a TODO comment.
struct MetricCircleView: View {
    let value: Double?
    let label: String

    var body: some View {
        VStack(spacing: 6) {
            Circle()
                .fill(StudioColor.env4.opacity(0.60))
                .frame(width: 64, height: 64)
                .overlay {
                    Text(value.map { "\(Int($0.rounded()))" } ?? "—")
                        .font(StudioFont.body(14, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                }
            Text(label)
                .font(StudioFont.body(10))
                .foregroundStyle(StudioColor.inkSoft)
        }
    }
}
