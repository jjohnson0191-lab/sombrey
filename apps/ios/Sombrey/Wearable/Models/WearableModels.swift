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
}

struct WearableDeviceStatus {
    let deviceId: DeviceID
    var connectionState: WearableConnectionState
    var batteryPct: Double?
    var lastSeenAt: Date?
}

/// Metrics approved as first-class V1 wearable metrics, where the
/// physical band actually supports them. HRV/stress are optional — not
/// guaranteed available. No blood pressure metric exists yet; add it
/// only once QCBandSDK confirms the band actually measures it.
enum WearableMetricType: String {
    case heartRate = "heart_rate"
    case restingHeartRate = "resting_heart_rate"
    case steps
    case activeCalories = "active_calories"
    case spo2
    case skinTemperature = "skin_temperature"
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
/// `QCBandService` methods for targets, firmware OTA, vibration,
/// find-band, and camera/button control all resolve through this so the
/// UI can distinguish "not connected" from "this isn't a real feature
/// yet" — never silently no-op.
struct WearableUnsupportedError: Error {
    let feature: String
    var message: String { "\(feature) is not supported by the current Sombrey Band integration yet." }
}
