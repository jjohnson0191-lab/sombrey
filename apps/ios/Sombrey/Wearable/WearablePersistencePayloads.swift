import Foundation
import ConvexMobile

/// Wire shapes for `convex/wearable.ts` — every field here is a real
/// QCBandSDK reading passed straight through from `WearableManager`,
/// never fabricated or estimated on this side either.
struct WearableMeasurementPayload: Encodable, ConvexEncodable {
    let metricType: String
    let value: Double
    let unit: String
    let recordedAt: Double // epoch ms
    // Optional provenance — synthesized `Encodable` omits these keys when
    // nil (never an explicit `null`, which Convex's `v.optional` rejects).
    let rawValue: Double?
    let rawUnit: String?
    let sdkSource: String?

    init(_ measurement: WearableMeasurement) {
        metricType = measurement.metricType.rawValue
        value = measurement.value
        unit = measurement.unit
        recordedAt = measurement.recordedAt.timeIntervalSince1970 * 1000
        rawValue = measurement.deviceRawValue
        rawUnit = measurement.deviceRawUnit
        sdkSource = measurement.sdkSource
    }
}

struct WearableSleepStagePayload: Encodable {
    let stage: String
    let startedAt: Double // epoch ms
    let durationMinutes: Int

    init(_ stage: SleepStage) {
        self.stage = stage.stage.rawValue
        startedAt = stage.startedAt.timeIntervalSince1970 * 1000
        durationMinutes = stage.durationMinutes
    }
}

struct WearableSleepSessionPayload: Encodable, ConvexEncodable {
    let startedAt: Double // epoch ms
    let endedAt: Double // epoch ms
    let totalSleepMinutes: Int
    let stages: [WearableSleepStagePayload]?

    init(_ session: SleepSessionData) {
        startedAt = session.startedAt.timeIntervalSince1970 * 1000
        endedAt = session.endedAt.timeIntervalSince1970 * 1000
        totalSleepMinutes = session.totalSleepMinutes
        stages = session.stages?.map(WearableSleepStagePayload.init)
    }
}

/// Decoded shape of `readiness:computeAndStore`'s return value (see
/// `convex/readiness.ts`) — `sleepSignal` is derived server-side from the
/// same scoring algorithm's own sleep sub-component and confidence, never
/// a separately hardcoded threshold.
struct ReadinessComputeResult: Decodable {
    let id: String
    let score: Int?
    let confidence: Double
    let sleepSignal: String
}

struct GPSPointPayload: Encodable, ConvexEncodable {
    let latitude: Double
    let longitude: Double
    let recordedAt: Double // epoch ms
    let altitudeMeters: Double?

    init(_ point: GPSPoint) {
        latitude = point.latitude
        longitude = point.longitude
        recordedAt = point.recordedAt.timeIntervalSince1970 * 1000
        altitudeMeters = point.altitudeMeters
    }
}
