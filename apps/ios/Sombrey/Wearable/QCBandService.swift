import Foundation

/// The one thing `WearableManager` (and therefore all SwiftUI code)
/// depends on for band functionality. No view, view model, or manager
/// outside `Wearable/` may import CoreBluetooth or a vendor SDK type
/// directly — matching the boundary `packages/wearable`'s README already
/// established for the web app.
///
/// Two conformers exist: `MockQCBandService` (explicit sample data, used
/// for previews/tests) and `QCBandSDKService` (the real implementation —
/// real CoreBluetooth discovery/connection plus the real QCBandSDK
/// wrapped behind this same protocol, Phase 3 of the migration).
/// Swapping one for the other changes zero UI code.
///
/// `setTargets`/`vibrate`/`findBand` are modeled here because the
/// physical band and QCBandSDK genuinely support the underlying
/// commands, but Sombrey V1's product scope doesn't call them from
/// anywhere yet (see the wearable-integration phase report) — both
/// conformers throw `WearableUnsupportedError` for these so the UI can
/// tell "not connected" apart from "this isn't wired up yet," never a
/// silent no-op.
///
/// `Sendable`: `WearableManager` is `@MainActor`-isolated and awaits
/// these methods directly, so the compiler needs to know a `QCBandService`
/// instance is safe to use from that isolated context. `MockQCBandService`
/// has no mutable stored state, a real checked conformance.
/// `QCBandSDKService` is `@MainActor`-isolated itself and conforms via
/// `@unchecked Sendable` — see its own file header for the justification.
protocol QCBandService: AnyObject, Sendable {
    // MARK: Discovery & pairing
    func scanForDevices() async throws -> [SombreyDevice]
    func pairDevice(_ deviceId: DeviceID) async throws
    func unpairDevice(_ deviceId: DeviceID) async throws

    // MARK: Status & sync
    func deviceStatus(_ deviceId: DeviceID) async throws -> WearableDeviceStatus
    func sync(_ deviceId: DeviceID) async throws -> WearableSyncResult
    func firmwareInfo(_ deviceId: DeviceID) async throws -> String

    /// A live stream of measurements as they arrive from the band —
    /// real-time callbacks (steps/battery ticks) for `QCBandSDKService`,
    /// nothing for `MockQCBandService`.
    func measurements(for deviceId: DeviceID) -> AsyncStream<WearableMeasurement>

    /// Structured sleep sessions for the last `days` days (0 = today).
    /// Kept separate from `measurements` because a sleep session is a
    /// time range with an optional stage breakdown, not a single value.
    func sleepHistory(_ deviceId: DeviceID, days: Int) async throws -> [SleepSessionData]

    // MARK: Real band/SDK capabilities not wired into Sombrey V1 yet —
    // see the type header. Every conformer throws `WearableUnsupportedError`.
    func setTargets(_ deviceId: DeviceID, steps: Int?, sleepMinutes: Int?, activeCalories: Int?) async throws
    func vibrate(_ deviceId: DeviceID) async throws
    func findBand(_ deviceId: DeviceID) async throws
}
