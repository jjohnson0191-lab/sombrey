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

    /// The Sport+ session currently running on the band, if any — set by
    /// `startSportSession(type:)`, cleared by `stopSportSession()`.
    private(set) var activeSportSession: ActiveSportSession?
    /// The last live tally from a session that just stopped — kept
    /// around (unlike `activeSportSession`, which clears) so a
    /// completion screen can show it once, without re-fetching.
    private(set) var lastCompletedSportSession: SportSessionLiveUpdate?

    private let service: QCBandService
    private let gpsTracker = GPSTracker()
    private var measurementTask: Task<Void, Never>?
    private var sportUpdateTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var pendingMeasurements: [WearableMeasurement] = []

    private static let lastDeviceIdKey = "sombreyWearable.lastDeviceId"

    struct ActiveSportSession {
        let sportType: Int
        let convexSessionId: String
        let startedAt: Date
        var liveUpdate: SportSessionLiveUpdate?
    }

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

    // MARK: - Sport+ workout sessions

    /// Starts a Sport+ session on the band AND its Convex record together
    /// — the two-object model the Phase 3 training-architecture spec
    /// calls for (a Sport+ session is not a Sombrey training session).
    /// `TrainingSessionManager` calls this, not the other way around.
    func startSportSession(type: SombreySportType) async {
        guard let device = pairedDevice else { return }
        lastError = nil
        do {
            try await service.startSportSession(device.id, sportType: type.rawValue)
            let startedAt = Date()
            let sessionId: String = try await ConvexClientProvider.client.mutation("sportPlusSessions:startSession", with: [
                "deviceId": device.id,
                "sportType": Double(type.rawValue),
                "startedAt": startedAt.timeIntervalSince1970 * 1000,
            ])
            activeSportSession = ActiveSportSession(sportType: type.rawValue, convexSessionId: sessionId, startedAt: startedAt, liveUpdate: nil)
            subscribeToSportUpdates(deviceId: device.id)
            if type.usesPhoneGPS {
                gpsTracker.requestAuthorizationIfNeeded()
                if gpsTracker.isAuthorized {
                    gpsTracker.startTracking()
                }
            }
        } catch {
            lastError = String(describing: error)
        }
    }

    func pauseSportSession() async {
        guard let device = pairedDevice else { return }
        do {
            try await service.pauseSportSession(device.id)
        } catch {
            lastError = String(describing: error)
        }
    }

    func resumeSportSession() async {
        guard let device = pairedDevice else { return }
        do {
            try await service.resumeSportSession(device.id)
        } catch {
            lastError = String(describing: error)
        }
    }

    /// Stops both the band's Sport+ session and finalizes its Convex
    /// record — the immediate summary comes from the last live tick the
    /// band pushed (real data, not fabricated), not the band's own
    /// post-processed historical summary (`sync()` doesn't yet reconcile
    /// against that — see the Phase 3 implementation report). Returns the
    /// Convex session id so a caller (`TrainingSessionManager`) can
    /// associate it with a Sombrey workout.
    @discardableResult
    func stopSportSession() async -> String? {
        guard let device = pairedDevice, let active = activeSportSession else { return nil }
        sportUpdateTask?.cancel()
        sportUpdateTask = nil
        let usesGPS = SombreySportType.byRawValue[active.sportType]?.usesPhoneGPS ?? false
        if usesGPS { gpsTracker.stopTracking() }

        do {
            try await service.stopSportSession(device.id)
        } catch {
            lastError = String(describing: error)
        }

        let liveUpdate = active.liveUpdate
        do {
            try await ConvexClientProvider.client.mutation("sportPlusSessions:finishSession", with: [
                "sessionId": active.convexSessionId,
                "endedAt": Date().timeIntervalSince1970 * 1000,
                "durationSeconds": liveUpdate.map { Double($0.durationSeconds) },
                "distanceMeters": liveUpdate.map { Double($0.distanceMeters) },
                "calories": liveUpdate.map { Double($0.calories) },
                "averageHeartRate": liveUpdate.map { Double($0.heartRate) },
                "steps": liveUpdate.map { Double($0.steps) },
            ])
        } catch {
            lastError = String(describing: error)
        }

        if usesGPS && !gpsTracker.route.isEmpty {
            let routePayload: [ConvexEncodable?] = gpsTracker.route.map { GPSPointPayload($0) as ConvexEncodable? }
            try? await ConvexClientProvider.client.mutation("sportPlusSessions:recordDetail", with: [
                "sessionId": active.convexSessionId,
                "route": routePayload,
            ])
        }

        let sessionId = active.convexSessionId
        lastCompletedSportSession = liveUpdate
        activeSportSession = nil
        return sessionId
    }

    private func subscribeToSportUpdates(deviceId: DeviceID) {
        sportUpdateTask?.cancel()
        sportUpdateTask = Task { [weak self] in
            guard let self else { return }
            for await update in self.service.sportSessionUpdates(for: deviceId) {
                guard !Task.isCancelled else { return }
                self.activeSportSession?.liveUpdate = update
            }
        }
    }

    // MARK: - On-demand measurement

    /// A single user-initiated "measure now" reading — persists whatever
    /// values come back (never all four; the SDK returns one reading per
    /// metric) and updates `latestMeasurements` for immediate display.
    @discardableResult
    func measureNow(_ metric: OnDemandMetric) async -> OnDemandMeasurementResult? {
        guard let device = pairedDevice else { return nil }
        lastError = nil
        do {
            let result = try await service.measureNow(device.id, metric: metric)
            let now = Date()
            var readings: [WearableMeasurement] = []
            if let hr = result.heartRate {
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .heartRate, value: Double(hr), unit: "bpm", recordedAt: now))
            }
            if let spo2 = result.spo2Pct {
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .spo2, value: spo2, unit: "%", recordedAt: now))
            }
            if let temp = result.temperatureC {
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .skinTemperature, value: temp, unit: "°C", recordedAt: now))
            }
            if let systolic = result.systolicMmHg {
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .bloodPressureSystolic, value: Double(systolic), unit: "mmHg", recordedAt: now))
            }
            if let diastolic = result.diastolicMmHg {
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .bloodPressureDiastolic, value: Double(diastolic), unit: "mmHg", recordedAt: now))
            }
            for reading in readings { latestMeasurements[reading.metricType] = reading }
            if !readings.isEmpty {
                await persistMeasurements(deviceId: device.id, measurements: readings)
            }
            return result
        } catch {
            lastError = String(describing: error)
            return nil
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
        sportUpdateTask?.cancel()
        sportUpdateTask = nil
        syncTask?.cancel()
        syncTask = nil
        gpsTracker.stopTracking()
        pendingMeasurements.removeAll()
        latestMeasurements.removeAll()
        pairedDevice = nil
        status = nil
        lastSyncResult = nil
        activeSportSession = nil
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
