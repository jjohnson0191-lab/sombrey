import SwiftUI

/// Bricolage Grotesque — reserved for exactly the highest-attention
/// numerical moments (readiness score, a live rep count, a rest timer, the
/// workout-duration stat on completion). This is the ONLY view type
/// allowed to use `StudioFont.hero`; every other number in the app stays
/// in Instrument Sans. Ported from `apps/mobile/src/ui/HeroNumber.tsx`.
struct HeroNumberText: View {
    enum Size {
        case lg, md, sm

        var points: CGFloat {
            switch self {
            case .lg: return 104   // text-[6.5rem]
            case .md: return 56    // text-[3.5rem]
            case .sm: return 36    // text-[2.25rem]
            }
        }
    }

    enum Tone { case ink, paper }

    let text: String
    var size: Size = .lg
    var tone: Tone = .ink

    var body: some View {
        Text(text)
            .font(StudioFont.hero(size.points, weight: .bold))
            .foregroundStyle(tone == .paper ? StudioColor.paper : StudioColor.ink)
            .lineSpacing(size.points * -0.12) // leading-[0.88] approximation
            .monospacedDigit()
    }
}
