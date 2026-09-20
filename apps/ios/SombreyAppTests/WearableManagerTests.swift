import Testing
@testable import SombreyApp

/// Only what's testable without a live Convex session/network — matching
/// `ConvexClientProviderTests`' own discipline. `pair()`/`sync()`/
/// `unpair()`/`handleSignOut()` all call `ConvexClientProvider.client`
/// for persistence and aren't exercised here; the state-machine behavior
/// they drive locally (`discoveredDevices`, `MockQCBandService`'s own
/// contract) is.
@MainActor
struct WearableManagerTests {
    @Test func scanPopulatesDiscoveredDevicesFromTheService() async {
        let manager = WearableManager(service: MockQCBandService())
        #expect(manager.discoveredDevices.isEmpty)
        #expect(!manager.isScanning)

        await manager.scan()

        #expect(manager.isScanning == false)
        #expect(manager.discoveredDevices.count == 1)
        #expect(manager.discoveredDevices.first?.nickname == "My Band")
    }

    @Test func newManagerHasNoPairedDeviceByDefault() {
        // Isolate from any UserDefaults state a real device run may have
        // left behind — restore afterward regardless of outcome.
        let key = "sombreyWearable.lastDeviceId"
        let existing = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        defer {
            if let existing { UserDefaults.standard.set(existing, forKey: key) }
        }

        let manager = WearableManager(service: MockQCBandService())
        #expect(manager.pairedDevice == nil)
        #expect(manager.status == nil)
        #expect(manager.lastSyncResult == nil)
    }
}

/// `MockQCBandService`'s own contract — the "explicit sample data, never
/// presented as real" honesty rules from its file header, verified.
struct MockQCBandServiceTests {
    @Test func scanReturnsExactlyOneClearlyMockedDevice() async throws {
        let service = MockQCBandService()
        let devices = try await service.scanForDevices()
        #expect(devices.count == 1)
        #expect(devices.first?.serial.contains("MOCK") == true)
    }

    @Test func measurementStreamEmitsNothingRatherThanFabricatingData() async {
        let service = MockQCBandService()
        var received: [WearableMeasurement] = []
        for await measurement in service.measurements(for: "mock-device-1") {
            received.append(measurement)
        }
        #expect(received.isEmpty)
    }

    @Test func sleepHistoryIsEmptyRatherThanFabricated() async throws {
        let service = MockQCBandService()
        let sessions = try await service.sleepHistory("mock-device-1", days: 7)
        #expect(sessions.isEmpty)
    }

    @Test func unwiredCapabilitiesThrowUnsupportedRatherThanSilentlyNoOp() async {
        let service = MockQCBandService()
        await #expect(throws: WearableUnsupportedError.self) {
            try await service.vibrate("mock-device-1")
        }
        await #expect(throws: WearableUnsupportedError.self) {
            try await service.findBand("mock-device-1")
        }
        await #expect(throws: WearableUnsupportedError.self) {
            try await service.setTargets("mock-device-1", steps: nil, sleepMinutes: nil, activeCalories: nil)
        }
    }
}

/// Swift-side `WearableMetricType` raw values must match
/// `convex/wearable.ts`'s `metricTypeValidator` literals exactly — this
/// guards against the two drifting silently (a mismatch would fail every
/// `wearable:recordMeasurements` call for that metric at runtime, not at
/// compile time, since the argument crosses a JSON boundary).
struct WearableMetricTypeTests {
    @Test func rawValuesMatchTheConvexSchemaLiterals() {
        #expect(WearableMetricType.heartRate.rawValue == "heart_rate")
        #expect(WearableMetricType.restingHeartRate.rawValue == "resting_heart_rate")
        #expect(WearableMetricType.steps.rawValue == "steps")
        #expect(WearableMetricType.activeCalories.rawValue == "active_calories")
        #expect(WearableMetricType.distanceMeters.rawValue == "distance_meters")
        #expect(WearableMetricType.spo2.rawValue == "spo2")
        #expect(WearableMetricType.skinTemperature.rawValue == "skin_temperature")
        #expect(WearableMetricType.bloodPressureSystolic.rawValue == "blood_pressure_systolic")
        #expect(WearableMetricType.bloodPressureDiastolic.rawValue == "blood_pressure_diastolic")
        #expect(WearableMetricType.batteryPct.rawValue == "battery_pct")
    }
}
