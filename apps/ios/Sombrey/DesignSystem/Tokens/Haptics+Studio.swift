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
    /// Moving between LIVE / TODAY / 7D / 30D.
    static let rangeChange = SensoryFeedback.selection
    /// Scrubbing across a chart onto a different real reading.
    static let scrubStep = SensoryFeedback.selection
    /// An on-demand measurement returned a real reading from the band.
    static let measurementComplete = SensoryFeedback.success
    /// An on-demand measurement ended without a reading.
    static let measurementFailed = SensoryFeedback.warning
}
