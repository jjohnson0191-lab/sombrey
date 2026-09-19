import SwiftUI

/// Sombrey motion language, ported from `index.css`'s `si-*` keyframes:
/// trigger -> transition -> settle -> still. Every animation here plays
/// ONCE (or, for a live tick, gently) and never loops as decoration for
/// its own sake — this is a physical instrument powering up and
/// responding to input, not a website with elements sliding in.
///
/// Every call site must read `\.accessibilityReduceMotion` and resolve
/// through `StudioMotion.resolve(_:reduceMotion:)`, mirroring the web
/// app's `@media (prefers-reduced-motion: reduce)` block exactly. When
/// reduced motion is on, state must still be communicated — through
/// opacity/color end-states appearing immediately, never left implicit.
enum StudioMotion {
    // MARK: Named curves (the vocabulary — reach for these, not raw
    // `.easeInOut`/magic numbers, at any new call site).

    /// `si-bloom-once`: 900ms, cubic-bezier(0.2, 0.8, 0.2, 1). A single
    /// weighted reveal — hero numbers, first-paint content, wordmarks.
    /// Fast start, long unhurried settle: powering on, not sliding in.
    static let bloomOnce = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.9)

    /// `si-sweep-once`: 2.4s, cubic-bezier(0.3, 0, 0.2, 1). One slow
    /// light pass — the wearable badge's syncing sweep.
    static let sweepOnce = Animation.timingCurve(0.3, 0, 0.2, 1, duration: 2.4)

    /// `si-tick`: 1.3s ease-in-out, repeats. The one ambient/looping
    /// exception, reserved for a genuinely live, connected state (never
    /// a "loading" stand-in).
    static let tick = Animation.easeInOut(duration: 1.3).repeatForever(autoreverses: true)

    /// `si-settle-once`: 1.6s, cubic-bezier(0.2, 0.7, 0.3, 1). A slower
    /// weighted settle for larger compositions (scene changes, workout
    /// completion) — bloomOnce's slower sibling.
    static let settleOnce = Animation.timingCurve(0.2, 0.7, 0.3, 1, duration: 1.6)

    /// Scene/environment crop changes (tab switches). Slower than UI
    /// feedback — an instrument's backlight shifting, not a page fade.
    static let sceneShift = Animation.timingCurve(0.25, 0.75, 0.3, 1, duration: 0.7)

    /// Content cross-fade paired with `sceneShift` when navigating
    /// between the five destinations.
    static let contentShift = Animation.timingCurve(0.3, 0.7, 0.35, 1, duration: 0.45)

    /// Immediate physical response to a touch-down — a control engaging.
    static let press = Animation.timingCurve(0.4, 0, 0.2, 1, duration: 0.12)

    /// The release/settle after a press or a momentary state change
    /// (set completed, rest skipped).
    static let release = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.35)

    /// Very slow, low-amplitude idle evolution (CTA idle illumination).
    /// Never call without checking reduced motion — this is the token
    /// most likely to read as "excessive" if misused.
    static let ambient = Animation.easeInOut(duration: 3.2).repeatForever(autoreverses: true)

    /// No motion at all — the reduced-motion fallback for every case
    /// above.
    static let reduced: Animation? = nil

    // MARK: Stagger

    /// Base unit for sequenced reveals (metric rows, card stacks). Scene
    /// establishes itself first; secondary content follows in short,
    /// deliberate steps — not a slow cascade.
    static let staggerUnit: TimeInterval = 0.06

    /// Per-index delay for a staggered reveal, capped so a long list
    /// doesn't make the screen feel slow to settle.
    static func staggerDelay(_ index: Int, cap: Int = 6) -> TimeInterval {
        TimeInterval(min(index, cap)) * staggerUnit
    }

    // MARK: Resolution

    /// Resolves a Studio animation against the current Reduce Motion
    /// setting. Use from a View: `.animation(StudioMotion.resolve(StudioMotion.bloomOnce, reduceMotion: reduceMotion), value: x)`.
    static func resolve(_ animation: Animation, reduceMotion: Bool) -> Animation? {
        reduceMotion ? reduced : animation
    }

    /// Same, with a stagger delay folded in.
    static func resolve(_ animation: Animation, delay: TimeInterval, reduceMotion: Bool) -> Animation? {
        reduceMotion ? reduced : animation.delay(delay)
    }
}

/// A controlled, weighted entrance — opacity + a small scale/position
/// evolution, never a bounce. The one primitive every "reveal" in the
/// app should be built from, so the physical feel stays consistent
/// instead of every screen inventing its own animation.
struct StudioReveal: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isVisible = false

    var delay: TimeInterval = 0
    var distance: CGFloat = 6

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .scaleEffect(isVisible ? 1 : 0.97)
            .offset(y: isVisible ? 0 : distance)
            .onAppear {
                if reduceMotion {
                    isVisible = true
                } else {
                    withAnimation(StudioMotion.bloomOnce.delay(delay)) {
                        isVisible = true
                    }
                }
            }
    }
}

extension View {
    /// A single deliberate reveal, optionally staggered by `index` —
    /// the shared entrance primitive for hero numbers, metric rows, and
    /// card stacks. `distance` is the (small, restrained) vertical
    /// offset the content settles in from.
    func studioReveal(index: Int = 0, distance: CGFloat = 6) -> some View {
        modifier(StudioReveal(delay: StudioMotion.staggerDelay(index), distance: distance))
    }
}
