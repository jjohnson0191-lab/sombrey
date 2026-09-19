import SwiftUI

/// A single labeled number for quiet, everyday metrics (steps, active
/// calories) — plain Instrument Sans, never Bricolage. Ported from
/// `apps/mobile/src/ui/Metric.tsx`.
struct MetricView: View {
    enum Tone { case ink, paper }

    let label: String
    let value: String
    var unit: String?
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
        }
    }
}
