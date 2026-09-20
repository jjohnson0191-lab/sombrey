import Foundation

/// Sombrey wearable domain models — the native equivalent of
/// `packages/wearable/src/types.ts`. This is the contract between
/// SwiftUI and `WearableManager`; nothing outside `Wearable/` should
/// import a QCBandSDK type directly (there is no such SDK integrated yet
/// — see `QCBandSDKService`).
///
/// Field shapes here are intentionally the same generic, conservative set
/// the TS contract already committed to. They will very likely be
/// revised once the real QCBandSDK's payloads are known — nothing here
/// should be read as final. No `bloodPressure`, `targets`, firmware-OTA,
/// vibration, or find-band API exists in the TS contract today; those are
/// modeled below as explicit `.unsupported` cases on `QCBandService` so
/// the protocol is honest about what the current generation of the app
/// can and can't do, rather than silently omitting them.

typealias DeviceID = String

struct SombreyDevice: Identifiable, Hashable {
    let id: DeviceID
    let serial: String
    let model: String
    var nickname: String?
    var firmwareVersion: String?
}

enum WearableConnectionState: String {
    case disconnected, connecting, connected, syncing, error
    /// Bluetooth itself is off, unauthorized, or unsupported — distinct
    /// from `.disconnected` (no paired device) or `.error` (a specific
    /// operation failed): here no operation can even be attempted.
    case unavailable
}

struct WearableDeviceStatus {
    let deviceId: DeviceID
    var connectionState: WearableConnectionState
    var batteryPct: Double?
    var lastSeenAt: Date?
}

/// Metrics approved as first-class V1 wearable metrics, where the
/// physical band actually supports them (confirmed against QCBandSDK's
/// real headers in Phase 3 — see `QCBandSDKService`). HRV/stress are
/// optional — not guaranteed available on every device.
enum WearableMetricType: String {
    case heartRate = "heart_rate"
    case restingHeartRate = "resting_heart_rate"
    case steps
    case activeCalories = "active_calories"
    case distanceMeters = "distance_meters"
    case spo2
    case skinTemperature = "skin_temperature"
    case bloodPressureSystolic = "blood_pressure_systolic"
    case bloodPressureDiastolic = "blood_pressure_diastolic"
    case batteryPct = "battery_pct"
    case hrv
    case stress
}

struct WearableMeasurement {
    let deviceId: DeviceID
    let metricType: WearableMetricType
    let value: Double
    let unit: String
    let recordedAt: Date
}

struct SleepStage {
    enum Stage: String { case light, deep, rem, awake }
    let stage: Stage
    let startedAt: Date
    let durationMinutes: Int
}

struct SleepSessionData {
    let deviceId: DeviceID
    let startedAt: Date
    let endedAt: Date
    let totalSleepMinutes: Int
    /// Only present if the SDK actually exposes stage-level data.
    var stages: [SleepStage]?
}

struct WorkoutSessionData {
    let deviceId: DeviceID
    let startedAt: Date
    let endedAt: Date
    var avgHeartRate: Double?
    var maxHeartRate: Double?
    var caloriesBurned: Double?
}

enum WearableSyncStatus: String {
    case idle, syncing, success, partial, failed
}

struct WearableSyncResult {
    let status: WearableSyncStatus
    let recordsSynced: Int
    var errorMessage: String?
    let syncedAt: Date
}

/// A capability the current band/SDK generation does not (yet) support.
/// `QCBandService` methods for targets, vibration, find-band, and
/// camera/button control all resolve through this so the UI can
/// distinguish "not connected" from "this isn't a real feature yet" —
/// never silently no-op.
struct WearableUnsupportedError: Error {
    let feature: String
    var message: String { "\(feature) is not supported by the current Sombrey Band integration yet." }
}

/// Real QCBandSDK/CoreBluetooth failure modes — thrown only by
/// `QCBandSDKService`, never fabricated. `MockQCBandService` never throws
/// these.
enum WearableSDKError: Error {
    /// Bluetooth is off, unauthorized, or unsupported on this device.
    case bluetoothUnavailable
    /// `pairDevice` was called with an id not present in the most recent
    /// `scanForDevices()` result.
    case deviceNotFound
    /// CoreBluetooth reported a connect failure with no underlying error.
    case connectFailed
    /// No device is currently paired/connected for an operation that
    /// requires one.
    case noConnectedDevice
    /// The SDK's own completion handler reported failure with no
    /// `NSError` attached.
    case commandFailed(String)
}
