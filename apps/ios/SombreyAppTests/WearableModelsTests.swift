import Foundation
import Testing
@testable import SombreyApp

/// Coverage for the two validity rules the calorie/blood-pressure audit
/// introduced/tightened: active calories must never surface a bare `0`
/// (the device's cumulative counter can't distinguish "genuinely zero
/// effort" from "no real reading yet"), and a cumulative-day reading
/// must never be treated as "today's" once its calendar day has passed.
struct WearableMetricTypeValidityTests {
    @Test func activeCaloriesRejectsZeroUnlikeStepsAndDistance() {
        #expect(WearableMetricType.activeCalories.isPhysicallyPlausible(0) == false)
        #expect(WearableMetricType.activeCalories.isPhysicallyPlausible(1) == true)
        #expect(WearableMetricType.activeCalories.isPhysicallyPlausible(600) == true)
        // Contrast: 0 remains a legitimate, real reading for these —
        // this rule is deliberately specific to active calories, not a
        // blanket "0 is invalid."
        #expect(WearableMetricType.steps.isPhysicallyPlausible(0) == true)
        #expect(WearableMetricType.distanceMeters.isPhysicallyPlausible(0) == true)
        #expect(WearableMetricType.batteryPct.isPhysicallyPlausible(0) == true)
    }

    @Test func perSampleMetricsStillRejectZeroAndNegatives() {
        #expect(WearableMetricType.heartRate.isPhysicallyPlausible(0) == false)
        #expect(WearableMetricType.bloodPressureSystolic.isPhysicallyPlausible(0) == false)
        #expect(WearableMetricType.bloodPressureDiastolic.isPhysicallyPlausible(-5) == false)
        #expect(WearableMetricType.heartRate.isPhysicallyPlausible(62) == true)
    }
}

struct WearableMeasurementFreshnessTests {
    @Test func todaysMeasurementIsFromToday() {
        let measurement = WearableMeasurement(deviceId: "d1", metricType: .activeCalories, value: 350, unit: "kcal", recordedAt: Date())
        #expect(measurement.isFromToday)
    }

    @Test func yesterdaysMeasurementIsNotFromToday() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let measurement = WearableMeasurement(deviceId: "d1", metricType: .activeCalories, value: 350, unit: "kcal", recordedAt: yesterday)
        #expect(!measurement.isFromToday)
    }
}

/// The band reports pedometer calories in small calories (cal); see
/// `BandCalorieUnits` for the vendor evidence. Values below are real
/// production readings from the investigation into "30,040 kcal".
struct BandCalorieUnitsTests {
    @Test func rawBandCaloriesConvertToKilocalories() {
        // 1,126 steps → band reported 30040 → 30.04 kcal, not 30,040.
        #expect(BandCalorieUnits.kilocalories(fromBandCalories: 30040) == 30.04)
        // 79 steps → band reported 2070 → 2.07 kcal.
        #expect(BandCalorieUnits.kilocalories(fromBandCalories: 2070) == 2.07)
        #expect(BandCalorieUnits.rawUnit == "cal")
    }

    @Test func zeroStillRejectedAfterConversion() {
        let kcal = BandCalorieUnits.kilocalories(fromBandCalories: 0)
        #expect(WearableMetricType.activeCalories.isPhysicallyPlausible(kcal) == false)
        // The smallest real band reading (1 cal) stays a real reading.
        #expect(WearableMetricType.activeCalories.isPhysicallyPlausible(BandCalorieUnits.kilocalories(fromBandCalories: 1)))
    }

    @Test func smallKilocalorieValuesAreNotRoundedToZero() {
        #expect(HomeScreen.kilocalorieText(0.288) == "0.3")
        #expect(HomeScreen.kilocalorieText(2.07) == "2.1")
        #expect(HomeScreen.kilocalorieText(30.04) == "30")
    }
}

struct WearableMeasurementPayloadTests {
    @Test func convertedCaloriesCarryRawDeviceValueAndSource() throws {
        let measurement = WearableMeasurement(
            deviceId: "d1", metricType: .activeCalories, value: 30.04, unit: "kcal", recordedAt: Date(),
            deviceRawValue: 30040, deviceRawUnit: "cal", sdkSource: "getCurrentSportSucess"
        )
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(WearableMeasurementPayload(measurement))) as! [String: Any]
        #expect(json["value"] as? Double == 30.04)
        #expect(json["unit"] as? String == "kcal")
        #expect(json["rawValue"] as? Double == 30040)
        #expect(json["rawUnit"] as? String == "cal")
        #expect(json["sdkSource"] as? String == "getCurrentSportSucess")
    }

    /// Convex's `v.optional` rejects an explicit `null`, so absent
    /// provenance must be an absent key.
    @Test func unconvertedMetricsOmitProvenanceKeys() throws {
        let measurement = WearableMeasurement(deviceId: "d1", metricType: .heartRate, value: 62, unit: "bpm", recordedAt: Date())
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(WearableMeasurementPayload(measurement))) as! [String: Any]
        #expect(json["rawValue"] == nil)
        #expect(json["rawUnit"] == nil)
        #expect(json["sdkSource"] == nil)
        #expect(json.keys.contains("rawValue") == false)
    }
}

/// On-demand BP comes only from the band's own real-time push, which the
/// SDK forwards to `measuringHandle` as `@{"sbp": n, "dbp": n}` — never
/// from `completedHandle`'s value, which for BP is a bare systolic number
/// (the SDK's hardcoded 120 when the band sent nothing).
struct BandBloodPressurePushTests {
    @Test func bandPushDictionaryParsesToPair() {
        let tick: Any = NSDictionary(dictionary: ["sbp": NSNumber(value: 118), "dbp": NSNumber(value: 76)])
        let pair = BandBloodPressurePush.pair(from: tick)
        #expect(pair?.systolic == 118)
        #expect(pair?.diastolic == 76)
    }

    @Test func completionStyleNumberIsNeverAReading() {
        #expect(BandBloodPressurePush.pair(from: NSNumber(value: 120)) == nil)
        #expect(BandBloodPressurePush.pair(from: nil) == nil)
    }

    @Test func missingOrZeroHalfIsNotAReading() {
        #expect(BandBloodPressurePush.pair(from: ["sbp": NSNumber(value: 118)]) == nil)
        #expect(BandBloodPressurePush.pair(from: ["sbp": NSNumber(value: 0), "dbp": NSNumber(value: 76)]) == nil)
    }
}

@MainActor
struct BloodPressureFailureDetailTests {
    @Test func sdkErrorCodesMapToWhatTheBandReported() {
        func sdkError(_ code: Int) -> NSError { NSError(domain: "QCEndMeasuringError", code: code) }
        #expect(WearableManager.bloodPressureFailureDetail(for: sdkError(-3))?.contains("isn't being worn properly") == true)
        #expect(WearableManager.bloodPressureFailureDetail(for: sdkError(-4))?.contains("calibrating") == true)
        #expect(WearableManager.bloodPressureFailureDetail(for: sdkError(-1))?.contains("start-measurement") == true)
        #expect(WearableManager.bloodPressureFailureDetail(for: WearableSDKError.bloodPressureNotReturnedByBand)?.contains("without returning") == true)
    }

    @Test func unknownCausesKeepTheGenericMessage() {
        #expect(WearableManager.bloodPressureFailureDetail(for: NSError(domain: "x", code: 42)) == nil)
        #expect(WearableManager.bloodPressureFailureDetail(for: WearableSDKError.noConnectedDevice) == nil)
    }
}

// A `QCBandSDKService.parseMeasurementResult` test for the blood-pressure
// vendor-model-vs-dictionary fix was deliberately left out here: it would
// need `import QCBandSDK`, and `SombreyAppTests`' build settings don't
// carry the `FRAMEWORK_SEARCH_PATHS` entry the main `SombreyApp` target
// has for `$(PROJECT_DIR)/Frameworks` (confirmed by reading
// `SombreyApp.xcodeproj/project.pbxproj` directly rather than assuming),
// so that import would fail to compile in the test target as configured
// today. Adding that search path is a reasonable follow-up, but changing
// Xcode build settings blind (this environment can't build this project
// locally to verify — see the wearable/BP audit report) is a bigger risk
// than this audit should take on for one extra test.
