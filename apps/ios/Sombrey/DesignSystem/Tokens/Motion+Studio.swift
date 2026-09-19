import SwiftUI

/// Sombrey motion language, ported from `index.css`'s `si-*` keyframes:
/// trigger -> transition -> settle -> still. Every animation here plays
/// ONCE (or, for a live tick, gently) and never loops as ambient
/// decoration — see the web app's own comment on this rule.
///
/// Every call site must read `\.accessibilityReduceMotion` and fall back to
/// `StudioMotion.reduced`, mirroring the web app's
/// `@media (prefers-reduced-motion: reduce)` block exactly.
enum StudioMotion {
    /// `si-bloom-once`: 900ms, cubic-bezier(0.2, 0.8, 0.2, 1).
    static let bloomOnce = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.9)

    /// `si-sweep-once`: 2.4s, cubic-bezier(0.3, 0, 0.2, 1).
    static let sweepOnce = Animation.timingCurve(0.3, 0, 0.2, 1, duration: 2.4)

    /// `si-tick`: 1.3s ease-in-out, repeats — the one exception to
    /// "plays once," reserved for a live/active indicator only.
    static let tick = Animation.easeInOut(duration: 1.3).repeatForever(autoreverses: true)

    /// `si-settle-once`: 1.6s, cubic-bezier(0.2, 0.7, 0.3, 1).
    static let settleOnce = Animation.timingCurve(0.2, 0.7, 0.3, 1, duration: 1.6)

    /// No motion at all — the reduced-motion fallback for every case above.
    static let reduced: Animation? = nil

    /// Resolves a Studio animation against the current Reduce Motion
    /// setting. Use from a View: `.animation(StudioMotion.resolve(.bloomOnce, reduceMotion), value: x)`.
    static func resolve(_ animation: Animation, reduceMotion: Bool) -> Animation? {
        reduceMotion ? reduced : animation
    }
}
