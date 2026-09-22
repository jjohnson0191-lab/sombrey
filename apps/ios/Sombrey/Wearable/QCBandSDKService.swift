import Foundation
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
    private var pairContinuation: CheckedContinuation<Void, Error>?

    private var measurementContinuation: AsyncStream<WearableMeasurement>.Continuation?
    private var sportUpdateContinuation: AsyncStream<SportSessionLiveUpdate>.Continuation?
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
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pairContinuation = continuation
            centralManager.connect(
                peripheral,
                options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: true]
            )
        }
    }

    func reconnectDevice(_ deviceId: DeviceID) async throws {
        guard centralManager.state == .poweredOn else {
            throw WearableSDKError.bluetoothUnavailable
        }
        guard let uuid = UUID(uuidString: deviceId) else {
            throw WearableSDKError.deviceNotFound
        }
        // `retrievePeripherals(withIdentifiers:)` gets a real CBPeripheral
        // handle for a device the system already knows about by UUID —
        // standard CoreBluetooth, no scan required. Feeds it into the
        // exact same `discoveredPeripherals`-backed connect path
        // `pairDevice` already uses, rather than duplicating the connect
        // logic.
        guard let peripheral = centralManager.retrievePeripherals(withIdentifiers: [uuid]).first else {
            throw WearableSDKError.deviceNotFound
        }
        discoveredPeripherals[deviceId] = peripheral
        try await pairDevice(deviceId)
    }

    func unpairDevice(_ deviceId: DeviceID) async throws {
        // Explicit stop here rather than relying solely on the
        // `didDisconnectPeripheral` delegate path below: `connectedPeripheral`
        // is cleared synchronously a few lines down, which makes that
        // delegate callback's own identity guard a no-op once it actually
        // fires later.
        liveHeartRateTask?.cancel()
        liveHeartRateTask = nil
        if let peripheral = connectedPeripheral {
            centralManager.cancelPeripheralConnection(peripheral)
        }
        QCSDKManager.shareInstance().removeAllPeripheral()
        connectedPeripheral = nil
        activeDeviceId = nil
    }

    // MARK: - Status & sync

    func deviceStatus(_ deviceId: DeviceID) async throws -> WearableDeviceStatus {
        guard connectedPeripheral?.identifier.uuidString == deviceId else {
            return WearableDeviceStatus(deviceId: deviceId, connectionState: .disconnected, batteryPct: nil, lastSeenAt: nil)
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
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getDeviceSoftAndHardVersionSuccess({ hardVersion, softVersion in
                continuation.resume(returning: "hw \(hardVersion) / sw \(softVersion)")
            }, fail: {
                continuation.resume(throwing: WearableSDKError.commandFailed("firmware version"))
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
        guard connectedPeripheral?.identifier.uuidString == deviceId else {
            throw WearableSDKError.noConnectedDevice
        }
        WearableRuntimeDiagnostics.shared.recordSyncStarted()
        try? await setDeviceTime()

        var synced = 0
        var anyFailed = false
        var syncedTypes: [String] = []
        let now = Date()

        if let sport = try? await currentSport() {
            // Logged raw, before any parsing/transformation — this is
            // exactly the "compare against the previous response"
            // evidence needed to tell apart "the band's own counter
            // isn't advancing" from "Sombrey is receiving updated data
            // but failing to display it."
            WearableRuntimeDiagnostics.shared.recordRawSportResponse(calories: sport.calories, steps: sport.totalStepCount, distance: sport.distance, happenDate: sport.happenDate)
            // `getCurrentSportSucess` is documented (QCSDKCmdCreator.h)
            // as returning "the summary statistics of the day" — a
            // genuine device-reported cumulative-since-midnight total,
            // not a fabricated or estimated value. But it must be tagged
            // with the day it actually applies to, not the moment this
            // sync happened to run: `sport.happenDate`, when the SDK
            // populates it, is that day; falling back to `now` only when
            // it's absent/unparseable preserves today's existing
            // behavior rather than silently dropping the reading.
            // `isFromToday` (used by every read site) is what actually
            // keeps a stale day's total from displaying as current — see
            // `WearableManager.latestMeasurementForToday(_:)`.
            let sportDate = Self.sdkDateFormatter.date(from: sport.happenDate) ?? now
            emit(deviceId: deviceId, type: .steps, value: Double(sport.totalStepCount), unit: "steps", at: sportDate)
            emit(deviceId: deviceId, type: .activeCalories, value: sport.calories, unit: "kcal", at: sportDate)
            emit(deviceId: deviceId, type: .distanceMeters, value: Double(sport.distance), unit: "m", at: sportDate)
            synced += 3
            syncedTypes.append(contentsOf: ["steps", "active_calories", "distance_meters"])
        } else {
            anyFailed = true
        }

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

        if let spo2 = try? await bloodOxygen(dayIndex: 0) {
            for reading in spo2 {
                emit(deviceId: deviceId, type: .spo2, value: Double(reading.soa2), unit: "%", at: reading.date)
                synced += 1
            }
            if !spo2.isEmpty { syncedTypes.append("spo2") }
        } else {
            anyFailed = true
        }

        if let temps = try? await scheduledTemperature(dayIndex: 0) {
            for reading in temps {
                emit(deviceId: deviceId, type: .skinTemperature, value: Double(reading.temperature), unit: "°C", at: reading.time)
                synced += 1
            }
            if !temps.isEmpty { syncedTypes.append("skin_temperature") }
        } else {
            anyFailed = true
        }

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

        if let battery = try? await readBattery() {
            emit(deviceId: deviceId, type: .batteryPct, value: Double(battery.percent), unit: "%", at: now)
            synced += 1
            syncedTypes.append("battery_pct")
        } else {
            anyFailed = true
        }

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
        let byDay: [String: [QCSleepModel]] = try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getSleepDetailData(fromDay: days, sleepDatas: { result in
                continuation.resume(returning: result)
            }, fail: {
                continuation.resume(throwing: WearableSDKError.commandFailed("sleep history"))
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
        try await operateSportMode(sportType: sportType, state: Self.sportStateStop)
        activeSportType = nil
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

    func sportSessionHistory(_ deviceId: DeviceID, since timestamp: Date) async throws -> [SportSessionSummary] {
        let summaries = try await sportRecords(since: timestamp.timeIntervalSince1970)
        return summaries.map { model in
            SportSessionSummary(
                sportType: model.exerciseType,
                startedAt: Date(timeIntervalSince1970: model.startTime),
                durationSeconds: model.duration,
                distanceMeters: Double(model.distance),
                calories: Double(model.calorie),
                averageHeartRate: Double(model.averageHR),
                lowestHeartRate: Double(model.lowestHR),
                highestHeartRate: Double(model.highestHR),
                averageSpeedMetersPerSecond: Double(model.averageSpeed),
                steps: model.steps
            )
        }
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
        return try await withCheckedThrowingContinuation { continuation in
            var didResume = false
            QCSDKManager.shareInstance().startToMeasuring(
                withOperateType: qcType,
                timeout: 30,
                measuringHandle: { tick in
                    WearableDiagnostics.log("measureNow(\(metric.rawValue)): measuringHandle tick, type=\(String(describing: type(of: tick as Any)))")
                },
                completedHandle: { isSuccess, result, error in
                    guard !didResume else { return }
                    didResume = true
                    // This line answers exactly what the vendor SDK
                    // actually handed back for this device/firmware —
                    // the dynamic type of `result` — rather than
                    // continuing to assume `QCBloodPressureModel` (or
                    // the dictionary fallback) is correct.
                    //
                    // Every string here is extracted synchronously,
                    // before crossing into the `Task { @MainActor in }`
                    // below: this ObjC completion handler isn't provably
                    // MainActor-isolated (unlike the vendor's live-push
                    // callbacks elsewhere in this file, which are called
                    // from inside `Task { @MainActor in }` closures
                    // created directly in MainActor-isolated methods),
                    // so `WearableRuntimeDiagnostics` (a `@MainActor`
                    // type) can't be touched directly from here — and
                    // `result` itself (`Any?`) can't cross that boundary
                    // at all, same reasoning as `parseMeasurementResult`
                    // being called synchronously below, not inside the
                    // Task (confirmed by a real Codemagic build: "sending
                    // 'result' risks causing data races").
                    let rawType = String(describing: type(of: result as Any))
                    let resultDescription = String(describing: result)
                    let errorDescription = error?.localizedDescription
                    WearableDiagnostics.log("measureNow(\(metric.rawValue)): completedHandle isSuccess=\(isSuccess) resultType=\(rawType) resultIsNil=\(result == nil) error=\(errorDescription ?? "nil")")
                    if isBP {
                        Task { @MainActor in
                            WearableRuntimeDiagnostics.shared.recordBPCallback(isSuccess: isSuccess, rawType: rawType, rawDescription: resultDescription, error: errorDescription)
                        }
                    }
                    if isSuccess {
                        let parsed = Self.parseMeasurementResult(result, metric: metric)
                        if isBP {
                            Task { @MainActor in
                                WearableRuntimeDiagnostics.shared.recordBPParsed(systolic: parsed.systolicMmHg, diastolic: parsed.diastolicMmHg)
                                if parsed.systolicMmHg == nil || parsed.diastolicMmHg == nil {
                                    WearableRuntimeDiagnostics.shared.recordBPFailure("SDK reported success but result didn't parse into systolic+diastolic (rawType=\(rawType))")
                                }
                            }
                        }
                        continuation.resume(returning: parsed)
                    } else {
                        if isBP {
                            Task { @MainActor in
                                WearableRuntimeDiagnostics.shared.recordBPFailure(errorDescription ?? "SDK completedHandle reported failure with no NSError")
                            }
                        }
                        continuation.resume(throwing: error ?? WearableSDKError.commandFailed("on-demand measurement"))
                    }
                }
            )
        }
    }

    private static func parseMeasurementResult(_ raw: Any?, metric: OnDemandMetric) -> OnDemandMeasurementResult {
        var result = OnDemandMeasurementResult()
        switch metric {
        case .heartRate:
            result.heartRate = intValue(raw)
        case .spo2:
            result.spo2Pct = doubleValue(raw)
        case .bodyTemperature:
            result.temperatureC = doubleValue(raw)
        case .bloodPressure:
            // The vendor demo (`QCBandSDKDemo/ViewController.m`) never
            // exercises `startToMeasuringWithOperateType:` for BP
            // specifically (its own `getBloodPressure` only demonstrates
            // the scheduled/manual *history* APIs), so this exact
            // completion shape isn't directly demonstrated there. But
            // every one-shot measurement type the demo DOES show a result
            // for (raw HR, three-value temperature) hands back the
            // vendor's own model class, never a plain dictionary — and
            // `QCBloodPressureModel` is that same vendor class used by
            // every other BP API in this SDK (`QCSDKCmdCreator`'s
            // schedule/manual/history calls). Casting to it first matches
            // that established SDK idiom; the dictionary form is kept
            // only as a documented fallback for a shape no known
            // SDK/firmware combination has been confirmed to send.
            if let model = raw as? QCBloodPressureModel {
                result.systolicMmHg = Int(model.systolicPressure)
                result.diastolicMmHg = Int(model.diastolicPressure)
            } else if let dict = raw as? [String: Any] {
                result.systolicMmHg = intValue(dict["sbp"])
                result.diastolicMmHg = intValue(dict["dbp"])
            }
        }
        return result
    }

    private static func intValue(_ any: Any?) -> Int? {
        if let number = any as? NSNumber { return number.intValue }
        if let string = any as? String { return Int(string) }
        return nil
    }

    private static func doubleValue(_ any: Any?) -> Double? {
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
        WearableDiagnostics.log("startLiveHeartRate: sending Start command")
        WearableRuntimeDiagnostics.shared.recordHRStartCommand()
        QCSDKCmdCreator.realTimeHeartRate(with: QCBandRealTimeHeartRateCmdType(rawValue: Self.realTimeHRCmdStart), finished: nil)
        liveHeartRateTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.realTimeHRHoldInterval))
                guard !Task.isCancelled, let self else { return }
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
                self.emit(deviceId: deviceId, type: .steps, value: Double(step), unit: "steps", at: now)
                self.emit(deviceId: deviceId, type: .activeCalories, value: Double(calorie), unit: "kcal", at: now)
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
                self.emit(deviceId: deviceId, type: .heartRate, value: Double(hr), unit: "bpm", at: Date())
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
                    calories: sportInfo.calorie
                ))
            }
        }
    }

    /// The single choke point every reading passes through — live
    /// callbacks, on-demand results, and historical sync all funnel
    /// here, so this is the one place a validity check protects the
    /// whole pipeline (`WearableManager`, Convex persistence, graphs,
    /// readiness) uniformly, rather than each call site needing its own
    /// guard. See `isValid(metricType:value:)` for why.
    private func emit(deviceId: DeviceID, type: WearableMetricType, value: Double, unit: String, at date: Date) {
        guard type.isPhysicallyPlausible(value) else {
            WearableDiagnostics.log("emit: rejected \(type.rawValue)=\(value) as not physically plausible")
            WearableRuntimeDiagnostics.shared.recordMetricEmit(type: type, value: value, accepted: false)
            return
        }
        WearableRuntimeDiagnostics.shared.recordMetricEmit(type: type, value: value, accepted: true)
        measurementContinuation?.yield(WearableMeasurement(deviceId: deviceId, metricType: type, value: value, unit: unit, recordedAt: date))
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

    // Raw values per the vendor header (QCDFU_Utils.h): Start=0x01,
    // Pause=0x02, Continue=0x03, Stop=0x04, Running=0x05, GetTime=0x06.
    // Matched by raw int for the same reason `SLEEPTYPE` is — this
    // specific enum's Swift bridging can't be trusted across Xcode
    // versions.
    private static let sportStateStart = 0x01
    private static let sportStatePause = 0x02
    private static let sportStateContinue = 0x03
    private static let sportStateStop = 0x04

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
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            QCSDKCmdCreator.operateSportMode(with: type, state: sportState) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private func sportRecords(since timestamp: TimeInterval) async throws -> [OdmGeneralExerciseSummaryModel] {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getSportRecords(fromLastTimeStamp: timestamp) { summaries, error in
                if let summaries {
                    continuation.resume(returning: summaries)
                } else {
                    continuation.resume(throwing: error ?? WearableSDKError.commandFailed("sport session history"))
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
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            QCSDKCmdCreator.setTime(Date(), success: { [weak self] featureList in
                self?.capabilities = Self.parseCapabilities(featureList)
                WearableDiagnostics.log("setDeviceTime: capabilities=\(self?.capabilities ?? [:])")
                continuation.resume()
            }, failed: {
                WearableDiagnostics.error("setDeviceTime: failed")
                continuation.resume(throwing: WearableSDKError.commandFailed("set device time"))
            })
        }
    }

    private static func parseCapabilities(_ featureList: [AnyHashable: Any]) -> [String: Bool] {
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
        case .bloodPressure: return "QCBandFeatureBloodPressure"
        case .spo2: return "QCBandFeatureBloodOxygen"
        case .bodyTemperature: return "QCBandFeatureTemperature"
        case .heartRate: return nil
        }
    }

    private func currentSport() async throws -> QCSportModel {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getCurrentSportSucess({ sport in
                continuation.resume(returning: sport)
            }, failed: {
                continuation.resume(throwing: WearableSDKError.commandFailed("current activity"))
            })
        }
    }

    private func scheduledHeartRate(dayIndexes: [Int]) async throws -> [QCSchedualHeartRateModel] {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getSchedualHeartRateData(withDayIndexs: dayIndexes.map { NSNumber(value: $0) }, success: { models in
                continuation.resume(returning: models)
            }, fail: {
                continuation.resume(throwing: WearableSDKError.commandFailed("heart rate history"))
            })
        }
    }

    private func bloodOxygen(dayIndex: Int) async throws -> [QCBloodOxygenModel] {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getBloodOxygenData(byDayIndex: dayIndex) { result, error in
                if let models = result as? [QCBloodOxygenModel] {
                    continuation.resume(returning: models)
                } else {
                    continuation.resume(throwing: error ?? WearableSDKError.commandFailed("SpO2 history"))
                }
            }
        }
    }

    private func scheduledTemperature(dayIndex: Int) async throws -> [QCTemperatureModel] {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getSchedualTemperatureData(byDayIndex: dayIndex) { result, error in
                if let models = result as? [QCTemperatureModel] {
                    continuation.resume(returning: models)
                } else {
                    continuation.resume(throwing: error ?? WearableSDKError.commandFailed("temperature history"))
                }
            }
        }
    }

    private func bloodPressureHistory() async throws -> [QCBloodPressureModel] {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.getSchedualBPHistoryData(success: { models in
                continuation.resume(returning: models)
            }, fail: {
                continuation.resume(throwing: WearableSDKError.commandFailed("blood pressure history"))
            })
        }
    }

    private func readBattery() async throws -> (percent: Int, charging: Bool) {
        try await withCheckedThrowingContinuation { continuation in
            QCSDKCmdCreator.readBatterySuccess({ battery, charging in
                continuation.resume(returning: (Int(battery), charging))
            }, failed: {
                continuation.resume(throwing: WearableSDKError.commandFailed("battery"))
            })
        }
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
                self.connectionStateContinuation?.yield(.unavailable)
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
            QCSDKManager.shareInstance().add(peripheral) { [weak self] success in
                Task { @MainActor in
                    guard let self else { return }
                    if success {
                        self.connectedPeripheral = peripheral
                        self.activeDeviceId = peripheral.identifier.uuidString
                        self.connectionStateContinuation?.yield(.connected)
                        WearableRuntimeDiagnostics.shared.recordPairingResult(success: true)
                        self.pairContinuation?.resume()
                    } else {
                        self.connectionStateContinuation?.yield(.error)
                        WearableRuntimeDiagnostics.shared.recordPairingResult(success: false, error: "QCSDKManager.add(peripheral:) reported failure")
                        self.pairContinuation?.resume(throwing: WearableSDKError.connectFailed)
                    }
                    self.pairContinuation = nil
                }
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            self.connectionStateContinuation?.yield(.error)
            WearableRuntimeDiagnostics.shared.recordPairingResult(success: false, error: String(describing: error))
            self.pairContinuation?.resume(throwing: error ?? WearableSDKError.connectFailed)
            self.pairContinuation = nil
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            QCSDKManager.shareInstance().remove(peripheral)
            guard self.connectedPeripheral?.identifier == peripheral.identifier else { return }
            self.connectedPeripheral = nil
            // The band itself is gone — no point continuing to send hold
            // commands into a dead connection; `WearableManager` clears
            // the stale live BPM value once it observes `.reconnecting`/
            // `.disconnected` via `connectionStateUpdates`.
            self.liveHeartRateTask?.cancel()
            self.liveHeartRateTask = nil
            // Best-effort automatic reconnect — mirrors the vendor demo's
            // own behavior for an unexpected drop (not a user-initiated
            // `unpairDevice`, which clears `connectedPeripheral` itself
            // before this delegate call would fire from a real teardown).
            if central.state == .poweredOn {
                self.connectionStateContinuation?.yield(.reconnecting)
                central.connect(peripheral, options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: true])
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
            self.connectedPeripheral = peripheral
            self.activeDeviceId = peripheral.identifier.uuidString
            peripheral.delegate = nil
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
