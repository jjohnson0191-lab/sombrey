import Foundation
import Observation
import ConvexMobile

/// The one wearable object SwiftUI views touch. Owns a `QCBandService`
/// conformer (injected — `QCBandSDKService` in the running app,
/// `MockQCBandService` for previews/tests) and exposes state as plain
/// published properties. No view should ever hold a `QCBandService`
/// directly.
///
/// Phase 3: this is now the real orchestration layer described in the
/// wearable-integration plan — connection lifecycle, historical +
/// live-measurement sync, and Convex persistence (`convex/wearable.ts`)
/// all live here, on top of whatever `QCBandService` conformer is
/// injected. Nothing here fabricates a reading; every value passed to
/// Convex came from a real `QCBandService` call.
///
/// `@MainActor` on the whole type: every call site is SwiftUI-driven
/// (already on the main actor), and the `Task { [weak self] in ... }`
/// this type creates for the live measurement stream needs guaranteed
/// main-actor isolation to safely capture `self`.
@Observable
@MainActor
final class WearableManager {
    private(set) var pairedDevice: SombreyDevice?
    private(set) var status: WearableDeviceStatus?
    private(set) var lastSyncResult: WearableSyncResult?
    private(set) var isScanning = false
    private(set) var lastError: String?
    private(set) var discoveredDevices: [SombreyDevice] = []
    /// Most recent reading per metric — what `HomeScreen`'s activity row
    /// reads for "— steps / — active cal / HR —" once real data exists.
    private(set) var latestMeasurements: [WearableMetricType: WearableMeasurement] = [:]

    private let service: QCBandService
    private var measurementTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var pendingMeasurements: [WearableMeasurement] = []

    private static let lastDeviceIdKey = "sombreyWearable.lastDeviceId"

    init(service: QCBandService) {
        self.service = service
        if let savedId = UserDefaults.standard.string(forKey: Self.lastDeviceIdKey) {
            pairedDevice = SombreyDevice(id: savedId, serial: "", model: "Sombrey Band", nickname: nil, firmwareVersion: nil)
        }
    }

    // MARK: - Discovery & pairing

    func scan() async {
        isScanning = true
        lastError = nil
        defer { isScanning = false }
        do {
            discoveredDevices = try await service.scanForDevices()
        } catch WearableSDKError.bluetoothUnavailable {
            status = WearableDeviceStatus(deviceId: pairedDevice?.id ?? "", connectionState: .unavailable, batteryPct: nil, lastSeenAt: nil)
            lastError = "Bluetooth is off or unavailable."
        } catch {
            lastError = String(describing: error)
        }
    }

    func pair(_ device: SombreyDevice) async {
        lastError = nil
        status = WearableDeviceStatus(deviceId: device.id, connectionState: .connecting, batteryPct: nil, lastSeenAt: nil)
        do {
            try await service.pairDevice(device.id)
            pairedDevice = device
            UserDefaults.standard.set(device.id, forKey: Self.lastDeviceIdKey)
            subscribeToMeasurements(deviceId: device.id)
            await refreshStatus()
            await persistDeviceState(deviceId: device.id, model: device.model, nickname: device.nickname, connected: true, synced: false)
            await sync()
        } catch {
            status = WearableDeviceStatus(deviceId: device.id, connectionState: .error, batteryPct: nil, lastSeenAt: nil)
            lastError = String(describing: error)
        }
    }

    func unpair() async {
        guard let device = pairedDevice else { return }
        do {
            try await service.unpairDevice(device.id)
        } catch {
            lastError = String(describing: error)
        }
        teardownLocalState()
    }

    // MARK: - Status & sync

    func refreshStatus() async {
        guard let device = pairedDevice else { return }
        do {
            status = try await service.deviceStatus(device.id)
        } catch {
            lastError = String(describing: error)
        }
    }

    func sync() async {
        guard let device = pairedDevice else { return }
        syncTask?.cancel()
        status = WearableDeviceStatus(deviceId: device.id, connectionState: .syncing, batteryPct: status?.batteryPct, lastSeenAt: status?.lastSeenAt)

        let task = Task {
            do {
                let result = try await service.sync(device.id)
                guard !Task.isCancelled else { return }
                self.lastSyncResult = result
                await self.flushPendingMeasurements(deviceId: device.id)
                await self.syncSleepHistory(deviceId: device.id)
                await self.persistDeviceState(deviceId: device.id, model: nil, nickname: nil, connected: false, synced: true)
                await self.refreshStatus()
            } catch {
                guard !Task.isCancelled else { return }
                self.lastError = String(describing: error)
                await self.refreshStatus()
            }
        }
        syncTask = task
        await task.value
    }

    private func syncSleepHistory(deviceId: DeviceID) async {
        do {
            let sessions = try await service.sleepHistory(deviceId, days: 7)
            guard !sessions.isEmpty else { return }
            let payload: [ConvexEncodable?] = sessions.map { WearableSleepSessionPayload($0) as ConvexEncodable? }
            try await ConvexClientProvider.client.mutation("wearable:recordSleepSessions", with: [
                "deviceId": deviceId,
                "sessions": payload,
            ])
        } catch {
            // Non-fatal — sleep history is best-effort on top of the
            // measurement sync that already ran.
            lastError = String(describing: error)
        }
    }

    // MARK: - App lifecycle

    /// Call from the root view's `.onChange(of: scenePhase)`.
    func handleScenePhaseChange(isActive: Bool) {
        guard pairedDevice != nil else { return }
        if isActive {
            Task { await refreshStatus() }
        } else {
            Task { await flushPendingMeasurements(deviceId: pairedDevice?.id ?? "") }
        }
    }

    /// Call when `AppState.authPhase` transitions to `.signedOut` — no
    /// wearable sync or persistence may keep running for a user who just
    /// signed out. The physical pairing itself is torn down too, since
    /// there is no "which Sombrey account" concept at the BLE layer;
    /// the next signed-in user re-pairs explicitly.
    func handleSignOut() {
        Task {
            if let device = pairedDevice {
                try? await service.unpairDevice(device.id)
            }
            teardownLocalState()
        }
    }

    private func teardownLocalState() {
        measurementTask?.cancel()
        measurementTask = nil
        syncTask?.cancel()
        syncTask = nil
        pendingMeasurements.removeAll()
        latestMeasurements.removeAll()
        pairedDevice = nil
        status = nil
        lastSyncResult = nil
        discoveredDevices = []
        UserDefaults.standard.removeObject(forKey: Self.lastDeviceIdKey)
    }

    // MARK: - Live measurement stream

    private func subscribeToMeasurements(deviceId: DeviceID) {
        measurementTask?.cancel()
        measurementTask = Task { [weak self] in
            guard let self else { return }
            for await measurement in self.service.measurements(for: deviceId) {
                guard !Task.isCancelled else { return }
                self.latestMeasurements[measurement.metricType] = measurement
                self.pendingMeasurements.append(measurement)
                if self.pendingMeasurements.count >= 20 {
                    await self.flushPendingMeasurements(deviceId: deviceId)
                }
            }
        }
    }

    private func flushPendingMeasurements(deviceId: DeviceID) async {
        guard !pendingMeasurements.isEmpty else { return }
        let batch = pendingMeasurements
        pendingMeasurements.removeAll()
        await persistMeasurements(deviceId: deviceId, measurements: batch)
    }

    // MARK: - Convex persistence

    private func persistMeasurements(deviceId: DeviceID, measurements: [WearableMeasurement]) async {
        guard !measurements.isEmpty else { return }
        let payload: [ConvexEncodable?] = measurements.map { WearableMeasurementPayload($0) as ConvexEncodable? }
        do {
            try await ConvexClientProvider.client.mutation("wearable:recordMeasurements", with: [
                "deviceId": deviceId,
                "measurements": payload,
            ])
        } catch {
            // Non-fatal: local state already reflects the reading, and
            // the next successful sync's batch will include it again if
            // it's still within the device's own history window.
            lastError = String(describing: error)
        }
    }

    private func persistDeviceState(deviceId: DeviceID, model: String?, nickname: String?, connected: Bool, synced: Bool) async {
        do {
            try await ConvexClientProvider.client.mutation("wearable:upsertDevice", with: [
                "deviceId": deviceId,
                "model": model,
                "nickname": nickname,
                "connected": connected,
                "synced": synced,
            ])
        } catch {
            lastError = String(describing: error)
        }
    }
}
