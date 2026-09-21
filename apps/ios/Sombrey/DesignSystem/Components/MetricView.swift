import SwiftUI

/// A single labeled number for quiet, everyday metrics (steps, active
/// calories) — plain Instrument Sans, never Bricolage. Ported from
/// `apps/mobile/src/ui/Metric.tsx`.
struct MetricView: View {
    enum Tone { case ink, paper }

    let label: String
    let value: String
    var unit: String?
    /// An optional third line beneath `label` — e.g. "As of 8:04 AM" or
    /// "Waiting for band data" — for a metric whose bare value can't
    /// honestly stand alone (a device-reported cumulative reading needs
    /// its provenance/recency stated, not just a number). `nil` (the
    /// default) renders identically to before this existed.
    var caption: String?
    var tone: Tone = .ink

    private var valueColor: Color { tone == .paper ? StudioColor.paper : StudioColor.ink }
    private var labelColor: Color { tone == .paper ? StudioColor.paperSoft : StudioColor.inkSoft }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            (Text(value).font(StudioFont.body(20, weight: .semibold)).foregroundStyle(valueColor)
                + (unit.map { Text(" " + $0).font(StudioFont.body(14)).foregroundStyle(labelColor) } ?? Text("")))
                .monospacedDigit()
            Text(label)
                .font(StudioFont.body(12))
                .foregroundStyle(labelColor)
            if let caption {
                Text(caption)
                    .font(StudioFont.body(10))
                    .foregroundStyle(labelColor.opacity(0.7))
            }
        }
    }
}
