import Foundation
// import CoreBluetooth  — uncomment once real BLE work starts (Phase 10).
// import QCBandSDK      — the vendor SDK is not integrated anywhere in this
//                          repo yet. This file (and a future Swift wrapper
//                          it calls) is the ONLY place allowed to import it,
//                          matching the architecture boundary already
//                          established in `apps/mobile`'s
//                          `native/ios/SombreyWearablePlugin.swift`.

/// NATIVE SDK INTEGRATION — SKELETON ONLY. Establishes the boundary, does
/// not implement QCBandSDK. Every method currently throws so the contract
/// is real and testable end-to-end before any actual Bluetooth code
/// exists — same discipline as the Capacitor-era Swift plugin stub this
/// replaces.
///
/// Real implementation is Phase 10 of the migration plan, gated on the
/// vendor actually supplying QCBandSDK. Do not add CoreBluetooth logic
/// here speculatively — build it against the real SDK's actual API once
/// available, not a guess.
final class QCBandSDKService: QCBandService {
    private func notImplemented(_ feature: String) -> Error {
        WearableUnsupportedError(feature: feature)
    }

    func scanForDevices() async throws -> [SombreyDevice] {
        throw notImplemented("Band scanning (QCBandSDK not yet integrated)")
    }

    func pairDevice(_ deviceId: DeviceID) async throws {
        throw notImplemented("Band pairing (QCBandSDK not yet integrated)")
    }

    func unpairDevice(_ deviceId: DeviceID) async throws {
        throw notImplemented("Band unpairing (QCBandSDK not yet integrated)")
    }

    func deviceStatus(_ deviceId: DeviceID) async throws -> WearableDeviceStatus {
        throw notImplemented("Band status (QCBandSDK not yet integrated)")
    }

    func sync(_ deviceId: DeviceID) async throws -> WearableSyncResult {
        throw notImplemented("Band sync (QCBandSDK not yet integrated)")
    }

    func measurements(for deviceId: DeviceID) -> AsyncStream<WearableMeasurement> {
        AsyncStream { continuation in continuation.finish() }
    }

    func setTargets(_ deviceId: DeviceID, steps: Int?, sleepMinutes: Int?, activeCalories: Int?) async throws {
        throw notImplemented("Setting band targets")
    }

    func firmwareInfo(_ deviceId: DeviceID) async throws -> String {
        throw notImplemented("Firmware info")
    }

    func vibrate(_ deviceId: DeviceID) async throws {
        throw notImplemented("Vibration")
    }

    func findBand(_ deviceId: DeviceID) async throws {
        throw notImplemented("Find my band")
    }
}
