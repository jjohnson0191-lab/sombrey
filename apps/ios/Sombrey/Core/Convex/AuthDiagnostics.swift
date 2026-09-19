import Foundation
import os

/// Temporary, targeted diagnostic logging for the native auth lifecycle
/// (Clerk session -> ConvexClientWithAuth -> ClerkConvexAuthProvider ->
/// Convex JWT -> Convex auth state -> users:updateCurrentUser ->
/// users:getCurrentUser -> AppState.authPhase), added to debug the
/// "stuck on Connecting…" report. Viewable live from a connected device
/// via Console.app (subsystem "com.sombrey.app", category "auth") —
/// TestFlight builds have no attached debugger, so this is the only way
/// to see what actually happened on a physical device.
///
/// Never logs token/JWT contents — only presence, length, and error
/// descriptions.
enum AuthDiagnostics {
    private static let logger = Logger(subsystem: "com.sombrey.app", category: "auth")

    static func log(_ message: String) {
        logger.log("\(message, privacy: .public)")
    }

    static func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
    }
}
