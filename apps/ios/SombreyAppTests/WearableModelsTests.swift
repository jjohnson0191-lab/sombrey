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
