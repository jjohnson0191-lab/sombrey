import Foundation
import os

/// Temporary, targeted diagnostic logging for the wearable data path —
/// added to debug a physical-device regression report where live heart
/// rate, on-demand blood pressure, and historical Vitals graphs all
/// stopped working in the same test session. Mirrors `AuthDiagnostics`'
/// own reasoning exactly: a TestFlight build has no attached debugger,
/// so unified logging (viewable live from a connected device via
/// Console.app, subsystem "com.sombrey.app", category "wearable") is the
/// only way to see what actually happened on the physical band.
///
/// Never logs anything beyond metric types, counts, booleans, and error
/// descriptions — no raw health values are excluded on privacy grounds
/// here (they're the same numbers already shown on-screen), but nothing
/// beyond what's needed to diagnose the reported regression is added.
enum WearableDiagnostics {
    private static let logger = Logger(subsystem: "com.sombrey.app", category: "wearable")

    static func log(_ message: String) {
        logger.log("\(message, privacy: .public)")
    }

    static func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
    }
}
