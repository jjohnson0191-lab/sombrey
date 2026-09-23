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

/// `sportPlusSessions:importBandSessions`' record shape. Absent values are
/// omitted from the JSON entirely (Convex's `v.optional` rejects `null`).
struct BandSportRecordPayload: Encodable, ConvexEncodable, Equatable {
    let sportType: Int
    let recordSource: String?
    let bandStartTimeSec: Double
    let bandDurationRaw: Double
    let durationSeconds: Double
    let distanceMeters: Double?
    let calories: Double?
    let averageHeartRate: Double?
    let lowestHeartRate: Double?
    let highestHeartRate: Double?
    let averageSpeedMetersPerSecond: Double?
    let fastestSpeedMetersPerSecond: Double?
    let stepFrequency: Double?
    let actionCount: Double?
    let averageAltitudeMeters: Double?
    let climbMeters: Double?
    let descentMeters: Double?
    let steps: Double?
    let sampleRateSeconds: Double?
    let heartRates: [Double]?
    let speedsMetersPerSecond: [Double]?
    let route: [BandSportRecord.RoutePoint]?

    enum CodingKeys: String, CodingKey {
        case sportType, recordSource, bandStartTimeSec, bandDurationRaw, durationSeconds, distanceMeters, calories
        case averageHeartRate, lowestHeartRate, highestHeartRate, averageSpeedMetersPerSecond, fastestSpeedMetersPerSecond
        case stepFrequency, actionCount, averageAltitudeMeters, climbMeters, descentMeters, steps, sampleRateSeconds
        case heartRates, speedsMetersPerSecond, route
    }

    private struct RouteKeys: Encodable {
        let latitude: Double
        let longitude: Double
        let recordedAt: Double
        let altitudeMeters: Double?
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(Double(sportType), forKey: .sportType)
        try c.encodeIfPresent(recordSource, forKey: .recordSource)
        try c.encode(bandStartTimeSec, forKey: .bandStartTimeSec)
        try c.encode(bandDurationRaw, forKey: .bandDurationRaw)
        try c.encode(durationSeconds, forKey: .durationSeconds)
        try c.encodeIfPresent(distanceMeters, forKey: .distanceMeters)
        try c.encodeIfPresent(calories, forKey: .calories)
        try c.encodeIfPresent(averageHeartRate, forKey: .averageHeartRate)
        try c.encodeIfPresent(lowestHeartRate, forKey: .lowestHeartRate)
        try c.encodeIfPresent(highestHeartRate, forKey: .highestHeartRate)
        try c.encodeIfPresent(averageSpeedMetersPerSecond, forKey: .averageSpeedMetersPerSecond)
        try c.encodeIfPresent(fastestSpeedMetersPerSecond, forKey: .fastestSpeedMetersPerSecond)
        try c.encodeIfPresent(stepFrequency, forKey: .stepFrequency)
        try c.encodeIfPresent(actionCount, forKey: .actionCount)
        try c.encodeIfPresent(averageAltitudeMeters, forKey: .averageAltitudeMeters)
        try c.encodeIfPresent(climbMeters, forKey: .climbMeters)
        try c.encodeIfPresent(descentMeters, forKey: .descentMeters)
        try c.encodeIfPresent(steps, forKey: .steps)
        try c.encodeIfPresent(sampleRateSeconds, forKey: .sampleRateSeconds)
        try c.encodeIfPresent(heartRates, forKey: .heartRates)
        try c.encodeIfPresent(speedsMetersPerSecond, forKey: .speedsMetersPerSecond)
        if let route {
            try c.encode(route.map {
                RouteKeys(latitude: $0.latitude, longitude: $0.longitude, recordedAt: $0.recordedAt.timeIntervalSince1970 * 1000, altitudeMeters: $0.altitudeMeters)
            }, forKey: .route)
        }
    }
}
