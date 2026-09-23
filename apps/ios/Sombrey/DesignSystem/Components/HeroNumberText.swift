import SwiftUI

/// The standard hero numeral — Bricolage Grotesque at one of three
/// fixed sizes, with a weighted entrance — for the numbers that ARE the
/// moment (the Sombrey Score, a live rep count, a workout's duration).
/// Other display-face uses (titles, the clock, secondary hero values)
/// call `StudioFont.hero` directly; see `StudioFont` for the rule.
/// Ported from `apps/mobile/src/ui/HeroNumber.tsx`.
///
/// `animatesEntrance`: a controlled, weighted reveal (opacity + a small
/// scale settle, via `StudioMotion.bloomOnce`/`StudioReveal`) rather than
/// appearing instantly — a hero number should feel like it's powering
/// on, not popping in. Set `false` for a number that updates in place
/// (e.g. a live rep count during a set) where a fresh reveal on every
/// change would be distracting rather than weighted.
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
    var animatesEntrance: Bool = true
    var revealIndex: Int = 0

    var body: some View {
        Group {
            if animatesEntrance {
                content.studioReveal(index: revealIndex, distance: 10)
            } else {
                content
            }
        }
    }

    private var content: some View {
        Text(text)
            .font(StudioFont.hero(size.points, weight: .bold))
            .foregroundStyle(tone == .paper ? StudioColor.paper : StudioColor.ink)
            .lineSpacing(size.points * -0.12) // leading-[0.88] approximation
            .monospacedDigit()
    }
}
