import SwiftUI

/// Sombrey's haptic vocabulary — the tactile half of the motion language
/// in `Motion+Studio.swift`. Each case is a meaning, not an intensity:
/// call sites pick the event that happened, never a raw generator.
/// Deliberately small and soft: haptics confirm that the instrument
/// responded, they don't decorate. Applied with SwiftUI's
/// `.sensoryFeedback`, which already follows the system's own haptics
/// setting.
enum StudioHaptic {
    /// A metric instrument opening to reveal its history.
    static let expand = SensoryFeedback.impact(flexibility: .soft, intensity: 0.55)
    /// The instrument closing — lighter than opening.
    static let collapse = SensoryFeedback.impact(flexibility: .soft, intensity: 0.3)
    /// Changing destination on the tab bar.
    static let tabChange = SensoryFeedback.selection
    /// Moving between LIVE / TODAY / 7D / 30D.
    static let rangeChange = SensoryFeedback.selection
    /// Scrubbing across a chart onto a different real reading.
    static let scrubStep = SensoryFeedback.selection
    /// Singling out one part of an instrument (a readiness contributor,
    /// an activity span, a sleep stage).
    static let focus = SensoryFeedback.selection
    // Training — the one place the app is allowed to feel more physical.
    /// A set was recorded: a firm, single landing.
    static let setLogged = SensoryFeedback.impact(flexibility: .solid, intensity: 0.9)
    /// The rest target was reached.
    static let restComplete = SensoryFeedback.success
    /// Workout paused or resumed.
    static let pauseToggle = SensoryFeedback.impact(flexibility: .soft, intensity: 0.6)
    /// Workout started / finished and recorded.
    static let workoutStart = SensoryFeedback.impact(flexibility: .solid, intensity: 0.7)
    static let workoutFinish = SensoryFeedback.success

    /// An on-demand measurement returned a real reading from the band.
    static let measurementComplete = SensoryFeedback.success
    /// An on-demand measurement ended without a reading.
    static let measurementFailed = SensoryFeedback.warning
}
