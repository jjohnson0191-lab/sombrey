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
    /// No device has ever been paired — distinct from `.disconnected`
    /// (a previously-paired device that's currently not connected).
    /// Never inferred from "no saved device id" alone at the UI layer;
    /// `WearableManager.pairedDevice == nil` is the one source of truth.
    case notPaired
    /// Actively scanning for nearby devices (`WearableManager.isScanning`).
    case searching
    /// A fresh pairing attempt is in flight — the label shown to the
    /// user is "Pairing," distinct from `.reconnecting` below even
    /// though both reuse this same underlying state internally.
    case connecting
    case connected
    case syncing
    /// The band dropped unexpectedly and `QCBandSDKService` is
    /// automatically retrying the connection — distinct from
    /// `.connecting` (a fresh, user-initiated pair) even though both
    /// represent "not yet connected, actively trying."
    case reconnecting
    case disconnected
    case error
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

// MARK: - Sport+ workout sessions (Phase 3 training-architecture expansion)
//
// A Sport+ session is the band's own physiological/activity record of one
// continuous activity (start->stop) — a distinct object from a Sombrey
// training session (exercises/sets/reps/weight), never merged with it.
// `sportType` is the raw `OdmSportPlusExerciseModelType` value from
// `SombreySportType` — matched by raw int, never the vendor's bridged
// Swift enum case names (unreliable across Xcode versions — see
// `QCBandSDKService`'s own sleep-type handling for why).

/// One push from the band while a Sport+ session is actively running —
/// `QCSDKManager.currentSportInfo`'s payload, mapped 1:1.
struct SportSessionLiveUpdate {
    let sportType: Int
    let state: Int
    let durationSeconds: Int
    let heartRate: Int
    let steps: Int
    let distanceMeters: Int
    let calories: Int
}

/// A completed Sport+ session, from the band's own historical record
/// (`getSportRecordsFromLastTimeStamp:`) — richer and more accurate than
/// the last live tick, but only available after the band has processed
/// the session, hence fetched separately during `sync()`.
struct SportSessionSummary {
    let sportType: Int
    let startedAt: Date
    let durationSeconds: Int?
    let distanceMeters: Double?
    let calories: Double?
    let averageHeartRate: Double?
    let lowestHeartRate: Double?
    let highestHeartRate: Double?
    let averageSpeedMetersPerSecond: Double?
    let steps: Int?
}

/// A metric the vendor SDK genuinely supports as an on-demand ("measure
/// now") reading — see `QCSDKManager.startToMeasuringWithOperateType:`.
/// HRV/stress/blood-glucose are deliberately excluded: the vendor
/// documents HRV/stress as ring-only, and this can't be confirmed against
/// the physical Sombrey Band from software alone.
enum OnDemandMetric: String, CaseIterable {
    case heartRate, bloodPressure, spo2, bodyTemperature

    /// Raw `QCMeasuringType` value per the vendor header (QCSDKManager.h):
    /// HeartRate=0, BloodPressue=1, BloodOxygen=2, BodyTemperature=7.
    /// Matched by raw int for the same reason `SLEEPTYPE` is in
    /// `QCBandSDKService` — this NS_ENUM's Swift case names aren't
    /// reliably bridged across Xcode versions.
    var qcRawValue: Int {
        switch self {
        case .heartRate: return 0
        case .bloodPressure: return 1
        case .spo2: return 2
        case .bodyTemperature: return 7
        }
    }
}

struct OnDemandMeasurementResult {
    var heartRate: Int?
    var systolicMmHg: Int?
    var diastolicMmHg: Int?
    var spo2Pct: Double?
    var temperatureC: Double?
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
