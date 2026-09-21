import SwiftUI

/// Renders a `ReadinessResult` conservatively: `score` is nil by design and
/// this view treats that as a normal, expected state — "still collecting
/// data" — never fabricating a number. No medical/clinical language
/// anywhere here. Ported from `apps/mobile/src/ui/ReadinessIndicator.tsx`.
///
/// The arc behind the hero number is an instrument reading, not a
/// progress bar or loading spinner: it draws once (`StudioMotion.bloomOnce`,
/// a fraction of a full circle matched to `confidence`) and then holds
/// still — no perpetual sweep. When `score` is nil, no arc is drawn at
/// all (there's nothing yet to read).
struct ReadinessIndicatorView: View {
    enum Tone { case ink, paper }

    let result: ReadinessResult?
    var tone: Tone = .paper

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arcRevealed = false

    private var softColor: Color { tone == .paper ? StudioColor.paperSoft : StudioColor.inkSoft }
    private var faintColor: Color { tone == .paper ? StudioColor.paperFaint : StudioColor.inkFaint }
    private var markColor: Color { tone == .paper ? StudioColor.paper : StudioColor.ink }

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
            .studioReveal()
        } else if let result {
            VStack(alignment: .trailing, spacing: 8) {
                Text("READINESS")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(softColor)
                ZStack(alignment: .bottomTrailing) {
                    // The instrument-reading arc: a quiet stroke sized
                    // to `confidence`, revealed once, then still.
                    Circle()
                        .trim(from: 0, to: arcRevealed ? CGFloat(result.confidence) : 0)
                        .stroke(markColor.opacity(0.35), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: 132, height: 132)
                        .onAppear {
                            let animation = StudioMotion.resolve(StudioMotion.bloomOnce, reduceMotion: reduceMotion)
                            if let animation {
                                withAnimation(animation) { arcRevealed = true }
                            } else {
                                arcRevealed = true
                            }
                        }
                    HeroNumberText(text: "\(result.score!)", size: .lg, tone: tone == .paper ? .paper : .ink)
                }
                if let band = result.scoreBand {
                    Text(band.uppercased())
                        .font(StudioFont.body(15, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(markColor)
                }
                Text("\(result.confidenceBand) confidence")
                    .font(StudioFont.body(12))
                    .foregroundStyle(softColor)
                if !result.contributingFactors.isEmpty {
                    VStack(alignment: .trailing, spacing: 2) {
                        ForEach(Array(result.contributingFactors.prefix(3).enumerated()), id: \.offset) { index, factor in
                            Text(factor.description)
                                .font(StudioFont.body(12))
                                .foregroundStyle(softColor)
                                .studioReveal(index: index + 1)
                        }
                    }
                    .padding(.top, 4)
                }
                Text("v\(result.algorithmVersion) · not a medical measurement")
                    .font(StudioFont.body(10))
                    .foregroundStyle(faintColor)
            }
        }
    }
}
