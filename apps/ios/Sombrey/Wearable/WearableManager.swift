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
    /// Wall-clock time of the last successful `sync()` — used only to
    /// avoid resyncing on every trivial foreground (see
    /// `handleScenePhaseChange`), not surfaced in any UI.
    private(set) var lastSyncAt: Date?
    /// Total measurements received this session (live ticks + historical
    /// sync), for the developer diagnostics view only — not shown to
    /// normal users, not persisted.
    private(set) var measurementsReceivedCount: Int = 0
    private(set) var isScanning = false
    private(set) var lastError: String?
    private(set) var discoveredDevices: [SombreyDevice] = []
    /// Most recent reading per metric — what `HomeScreen`'s activity row
    /// reads for "— steps / — active cal / HR —" once real data exists.
    private(set) var latestMeasurements: [WearableMetricType: WearableMeasurement] = [:]
    /// The band's real-time heart-rate samples from this connection, oldest
    /// first — only readings the band itself streamed live (never synced
    /// history), bounded by `LiveHeartRateTrace`. Powers the LIVE range of
    /// the Vitals heart-rate instrument; cleared when the band disconnects,
    /// exactly like `latestMeasurements[.heartRate]`.
    private(set) var liveHeartRateTrace: [WearableMeasurement] = []
    /// The on-demand metric a `measureNow(_:)` call is currently
    /// mid-flight for, if any — `nil` the rest of the time. Doubles as
    /// the single duplicate-request guard (a second tap while one is
    /// already running is a no-op, never a second concurrent SDK
    /// command) and as the UI's one source of truth for a "Measuring…"
    /// state (see `VitalsScreen`'s blood-pressure section).
    private(set) var activeOnDemandMeasurement: OnDemandMetric?
    /// Whether the most recent `measureNow(_:)` failure was because the
    /// band itself reported this metric unsupported (`.unsupportedByDevice`)
    /// rather than a transient/generic failure — lets the UI show an
    /// honest "this band doesn't support X" instead of a retry prompt
    /// that would just fail the same way again.
    private(set) var lastMeasurementUnsupportedByDevice = false
    /// Why the last on-demand blood-pressure attempt produced no reading,
    /// in the band's/SDK's own terms (see `bloodPressureFailureDetail`),
    /// so Vitals doesn't collapse every cause into one generic retry
    /// message. `nil` when the cause is unknown.
    private(set) var lastBloodPressureFailureDetail: String?
    /// The band's own advertised feature-support flags — see
    /// `QCBandService.lastKnownCapabilities`.
    var bandCapabilities: [String: Bool] { service.lastKnownCapabilities }
    /// Wall-clock time of the most recent successful Convex write from
    /// this session (a measurement batch or a device-state upsert) —
    /// developer-diagnostics only (`WearableDiagnosticsView`), distinct
    /// from `lastSyncAt` (which only reflects the band's own historical
    /// `sync()`, not every incremental upload).
    private(set) var lastSuccessfulUploadAt: Date?

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
    private var sportRecordTask: Task<Void, Never>?
    private var isImportingSportRecords = false
    /// Set when an import is requested while one is running; the running
    /// import then runs once more, so a record reported mid-import isn't
    /// left waiting for the next sync.
    private var sportImportRequestedAgain = false
    /// The outcome of the latest band Sport+ import, for Train's history
    /// ("last synced from band") and physical-band validation.
    private(set) var lastSportImport: SportImportStatus?

    struct SportImportStatus: Equatable {
        let at: Date
        let fetched: Int
        let inserted: Int
        let merged: Int
        let refreshed: Int
        let skipped: Int
        let error: String?
    }
    private var connectionStateTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var pendingMeasurements: [WearableMeasurement] = []

    private static let lastDeviceIdKey = "sombreyWearable.lastDeviceId"
    private static let readinessDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    /// The single source of truth the UI should read instead of raw
    /// `status?.connectionState` — layers "not paired" and "searching" on
    /// top, neither of which the SDK-driven connection-state stream
    /// itself represents.
    var displayState: WearableConnectionState {
        if pairedDevice == nil { return .notPaired }
        if isScanning { return .searching }
        return status?.connectionState ?? .disconnected
    }

    struct ActiveSportSession {
        let sportType: Int
        let convexSessionId: String
        let startedAt: Date
        var liveUpdate: SportSessionLiveUpdate?
        /// When `liveUpdate` arrived — the band's pushes carry no
        /// timestamp of their own, so this is what tells a live reading
        /// from a stale one.
        var liveUpdateAt: Date? = nil
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
            WearableRuntimeDiagnostics.shared.recordDeviceName(device.nickname ?? device.model)
            UserDefaults.standard.set(device.id, forKey: Self.lastDeviceIdKey)
            subscribeToMeasurements(deviceId: device.id)
            subscribeToConnectionState(deviceId: device.id)
            await refreshStatus()
            await persistDeviceState(deviceId: device.id, model: device.model, nickname: device.nickname, connected: true, synced: false)
            await sync()
        } catch {
            status = WearableDeviceStatus(deviceId: device.id, connectionState: .error, batteryPct: nil, lastSeenAt: nil)
            lastError = String(describing: error)
        }
    }

    /// For a device that was paired in a previous app session (or that
    /// dropped and gave up auto-reconnecting) — reconnects by the saved
    /// device id directly, without requiring a fresh scan first. Surfaced
    /// from Settings' "Reconnect Sombrey Band."
    func reconnect() async {
        guard let device = pairedDevice else { return }
        lastError = nil
        WearableRuntimeDiagnostics.shared.recordReconnectAttempt()
        status = WearableDeviceStatus(deviceId: device.id, connectionState: .reconnecting, batteryPct: status?.batteryPct, lastSeenAt: nil)
        do {
            try await service.reconnectDevice(device.id)
            subscribeToMeasurements(deviceId: device.id)
            subscribeToConnectionState(deviceId: device.id)
            await refreshStatus()
            await persistDeviceState(deviceId: device.id, model: nil, nickname: nil, connected: true, synced: false)
            WearableRuntimeDiagnostics.shared.recordReconnectResult(success: true)
            await sync()
        } catch {
            status = WearableDeviceStatus(deviceId: device.id, connectionState: .disconnected, batteryPct: status?.batteryPct, lastSeenAt: nil)
            lastError = String(describing: error)
            WearableRuntimeDiagnostics.shared.recordReconnectResult(success: false, error: String(describing: error))
        }
    }

    /// "Forget Band" — unpairs and clears all local state, distinct from
    /// a transient `.disconnected` (which keeps `pairedDevice` so
    /// Settings can offer "Reconnect").
    func unpair() async {
        guard let device = pairedDevice else { return }
        do {
            try await service.unpairDevice(device.id)
        } catch {
            lastError = String(describing: error)
        }
        teardownLocalState()
    }

    private func subscribeToConnectionState(deviceId: DeviceID) {
        connectionStateTask?.cancel()
        connectionStateTask = Task { [weak self] in
            guard let self else { return }
            var previousState = self.status?.connectionState
            for await state in self.service.connectionStateUpdates(for: deviceId) {
                guard !Task.isCancelled else { return }
                WearableDiagnostics.log("connectionStateUpdates: \(state.rawValue)")
                WearableRuntimeDiagnostics.shared.recordConnectionState(state, deviceId: deviceId)
                self.status = WearableDeviceStatus(
                    deviceId: deviceId,
                    connectionState: state,
                    batteryPct: self.status?.batteryPct,
                    lastSeenAt: state == .connected ? Date() : self.status?.lastSeenAt
                )
                if state == .connected {
                    await self.refreshStatus()
                    // Real-time HR is not ambient like steps/battery — it
                    // requires an explicit start command, only meaningful
                    // once actually connected (see `QCBandSDKService`).
                    await self.service.startLiveHeartRate(deviceId)
                } else if state == .disconnected || state == .error || state == .unavailable {
                    // The band is genuinely gone (not merely
                    // `.reconnecting`, which is a transient auto-retry) —
                    // stop the live-HR stream and clear the last BPM so
                    // Home/Vitals never shows a stale reading as current.
                    await self.service.stopLiveHeartRate(deviceId)
                    self.latestMeasurements[.heartRate] = nil
                    self.liveHeartRateTrace.removeAll()
                    // Steps/active calories/distance are the band's own
                    // cumulative-since-midnight counters — genuinely
                    // accurate for whatever period the band WAS worn
                    // today, but Sombrey has no way to tell "still being
                    // worn" from "was worn earlier, now off the wrist"
                    // (the vendor SDK exposes no real-time wear/skin-
                    // contact signal outside of sleep-stage data). Once
                    // the connection itself is gone, though, that's a
                    // fact Sombrey CAN verify — and showing a same-day
                    // total with no live connection backing it is
                    // exactly "a value even when not wearing the band."
                    // Clearing here matches heart rate's own precedent
                    // above; the next reconnect+sync legitimately
                    // repopulates these from the band itself.
                    self.latestMeasurements[.activeCalories] = nil
                    self.latestMeasurements[.steps] = nil
                    self.latestMeasurements[.distanceMeters] = nil
                }
                // Only notify on a real transition — never the initial
                // state a fresh subscription happens to start on, and
                // never every repeated tick of the same state.
                if let previousState, previousState != state, state == .connected || state == .disconnected {
                    await self.notifyConnectionChange(connected: state == .connected)
                }
                previousState = state
            }
        }
    }

    private func notifyConnectionChange(connected: Bool) async {
        guard let preferences = await NotificationManager.shared.currentPreferences() else { return }
        let deviceName = pairedDevice?.nickname ?? pairedDevice?.model ?? "Sombrey Band"
        await NotificationManager.shared.postWearableConnectionNotification(connected: connected, deviceName: deviceName, preferences: preferences)
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
                let foundFreshWake = await self.syncSleepHistory(deviceId: device.id)
                // Sessions recorded on the band — including ones started on
                // the band that Sombrey never saw live — on every sync
                // (connect, reconnect, foreground, relaunch).
                await self.importBandSportSessions(deviceId: device.id, reason: "sync")
                await self.persistDeviceState(deviceId: device.id, model: nil, nickname: nil, connected: false, synced: true)
                await self.refreshStatus()
                await self.triggerReadinessRecompute(postMorningSummary: foundFreshWake)
                self.lastSyncAt = Date()
            } catch {
                guard !Task.isCancelled else { return }
                self.lastError = String(describing: error)
                await self.refreshStatus()
            }
        }
        syncTask = task
        await task.value
    }

    /// Returns whether a sleep session ending within the last 12 hours
    /// was found — a real "just woke up and synced" signal, never a
    /// fixed clock time pretending to know when the user woke.
    @discardableResult
    private func syncSleepHistory(deviceId: DeviceID) async -> Bool {
        do {
            let sessions = try await service.sleepHistory(deviceId, days: 7)
            guard !sessions.isEmpty else { return false }
            let payload: [ConvexEncodable?] = sessions.map { WearableSleepSessionPayload($0) as ConvexEncodable? }
            try await ConvexClientProvider.client.mutation("wearable:recordSleepSessions", with: [
                "deviceId": deviceId,
                "sessions": payload,
            ])
            let twelveHoursAgo = Date().addingTimeInterval(-12 * 3600)
            return sessions.contains { $0.endedAt >= twelveHoursAgo }
        } catch {
            // Non-fatal — sleep history is best-effort on top of the
            // measurement sync that already ran.
            lastError = String(describing: error)
            return false
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
            // Same explicit-null-vs-omitted-key issue fixed in
            // `persistDeviceState` above — these five fields are
            // `v.optional(v.number())` on the Convex side, which rejects
            // literal `null`. Previously sent as `nil` whenever no live
            // Sport+ tick ever arrived before the session stopped,
            // throwing and silently dropping the whole `finishSession`
            // call (caught below).
            var args: [String: ConvexEncodable?] = [
                "sessionId": active.convexSessionId,
                "endedAt": Date().timeIntervalSince1970 * 1000,
            ]
            if let liveUpdate {
                args["durationSeconds"] = Double(liveUpdate.durationSeconds)
                args["distanceMeters"] = Double(liveUpdate.distanceMeters)
                args["calories"] = liveUpdate.calories
                // No heart-rate statistics from here: the only figure
                // available is the last live reading, which is not an
                // average. The band's own record supplies real min/avg/max
                // when it's imported (below).
                args["steps"] = Double(liveUpdate.steps)
            }
            try await ConvexClientProvider.client.mutation("sportPlusSessions:finishSession", with: args)
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
        await triggerReadinessRecompute()
        // The band writes its own record of this session once it stops;
        // import it to complete the row with the band's real summary.
        let deviceId = device.id
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            await self?.importBandSportSessions(deviceId: deviceId, reason: "after app-started session")
        }
        return sessionId
    }

    /// Sombrey Readiness Score — computed server-side (see
    /// `convex/readiness.ts`/`readiness/scoring.ts`); this only asks it
    /// to recompute using whatever real data just landed. `date` is a
    /// UTC calendar day to match the server's own day-bucketing
    /// convention exactly (documented V1 simplification, not
    /// per-user-timezone-aware yet — see the Phase 3 readiness report).
    ///
    /// `postMorningSummary` is only ever true from the wearable-sync path
    /// when a genuinely fresh sleep session was just found — never from
    /// a workout-triggered recompute, and never on a fixed clock time.
    private func triggerReadinessRecompute(postMorningSummary: Bool = false) async {
        let dateString = Self.readinessDateFormatter.string(from: Date())
        let result: ReadinessComputeResult? = try? await ConvexClientProvider.client.mutation("readiness:computeAndStore", with: ["date": dateString])
        guard postMorningSummary, let result else { return }
        guard let preferences = await NotificationManager.shared.currentPreferences() else { return }
        await NotificationManager.shared.postMorningSummaryIfNeeded(score: result.score, sleepSignal: result.sleepSignal, preferences: preferences)
    }

    private func subscribeToSportUpdates(deviceId: DeviceID) {
        sportUpdateTask?.cancel()
        sportUpdateTask = Task { [weak self] in
            guard let self else { return }
            for await update in self.service.sportSessionUpdates(for: deviceId) {
                guard !Task.isCancelled else { return }
                self.activeSportSession?.liveUpdate = update
                self.activeSportSession?.liveUpdateAt = Date()
            }
        }
    }

    // MARK: - On-demand measurement

    /// A single user-initiated "measure now" reading — persists whatever
    /// values come back (never all four; the SDK returns one reading per
    /// metric) and updates `latestMeasurements` for immediate display.
    /// Guarded by `activeOnDemandMeasurement`: a second call while one is
    /// already in flight (for any metric — the physical band can only
    /// run one measurement command at a time) is a no-op rather than a
    /// second concurrent SDK command racing the first.
    ///
    /// Pauses continuous live heart rate for the duration of the
    /// command and restarts it afterward: live HR and a one-shot
    /// on-demand measurement both drive the band's PPG sensor, and
    /// nothing in the vendor SDK/demo documents these as safe to run
    /// concurrently. Added after a physical-device report where BP
    /// on-demand measurement failing and live HR going stale showed up
    /// in the same session — this is the leading hypothesis for a
    /// shared cause, not a vendor-confirmed requirement (see
    /// `WearableDiagnostics` logging added alongside this for the next
    /// physical test to confirm or rule out).
    @discardableResult
    func measureNow(_ metric: OnDemandMetric) async -> OnDemandMeasurementResult? {
        guard let device = pairedDevice, activeOnDemandMeasurement == nil else {
            WearableDiagnostics.log("measureNow(\(metric.rawValue)): blocked — device=\(pairedDevice != nil) activeOnDemandMeasurement=\(String(describing: activeOnDemandMeasurement))")
            return nil
        }
        WearableDiagnostics.log("measureNow(\(metric.rawValue)): starting, pausing live HR first")
        lastError = nil
        lastMeasurementUnsupportedByDevice = false
        if metric == .bloodPressure { lastBloodPressureFailureDetail = nil }
        activeOnDemandMeasurement = metric
        defer { activeOnDemandMeasurement = nil }
        await service.stopLiveHeartRate(device.id)
        // `stopLiveHeartRate` only submits the BLE "End" write — it
        // doesn't wait for the band to actually process/release the PPG
        // sensor before returning. Sending a new measurement command
        // immediately afterward risks the band still being mid-teardown
        // of the previous mode. A brief settling pause is a standard,
        // low-risk BLE safeguard (not a confirmed fix for the BP report
        // this mutual-exclusion was originally added for — that report
        // persisted across the prior build with no delay at all, which
        // is itself evidence worth logging, not hiding).
        try? await Task.sleep(for: .milliseconds(400))
        defer {
            WearableDiagnostics.log("measureNow(\(metric.rawValue)): finished, resuming live HR")
            Task { await self.service.startLiveHeartRate(device.id) }
        }
        do {
            let result = try await service.measureNow(device.id, metric: metric)
            WearableDiagnostics.log("measureNow(\(metric.rawValue)): result hr=\(String(describing: result.heartRate)) spo2=\(String(describing: result.spo2Pct)) temp=\(String(describing: result.temperatureC)) sbp=\(String(describing: result.systolicMmHg)) dbp=\(String(describing: result.diastolicMmHg))")
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
            // Systolic/diastolic are a pair — a lone half of a blood
            // pressure reading (the SDK dropped or invalidated the
            // other) isn't a meaningful, displayable measurement, so
            // both are required and both must independently pass the
            // same validity gate every other metric goes through before
            // either is even considered, rather than letting one half
            // silently persist without its pair.
            if metric == .bloodPressure {
                let bothPresent = result.systolicMmHg != nil && result.diastolicMmHg != nil
                let bothPlausible = result.systolicMmHg.map { WearableMetricType.bloodPressureSystolic.isPhysicallyPlausible(Double($0)) } ?? false
                    && result.diastolicMmHg.map { WearableMetricType.bloodPressureDiastolic.isPhysicallyPlausible(Double($0)) } ?? false
                WearableRuntimeDiagnostics.shared.recordBPValidation(
                    passed: bothPresent && bothPlausible,
                    reason: !bothPresent ? "missing systolic or diastolic" : (!bothPlausible ? "value out of physically plausible range" : "")
                )
            }
            if let systolic = result.systolicMmHg, let diastolic = result.diastolicMmHg,
               WearableMetricType.bloodPressureSystolic.isPhysicallyPlausible(Double(systolic)),
               WearableMetricType.bloodPressureDiastolic.isPhysicallyPlausible(Double(diastolic)) {
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .bloodPressureSystolic, value: Double(systolic), unit: "mmHg", recordedAt: now))
                readings.append(WearableMeasurement(deviceId: device.id, metricType: .bloodPressureDiastolic, value: Double(diastolic), unit: "mmHg", recordedAt: now))
            }
            let validReadings = readings.filter { $0.metricType.isPhysicallyPlausible($0.value) }
            WearableRuntimeDiagnostics.shared.recordMeasurementsRejectedClientSide(readings.count - validReadings.count)
            for reading in validReadings { recordAsLatestIfNewer(reading) }
            if !validReadings.isEmpty {
                await persistMeasurements(deviceId: device.id, measurements: validReadings)
            }
            return result
        } catch {
            WearableDiagnostics.error("measureNow(\(metric.rawValue)): threw \(String(describing: error))")
            if case WearableSDKError.unsupportedByDevice = error {
                lastMeasurementUnsupportedByDevice = true
            }
            if metric == .bloodPressure {
                lastBloodPressureFailureDetail = Self.bloodPressureFailureDetail(for: error)
            }
            lastError = String(describing: error)
            return nil
        }
    }

    /// Maps the SDK's own `startToMeasuring` failure codes (header:
    /// -1 start command failed, -2 end command failed, -3 not properly
    /// worn, -4 uncalibrated — each confirmed as a literal in the SDK
    /// binary) to what actually happened. Unknown causes return `nil` so
    /// the UI keeps its generic message rather than guessing.
    static func bloodPressureFailureDetail(for error: Error) -> String? {
        if case WearableSDKError.bloodPressureNotReturnedByBand = error {
            return "The band finished without returning a blood-pressure reading."
        }
        switch (error as NSError).code {
        case -1: return "The band didn't accept the start-measurement command."
        case -2: return "The band didn't confirm the end of the measurement."
        case -3: return "The band reported it isn't being worn properly — wear it snug against your wrist and try again."
        case -4: return "The band reported it needs calibrating before it can measure blood pressure."
        default: return nil
        }
    }

    // MARK: - App lifecycle

    /// Call from the root view's `.onChange(of: scenePhase)`.
    func handleScenePhaseChange(isActive: Bool) {
        guard let device = pairedDevice else { return }
        if isActive {
            Task {
                await refreshStatus()
                await resyncIfStale()
                // Real-time HR is stopped on background (below) to avoid
                // draining the band's battery while nobody can see the
                // reading; resume it here rather than waiting for a full
                // reconnect cycle, since the BLE connection itself is
                // typically still alive across a brief background.
                if self.status?.connectionState == .connected {
                    await self.service.startLiveHeartRate(device.id)
                }
            }
        } else {
            Task {
                await flushPendingMeasurements(deviceId: device.id)
                await service.stopLiveHeartRate(device.id)
            }
        }
    }

    private static let minimumForegroundResyncInterval: TimeInterval = 15 * 60

    /// Foreground resync — only while already connected (never attempts
    /// a fresh BLE reconnect here; that stays the existing manual
    /// "Reconnect" affordance in Settings) and only when the last sync
    /// is genuinely stale, so switching back to the app after a minute
    /// doesn't trigger a resync every time. This is what keeps
    /// readiness/sleep/measurement data from going stale purely because
    /// the app was merely backgrounded and re-foregrounded, without
    /// polling on any fixed timer.
    private func resyncIfStale() async {
        guard status?.connectionState == .connected else { return }
        if let lastSyncAt, Date().timeIntervalSince(lastSyncAt) < Self.minimumForegroundResyncInterval {
            return
        }
        await sync()
    }

    /// Called once at launch (see `SombreyApp.swift`'s `.task`) when a
    /// device was paired in a previous app session. `init(service:)`
    /// only restores a local device-id stub from `UserDefaults` — there
    /// is no live BLE connection yet at that point — so this performs
    /// the same reconnect-then-sync `reconnect()` already does for the
    /// Settings "Reconnect Sombrey Band" button, automatically, so
    /// readiness/sleep/measurement data isn't stale simply because the
    /// user never manually tapped it after relaunching the app. No-op
    /// if nothing was ever paired; safe to call more than once (skips if
    /// a connection attempt is already in flight or already connected).
    func resumeIfPaired() async {
        guard pairedDevice != nil else { return }
        switch status?.connectionState {
        case .connected, .connecting, .reconnecting, .syncing:
            return
        default:
            await reconnect()
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
        sportRecordTask?.cancel()
        sportRecordTask = nil
        sportUpdateTask?.cancel()
        sportUpdateTask = nil
        connectionStateTask?.cancel()
        connectionStateTask = nil
        syncTask?.cancel()
        syncTask = nil
        gpsTracker.stopTracking()
        pendingMeasurements.removeAll()
        latestMeasurements.removeAll()
        liveHeartRateTrace.removeAll()
        measurementsReceivedCount = 0
        pairedDevice = nil
        status = nil
        lastSyncResult = nil
        activeSportSession = nil
        discoveredDevices = []
        UserDefaults.standard.removeObject(forKey: Self.lastDeviceIdKey)
    }

    // MARK: - Live measurement stream

    /// The band's "new Sport+ record" report triggers an import. It's only
    /// a trigger: a missed report is covered by the import on every sync.
    private func subscribeToSportRecordReports(deviceId: DeviceID) {
        sportRecordTask?.cancel()
        sportRecordTask = Task { [weak self] in
            guard let self else { return }
            for await _ in self.service.sportRecordUpdates(for: deviceId) {
                guard !Task.isCancelled else { return }
                // Give the band a moment to finish writing the record.
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                await self.importBandSportSessions(deviceId: deviceId, reason: "band report")
            }
        }
    }

    /// Imports the band's Sport+ records into Convex. Asks the server for
    /// the newest band start time already imported, then asks the band for
    /// records from six hours before it (so a slow or partial earlier
    /// import is re-covered); the server de-duplicates on the band's own
    /// start time, so re-sending is harmless. One import at a time.
    func importBandSportSessions(deviceId: DeviceID? = nil, reason: String) async {
        guard let deviceId = deviceId ?? pairedDevice?.id else { return }
        guard !isImportingSportRecords else {
            sportImportRequestedAgain = true
            return
        }
        isImportingSportRecords = true
        await runSportImport(deviceId: deviceId, reason: reason)
        if sportImportRequestedAgain {
            sportImportRequestedAgain = false
            await runSportImport(deviceId: deviceId, reason: "\(reason) (requested again)")
        }
        isImportingSportRecords = false
    }

    private func runSportImport(deviceId: DeviceID, reason: String) async {
        do {
            let cursor: Double? = try await ConvexClientProvider.client.mutation("sportPlusSessions:importCursor")
            let since = max(0, (cursor ?? 0) - 6 * 3600)
            let records = try await service.sportSessionHistory(deviceId, sinceBandTimestamp: since)
            let payloads = records.compactMap(BandSportImport.normalize)
            var result = SportImportResultDTO(inserted: 0, merged: 0, refreshed: 0, skipped: 0)
            if !payloads.isEmpty {
                let boxed: [ConvexEncodable?] = payloads.map { $0 as ConvexEncodable? }
                result = try await ConvexClientProvider.client.mutation("sportPlusSessions:importBandSessions", with: [
                    "deviceId": deviceId,
                    "records": boxed,
                ])
            }
            let status = SportImportStatus(
                at: Date(), fetched: records.count,
                inserted: result.inserted, merged: result.merged, refreshed: result.refreshed,
                skipped: result.skipped + (records.count - payloads.count), error: nil
            )
            lastSportImport = status
            WearableRuntimeDiagnostics.shared.recordSportImport("\(reason): since=\(since) fetched=\(records.count) inserted=\(result.inserted) merged=\(result.merged) refreshed=\(result.refreshed) skipped=\(status.skipped)")
            if result.inserted > 0 || result.merged > 0 {
                await triggerReadinessRecompute()
            }
        } catch {
            lastSportImport = SportImportStatus(at: Date(), fetched: 0, inserted: 0, merged: 0, refreshed: 0, skipped: 0, error: String(describing: error))
            WearableRuntimeDiagnostics.shared.recordSportImport("\(reason): failed — \(error)")
        }
    }

    private func subscribeToMeasurements(deviceId: DeviceID) {
        subscribeToSportRecordReports(deviceId: deviceId)
        measurementTask?.cancel()
        measurementTask = Task { [weak self] in
            guard let self else { return }
            for await measurement in self.service.measurements(for: deviceId) {
                guard !Task.isCancelled else { return }
                self.recordAsLatestIfNewer(measurement)
                if measurement.sdkSource == LiveHeartRateTrace.sdkSource {
                    self.liveHeartRateTrace = LiveHeartRateTrace.appending(measurement, to: self.liveHeartRateTrace)
                }
                self.measurementsReceivedCount += 1
                self.pendingMeasurements.append(measurement)
                if self.pendingMeasurements.count >= 20 {
                    await self.flushPendingMeasurements(deviceId: deviceId)
                }
            }
        }
    }

    /// Only overwrites `latestMeasurements` when the incoming reading is
    /// genuinely more recent than what's already stored — a historical
    /// sync batch isn't guaranteed to arrive in strict chronological
    /// order (the vendor's own scheduled-history payload just lists a
    /// day's samples), so blindly overwriting by processing order could
    /// let an older reading clobber a newer, still-valid one that's
    /// already showing. `>=` (not `>`) so same-timestamp updates (a live
    /// tick re-affirming itself) still apply normally.
    private func recordAsLatestIfNewer(_ measurement: WearableMeasurement) {
        if let existing = latestMeasurements[measurement.metricType], existing.recordedAt > measurement.recordedAt {
            return
        }
        latestMeasurements[measurement.metricType] = measurement
    }

    /// The one accessor Home/Vitals use for the band's cumulative-day
    /// counters (steps, active calories, distance) — `latestMeasurements`
    /// itself is never cleared for these on disconnect (a same-day
    /// partial total, e.g. synced at 8am and not since, is still a
    /// genuine, legitimate reading to keep showing), so nothing else
    /// stops a reading tagged with a *past* calendar day from sitting in
    /// `latestMeasurements` indefinitely and being displayed as if it
    /// were today's. Per-sample metrics (heart rate, SpO2, temperature,
    /// blood pressure) intentionally keep using `latestMeasurements`
    /// directly — those aren't the same "silently stale across a day
    /// boundary" shape, so gating them here too is a call for a future,
    /// separately-audited change, not this one.
    func latestMeasurementForToday(_ type: WearableMetricType) -> WearableMeasurement? {
        guard let measurement = latestMeasurements[type], measurement.isFromToday else { return nil }
        return measurement
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
        WearableRuntimeDiagnostics.shared.recordMeasurementsQueued(measurements.count)
        let payload: [ConvexEncodable?] = measurements.map { WearableMeasurementPayload($0) as ConvexEncodable? }
        do {
            try await ConvexClientProvider.client.mutation("wearable:recordMeasurements", with: [
                "deviceId": deviceId,
                "measurements": payload,
            ])
            lastSuccessfulUploadAt = Date()
            WearableRuntimeDiagnostics.shared.recordUploadResult(success: true, count: measurements.count)
        } catch {
            // Non-fatal: local state already reflects the reading, and
            // the next successful sync's batch will include it again if
            // it's still within the device's own history window.
            WearableDiagnostics.error("persistMeasurements: threw \(String(describing: error)) for \(measurements.count) reading(s)")
            lastError = String(describing: error)
            WearableRuntimeDiagnostics.shared.recordUploadResult(success: false, count: measurements.count, error: String(describing: error))
        }
    }

    private func persistDeviceState(deviceId: DeviceID, model: String?, nickname: String?, connected: Bool, synced: Bool) async {
        do {
            // Confirmed via a real production call (`npx convex run
            // wearable:upsertDevice ... --prod`) that Convex's argument
            // validator for `v.optional(v.string())` rejects an explicit
            // JSON `null` outright (`ArgumentValidationError`) — it only
            // accepts the field being omitted. Every call from `sync()`/
            // `reconnect()` passes `model: nil, nickname: nil`, which
            // silently threw here every time (caught below, only ever
            // surfacing as `lastError`) — this is why `wearableDevices`
            // was empty in production despite `wearableMeasurements`
            // having real rows. Matches the existing, established
            // pattern elsewhere in this codebase (see
            // `MealScheduleView.save()`) for exactly this situation:
            // only set a key when the value is actually present.
            var args: [String: ConvexEncodable?] = [
                "deviceId": deviceId,
                "connected": connected,
                "synced": synced,
            ]
            if let model { args["model"] = model }
            if let nickname { args["nickname"] = nickname }
            try await ConvexClientProvider.client.mutation("wearable:upsertDevice", with: args)
            lastSuccessfulUploadAt = Date()
        } catch {
            WearableDiagnostics.error("persistDeviceState: threw \(String(describing: error))")
            lastError = String(describing: error)
        }
    }
}

/// `sportPlusSessions:importBandSessions`' result.
struct SportImportResultDTO: Decodable {
    let inserted: Int
    let merged: Int
    let refreshed: Int
    let skipped: Int
}
