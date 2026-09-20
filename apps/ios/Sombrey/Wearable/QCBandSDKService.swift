import Foundation
import CoreBluetooth
import QCBandSDK

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
/// `Sendable`: `@unchecked` is a genuine third-party-SDK boundary, not a
/// convenience escape. `CBCentralManager`, `CBPeripheral`, and
/// `QCSDKManager` are System/vendor types the compiler cannot verify as
/// Sendable. Every stored property here is only ever read or mutated from
/// this type's own methods, which are all `@MainActor`-isolated by the
/// type-level annotation; `CBCentralManager` is constructed with
/// `queue: nil`, which per Apple's documentation delivers every delegate
/// callback on the main queue, so delegate methods (marked `nonisolated`
/// only because `CBCentralManagerDelegate` itself carries no actor
/// annotation) immediately re-enter `@MainActor` via `Task { @MainActor in }`
/// and never touch state from any other thread. `WearableManager`, the
/// sole caller, is itself `@MainActor`.
@MainActor
final class QCBandSDKService: NSObject, QCBandService, @unchecked Sendable {
    private var centralManager: CBCentralManager!
    private var discoveredPeripherals: [DeviceID: CBPeripheral] = [:]
    private var connectedPeripheral: CBPeripheral?
    /// Set once a device has been added to `QCSDKManager`; live callback
    /// data (steps/battery ticks) has no device id of its own, so this is
    /// what tags those events for `measurements(for:)`.
    private var activeDeviceId: DeviceID?

    private var scanContinuation: CheckedContinuation<[SombreyDevice], Never>?
    private var scanTimeoutTask: Task<Void, Never>?
    private var pairContinuation: CheckedContinuation<Void, Error>?

    private var measurementContinuation: AsyncStream<WearableMeasurement>.Continuation?

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
            throw WearableSDKError.bluetoothUnavailable
        }
        stopScanIfNeeded()
        discoveredPeripherals.removeAll()

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
        scanContinuation?.resume(returning: devices)
        scanContinuation = nil
    }

    func pairDevice(_ deviceId: DeviceID) async throws {
        guard let peripheral = discoveredPeripherals[deviceId] else {
            throw WearableSDKError.deviceNotFound
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pairContinuation = continuation
            centralManager.connect(
                peripheral,
                options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: true]
            )
        }
    }

    func unpairDevice(_ deviceId: DeviceID) async throws {
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
        try? await setDeviceTime()

        var synced = 0
        var anyFailed = false
        let now = Date()

        if let sport = try? await currentSport() {
            emit(deviceId: deviceId, type: .steps, value: Double(sport.totalStepCount), unit: "steps", at: now)
            emit(deviceId: deviceId, type: .activeCalories, value: sport.calories, unit: "kcal", at: now)
            emit(deviceId: deviceId, type: .distanceMeters, value: Double(sport.distance), unit: "m", at: now)
            synced += 3
        } else {
            anyFailed = true
        }

        if let heartRateDays = try? await scheduledHeartRate(dayIndexes: Array(0...6)) {
            for day in heartRateDays {
                synced += emitHeartRate(deviceId: deviceId, model: day)
            }
        } else {
            anyFailed = true
        }

        if let spo2 = try? await bloodOxygen(dayIndex: 0) {
            for reading in spo2 {
                emit(deviceId: deviceId, type: .spo2, value: Double(reading.soa2), unit: "%", at: reading.date)
                synced += 1
            }
        } else {
            anyFailed = true
        }

        if let temps = try? await scheduledTemperature(dayIndex: 0) {
            for reading in temps {
                emit(deviceId: deviceId, type: .skinTemperature, value: Double(reading.temperature), unit: "°C", at: reading.time)
                synced += 1
            }
        } else {
            anyFailed = true
        }

        if let bpHistory = try? await bloodPressureHistory() {
            for reading in bpHistory {
                emit(deviceId: deviceId, type: .bloodPressureSystolic, value: Double(reading.systolicPressure), unit: "mmHg", at: reading.date)
                emit(deviceId: deviceId, type: .bloodPressureDiastolic, value: Double(reading.diastolicPressure), unit: "mmHg", at: reading.date)
                synced += 2
            }
        } else {
            anyFailed = true
        }

        if let battery = try? await readBattery() {
            emit(deviceId: deviceId, type: .batteryPct, value: Double(battery.percent), unit: "%", at: now)
            synced += 1
        } else {
            anyFailed = true
        }

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
        manager.currentStepInfo = { [weak self] step, calorie, _ in
            Task { @MainActor in
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
                guard let self, let deviceId = self.activeDeviceId, hr > 0 else { return }
                self.emit(deviceId: deviceId, type: .heartRate, value: Double(hr), unit: "bpm", at: Date())
            }
        }
    }

    private func emit(deviceId: DeviceID, type: WearableMetricType, value: Double, unit: String, at date: Date) {
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

    private static func sleepSession(from stages: [QCSleepModel]) -> SleepSessionData? {
        let real = stages.filter { $0.type != .none && $0.type != .unweared }
        guard !real.isEmpty else { return nil }
        let mapped: [SleepStage] = real.compactMap { model in
            guard let stage = stage(for: model.type),
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

    private static func stage(for type: SLEEPTYPE) -> SleepStage.Stage? {
        switch type {
        case .light: return .light
        case .deep: return .deep
        case .rem: return .rem
        case .sober: return .awake
        case .none, .unweared: return nil
        @unknown default: return nil
        }
    }

    // MARK: - Command wrappers (each an independent BLE round trip)

    private func setDeviceTime() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            QCSDKCmdCreator.setTime(Date(), success: { _ in
                continuation.resume()
            }, failed: {
                continuation.resume(throwing: WearableSDKError.commandFailed("set device time"))
            })
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
            QCSDKCmdCreator.getSchedualBPHistoryData(withSuccess: { models in
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
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Task { @MainActor in
            if central.state != .poweredOn {
                self.stopScanIfNeeded()
                self.scanContinuation?.resume(returning: [])
                self.scanContinuation = nil
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        Task { @MainActor in
            guard let name = peripheral.name, !name.isEmpty else { return }
            self.discoveredPeripherals[peripheral.identifier.uuidString] = peripheral
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Task { @MainActor in
            QCSDKManager.shareInstance().addPeripheral(peripheral) { [weak self] success in
                Task { @MainActor in
                    guard let self else { return }
                    if success {
                        self.connectedPeripheral = peripheral
                        self.activeDeviceId = peripheral.identifier.uuidString
                        self.pairContinuation?.resume()
                    } else {
                        self.pairContinuation?.resume(throwing: WearableSDKError.connectFailed)
                    }
                    self.pairContinuation = nil
                }
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            self.pairContinuation?.resume(throwing: error ?? WearableSDKError.connectFailed)
            self.pairContinuation = nil
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            QCSDKManager.shareInstance().removePeripheral(peripheral)
            guard self.connectedPeripheral?.identifier == peripheral.identifier else { return }
            self.connectedPeripheral = nil
            // Best-effort automatic reconnect — mirrors the vendor demo's
            // own behavior for an unexpected drop (not a user-initiated
            // `unpairDevice`, which clears `connectedPeripheral` itself
            // before this delegate call would fire from a real teardown).
            if central.state == .poweredOn {
                central.connect(peripheral, options: [CBConnectPeripheralOptionNotifyOnDisconnectionKey: true])
            }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        Task { @MainActor in
            guard let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral],
                  let peripheral = peripherals.first else { return }
            self.connectedPeripheral = peripheral
            self.activeDeviceId = peripheral.identifier.uuidString
            peripheral.delegate = nil
        }
    }
}
