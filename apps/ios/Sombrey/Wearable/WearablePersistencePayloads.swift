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

    init(_ measurement: WearableMeasurement) {
        metricType = measurement.metricType.rawValue
        value = measurement.value
        unit = measurement.unit
        recordedAt = measurement.recordedAt.timeIntervalSince1970 * 1000
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
