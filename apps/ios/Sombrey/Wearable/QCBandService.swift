import Foundation

/// The one thing `WearableManager` (and therefore all SwiftUI code)
/// depends on for band functionality. No view, view model, or manager
/// outside `Wearable/` may import CoreBluetooth or a vendor SDK type
/// directly — matching the boundary `packages/wearable`'s README already
/// established for the web app.
///
/// Two conformers exist today: `MockQCBandService` (explicit sample data,
/// used for all UI development) and `QCBandSDKService` (the real
/// implementation, a stub until the vendor QCBandSDK is actually
/// integrated — see its own file header). Swapping one for the other
/// changes zero UI code.
///
/// Capabilities beyond connect/pair/status/sync/measurement-stream
/// (targets, firmware OTA, vibration, find-band, camera/button) are
/// included here because the product requires the architecture to be
/// ready for them, but every conformer today throws
/// `WearableUnsupportedError` for these — there is no real band
/// integration yet, and nothing here may fabricate one.
protocol QCBandService: AnyObject {
    // MARK: Discovery & pairing
    func scanForDevices() async throws -> [SombreyDevice]
    func pairDevice(_ deviceId: DeviceID) async throws
    func unpairDevice(_ deviceId: DeviceID) async throws

    // MARK: Status & sync
    func deviceStatus(_ deviceId: DeviceID) async throws -> WearableDeviceStatus
    func sync(_ deviceId: DeviceID) async throws -> WearableSyncResult

    /// A live stream of measurements as they arrive from the band.
    func measurements(for deviceId: DeviceID) -> AsyncStream<WearableMeasurement>

    // MARK: Not yet implemented by any real band integration — see the
    // type's header. Every conformer must throw `WearableUnsupportedError`
    // until QCBandSDK actually supports the capability.
    func setTargets(_ deviceId: DeviceID, steps: Int?, sleepMinutes: Int?, activeCalories: Int?) async throws
    func firmwareInfo(_ deviceId: DeviceID) async throws -> String
    func vibrate(_ deviceId: DeviceID) async throws
    func findBand(_ deviceId: DeviceID) async throws
}
