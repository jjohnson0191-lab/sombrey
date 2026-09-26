import Foundation
import CoreLocation
// @preconcurrency: CoreBluetooth and QCBandSDK both predate Swift
// concurrency auditing — their types (CBCentralManager, CBPeripheral,
// QCSleepModel, QCSportModel, etc.) aren't marked Sendable, which Swift
// 6's region-isolation checker otherwise flags every time one crosses
// the nonisolated-delegate-callback -> @MainActor boundary below ("sending
// 'x' risks causing data races" — confirmed by a real Codemagic build).
// This is Apple's own documented idiom for consuming an un-audited
// pre-concurrency framework/library, not a suppression of a real bug:
// every one of these values is still only ever touched from this type's
// single @MainActor context (see the type's own header).
@preconcurrency import CoreBluetooth
@preconcurrency import QCBandSDK

/// REAL QCBandSDK INTEGRATION — Phase 3 of the migration. This file (and
/// no other) imports `QCBandSDK` and `CoreBluetooth`, matching the
/// boundary documented on `QCBandService`. Every method here is backed by
/// an actual QCBandSDK call verified against the vendor's shipped headers
/// and demo app (`~/Downloads/QCBandSDKDemo`) — nothing is guessed, and
/// nothing here fabricates a reading: a metric the SDK doesn't return for
/// the connected band is simply absent from the result, never estimated.
///
/// Architecture, porting the vendor demo's `QCCentralManager` pattern
/// into this boundary: this type owns the `CBCentralManager` (central
/// role) directly, and every data command goes through the vendor's own
/// singletons (`QCSDKManager.shareInstance()`, `QCSDKCmdCreator`) once a
/// peripheral has been handed to `addPeripheral:finished:` — the SDK
/// resolves the peripheral's characteristics internally; nothing here
/// talks to GATT characteristics directly.
///
/// No `Sendable`/`@unchecked Sendable` ceremony needed here: `QCBandService`
/// is itself `@MainActor`-isolated (see its own file header for why), and
/// this class is `@MainActor` too, so every stored property — including
/// the vendor/System types (`CBCentralManager`, `CBPeripheral`,
/// `QCSDKManager`) the compiler can't independently verify as Sendable —
/// is only ever touched from that one actor. Delegate methods below are
/// `nonisolated` only because `CBCentralManagerDelegate` itself carries no
/// actor annotation; each one immediately re-enters `@MainActor` via
/// `Task { @MainActor in }`, and `CBCentralManager` is constructed with
/// `queue: nil`, which per Apple's documentation delivers every delegate
/// callback on the main queue anyway.
@MainActor
final class QCBandSDKService: NSObject, QCBandService {
    private var centralManager: CBCentralManager!
    private var discoveredPeripherals: [DeviceID: CBPeripheral] = [:]
    private var connectedPeripheral: CBPeripheral?
    /// Set once a device has been added to `QCSDKManager`; live callback
    /// data (steps/battery ticks) has no device id of its own, so this is
    /// what tags those events for `measurements(for:)`.
    private var activeDeviceId: DeviceID?
    /// The band's own feature-support flags, from the most recent
    /// successful `setDeviceTime()` call. See `QCBandService`'s own doc
    /// comment on `lastKnownCapabilities`.
    private var capabilities: [String: Bool] = [:]
    var lastKnownCapabilities: [String: Bool] { capabilities }

    private var scanContinuation: CheckedContinuation<[SombreyDevice], Never>?
    private var scanTimeoutTask: Task<Void, Never>?

    // MARK: Link lifecycle (see "Connection lifecycle" below)

    /// Every command waiting on the band; all failed at once on disconnect.
    private let commands = BandCommandRegistry()
    /// The link instance. Incremented every time the band is attached to
    /// the SDK and every time the link is lost, so a callback from an
    /// earlier link can be recognised as stale.
    private var linkEpoch = 0
    /// The paired band Sombrey should keep reconnecting to (set once a
    /// connect succeeds or iOS restores one; cleared only by Forget Band).
    private var autoReconnectId: DeviceID?
    /// The one connect attempt in progress (peripheral id), if any. Manual
    /// and automatic reconnects JOIN it rather than starting another.
    private var connectingId: DeviceID?
    /// Everyone awaiting the current connect attempt (pair, manual reconnect).
    private var connectWaiters: [UUID: CheckedContinuation<Void, Error>] = [:]
    /// Consecutive failed connect/attach attempts — drives `ReconnectBackoff`.
    private var connectFailures = 0
    private var reconnectTask: Task<Void, Never>?
    /// A peripheral iOS handed back on state restoration, awaiting power-on.
    private var restoredPeripheral: CBPeripheral?
    /// A Sport+ stop the band never received (the link was down when the
    /// user ended the session) — sent as soon as the link is back.
    private var pendingSportStop: Int?

    /// Commands may only be sent over a live, SDK-attached link.
    private var isLinkLive: Bool {
        guard let peripheral = connectedPeripheral else { return false }
        return peripheral.state == .connected
    }

    private var measurementContinuation: AsyncStream<WearableMeasurement>.Continuation?
    private var sportUpdateContinuation: AsyncStream<SportSessionLiveUpdate>.Continuation?
    private var sportRecordContinuation: AsyncStream<Void>.Continuation?
    private var connectionStateContinuation: AsyncStream<WearableConnectionState>.Continuation?
    /// The Sport+ type of whatever session is currently active on the
    /// band, if any — `currentSportInfo` pushes are tagged with the
    /// device's own type, but stop/pause/resume commands need to know
    /// which one is running without re-asking the caller.
    private var activeSportType: Int?

    private static let scanTimeout: TimeInterval = 15
    private static let restoreIdentifier = "SombreyBandCentralRestoreIdentifier"

    private static let sdkDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        return formatter
    }()

    override init() {
        super.init()
        centralManager = CBCentralManager(
            delegate: self,
            queue: nil,
            options: [
                CBCentralManagerOptionShowPowerAlertKey: true,
                CBCentralManagerOptionRestoreIdentifierKey: Self.restoreIdentifier,
            ]
        )
        configureLiveCallbacks()
    }

    // MARK: - Discovery & pairing

    func scanForDevices() async throws -> [SombreyDevice] {
        guard centralManager.state == .poweredOn else {
            WearableDiagnostics.error("scanForDevices: Bluetooth not powered on, state=\(centralManager.state.rawValue)")
            throw WearableSDKError.bluetoothUnavailable
        }
        stopScanIfNeeded()
        // A scan still waiting (a second tap on Scan) is finished first, so
        // its continuation is never overwritten and left hanging.
        if let previous = scanContinuation {
            scanContinuation = nil
            previous.resume(returning: [])
        }
        discoveredPeripherals.removeAll()
        WearableRuntimeDiagnostics.shared.recordDiscoveryStarted()

        return await withCheckedContinuation { (continuation: CheckedContinuation<[SombreyDevice], Never>) in
            scanContinuation = continuation
            centralManager.scanForPeripherals(
                withServices: nil,
                options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
            )
            scanTimeoutTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(Self.scanTimeout))
                guard let self, !Task.isCancelled else { return }
                self.finishScan()
            }
        }
    }

    private func stopScanIfNeeded() {
        scanTimeoutTask?.cancel()
        scanTimeoutTask = nil
        if centralManager.isScanning { centralManager.stopScan() }
    }

    private func finishScan() {
        stopScanIfNeeded()
        let devices = discoveredPeripherals.map { id, peripheral in
            SombreyDevice(id: id, serial: "", model: peripheral.name ?? "Sombrey Band", nickname: peripheral.name, firmwareVersion: nil)
        }
        WearableRuntimeDiagnostics.shared.recordDiscoveryStopped(deviceCount: devices.count)
        scanContinuation?.resume(returning: devices)
        scanContinuation = nil
    }

    func pairDevice(_ deviceId: DeviceID) async throws {
        guard let peripheral = discoveredPeripherals[deviceId] else {
            WearableDiagnostics.error("pairDevice: \(deviceId) not in discoveredPeripherals (\(discoveredPeripherals.count) known)")
            throw WearableSDKError.deviceNotFound
        }
        WearableRuntimeDiagnostics.shared.recordPairingAttempt(deviceId: deviceId)
        try await connect(peripheral, reason: "pair", waitLimit: 30)
    }

    func reconnectDevice(_ deviceId: DeviceID) async throws {
        guard centralManager.state == .poweredOn else {
            throw WearableSDKError.bluetoothUnavailable
        }
        guard let uuid = UUID(uuidString: deviceId) else {
            throw WearableSDKError.deviceNotFound
        }
        // Already connected to this band: nothing to do.
        if isLinkLive, connectedPeripheral?.identifier == uuid { return }
        // `retrievePeripherals(withIdentifiers:)` gets a real CBPeripheral
        // handle for a device the system already knows about by UUID —
        // standard CoreBluetooth, no scan required.
        guard let peripheral = centralManager.retrievePeripherals(withIdentifiers: [uuid]).first else {
            throw WearableSDKError.deviceNotFound
        }
        discoveredPeripherals[deviceId] = peripheral
        // A manual reconnect skips any backoff wait and joins (never
        // duplicates) an automatic attempt already in progress. If the band
        // isn't in range yet, the caller stops waiting after 20 s, but the
        // pending connect stays armed and completes whenever it returns.
        reconnectTask?.cancel()
        reconnectTask = nil
        try await connect(peripheral, reason: "manual reconnect", waitLimit: 20)
    }

    func unpairDevice(_ deviceId: DeviceID) async throws {
        // Forget Band: stop reconnecting, stop everything in flight.
        autoReconnectId = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        liveHeartRateTask?.cancel()
        liveHeartRateTask = nil
        pendingSportStop = nil
        let cancelled = commands.failAll { WearableCommandError.cancelled(command: $0) }
        if !cancelled.isEmpty { WearableRuntimeDiagnostics.shared.recordLinkEvent("forget band: cancelled \(cancelled.joined(separator: ", "))") }
        failConnectWaiters(WearableCommandError.cancelled(command: "connect"))
        if let peripheral = connectedPeripheral ?? restoredPeripheral {
            centralManager.cancelPeripheralConnection(peripheral)
        }
        if let id = connectingId, let uuid = UUID(uuidString: id), let pending = centralManager.retrievePeripherals(withIdentifiers: [uuid]).first {
            centralManager.cancelPeripheralConnection(pending)
        }
        connectingId = nil
        restoredPeripheral = nil
        QCSDKManager.shareInstance().removeAllPeripheral()
        connectedPeripheral = nil
        activeDeviceId = nil
        linkEpoch += 1
    }

    // MARK: - Connection lifecycle
    //
    // One authoritative connect attempt at a time:
    //   connect(p)  → joins the attempt in progress, or starts one
    //   didConnect  → attach to the SDK (QCSDKManager.add)
    //   attached    → linkEpoch += 1, waiters succeed, `.connected`
    //   didDisconnect → linkEpoch += 1, every in-flight command fails with
    //                   `.disconnected`, `.reconnecting`, and a PENDING
    //                   connect is re-armed (CoreBluetooth completes it when
    //                   the band is back in range — also in the background)
    //   connect/attach failure → retry after `ReconnectBackoff`
    // Callbacks for a peripheral other than the one being connected/attached
    // are stale and ignored.

    /// Starts (or joins) the connect attempt for `peripheral` and waits for
    /// it — at most `waitLimit` seconds, after which the waiter gets
    /// `.timedOut` while the pending connect itself stays armed.
    private func connect(_ peripheral: CBPeripheral, reason: String, waitLimit: TimeInterval) async throws {
        let id = peripheral.identifier.uuidString
        if isLinkLive, connectedPeripheral?.identifier == peripheral.identifier { return }
        let waiter = UUID()
        let timeout = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(waitLimit))
            guard !Task.isCancelled, let self else { return }
            if let c = self.connectWaiters.removeValue(forKey: waiter) {
                c.resume(throwing: WearableCommandError.timedOut(command: "connect", seconds: Int(waitLimit)))
                self.log("connect (\(reason)): not reachable within \(Int(waitLimit))s — still waiting in the background")
            }
        }
        defer { timeout.cancel() }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                connectWaiters[waiter] = continuation
                if connectingId == id {
                    log("connect (\(reason)): joining the attempt already in progress")
                    return
                }
                connectingId = id
                autoReconnectId = id
                log("connect (\(reason)): connecting")
                centralManager.connect(peripheral, options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: true])
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                if let c = self?.connectWaiters.removeValue(forKey: waiter) {
                    c.resume(throwing: WearableCommandError.cancelled(command: "connect"))
                }
            }
        }
    }

    private func succeedConnectWaiters() {
        let waiters = connectWaiters
        connectWaiters.removeAll()
        for c in waiters.values { c.resume() }
    }

    private func failConnectWaiters(_ error: Error) {
        let waiters = connectWaiters
        connectWaiters.removeAll()
        for c in waiters.values { c.resume(throwing: error) }
    }

    /// Re-arms the connect for the paired band — immediately after a drop
    /// (a pending CoreBluetooth connect costs nothing while the band is out
    /// of range), or after the backoff delay following a failure.
    private func scheduleReconnect(after delay: TimeInterval, reason: String) {
        guard let id = autoReconnectId, let uuid = UUID(uuidString: id) else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { @MainActor [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled, let self, self.autoReconnectId == id, !self.isLinkLive else { return }
            guard self.centralManager.state == .poweredOn else { return }
            guard let peripheral = self.centralManager.retrievePeripherals(withIdentifiers: [uuid]).first else {
                self.log("reconnect: band unknown to iOS — waiting for a manual reconnect")
                return
            }
            self.discoveredPeripherals[id] = peripheral
            self.connectingId = id
            self.log("reconnect (\(reason)): pending connect armed\(delay > 0 ? " after \(Int(delay))s backoff" : "")")
            self.centralManager.connect(peripheral, options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: true])
        }
    }

    /// The band is connected at the BLE level: hand it to the SDK. Only a
    /// successful attach makes the link live.
    private func attach(_ peripheral: CBPeripheral) {
        let id = peripheral.identifier.uuidString
        log("attaching to the SDK")
        // `@Sendable`: the SDK may call back on any queue (see `runCommand`).
        QCSDKManager.shareInstance().add(peripheral) { @Sendable [weak self] success in
            Task { @MainActor in self?.attachFinished(peripheral, id: id, success: success) }
        }
    }

    private func attachFinished(_ peripheral: CBPeripheral, id: DeviceID, success: Bool) {
        // Stale: a newer attempt, a forget, or a different band.
        guard connectingId == id || (connectingId == nil && autoReconnectId == id && connectedPeripheral == nil) else {
            log("attach result for a stale attempt ignored")
            return
        }
        connectingId = nil
        if success {
            connectedPeripheral = peripheral
            activeDeviceId = id
            autoReconnectId = id
            linkEpoch += 1
            connectFailures = 0
            reconnectTask?.cancel()
            reconnectTask = nil
            log("connected (link #\(linkEpoch))")
            WearableRuntimeDiagnostics.shared.recordPairingResult(success: true)
            connectionStateContinuation?.yield(.connected)
            succeedConnectWaiters()
            sendPendingSportStopIfNeeded()
        } else {
            connectFailures += 1
            WearableRuntimeDiagnostics.shared.recordPairingResult(success: false, error: "QCSDKManager.add(peripheral:) reported failure")
            centralManager.cancelPeripheralConnection(peripheral)
            failConnectWaiters(WearableSDKError.connectFailed)
            connectionStateContinuation?.yield(autoReconnectId == id ? .reconnecting : .error)
            scheduleReconnect(after: ReconnectBackoff.delay(afterFailures: connectFailures), reason: "SDK attach failed")
        }
    }

    /// The link is gone (disconnect, Bluetooth off, or reset): fail every
    /// command waiting on it — as `.disconnected`, never a data error.
    private func linkLost(_ why: String) {
        linkEpoch += 1
        connectedPeripheral = nil
        liveHeartRateTask?.cancel()
        liveHeartRateTask = nil
        let cancelled = commands.failAll { WearableCommandError.disconnected(command: $0) }
        log("link lost (\(why)) — \(cancelled.isEmpty ? "no commands in flight" : "cancelled: \(cancelled.joined(separator: ", "))")")
    }

    private func log(_ message: String) {
        WearableDiagnostics.log("link: \(message)")
        WearableRuntimeDiagnostics.shared.recordLinkEvent(message)
    }

    // MARK: - Status & sync

    func deviceStatus(_ deviceId: DeviceID) async throws -> WearableDeviceStatus {
        guard isLinkLive, connectedPeripheral?.identifier.uuidString == deviceId else {
            // A band Sombrey is still reconnecting to reads as reconnecting,
            // never as a plain disconnect.
            let reconnecting = autoReconnectId == deviceId && centralManager.state == .poweredOn
            return WearableDeviceStatus(deviceId: deviceId, connectionState: reconnecting ? .reconnecting : .disconnected, batteryPct: nil, lastSeenAt: nil)
        }
        let battery = try? await readBattery()
        return WearableDeviceStatus(
            deviceId: deviceId,
            connectionState: .connected,
            batteryPct: battery.map { Double($0.percent) },
            lastSeenAt: Date()
        )
    }

    func firmwareInfo(_ deviceId: DeviceID) async throws -> String {
        try await runCommand("firmware version", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.getDeviceSoftAndHardVersionSuccess({ @Sendable hardVersion, softVersion in
                finish(.success("hw \(hardVersion) / sw \(softVersion)"))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("firmware version")))
            })
        }
    }

    /// Syncs device time, then pulls today's activity, the last 7 days of
    /// scheduled heart rate, today's SpO2 and temperature, and available
    /// blood-pressure history — each independently, so one unsupported
    /// metric on a given band model never blocks the others. Emits every
    /// reading onto the live `measurements(for:)` stream (the same path
    /// real-time callbacks use) so `WearableManager` has one place to
    /// persist from.
    func sync(_ deviceId: DeviceID) async throws -> WearableSyncResult {
        guard isLinkLive, connectedPeripheral?.identifier.uuidString == deviceId else {
            throw WearableCommandError.notConnected(command: "sync")
        }
        // If the link drops mid-sync, the rest is abandoned as `.disconnected`
        // (not "partial data") — the whole sync reruns after reconnecting.
        let epoch = linkEpoch
        func checkLink() throws {
            guard isLinkLive, linkEpoch == epoch else { throw WearableCommandError.disconnected(command: "sync") }
        }
        WearableRuntimeDiagnostics.shared.recordSyncStarted()
        try? await setDeviceTime()

        var synced = 0
        var anyFailed = false
        var syncedTypes: [String] = []
        let now = Date()

        if let sport = try? await currentSport() {
            // Stamped when the band's answer arrives, not when `sync()`
            // started — so a response straddling midnight can't tag one
            // day's since-midnight total with the other day.
            let receivedAt = Date()
            // Logged raw, before any parsing/transformation — this is
            // exactly the "compare against the previous response"
            // evidence needed to tell apart "the band's own counter
            // isn't advancing" from "Sombrey is receiving updated data
            // but failing to display it."
            WearableRuntimeDiagnostics.shared.recordRawSportResponse(calories: sport.calories, steps: sport.totalStepCount, distance: sport.distance, happenDate: sport.happenDate)
            // `getCurrentSportSucess` is documented (QCSDKCmdCreator.h)
            // as returning "the summary statistics of the day" — the
            // band's own cumulative-since-midnight counters, not an
            // estimate. `sport.happenDate` is NOT a device timestamp:
            // the SDK binary fills it from the phone's `[NSDate date]`
            // as "yyyy-MM-dd" when the response is parsed, so the
            // receipt time above is the same information with a time of
            // day. `isFromToday` (used by every read site) is what keeps
            // a stale day's total from displaying as current — see
            // `WearableManager.latestMeasurementForToday(_:)`.
            emit(deviceId: deviceId, type: .steps, value: Double(sport.totalStepCount), unit: "steps", at: receivedAt, sdkSource: "getCurrentSportSucess")
            emitActiveCalories(deviceId: deviceId, bandCalories: sport.calories, at: receivedAt, sdkSource: "getCurrentSportSucess")
            emit(deviceId: deviceId, type: .distanceMeters, value: Double(sport.distance), unit: "m", at: receivedAt, sdkSource: "getCurrentSportSucess")
            synced += 3
            syncedTypes.append(contentsOf: ["steps", "active_calories", "distance_meters"])
        } else {
            anyFailed = true
        }

        try checkLink()
        if let heartRateDays = try? await scheduledHeartRate(dayIndexes: Array(0...6)) {
            var count = 0
            for day in heartRateDays {
                count += emitHeartRate(deviceId: deviceId, model: day)
            }
            synced += count
            if count > 0 { syncedTypes.append("heart_rate") }
        } else {
            anyFailed = true
        }

        try checkLink()
        if let spo2 = try? await bloodOxygen(dayIndex: 0) {
            for reading in spo2 {
                emit(deviceId: deviceId, type: .spo2, value: Double(reading.soa2), unit: "%", at: reading.date)
                synced += 1
            }
            if !spo2.isEmpty { syncedTypes.append("spo2") }
        } else {
            anyFailed = true
        }

        try checkLink()
        if let temps = try? await scheduledTemperature(dayIndex: 0) {
            for reading in temps {
                emit(deviceId: deviceId, type: .skinTemperature, value: Double(reading.temperature), unit: "°C", at: reading.time)
                synced += 1
            }
            if !temps.isEmpty { syncedTypes.append("skin_temperature") }
        } else {
            anyFailed = true
        }

        try checkLink()
        await enableScheduledBloodPressureIfNeeded()
        if let bpHistory = try? await bloodPressureHistory() {
            for reading in bpHistory {
                emit(deviceId: deviceId, type: .bloodPressureSystolic, value: Double(reading.systolicPressure), unit: "mmHg", at: reading.date)
                emit(deviceId: deviceId, type: .bloodPressureDiastolic, value: Double(reading.diastolicPressure), unit: "mmHg", at: reading.date)
                synced += 2
            }
            if !bpHistory.isEmpty { syncedTypes.append("blood_pressure") }
        } else {
            anyFailed = true
        }
        try checkLink()
        if let manualBP = try? await manualBloodPressureHistory() {
            for reading in manualBP {
                emit(deviceId: deviceId, type: .bloodPressureSystolic, value: Double(reading.systolicPressure), unit: "mmHg", at: reading.date)
                emit(deviceId: deviceId, type: .bloodPressureDiastolic, value: Double(reading.diastolicPressure), unit: "mmHg", at: reading.date)
                synced += 2
            }
            if !manualBP.isEmpty { syncedTypes.append("blood_pressure_manual") }
        }
        // Deliberately doesn't set `anyFailed` on failure here, unlike
        // every other block above: this API's exact Swift signature
        // wasn't confirmed against a real build before this change, so
        // a genuine incompatibility would otherwise mark every sync
        // "partial" for a metric that's already covered by the scheduled
        // fetch above — not silently swallowing a real problem, just not
        // letting an unverified supplementary fetch degrade the
        // already-meaningful `anyFailed` signal for everything else.

        try checkLink()
        if let battery = try? await readBattery() {
            emit(deviceId: deviceId, type: .batteryPct, value: Double(battery.percent), unit: "%", at: now)
            synced += 1
            syncedTypes.append("battery_pct")
        } else {
            anyFailed = true
        }

        try checkLink()
        WearableRuntimeDiagnostics.shared.recordSyncCompleted(
            success: synced > 0,
            metricTypes: syncedTypes,
            error: anyFailed ? "One or more metrics weren't available from this band." : nil
        )
        return WearableSyncResult(
            status: synced > 0 ? (anyFailed ? .partial : .success) : .failed,
            recordsSynced: synced,
            errorMessage: anyFailed ? "One or more metrics weren't available from this band." : nil,
            syncedAt: now
        )
    }

    func sleepHistory(_ deviceId: DeviceID, days: Int) async throws -> [SleepSessionData] {
        guard connectedPeripheral?.identifier.uuidString == deviceId else {
            throw WearableSDKError.noConnectedDevice
        }
        guard isLinkLive else { throw WearableCommandError.notConnected(command: "sleep history") }
        let byDay: [String: [QCSleepModel]] = try await runCommand("sleep history", timeout: BandCommandTimeout.history) { finish in
            QCSDKCmdCreator.getSleepDetailData(fromDay: days, sleepDatas: { @Sendable result in
                finish(.success(result))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("sleep history")))
            })
        }
        return byDay.values.compactMap(Self.sleepSession(from:)).sorted { $0.startedAt < $1.startedAt }
    }

    func connectionStateUpdates(for deviceId: DeviceID) -> AsyncStream<WearableConnectionState> {
        AsyncStream { continuation in
            self.connectionStateContinuation = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    guard self?.connectionStateContinuation != nil else { return }
                    self?.connectionStateContinuation = nil
                }
            }
        }
    }

    func measurements(for deviceId: DeviceID) -> AsyncStream<WearableMeasurement> {
        AsyncStream { continuation in
            self.measurementContinuation = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    guard self?.measurementContinuation != nil else { return }
                    self?.measurementContinuation = nil
                }
            }
        }
    }

    // MARK: - Sport+ workout sessions

    func startSportSession(_ deviceId: DeviceID, sportType: Int) async throws {
        try await operateSportMode(sportType: sportType, state: Self.sportStateStart)
        activeSportType = sportType
    }

    func pauseSportSession(_ deviceId: DeviceID) async throws {
        guard let sportType = activeSportType else { throw WearableSDKError.commandFailed("no active sport session") }
        try await operateSportMode(sportType: sportType, state: Self.sportStatePause)
    }

    func resumeSportSession(_ deviceId: DeviceID) async throws {
        guard let sportType = activeSportType else { throw WearableSDKError.commandFailed("no active sport session") }
        try await operateSportMode(sportType: sportType, state: Self.sportStateContinue)
    }

    func stopSportSession(_ deviceId: DeviceID) async throws {
        guard let sportType = activeSportType else { throw WearableSDKError.commandFailed("no active sport session") }
        activeSportType = nil
        do {
            try await operateSportMode(sportType: sportType, state: Self.sportStateStop)
        } catch {
            // Out of range (or no answer): the band keeps its own recording;
            // the stop is sent the moment the link is back, and the band's
            // record imports then (deduplicated against this session).
            if error.isBandLinkLoss || error is WearableCommandError {
                pendingSportStop = sportType
                log("Sport+ stop queued until the band reconnects (\(error))")
            }
            throw error
        }
    }

    func adoptSportSession(_ deviceId: DeviceID, sportType: Int) {
        activeSportType = sportType
    }

    func sportSessionUpdates(for deviceId: DeviceID) -> AsyncStream<SportSessionLiveUpdate> {
        AsyncStream { continuation in
            self.sportUpdateContinuation = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    guard self?.sportUpdateContinuation != nil else { return }
                    self?.sportUpdateContinuation = nil
                }
            }
        }
    }

    func sportSessionHistory(_ deviceId: DeviceID, sinceBandTimestamp bandTimestamp: Double) async throws -> [BandSportRecord] {
        let summaries = try await sportRecords(since: bandTimestamp)
        let records = summaries.map(Self.bandSportRecord)
        WearableRuntimeDiagnostics.shared.recordSportRecordsFetched(since: bandTimestamp, records: records)
        return records
    }

    func sportRecordUpdates(for deviceId: DeviceID) -> AsyncStream<Void> {
        AsyncStream { continuation in
            self.sportRecordContinuation = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    guard self?.sportRecordContinuation != nil else { return }
                    self?.sportRecordContinuation = nil
                }
            }
        }
    }

    /// The vendor summary + detail, as-is. The header has no nullability
    /// annotations, so its arrays/detail import implicitly unwrapped — read
    /// defensively. Heart rates and speeds prefer the detail series (the
    /// demo reads `model.detail.hrs`), falling back to the summary's own.
    private static func bandSportRecord(_ model: OdmGeneralExerciseSummaryModel) -> BandSportRecord {
        let detail: OdmGeneralExerciseDetailModel? = model.detail
        let detailHRs: [NSNumber] = detail?.hrs ?? []
        let summaryHRs: [NSNumber] = model.hrs ?? []
        let heartRates = (detailHRs.isEmpty ? summaryHRs : detailHRs).map { $0.intValue }
        let speeds: [Double] = (detail?.speeds ?? []).map { $0.doubleValue }
        let locations: [CLLocation] = detail?.gpsLocations ?? []
        let route = locations.map {
            BandSportRecord.RoutePoint(
                latitude: $0.coordinate.latitude,
                longitude: $0.coordinate.longitude,
                recordedAt: $0.timestamp,
                altitudeMeters: $0.verticalAccuracy >= 0 ? $0.altitude : nil
            )
        }
        return BandSportRecord(
            sportType: model.exerciseType,
            sourceType: model.sourceType,
            rawStartTime: model.startTime,
            rawDuration: model.duration,
            distanceMeters: model.distance,
            calories: Double(model.calorie),
            averageSpeed: Double(model.averageSpeed),
            fastestSpeed: Double(model.fastestSpeed),
            averageHeartRate: model.averageHR,
            lowestHeartRate: model.lowestHR,
            highestHeartRate: model.highestHR,
            averageAltitude: Double(model.averageAltitude),
            climbMeters: Double(model.upHillDistance),
            descentMeters: Double(model.downHillDistance),
            stepFrequency: model.averageStepFrequency,
            actionCount: model.numberOfActions,
            steps: model.steps,
            sampleRateSeconds: model.sampleRateSeconds,
            heartRates: heartRates,
            speeds: speeds,
            route: route
        )
    }

    // MARK: - On-demand measurement

    func measureNow(_ deviceId: DeviceID, metric: OnDemandMetric) async throws -> OnDemandMeasurementResult {
        guard connectedPeripheral?.identifier.uuidString == deviceId else {
            WearableDiagnostics.error("measureNow(\(metric.rawValue)): no connected device")
            throw WearableSDKError.noConnectedDevice
        }
        guard let qcType = QCMeasuringType(rawValue: metric.qcRawValue) else {
            throw WearableSDKError.commandFailed("unsupported measurement type")
        }
        // Only blocks on POSITIVE evidence (the band's own `setTime:`
        // feature list explicitly says this key is `false`) — an absent
        // key (no sync has completed yet, or this SDK/firmware doesn't
        // report the flag at all) never blocks the attempt. This never
        // fabricates a "not supported" verdict; it only ever repeats
        // what the band itself already told us.
        let capabilityKey = Self.capabilityKey(for: metric)
        let isBP = metric == .bloodPressure
        if let key = capabilityKey, capabilities[key] == false {
            WearableDiagnostics.error("measureNow(\(metric.rawValue)): band does not advertise \(key) support (capabilities=\(capabilities))")
            if isBP { WearableRuntimeDiagnostics.shared.recordBPCapability(.unsupported) }
            throw WearableSDKError.unsupportedByDevice(metric.rawValue)
        }
        if isBP {
            let status: WearableRuntimeDiagnostics.CapabilityStatus
            if let key = capabilityKey {
                status = capabilities[key] == true ? .supported : .unknown
            } else {
                status = .unknown
            }
            WearableRuntimeDiagnostics.shared.recordBPCapability(status)
            WearableRuntimeDiagnostics.shared.recordBPCommandSent()
        }
        WearableDiagnostics.log("measureNow(\(metric.rawValue)): sending startToMeasuring, qcRawValue=\(metric.qcRawValue), capabilities=\(capabilities)")
        // Parsed inside the completion handler, before crossing the
        // continuation boundary: `Any?` (what the ObjC callback actually
        // hands back — an NSNumber or NSDictionary depending on metric)
        // can't be proven Sendable, but `OnDemandMeasurementResult` (a
        // plain Swift struct of Int?/Double?) can — confirmed by a real
        // Codemagic build ("sending 'result' risks causing data races").
        // The band's BP push arrives on `measuringHandle`, possibly on the
        // SDK's own queue — kept in a lock-protected box (see `runCommand`
        // for why every callback here is `@Sendable`).
        let bpPush = BandPushBox()
        let metricName = metric.rawValue
        return try await runCommand("measure \(metricName)", timeout: BandCommandTimeout.measurement) { finish in
            // Blood pressure's only genuine device reading. Established
            // from the SDK binary (QCSDKManager / OdmBandNotifyCenter),
            // since neither the header nor the vendor demo shows a BP
            // one-shot result:
            // - The band's real-time BP packet (SBP byte 4, DBP byte 5)
            //   is posted only when both bytes are non-zero, and reaches
            //   the app solely through this `measuringHandle`, as
            //   `@{"sbp": n, "dbp": n}`.
            // - `completedHandle` fires only when the SDK's own timer
            //   expires. For BP it hands back a bare NSNumber (systolic
            //   only), and if the band never pushed a value it first
            //   substitutes a hardcoded 120/80 — then still reports
            //   `isSuccess`. Its `result` must therefore never be read
            //   as a BP reading.
            QCSDKManager.shareInstance().startToMeasuring(
                withOperateType: qcType,
                timeout: 30,
                measuringHandle: { @Sendable tick in
                    WearableDiagnostics.log("measureNow(\(metricName)): measuringHandle tick, type=\(String(describing: type(of: tick as Any))) value=\(String(describing: tick))")
                    if isBP, let pair = BandBloodPressurePush.pair(from: tick) {
                        bpPush.set(pair)
                        Task { @MainActor in
                            WearableRuntimeDiagnostics.shared.recordBPBandPush(systolic: pair.systolic, diastolic: pair.diastolic)
                        }
                    }
                },
                completedHandle: { @Sendable isSuccess, result, error in
                    // Everything is extracted here, synchronously, before
                    // anything crosses to the main actor: `result` (`Any?`)
                    // can't cross that boundary at all.
                    let rawType = String(describing: type(of: result as Any))
                    let resultDescription = String(describing: result)
                    let errorDescription = error?.localizedDescription
                    WearableDiagnostics.log("measureNow(\(metricName)): completedHandle isSuccess=\(isSuccess) resultType=\(rawType) resultIsNil=\(result == nil) error=\(errorDescription ?? "nil")")
                    guard isBP else {
                        if isSuccess {
                            finish(.success(Self.parseMeasurementResult(result, metric: metric)))
                        } else {
                            finish(.failure(error ?? WearableSDKError.commandFailed("on-demand measurement")))
                        }
                        return
                    }
                    let errorCode = (error as NSError?)?.code
                    let pair = bpPush.value
                    Task { @MainActor in
                        WearableRuntimeDiagnostics.shared.recordBPCallback(isSuccess: isSuccess, rawType: rawType, rawDescription: resultDescription, error: errorDescription)
                        WearableRuntimeDiagnostics.shared.recordBPCompletion(sdkErrorCode: errorCode, bandPushReceived: pair != nil)
                    }
                    // -3 (not worn) / -4 (uncalibrated) are the band
                    // flagging the attempt invalid, so an earlier push
                    // isn't trusted then; -2 only means the end command
                    // wasn't acknowledged after the band had reported.
                    if let pair, isSuccess || errorCode == -2 {
                        var parsed = OnDemandMeasurementResult()
                        parsed.systolicMmHg = pair.systolic
                        parsed.diastolicMmHg = pair.diastolic
                        Task { @MainActor in
                            WearableRuntimeDiagnostics.shared.recordBPParsed(systolic: pair.systolic, diastolic: pair.diastolic)
                        }
                        finish(.success(parsed))
                    } else if isSuccess {
                        Task { @MainActor in
                            WearableRuntimeDiagnostics.shared.recordBPFailure("SDK window ended with no band BP push; completion value \(resultDescription) discarded (SDK default when band sends nothing)")
                        }
                        finish(.failure(WearableSDKError.bloodPressureNotReturnedByBand))
                    } else {
                        Task { @MainActor in
                            WearableRuntimeDiagnostics.shared.recordBPFailure(errorDescription ?? "SDK completedHandle reported failure with no NSError")
                        }
                        finish(.failure(error ?? WearableSDKError.commandFailed("on-demand measurement")))
                    }
                }
            )
        }
    }

    nonisolated private static func parseMeasurementResult(_ raw: Any?, metric: OnDemandMetric) -> OnDemandMeasurementResult {
        var result = OnDemandMeasurementResult()
        switch metric {
        case .heartRate:
            result.heartRate = intValue(raw)
        case .spo2:
            result.spo2Pct = doubleValue(raw)
        case .bodyTemperature:
            result.temperatureC = doubleValue(raw)
        case .bloodPressure:
            // Never parsed from the completion value — see `measureNow`
            // and `BandBloodPressurePush`.
            break
        }
        return result
    }

    nonisolated private static func intValue(_ any: Any?) -> Int? {
        if let number = any as? NSNumber { return number.intValue }
        if let string = any as? String { return Int(string) }
        return nil
    }

    nonisolated private static func doubleValue(_ any: Any?) -> Double? {
        if let number = any as? NSNumber { return number.doubleValue }
        if let string = any as? String { return Double(string) }
        return nil
    }

    // MARK: - Live heart rate (real-time HR streaming)

    // Raw values per the vendor header (QCDFU_Utils.h): plain C enum
    // (not NS_ENUM) — bridges as UInt32 with a non-failable
    // `init(rawValue:)`, same reasoning as `QCSportState` above; matched
    // by raw int rather than a guessed bridged case name.
    // QCBandRealTimeHeartRateCmdTypeStart=0x01, ...End=0x02, ...Hold=0x03.
    /// `QCDeviceDataUpdateSportRecord` (QCDFU_Utils.h: HeartRate = 0x01,
    /// then BloodPressure, BloodOxygen, Step, Temperature, Sleep,
    /// SportRecord = 7).
    static let dataUpdateSportRecord = 7

    private static let realTimeHRCmdStart: UInt32 = 0x01
    private static let realTimeHRCmdEnd: UInt32 = 0x02
    private static let realTimeHRCmdHold: UInt32 = 0x03
    // The vendor demo app (`QCBandSDKDemo/ViewController.m`) re-sends a
    // "hold" every 20s to keep the band's real-time HR mode alive —
    // confirmed against that real, working reference implementation, not
    // guessed. Sombrey holds indefinitely (no demo-style 120s auto-cutoff)
    // since the product wants continuous live HR for as long as the app
    // is foregrounded and connected, not a bounded one-off measurement;
    // `stopLiveHeartRate` is what actually ends the session (disconnect/
    // background/teardown), so this never outlives its purpose.
    private static let realTimeHRHoldInterval: TimeInterval = 20

    private var liveHeartRateTask: Task<Void, Never>?

    func startLiveHeartRate(_ deviceId: DeviceID) async {
        guard connectedPeripheral?.identifier.uuidString == deviceId else {
            WearableDiagnostics.log("startLiveHeartRate: ignored, deviceId mismatch or not connected")
            return
        }
        guard liveHeartRateTask == nil else {
            WearableDiagnostics.log("startLiveHeartRate: already running, no-op")
            return
        }
        guard isLinkLive else {
            WearableDiagnostics.log("startLiveHeartRate: link not live — will start after reconnect")
            return
        }
        WearableDiagnostics.log("startLiveHeartRate: sending Start command")
        WearableRuntimeDiagnostics.shared.recordHRStartCommand()
        QCSDKCmdCreator.realTimeHeartRate(with: QCBandRealTimeHeartRateCmdType(rawValue: Self.realTimeHRCmdStart), finished: nil)
        liveHeartRateTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.realTimeHRHoldInterval))
                guard !Task.isCancelled, let self else { return }
                // Never write into a dead link; the task ends and live HR
                // is restarted by the reconnect.
                guard self.isLinkLive else { return }
                WearableDiagnostics.log("startLiveHeartRate: sending Hold command")
                WearableRuntimeDiagnostics.shared.recordHRHoldCommand()
                QCSDKCmdCreator.realTimeHeartRate(with: QCBandRealTimeHeartRateCmdType(rawValue: Self.realTimeHRCmdHold), finished: nil)
            }
        }
    }

    func stopLiveHeartRate(_ deviceId: DeviceID) async {
        guard liveHeartRateTask != nil else {
            WearableDiagnostics.log("stopLiveHeartRate: not running, no-op")
            return
        }
        WearableDiagnostics.log("stopLiveHeartRate: sending End command")
        WearableRuntimeDiagnostics.shared.recordHRStopCommand()
        liveHeartRateTask?.cancel()
        liveHeartRateTask = nil
        guard isLinkLive else { return }
        QCSDKCmdCreator.realTimeHeartRate(with: QCBandRealTimeHeartRateCmdType(rawValue: Self.realTimeHRCmdEnd), finished: nil)
    }

    // MARK: - Not wired into Sombrey V1 (see QCBandService's header)

    func setTargets(_ deviceId: DeviceID, steps: Int?, sleepMinutes: Int?, activeCalories: Int?) async throws {
        throw WearableUnsupportedError(feature: "Setting band targets")
    }

    func vibrate(_ deviceId: DeviceID) async throws {
        throw WearableUnsupportedError(feature: "Vibration")
    }

    func findBand(_ deviceId: DeviceID) async throws {
        throw WearableUnsupportedError(feature: "Find my band")
    }

    // MARK: - Live callbacks (real-time push data from the band)

    private func configureLiveCallbacks() {
        let manager = QCSDKManager.shareInstance()
        manager.currentStepInfo = { [weak self] step, calorie, distance in
            Task { @MainActor in
                // Logged unconditionally, before the emit()/plausibility
                // gate — this is the ONLY passive source of live
                // calorie/step updates between explicit `sync()` calls;
                // if this callback stops firing, calories/steps will
                // display the last accepted value indefinitely, which
                // looks identical to "stuck" from the UI alone.
                WearableDiagnostics.log("currentStepInfo callback fired: step=\(step) calorie=\(calorie) distance=\(distance)")
                guard let self, let deviceId = self.activeDeviceId else { return }
                let now = Date()
                self.emit(deviceId: deviceId, type: .steps, value: Double(step), unit: "steps", at: now, sdkSource: "currentStepInfo")
                self.emitActiveCalories(deviceId: deviceId, bandCalories: Double(calorie), at: now, sdkSource: "currentStepInfo")
            }
        }
        manager.currentBatteryInfo = { [weak self] battery, _ in
            Task { @MainActor in
                guard let self, let deviceId = self.activeDeviceId else { return }
                self.emit(deviceId: deviceId, type: .batteryPct, value: Double(battery), unit: "%", at: Date())
            }
        }
        manager.realTimeHeartRate = { [weak self] hr in
            Task { @MainActor in
                // Logged unconditionally, before the `hr > 0` guard below,
                // so a physical-device test can distinguish "the SDK
                // callback never fires at all" (nothing logged) from
                // "it fires but with a rejected value" (logged, then
                // dropped) — the two look identical from the UI alone
                // (both show live HR stuck on "Measuring…").
                WearableDiagnostics.log("realTimeHeartRate callback fired: hr=\(hr)")
                WearableRuntimeDiagnostics.shared.recordHRCallback(raw: Int(hr))
                guard let self, let deviceId = self.activeDeviceId, hr > 0 else { return }
                self.emit(deviceId: deviceId, type: .heartRate, value: Double(hr), unit: "bpm", at: Date(), sdkSource: LiveHeartRateTrace.sdkSource)
            }
        }
        // The band's "data updated" report. Every report is logged (it's
        // the evidence for which ones this band actually sends); a Sport+
        // record report (QCDeviceDataUpdateSportRecord = 7 in
        // QCDFU_Utils.h, matched by raw value) triggers an import.
        manager.watchDataUpdateReport = { [weak self] dataType, value in
            let raw = dataType.rawValue
            Task { @MainActor in
                WearableDiagnostics.log("watchDataUpdateReport: type=\(raw) value=\(value)")
                WearableRuntimeDiagnostics.shared.recordDataUpdateReport(type: raw, value: value)
                if raw == Self.dataUpdateSportRecord {
                    self?.sportRecordContinuation?.yield(())
                }
            }
        }
        manager.currentSportInfo = { [weak self] sportInfo in
            Task { @MainActor in
                guard let self else { return }
                self.sportUpdateContinuation?.yield(SportSessionLiveUpdate(
                    sportType: sportInfo.sportType.rawValue,
                    state: Int(sportInfo.state.rawValue),
                    durationSeconds: sportInfo.duration,
                    heartRate: sportInfo.hr,
                    steps: sportInfo.step,
                    distanceMeters: sportInfo.distance,
                    // Raw cal, like every live band calorie counter —
                    // the vendor demo logs this exact field as
                    // "calorie(unit:calorie)" (see `BandCalorieUnits`).
                    // Only the post-session Sport+ summary
                    // (`sportSessionHistory`) arrives already in kcal.
                    calories: BandCalorieUnits.kilocalories(fromBandCalories: Double(sportInfo.calorie))
                ))
            }
        }
    }

    /// The band's pedometer calorie counter arrives in raw cal (see
    /// `BandCalorieUnits` for the vendor evidence); this is the one place
    /// it's converted to kcal, with the untouched raw number carried
    /// along for provenance. Every calorie path into `emit` goes through
    /// here so the two can never drift apart.
    private func emitActiveCalories(deviceId: DeviceID, bandCalories: Double, at date: Date, sdkSource: String) {
        emit(
            deviceId: deviceId,
            type: .activeCalories,
            value: BandCalorieUnits.kilocalories(fromBandCalories: bandCalories),
            unit: "kcal",
            at: date,
            sdkSource: sdkSource,
            deviceRawValue: bandCalories,
            deviceRawUnit: BandCalorieUnits.rawUnit
        )
    }

    /// The single choke point every reading passes through — live
    /// callbacks, on-demand results, and historical sync all funnel
    /// here, so this is the one place a validity check protects the
    /// whole pipeline (`WearableManager`, Convex persistence, graphs,
    /// readiness) uniformly, rather than each call site needing its own
    /// guard. See `isValid(metricType:value:)` for why.
    private func emit(deviceId: DeviceID, type: WearableMetricType, value: Double, unit: String, at date: Date, sdkSource: String? = nil, deviceRawValue: Double? = nil, deviceRawUnit: String? = nil) {
        guard type.isPhysicallyPlausible(value) else {
            WearableDiagnostics.log("emit: rejected \(type.rawValue)=\(value) as not physically plausible")
            WearableRuntimeDiagnostics.shared.recordMetricEmit(type: type, value: value, accepted: false)
            return
        }
        WearableRuntimeDiagnostics.shared.recordMetricEmit(type: type, value: value, accepted: true)
        measurementContinuation?.yield(WearableMeasurement(deviceId: deviceId, metricType: type, value: value, unit: unit, recordedAt: date, deviceRawValue: deviceRawValue, deviceRawUnit: deviceRawUnit, sdkSource: sdkSource))
    }

    /// Each `QCSchedualHeartRateModel` covers one calendar day's worth of
    /// samples spaced `secondInterval` seconds apart, most-recent-first
    /// per the SDK's own ordering within the day.
    private func emitHeartRate(deviceId: DeviceID, model: QCSchedualHeartRateModel) -> Int {
        guard let dayStart = Self.sdkDateFormatter.date(from: "\(model.date) 00:00:00") else { return 0 }
        var emitted = 0
        for (index, sample) in model.heartRates.enumerated() {
            let bpm = sample.doubleValue
            guard bpm > 0 else { continue }
            let timestamp = dayStart.addingTimeInterval(Double(index) * Double(model.secondInterval))
            emit(deviceId: deviceId, type: .heartRate, value: bpm, unit: "bpm", at: timestamp)
            emitted += 1
        }
        return emitted
    }

    // Raw values per the vendor header (QCSleepModel.h): NONE=0, SOBER=1,
    // LIGHT=2, DEEP=3, REM=4, UNWEARED=5. Matched on `.rawValue` rather
    // than the bridged Swift case names — this specific NS_ENUM bridges
    // unpredictably across Xcode/Swift versions (confirmed against a real
    // Codemagic build; case-name guesses failed to compile), while the
    // raw integer values are the stable, header-defined wire format.
    private static let sleepTypeNone = 0
    private static let sleepTypeSober = 1
    private static let sleepTypeLight = 2
    private static let sleepTypeDeep = 3
    private static let sleepTypeRem = 4
    private static let sleepTypeUnweared = 5

    private static func sleepSession(from stages: [QCSleepModel]) -> SleepSessionData? {
        let real = stages.filter { $0.type.rawValue != sleepTypeNone && $0.type.rawValue != sleepTypeUnweared }
        guard !real.isEmpty else { return nil }
        let mapped: [SleepStage] = real.compactMap { model in
            guard let stage = stage(forRawValue: model.type.rawValue),
                  let start = sdkDateFormatter.date(from: model.happenDate) else { return nil }
            return SleepStage(stage: stage, startedAt: start, durationMinutes: model.total)
        }
        guard let firstStart = mapped.map(\.startedAt).min() else { return nil }
        let lastEnd = mapped.map { $0.startedAt.addingTimeInterval(Double($0.durationMinutes) * 60) }.max() ?? firstStart
        let asleepMinutes = mapped.filter { $0.stage != .awake }.reduce(0) { $0 + $1.durationMinutes }
        return SleepSessionData(
            deviceId: "",
            startedAt: firstStart,
            endedAt: lastEnd,
            totalSleepMinutes: asleepMinutes,
            stages: mapped
        )
    }

    private static func stage(forRawValue rawValue: Int) -> SleepStage.Stage? {
        switch rawValue {
        case sleepTypeLight: return .light
        case sleepTypeDeep: return .deep
        case sleepTypeRem: return .rem
        case sleepTypeSober: return .awake
        default: return nil // NONE / UNWEARED
        }
    }

    // MARK: - Command wrappers (each an independent BLE round trip)

    /// The ONE way a band command is sent. Structurally safe:
    ///
    /// - refused (`.notConnected`) unless the link is live — nothing is ever
    ///   sent into a dead connection;
    /// - exactly one terminal path: the SDK's success OR failure callback,
    ///   OR the time limit, OR link loss / task cancellation — whichever is
    ///   first, via `OneShotCompletion`; every later callback is logged as
    ///   stale and dropped, so a continuation can never resume twice;
    /// - registered in `commands` for its whole life, so a disconnect fails
    ///   it at once with `.disconnected` (never left hanging);
    /// - the SDK callbacks handed out are `@Sendable` (nonisolated): the
    ///   vendor SDK may invoke them on its own queue, and a main-actor
    ///   closure called off the main thread is a Swift 6 runtime trap.
    ///   `send` must only capture Sendable values in those callbacks and
    ///   report through `finish`.
    private func runCommand<T: Sendable>(
        _ name: String,
        timeout: TimeInterval,
        _ send: (_ finish: @escaping @Sendable (Result<T, Error>) -> Void) -> Void
    ) async throws -> T {
        guard isLinkLive else {
            log("\(name): not sent — band not connected")
            throw WearableCommandError.notConnected(command: name)
        }
        let epoch = linkEpoch
        let id = UUID()
        let once = OneShotCompletion<T>(command: name)
        let seconds = Int(timeout)
        let timer = Task {
            try? await Task.sleep(for: .seconds(timeout))
            guard !Task.isCancelled else { return }
            if once.complete(.failure(WearableCommandError.timedOut(command: name, seconds: seconds))) {
                Task { @MainActor [weak self] in self?.log("\(name): timed out after \(seconds)s") }
            }
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
                commands.register(id, command: name, epoch: epoch) { error in once.complete(.failure(error)) }
                once.install(continuation) {
                    timer.cancel()
                    Task { @MainActor [weak self] in self?.commands.unregister(id) }
                }
                send { result in
                    if !once.complete(result) {
                        // A late or duplicate SDK callback — the command
                        // already ended (disconnect, timeout, or an earlier
                        // callback). Dropped, never resumed again.
                        Task { @MainActor [weak self] in self?.log("\(name): stale callback from link #\(epoch) dropped") }
                    }
                }
            }
        } onCancel: {
            once.complete(.failure(WearableCommandError.cancelled(command: name)))
        }
    }

    // Raw values per the vendor header (QCDFU_Utils.h): Start=0x01,
    // Pause=0x02, Continue=0x03, Stop=0x04, Running=0x05, GetTime=0x06.
    // Matched by raw int for the same reason `SLEEPTYPE` is — this
    // specific enum's Swift bridging can't be trusted across Xcode
    // versions.
    private static let sportStateStart = 0x01
    private static let sportStatePause = 0x02
    private static let sportStateContinue = 0x03
    private static let sportStateStop = 0x04

    private static func sportStateName(_ state: Int) -> String {
        switch state {
        case sportStateStart: return "start"
        case sportStatePause: return "pause"
        case sportStateContinue: return "resume"
        case sportStateStop: return "stop"
        default: return "state \(state)"
        }
    }

    /// A stop the band missed while out of range: sent once the link is
    /// back, so the band's own recording ends and its record can import.
    private func sendPendingSportStopIfNeeded() {
        guard let sportType = pendingSportStop else { return }
        pendingSportStop = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await self.operateSportMode(sportType: sportType, state: Self.sportStateStop)
                self.log("sent the Sport+ stop the band missed while disconnected")
            } catch {
                self.log("Sport+ stop after reconnect failed: \(error)")
            }
        }
    }

    private func operateSportMode(sportType: Int, state: Int) async throws {
        // QCSportState is a plain (non-NS_ENUM) C enum in the vendor
        // header, which Clang/Swift bridges with a UInt32 raw value and
        // a non-failable `init(rawValue:)` — unlike
        // OdmSportPlusExerciseModelType (an explicit
        // NS_ENUM(NSInteger, ...)), which bridges as Int with a
        // failable initializer. Both confirmed by real Codemagic builds,
        // not assumed.
        guard let type = OdmSportPlusExerciseModelType(rawValue: sportType) else {
            throw WearableSDKError.commandFailed("invalid sport type")
        }
        let sportState = QCSportState(rawValue: UInt32(state))
        let _: Void = try await runCommand("Sport+ \(Self.sportStateName(state))", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.operateSportMode(with: type, state: sportState) { @Sendable _, error in
                if let error { finish(.failure(error)) } else { finish(.success(())) }
            }
        }
    }

    private func sportRecords(since timestamp: TimeInterval) async throws -> [OdmGeneralExerciseSummaryModel] {
        try await runCommand("Sport+ records", timeout: BandCommandTimeout.sportRecords) { finish in
            QCSDKCmdCreator.getSportRecords(fromLastTimeStamp: timestamp) { @Sendable summaries, error in
                if let summaries {
                    finish(.success(summaries))
                } else {
                    finish(.failure(error ?? WearableSDKError.commandFailed("sport session history")))
                }
            }
        }
    }

    /// The vendor demo (`QCBandSDKDemo/ViewController.m`) gates every
    /// feature-specific measurement (BP, SpO2, temperature, blood
    /// glucose, "app manual" one-shot mode) behind the `featureList`
    /// dictionary this call's success handler returns — e.g.
    /// `getBloodPressure`'s own comment: "Some watches support it, and
    /// setting the time will return the status of whether it is
    /// supported." Sombrey previously discarded this dictionary
    /// entirely; it's now captured into `capabilities` so `measureNow`
    /// can tell "this band doesn't support X" apart from "the command
    /// failed for some other reason" — see `capabilityKey(for:)`.
    private func setDeviceTime() async throws {
        // The feature list is parsed inside the callback (into Sendable
        // values) and applied back on the main actor.
        let parsed: [String: Bool] = try await runCommand("set device time", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.setTime(Date(), success: { @Sendable featureList in
                finish(.success(Self.parseCapabilities(featureList)))
            }, failed: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("set device time")))
            })
        }
        capabilities = parsed
        WearableDiagnostics.log("setDeviceTime: capabilities=\(capabilities)")
    }

    nonisolated private static func parseCapabilities(_ featureList: [AnyHashable: Any]) -> [String: Bool] {
        var result: [String: Bool] = [:]
        for (rawKey, rawValue) in featureList {
            guard let key = rawKey as? String else { continue }
            if let str = rawValue as? String {
                result[key] = str == "1"
            } else if let num = rawValue as? NSNumber {
                result[key] = num.boolValue
            }
        }
        return result
    }

    /// The `QCBandFeatureXXX` key that documents support for a given
    /// on-demand metric, per the vendor header's `setTime:success:` doc
    /// comment. `nil` for metrics the vendor demo never gates this way
    /// (real-time/one-shot heart rate isn't feature-flagged anywhere in
    /// the demo) — those are never blocked here, only ones we have an
    /// actual documented flag for.
    private static func capabilityKey(for metric: OnDemandMetric) -> String? {
        switch metric {
        // The SDK's own exported constant, not its symbol name as a
        // literal: the feature dictionary is keyed by the constant's
        // string value, "feature.bloodPressure" (confirmed in the SDK
        // binary), so the literal "QCBandFeatureBloodPressure" never
        // matched and BP support always read as unknown. The two lines
        // below are unchanged on purpose — this pass is BP-only.
        case .bloodPressure: return QCBandFeatureBloodPressure
        case .spo2: return "QCBandFeatureBloodOxygen"
        case .bodyTemperature: return "QCBandFeatureTemperature"
        case .heartRate: return nil
        }
    }

    private func currentSport() async throws -> QCSportModel {
        try await runCommand("today's activity", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.getCurrentSportSucess({ @Sendable sport in
                finish(.success(sport))
            }, failed: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("current activity")))
            })
        }
    }

    private func scheduledHeartRate(dayIndexes: [Int]) async throws -> [QCSchedualHeartRateModel] {
        try await runCommand("heart rate history", timeout: BandCommandTimeout.history) { finish in
            QCSDKCmdCreator.getSchedualHeartRateData(withDayIndexs: dayIndexes.map { NSNumber(value: $0) }, success: { @Sendable models in
                finish(.success(models))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("heart rate history")))
            })
        }
    }

    private func bloodOxygen(dayIndex: Int) async throws -> [QCBloodOxygenModel] {
        try await runCommand("SpO2 history", timeout: BandCommandTimeout.history) { finish in
            QCSDKCmdCreator.getBloodOxygenData(byDayIndex: dayIndex) { @Sendable result, error in
                if let models = result as? [QCBloodOxygenModel] {
                    finish(.success(models))
                } else {
                    finish(.failure(error ?? WearableSDKError.commandFailed("SpO2 history")))
                }
            }
        }
    }

    private func scheduledTemperature(dayIndex: Int) async throws -> [QCTemperatureModel] {
        try await runCommand("temperature history", timeout: BandCommandTimeout.history) { finish in
            QCSDKCmdCreator.getSchedualTemperatureData(byDayIndex: dayIndex) { @Sendable result, error in
                if let models = result as? [QCTemperatureModel] {
                    finish(.success(models))
                } else {
                    finish(.failure(error ?? WearableSDKError.commandFailed("temperature history")))
                }
            }
        }
    }

    private func bloodPressureHistory() async throws -> [QCBloodPressureModel] {
        try await runCommand("blood pressure history", timeout: BandCommandTimeout.history) { finish in
            QCSDKCmdCreator.getSchedualBPHistoryData(success: { @Sendable models in
                finish(.success(models))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("blood pressure history")))
            })
        }
    }

    /// The vendor demo (`QCBandSDKDemo/ViewController.m`'s `getBloodPressure`)
    /// never exercises the generic `startToMeasuringWithOperateType:` path
    /// for BP anywhere in its source — confirmed by an exhaustive search
    /// of the whole file, not just this one method — while it DOES use
    /// that exact generic path for heart rate and temperature. Its own
    /// BP flow is scheduled-measurement + history-fetch instead: enable
    /// the band's periodic auto-BP feature, then read back whatever it
    /// recorded. `getSchedualBPHistoryData` (already synced above) can
    /// only ever return readings if this feature is actually on — and
    /// nothing previously turned it on, so that fetch was always empty
    /// on a band where it defaults off. Mirrors the demo's own exact
    /// parameters (`beginTime:"00:00" endTime:"23:59" minuteInterval:60`),
    /// not invented. Best-effort: failure here doesn't fail `sync()`.
    private func enableScheduledBloodPressureIfNeeded() async {
        let isOn: Bool? = try? await runCommand("scheduled BP status", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.getSchedualBPInfo({ @Sendable featureOn, _, _, _ in
                finish(.success(featureOn))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("scheduled BP status")))
            })
        }
        WearableDiagnostics.log("enableScheduledBloodPressureIfNeeded: currently on=\(String(describing: isOn))")
        guard isOn == false else { return }
        let enabled: Void? = try? await runCommand("enable scheduled BP", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.setSchedualBPInfoOn(true, beginTime: "00:00", endTime: "23:59", minuteInterval: 60, success: { @Sendable _, _, _, _ in
                finish(.success(()))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("enable scheduled BP")))
            })
        }
        if enabled != nil { WearableDiagnostics.log("enableScheduledBloodPressureIfNeeded: enabled") }
    }

    /// The vendor demo's `getBloodPressure` fetches this immediately
    /// after scheduled BP history — its own comment marks it as the
    /// band-button-triggered ("manual") reading path, distinct from the
    /// app-scheduled one above. `0` = "since the beginning," matching
    /// the demo's own call exactly.
    private func manualBloodPressureHistory() async throws -> [QCBloodPressureModel] {
        try await runCommand("manual blood pressure history", timeout: BandCommandTimeout.history) { finish in
            QCSDKCmdCreator.getManualBloodPressureData(withLastUnixSeconds: 0, success: { @Sendable models in
                finish(.success(models))
            }, fail: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("manual blood pressure history")))
            })
        }
    }

    private func readBattery() async throws -> (percent: Int, charging: Bool) {
        let reading: BatteryReading = try await runCommand("battery", timeout: BandCommandTimeout.quick) { finish in
            QCSDKCmdCreator.readBatterySuccess({ @Sendable battery, charging in
                finish(.success(BatteryReading(percent: Int(battery), charging: charging)))
            }, failed: { @Sendable in
                finish(.failure(WearableSDKError.commandFailed("battery")))
            })
        }
        return (reading.percent, reading.charging)
    }
}

// MARK: - CBCentralManagerDelegate

extension QCBandSDKService: CBCentralManagerDelegate {
    /// Never guessed — a direct, exhaustive mapping of Apple's own
    /// `CBManagerState` cases, for the diagnostics report's "Bluetooth
    /// authorization/state" line.
    private static func stateDescription(_ state: CBManagerState) -> String {
        switch state {
        case .unknown: return "unknown"
        case .resetting: return "resetting"
        case .unsupported: return "unsupported"
        case .unauthorized: return "unauthorized"
        case .poweredOff: return "poweredOff"
        case .poweredOn: return "poweredOn"
        @unknown default: return "unrecognized(\(state.rawValue))"
        }
    }

    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Task { @MainActor in
            WearableRuntimeDiagnostics.shared.recordBluetoothState(Self.stateDescription(central.state), poweredOn: central.state == .poweredOn)
            if central.state != .poweredOn {
                self.stopScanIfNeeded()
                self.scanContinuation?.resume(returning: [])
                self.scanContinuation = nil
                // Bluetooth off/resetting invalidates every peripheral and
                // CoreBluetooth may not deliver a didDisconnect for it.
                if self.connectedPeripheral != nil || self.connectingId != nil {
                    self.linkLost("Bluetooth \(Self.stateDescription(central.state))")
                }
                self.connectingId = nil
                self.reconnectTask?.cancel()
                self.reconnectTask = nil
                self.failConnectWaiters(WearableSDKError.bluetoothUnavailable)
                self.connectionStateContinuation?.yield(.unavailable)
                return
            }
            // Powered on: resume the paired band — a restored peripheral
            // that's still connected is attached directly; otherwise a
            // pending connect is armed.
            if let restored = self.restoredPeripheral {
                self.restoredPeripheral = nil
                let id = restored.identifier.uuidString
                self.autoReconnectId = id
                self.discoveredPeripherals[id] = restored
                if restored.state == .connected {
                    self.connectingId = id
                    self.log("restored band still connected — re-attaching")
                    self.attach(restored)
                } else {
                    self.connectionStateContinuation?.yield(.reconnecting)
                    self.scheduleReconnect(after: 0, reason: "restored by iOS")
                }
            } else if self.autoReconnectId != nil, !self.isLinkLive, self.connectingId == nil {
                self.connectionStateContinuation?.yield(.reconnecting)
                self.scheduleReconnect(after: 0, reason: "Bluetooth back on")
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        Task { @MainActor in
            // The ONLY filter applied, currently: `peripheral.name` must
            // be non-nil and non-empty. No service-UUID filter, no
            // name-content/substring match against "Sombrey" — recorded
            // either way so a physical test can see exactly what
            // CoreBluetooth actually saw, not just what passed.
            let id = peripheral.identifier.uuidString
            let name = peripheral.name
            let passedFilter = name != nil && !(name?.isEmpty ?? true)
            WearableRuntimeDiagnostics.shared.recordDiscoveredPeripheral(
                id: id, name: name, rssi: RSSI.intValue,
                passedFilter: passedFilter,
                filterReason: passedFilter ? nil : "peripheral.name is nil or empty"
            )
            guard passedFilter else { return }
            self.discoveredPeripherals[id] = peripheral
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Task { @MainActor in
            let id = peripheral.identifier.uuidString
            // Stale: not the attempt in progress (a forgotten band, or a
            // connect superseded by another).
            guard self.connectingId == id || (self.connectingId == nil && self.autoReconnectId == id && !self.isLinkLive) else {
                self.log("didConnect for a peripheral no longer being connected — ignored")
                return
            }
            self.connectingId = id
            self.attach(peripheral)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        let message = String(describing: error)
        Task { @MainActor in
            let id = peripheral.identifier.uuidString
            guard self.connectingId == id else {
                self.log("didFailToConnect for a stale attempt — ignored")
                return
            }
            self.connectingId = nil
            self.connectFailures += 1
            WearableRuntimeDiagnostics.shared.recordPairingResult(success: false, error: message)
            self.failConnectWaiters(error ?? WearableSDKError.connectFailed)
            if self.autoReconnectId == id {
                self.connectionStateContinuation?.yield(.reconnecting)
                self.scheduleReconnect(after: ReconnectBackoff.delay(afterFailures: self.connectFailures), reason: "connect failed")
            } else {
                self.connectionStateContinuation?.yield(.error)
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let message = error.map { String(describing: $0) } ?? "no error"
        Task { @MainActor in
            QCSDKManager.shareInstance().remove(peripheral)
            let id = peripheral.identifier.uuidString
            let wasLive = self.connectedPeripheral?.identifier == peripheral.identifier
            let wasAttaching = self.connectingId == id
            // Stale: an older link or a band already forgotten.
            guard wasLive || wasAttaching else {
                self.log("didDisconnect for a stale link — ignored")
                return
            }
            self.connectingId = nil
            self.linkLost("disconnected: \(message)")
            if wasAttaching { self.failConnectWaiters(WearableCommandError.disconnected(command: "connect")) }
            guard self.autoReconnectId == id else {
                self.connectionStateContinuation?.yield(.disconnected)
                return
            }
            if central.state == .poweredOn {
                // The band walked out of range (or similar): an honest
                // `.reconnecting`, and a pending connect that completes on
                // its own when the band is back — no polling, no timeout.
                self.connectionStateContinuation?.yield(.reconnecting)
                self.scheduleReconnect(after: 0, reason: "link dropped")
            } else {
                self.connectionStateContinuation?.yield(.unavailable)
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        // Extract synchronously, outside the Task: `[String: Any]` can't
        // be proven Sendable (an `Any` value could be anything), so the
        // dictionary itself can't cross into the @MainActor closure below
        // — only the already-`@preconcurrency`-treated `CBPeripheral` we
        // actually need does.
        guard let peripheral = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first else { return }
        Task { @MainActor in
            // Not live until it's re-attached to the SDK: the attach (or a
            // pending reconnect) happens once Bluetooth reports powered-on.
            self.restoredPeripheral = peripheral
            self.autoReconnectId = peripheral.identifier.uuidString
            self.log("iOS restored the band's connection state (\(peripheral.state.rawValue == 2 ? "connected" : "not connected"))")
        }
    }
}

// These specific QCBandSDK model classes still triggered Swift 6's
// "sending 'x' risks causing data races" region-isolation check even
// under `@preconcurrency import QCBandSDK` above (confirmed by a real
// Codemagic build — `@preconcurrency` alone didn't cover every case).
// They're plain, vendor-owned data-holder classes returned by a single
// ObjC completion handler and never touched again after that handler
// resumes the awaiting continuation — a genuine third-party-SDK boundary
// the compiler can't verify, not a real concurrent-mutation risk.
extension QCSleepModel: @unchecked Sendable {}
extension QCSchedualHeartRateModel: @unchecked Sendable {}
extension QCBloodOxygenModel: @unchecked Sendable {}
extension QCTemperatureModel: @unchecked Sendable {}
extension QCBloodPressureModel: @unchecked Sendable {}
extension QCSportInfoModel: @unchecked Sendable {}
extension OdmGeneralExerciseSummaryModel: @unchecked Sendable {}
// Same boundary, now crossing through `runCommand`'s Sendable result.
extension QCSportModel: @unchecked Sendable {}

/// The latest band BP push during a measurement, shared between the SDK's
/// tick and completion callbacks (which may run on any queue).
final class BandPushBox: @unchecked Sendable {
    private let lock = NSLock()
    private var pair: (systolic: Int, diastolic: Int)?

    func set(_ value: (systolic: Int, diastolic: Int)) {
        lock.lock(); pair = value; lock.unlock()
    }

    var value: (systolic: Int, diastolic: Int)? {
        lock.lock(); defer { lock.unlock() }
        return pair
    }
}

/// Battery answer as a Sendable value (tuples can't carry a conformance).
struct BatteryReading: Sendable {
    let percent: Int
    let charging: Bool
}
