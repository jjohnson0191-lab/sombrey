import Foundation
import Observation

/// The one wearable object SwiftUI views touch. Owns a `QCBandService`
/// conformer (injected — `MockQCBandService` today, `QCBandSDKService`
/// once real, never both at once) and exposes state as plain published
/// properties. No view should ever hold a `QCBandService` directly.
///
/// `@MainActor` on the whole type (not just individual methods): the
/// previous per-method `@MainActor` annotations left `subscribeToMeasurements`
/// or nonisolated, so the `Task { [weak self] in ... }` it creates wasn't
/// guaranteed to inherit main-actor isolation, which the compiler flagged
/// as a data-race risk on capturing `self`. Isolating the type as a whole
/// is the minimal fix and matches how the type is actually used — every
/// call site is already on the main actor (SwiftUI-driven).
@Observable
@MainActor
final class WearableManager {
    private(set) var pairedDevice: SombreyDevice?
    private(set) var status: WearableDeviceStatus?
    private(set) var lastSyncResult: WearableSyncResult?
    private(set) var isScanning = false
    private(set) var lastError: String?

    private let service: QCBandService
    private var measurementTask: Task<Void, Never>?

    init(service: QCBandService) {
        self.service = service
    }

    @MainActor
    func scan() async {
        isScanning = true
        lastError = nil
        defer { isScanning = false }
        do {
            let devices = try await service.scanForDevices()
            pairedDevice = devices.first
        } catch {
            lastError = error.localizedDescription
        }
    }

    @MainActor
    func pair(_ device: SombreyDevice) async {
        do {
            try await service.pairDevice(device.id)
            pairedDevice = device
            await refreshStatus()
            subscribeToMeasurements(deviceId: device.id)
        } catch {
            lastError = error.localizedDescription
        }
    }

    @MainActor
    func unpair() async {
        guard let device = pairedDevice else { return }
        do {
            try await service.unpairDevice(device.id)
            measurementTask?.cancel()
            pairedDevice = nil
            status = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    @MainActor
    func refreshStatus() async {
        guard let device = pairedDevice else { return }
        do {
            status = try await service.deviceStatus(device.id)
        } catch {
            lastError = error.localizedDescription
        }
    }

    @MainActor
    func sync() async {
        guard let device = pairedDevice else { return }
        do {
            lastSyncResult = try await service.sync(device.id)
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func subscribeToMeasurements(deviceId: DeviceID) {
        measurementTask?.cancel()
        measurementTask = Task { [weak self] in
            guard let self else { return }
            for await _ in self.service.measurements(for: deviceId) {
                // Phase 0 foundation only — real handling (persisting to
                // Convex, updating live metric UI) lands with real
                // QCBandSDK integration in Phase 10.
            }
        }
    }
}
