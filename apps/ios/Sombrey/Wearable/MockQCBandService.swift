import Foundation

/// Explicit, clearly-named sample data for UI development ONLY. Mirrors
/// the `MOCK_WORKOUT` convention already established in the web app
/// (`apps/mobile/src/features/training/useTodayWorkout.ts`): a realistic,
/// clearly-mock dataset, isolated to one file, never presented as if it
/// were real.
///
/// `WearableManager` must be built so swapping this for `QCBandSDKService`
/// is the ONLY change required once the vendor SDK is integrated — no UI
/// code may change. This type must never be reachable from a production
/// build path once a real device is connected; that wiring decision
/// belongs to `WearableManager` / app configuration, not this file.
final class MockQCBandService: QCBandService {
    private let mockDevice = SombreyDevice(
        id: "mock-device-1",
        serial: "SBY-MOCK-0001",
        model: "Sombrey Band (Mock)",
        nickname: "My Band",
        firmwareVersion: "0.0.0-mock"
    )

    // Empty, not fabricated — no real band has ever been asked, matching
    // this conformer's honest-absence convention everywhere else.
    var lastKnownCapabilities: [String: Bool] { [:] }

    func scanForDevices() async throws -> [SombreyDevice] {
        [mockDevice]
    }

    func pairDevice(_ deviceId: DeviceID) async throws {
        // No-op: mock pairing always "succeeds" instantly.
    }

    func reconnectDevice(_ deviceId: DeviceID) async throws {
        // No-op: mock reconnect always "succeeds" instantly, same as pairing.
    }

    func unpairDevice(_ deviceId: DeviceID) async throws {
        // No-op.
    }

    func deviceStatus(_ deviceId: DeviceID) async throws -> WearableDeviceStatus {
        WearableDeviceStatus(deviceId: deviceId, connectionState: .connected, batteryPct: 76, lastSeenAt: Date())
    }

    func sync(_ deviceId: DeviceID) async throws -> WearableSyncResult {
        WearableSyncResult(status: .success, recordsSynced: 0, syncedAt: Date())
    }

    func measurements(for deviceId: DeviceID) -> AsyncStream<WearableMeasurement> {
        // Mock intentionally emits nothing by default — a UI that reads
        // "no data yet" from an empty stream is exercising the same
        // honest-absence path the web app uses (`HomeScreen`'s "—"
        // placeholders), not a fabricated live feed.
        AsyncStream { continuation in
            continuation.finish()
        }
    }

    func firmwareInfo(_ deviceId: DeviceID) async throws -> String {
        "0.0.0-mock"
    }

    func sleepHistory(_ deviceId: DeviceID, days: Int) async throws -> [SleepSessionData] {
        // Empty, not fabricated — matches `measurements(for:)`'s honest-
        // absence convention above.
        []
    }

    func connectionStateUpdates(for deviceId: DeviceID) -> AsyncStream<WearableConnectionState> {
        AsyncStream { continuation in continuation.finish() }
    }

    func startSportSession(_ deviceId: DeviceID, sportType: Int) async throws {
        // No-op: mock accepts the command instantly, no real band session exists.
    }

    func pauseSportSession(_ deviceId: DeviceID) async throws {}

    func resumeSportSession(_ deviceId: DeviceID) async throws {}

    func stopSportSession(_ deviceId: DeviceID) async throws {}

    func sportSessionUpdates(for deviceId: DeviceID) -> AsyncStream<SportSessionLiveUpdate> {
        AsyncStream { continuation in continuation.finish() }
    }

    func sportSessionHistory(_ deviceId: DeviceID, sinceBandTimestamp bandTimestamp: Double) async throws -> [BandSportRecord] {
        []
    }

    func sportRecordUpdates(for deviceId: DeviceID) -> AsyncStream<Void> {
        AsyncStream { continuation in continuation.finish() }
    }

    func measureNow(_ deviceId: DeviceID, metric: OnDemandMetric) async throws -> OnDemandMeasurementResult {
        // Empty result, not a fabricated reading — every field stays nil.
        OnDemandMeasurementResult()
    }

    // No real-time SDK stream to start/stop — matches `measurements(for:)`'s
    // honest-absence convention for this conformer.
    func startLiveHeartRate(_ deviceId: DeviceID) async {}
    func stopLiveHeartRate(_ deviceId: DeviceID) async {}

    func setTargets(_ deviceId: DeviceID, steps: Int?, sleepMinutes: Int?, activeCalories: Int?) async throws {
        throw WearableUnsupportedError(feature: "Setting band targets")
    }

    func vibrate(_ deviceId: DeviceID) async throws {
        throw WearableUnsupportedError(feature: "Vibration")
    }

    func findBand(_ deviceId: DeviceID) async throws {
        throw WearableUnsupportedError(feature: "Find my band")
    }
}
