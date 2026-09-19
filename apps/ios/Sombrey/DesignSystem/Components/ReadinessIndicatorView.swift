import SwiftUI

/// Renders a `ReadinessResult` conservatively: `score` is nil by design and
/// this view treats that as a normal, expected state — "still collecting
/// data" — never fabricating a number. No medical/clinical language
/// anywhere here. Ported from `apps/mobile/src/ui/ReadinessIndicator.tsx`.
struct ReadinessIndicatorView: View {
    enum Tone { case ink, paper }

    let result: ReadinessResult?
    var tone: Tone = .paper

    private var softColor: Color { tone == .paper ? StudioColor.paperSoft : StudioColor.inkSoft }
    private var faintColor: Color { tone == .paper ? StudioColor.paperFaint : StudioColor.inkFaint }

    var body: some View {
        if result?.score == nil {
            VStack(alignment: .trailing, spacing: 4) {
                Capsule()
                    .fill(tone == .paper ? StudioColor.paper.opacity(0.25) : StudioColor.ink.opacity(0.15))
                    .frame(width: 64, height: 3)
                Text("READINESS")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(softColor)
                Text(result?.missingInputs.isEmpty == false
                     ? "Still collecting data — check back soon."
                     : "Not enough data yet.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(faintColor)
                    .frame(maxWidth: 180, alignment: .trailing)
                    .multilineTextAlignment(.trailing)
            }
        } else if let result {
            VStack(alignment: .trailing, spacing: 6) {
                HeroNumberText(text: "\(result.score!)", size: .lg, tone: tone == .paper ? .paper : .ink)
                Text("READINESS")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(softColor)
                if !result.contributingFactors.isEmpty {
                    VStack(alignment: .trailing, spacing: 2) {
                        ForEach(result.contributingFactors.prefix(3)) { factor in
                            Text(factor.description)
                                .font(StudioFont.body(12))
                                .foregroundStyle(softColor)
                        }
                    }
                    .padding(.top, 4)
                }
                Text("v\(result.algorithmVersion) · confidence \(Int((result.confidence * 100).rounded()))% · not a medical measurement")
                    .font(StudioFont.body(10))
                    .foregroundStyle(faintColor)
            }
        }
    }
}
