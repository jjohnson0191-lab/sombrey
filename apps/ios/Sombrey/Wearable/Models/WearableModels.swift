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

    /// Whether `value` is even physically possible for this metric on a
    /// living person wearing the band — the one shared validity check
    /// every reading passes through before it's allowed to reach
    /// `WearableManager`, a graph, Convex persistence, or the readiness
    /// engine (`QCBandSDKService.emit`, `WearableManager.measureNow`).
    ///
    /// Neither vendor header (`QCTemperatureModel.h`, `QCSportModel.h`,
    /// etc.) documents an explicit "no reading" sentinel constant, but a
    /// scheduled/historical payload's zero-filled empty slots are
    /// indistinguishable from a real reading of exactly 0 for several
    /// metrics — and 0 is physically impossible for a living person on
    /// every one of them, confirmed against a real device: skin
    /// temperature briefly read 24.4°C, then a later array entry (a
    /// zero-filled gap, not a new measurement) overwrote it with 0.0°C.
    /// `emitHeartRate` already guarded against exactly this for heart
    /// rate (`guard bpm > 0`); this generalizes that same, already-
    /// established rule. Steps/distance/battery remain exempt — 0 steps,
    /// 0 meters, and 0% battery are all unambiguous, real, legitimate
    /// states.
    ///
    /// Active calories is the one deliberate exception to "0 is a real
    /// reading here": the band's pedometer calorie counter
    /// (`QCSportModel.calories` / the `currentStepInfo` live callback) is
    /// a cumulative since-midnight counter with no documented distinction
    /// between "band genuinely recorded zero effort today" and "the SDK
    /// hasn't produced a real reading for today yet" — both surface as
    /// the same `0`. Per explicit product decision, Sombrey never shows
    /// a numeric `0 kcal`, since a user reading that value can't tell
    /// those two states apart; the UI shows "—" (`WearableManager` /
    /// `HomeScreen` / `VitalsScreen`) until a real, positive reading
    /// exists for today instead. `value` here is already in kcal (see
    /// `BandCalorieUnits`), but the rule is unit-independent.
    func isPhysicallyPlausible(_ value: Double) -> Bool {
        switch self {
        case .heartRate, .restingHeartRate, .spo2, .skinTemperature,
             .bloodPressureSystolic, .bloodPressureDiastolic, .activeCalories:
            return value > 0
        case .steps, .distanceMeters, .batteryPct, .hrv, .stress:
            return value >= 0
        }
    }
}

/// The band reports every calorie counter except Sport+ session
/// summaries in small calories (cal), not kilocalories. Established
/// from the vendor's own material, not inferred from the magnitude:
///
/// - `QCSDKManager.h` documents `currentStepInfo`'s calorie as "unit:
///   calorie", `QCSDKCmdCreator.h` documents `calorieTarget` as "unit:
///   cal", and `QCExerciseModel.h` annotates its calories "单位卡" (cal) —
///   while `OdmSportPlusModels.h` explicitly marks the Sport+ summary's
///   `calorie` as "单位大卡" (kcal). The vendor distinguishes the two.
/// - The SDK binary's Sport+ V2 parser divides the band's raw calorie
///   integer by 1000.0 before storing that kcal value; the pedometer
///   parser (`OdmBandGetCurrentSportInfo`, command 0x48) stores its
///   3-byte raw integer into `QCSportModel.calories` unscaled.
/// - The vendor demo logs both live callbacks as
///   "calorie(unit:calorie)".
/// - Production readings rise ~23–29 units per step (e.g. 1126 steps →
///   30040): ~0.027 kcal/step as cal, impossible as kcal.
///
/// Converting here is a documented unit change, not an estimate: the
/// band's own number is preserved verbatim alongside it
/// (`WearableMeasurement.deviceRawValue`/`deviceRawUnit`).
enum BandCalorieUnits {
    static let rawUnit = "cal"
    static let smallCaloriesPerKilocalorie: Double = 1000

    static func kilocalories(fromBandCalories raw: Double) -> Double {
        raw / smallCaloriesPerKilocalorie
    }
}

/// Bounds for `WearableManager.liveHeartRateTrace`: the last few minutes of
/// the band's real-time stream, enough to show a live signal without
/// holding an unbounded session in memory. Pure so the windowing rule is
/// testable on its own.
enum LiveHeartRateTrace {
    /// Tag `QCBandSDKService` puts on real-time heart-rate readings, so a
    /// live sample can be told apart from synced history downstream.
    static let sdkSource = "realTimeHeartRate"
    static let window: TimeInterval = 5 * 60
    static let maxSamples = 600

    static func appending(_ sample: WearableMeasurement, to trace: [WearableMeasurement]) -> [WearableMeasurement] {
        let cutoff = sample.recordedAt.addingTimeInterval(-window)
        var next = trace.filter { $0.recordedAt >= cutoff && $0.recordedAt < sample.recordedAt }
        next.append(sample)
        return Array(next.suffix(maxSamples))
    }
}

struct WearableMeasurement {
    let deviceId: DeviceID
    let metricType: WearableMetricType
    let value: Double
    let unit: String
    let recordedAt: Date
    /// The value exactly as the SDK delivered it, when `value` had to be
    /// unit-converted from it (currently only active calories: raw cal →
    /// kcal). `nil` means `value` already is the SDK's own number.
    var deviceRawValue: Double? = nil
    var deviceRawUnit: String? = nil
    /// Which SDK entry point produced this reading (e.g.
    /// `getCurrentSportSucess` for the sync summary, `currentStepInfo` for
    /// the live push) — provenance for readings where more than one
    /// device path reports the same metric.
    var sdkSource: String? = nil

    /// Whether `recordedAt` falls on today's calendar date, in the
    /// device's local time zone. The one check that keeps a
    /// cumulative-since-midnight device counter (steps/active
    /// calories/distance, from `QCSportModel`'s daily summary) from
    /// silently surviving into a new calendar day as if it were still
    /// current — nothing elsewhere in `WearableManager` ever clears
    /// these values on its own (unlike live heart rate, which is cleared
    /// on disconnect), so a stale prior-day total would otherwise keep
    /// showing as "today's" reading indefinitely. See
    /// `WearableManager.latestMeasurementForToday(_:)`.
    var isFromToday: Bool { Calendar.current.isDateInToday(recordedAt) }
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
    /// kcal, converted from the band's raw cal (see `BandCalorieUnits`).
    let calories: Double
}

/// One Sport+ record exactly as the band's SDK returned it
/// (`OdmGeneralExerciseSummaryModel` + its detail), before any
/// interpretation. The SDK's numeric fields are non-optional, so an
/// unmeasured value arrives as 0 — `BandSportImport.normalize` decides
/// which zeros mean "not measured".
struct BandSportRecord: Equatable {
    let sportType: Int
    /// SDK `sourceType`: 0 = started on the band, 1 = started from an app.
    let sourceType: Int
    /// SDK `startTime`, "单位秒" (seconds) per the header. Epoch/time zone
    /// not documented — kept raw so it can be checked on a real band.
    let rawStartTime: Double
    /// SDK `duration` — unit not stated in the header.
    let rawDuration: Int
    let distanceMeters: Int
    /// kcal ("单位大卡"); the SDK converts from the band's cal itself.
    let calories: Double
    let averageSpeed: Double
    let fastestSpeed: Double
    let averageHeartRate: Int
    let lowestHeartRate: Int
    let highestHeartRate: Int
    let averageAltitude: Double
    let climbMeters: Double
    let descentMeters: Double
    let stepFrequency: Int
    let actionCount: Int
    let steps: Int
    let sampleRateSeconds: Int
    let heartRates: [Int]
    let speeds: [Double]
    let route: [RoutePoint]

    struct RoutePoint: Equatable {
        let latitude: Double
        let longitude: Double
        let recordedAt: Date
        let altitudeMeters: Double?
    }
}

/// Turns a raw band record into what Sombrey stores. Pure, so the rules
/// are unit-tested:
/// - A measurement the band reports as 0 where 0 can't be a real result
///   (heart rate, speed, calories, distance, steps, altitude, climb…) is
///   stored as absent — never as a fake zero.
/// - Timing is passed through untouched (`bandStartTimeSec`,
///   `bandDurationRaw`); `durationSeconds` assumes the undocumented unit
///   is seconds. The server flags implausible timing rather than shifting
///   it.
/// - A record with no start time or no duration isn't a session: `nil`.
enum BandSportImport {
    static func normalize(_ record: BandSportRecord) -> BandSportRecordPayload? {
        guard record.rawStartTime > 0, record.rawDuration > 0 else { return nil }
        func positive(_ value: Double) -> Double? { value > 0 && value.isFinite ? value : nil }
        func positive(_ value: Int) -> Double? { value > 0 ? Double(value) : nil }
        let heartRates = record.heartRates.filter { $0 > 0 }
        let speeds = record.speeds.filter { $0 >= 0 && $0.isFinite }
        return BandSportRecordPayload(
            sportType: record.sportType,
            recordSource: record.sourceType == 0 ? "band" : (record.sourceType == 1 ? "app" : nil),
            bandStartTimeSec: record.rawStartTime,
            bandDurationRaw: Double(record.rawDuration),
            durationSeconds: Double(record.rawDuration),
            distanceMeters: positive(record.distanceMeters),
            calories: positive(record.calories),
            averageHeartRate: positive(record.averageHeartRate),
            lowestHeartRate: positive(record.lowestHeartRate),
            highestHeartRate: positive(record.highestHeartRate),
            averageSpeedMetersPerSecond: positive(record.averageSpeed),
            fastestSpeedMetersPerSecond: positive(record.fastestSpeed),
            stepFrequency: positive(record.stepFrequency),
            actionCount: positive(record.actionCount),
            averageAltitudeMeters: positive(record.averageAltitude),
            climbMeters: positive(record.climbMeters),
            descentMeters: positive(record.descentMeters),
            steps: positive(record.steps),
            sampleRateSeconds: positive(record.sampleRateSeconds),
            heartRates: heartRates.isEmpty ? nil : heartRates.map(Double.init),
            speedsMetersPerSecond: speeds.isEmpty || speeds.allSatisfy({ $0 == 0 }) ? nil : speeds,
            route: record.route.isEmpty ? nil : record.route
        )
    }
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


/// The band's own real-time BP push, as the SDK forwards it to
/// `startToMeasuring`'s `measuringHandle`: `@{"sbp": NSNumber, "dbp":
/// NSNumber}` (keys confirmed in the SDK binary). The only source of a
/// genuine on-demand BP reading — see `QCBandSDKService.measureNow`.
enum BandBloodPressurePush {
    static func pair(from tick: Any?) -> (systolic: Int, diastolic: Int)? {
        guard let dict = tick as? [String: Any],
              let systolic = (dict["sbp"] as? NSNumber)?.intValue,
              let diastolic = (dict["dbp"] as? NSNumber)?.intValue,
              systolic > 0, diastolic > 0 else { return nil }
        return (systolic, diastolic)
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
    /// The connected band's own `setTime:` feature list explicitly
    /// reports this on-demand metric as unsupported — never inferred or
    /// guessed, only ever thrown from a positive "false" flag the SDK
    /// itself returned (see `QCBandSDKService.measureNow`).
    case unsupportedByDevice(String)
    /// Blood pressure only: the SDK's measurement window ended without
    /// the band itself pushing a systolic/diastolic pair. The SDK still
    /// reports `isSuccess` here, with a single number that is its own
    /// hardcoded default (120) whenever the band sent nothing — see
    /// `QCBandSDKService.measureNow` — so this is never treated as a
    /// reading.
    case bloodPressureNotReturnedByBand
}
