import SwiftUI

/// The Sombrey environmental wordmark — "SOMBREY" as illuminated lettering
/// behind the glass of every primary screen. Not a header: it sits between
/// the scene's tonal field and the content, fixed at the screen's centre
/// while content scrolls over it (it lives outside the scroll view) and
/// while screens slide between tabs (it counter-offsets against the panel
/// and is clipped to it, so the brand appears to stay put as the panels
/// pass over it).
///
/// One component, one configuration per scene: the same display face and
/// palette everywhere (no new colours) — only opacity, glow, scale and, on
/// AI, a slow breath vary. Rasterized once (`drawingGroup`); the only
/// animation is AI's opacity breath, off under Reduce Motion.
struct SombreyEnvironmentBranding: View {
    let style: SombreyBrandStyle
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var exhaled = false

    var body: some View {
        GeometryReader { geo in
            wordmark(width: geo.size.width)
                .position(x: geo.size.width / 2, y: geo.size.height * 0.5)
        }
        .opacity(style.breathes && exhaled && !reduceMotion ? 0.62 : 1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            guard style.breathes, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 7).repeatForever(autoreverses: true)) { exhaled = true }
        }
    }

    private func wordmark(width: CGFloat) -> some View {
        let letters = Text("SOMBREY")
            .font(StudioFont.hero(160, weight: .bold))
            .tracking(6)
            .lineLimit(1)
            .minimumScaleFactor(0.1)
        return ZStack {
            // Soft light spilling from the letter edges — a static blur,
            // rasterized with the rest.
            letters
                .foregroundStyle(Color.white.opacity(style.glow))
                .blur(radius: 18)
            // The face: lit from above, fading downward like backlit glass.
            letters
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color.white.opacity(style.face * 1.25), Color.white.opacity(style.face * 0.55)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                // A hairline edge so the lettering still reads on the
                // lighter crops (Progress, Settings).
                .shadow(color: StudioColor.ink.opacity(style.edge), radius: 0, x: 0, y: 1)
        }
        .frame(width: width * 0.88)
        .scaleEffect(style.scale)
        .drawingGroup()
    }
}

/// Per-scene intensity — opacity, glow, scale, breath. Nothing else varies.
struct SombreyBrandStyle: Equatable {
    var face: Double
    var glow: Double
    var edge: Double = 0.025
    var scale: CGFloat = 1
    var breathes = false

    /// Home — the strongest, still restrained.
    static let home = SombreyBrandStyle(face: 0.075, glow: 0.11, scale: 1)
    /// Train — a touch more lit and tighter, for energy.
    static let train = SombreyBrandStyle(face: 0.085, glow: 0.13, scale: 1.03)
    /// Progress — calmer.
    static let progress = SombreyBrandStyle(face: 0.055, glow: 0.06, edge: 0.03, scale: 0.98)
    /// AI — atmospheric, slowly breathing.
    static let ai = SombreyBrandStyle(face: 0.065, glow: 0.09, scale: 1, breathes: true)
    /// Settings — the quietest.
    static let settings = SombreyBrandStyle(face: 0.035, glow: 0.035, edge: 0.03, scale: 0.96)
}

extension StudioScene {
    /// The brand treatment for this scene; nil where the screen is a focused
    /// moment (a live set, a completion, sign-in) and the brand steps back.
    var brandStyle: SombreyBrandStyle? {
        switch self {
        case .home: return .home
        case .trainOverview: return .train
        case .progress: return .progress
        case .aiCoach: return .ai
        case .settings: return .settings
        case .trainActive, .trainComplete, .auth: return nil
        }
    }
}

/// How far this screen's panel is currently displaced by an interactive tab
/// swipe (0 at rest). The brand layer counter-offsets by it.
private struct PrimaryPanelOffsetKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var primaryPanelOffset: CGFloat {
        get { self[PrimaryPanelOffsetKey.self] }
        set { self[PrimaryPanelOffsetKey.self] = newValue }
    }
}
