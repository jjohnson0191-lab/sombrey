import Foundation
import Observation

/// Developer-only runtime evidence recorder for the physical wearable
/// pipeline — distinct from `WearableDiagnostics` (which only mirrors
/// text to Console.app, invisible without a Mac). This keeps the same
/// evidence *in memory*, observable, so `WearableDiagnosticsView` can
/// render it directly on the device and a report can be copied out.
///
/// A single `@MainActor` singleton (matching `ConvexClientProvider`'s
/// own pattern) rather than being owned by `WearableManager`: it must be
/// reachable from `QCBandSDKService` and `MetricHistoryChart` too, and
/// none of those hold a reference to each other. Every method here only
/// ever *records* what already happened — nothing here changes SDK
/// command behavior, connection handling, or validation. It is pure
/// observation, added specifically so the next physical-device test
/// produces evidence instead of another guess.
@Observable
@MainActor
final class WearableRuntimeDiagnostics {
    static let shared = WearableRuntimeDiagnostics()
    private init() {}

    // MARK: - Event log (the primary evidence trail)

    struct Event: Identifiable {
        let id = UUID()
        let at: Date
        let message: String
    }
    private(set) var events: [Event] = []
    private static let maxEvents = 300

    /// Every other `record...` method below funnels through this, so
    /// the event log alone is a complete, timestamped narrative of the
    /// session — also mirrored to Console.app via `WearableDiagnostics`
    /// for when a Mac is available.
    private func log(_ message: String) {
        events.append(Event(at: Date(), message: message))
        if events.count > Self.maxEvents {
            events.removeFirst(events.count - Self.maxEvents)
        }
        WearableDiagnostics.log(message)
    }

    // MARK: - Connection

    private(set) var lastConnectedAt: Date?
    private(set) var lastDisconnectedAt: Date?
    private(set) var reconnectAttemptCount = 0
    private(set) var reconnectSuccessCount = 0
    private(set) var reconnectFailureCount = 0
    private(set) var lastSuccessfulConnectionAt: Date?
    private(set) var currentDeviceId: String?
    private(set) var currentDeviceName: String?

    func recordConnectionState(_ state: WearableConnectionState, deviceId: String?) {
        currentDeviceId = deviceId
        switch state {
        case .connected:
            lastConnectedAt = Date()
            lastSuccessfulConnectionAt = lastConnectedAt
        case .disconnected, .error, .unavailable:
            lastDisconnectedAt = Date()
        default:
            break
        }
        log("connection: \(state.rawValue) device=\(deviceId ?? "none")")
    }

    func recordReconnectAttempt() {
        reconnectAttemptCount += 1
        log("reconnect: attempt #\(reconnectAttemptCount)")
    }

    func recordReconnectResult(success: Bool, error: String? = nil) {
        if success {
            reconnectSuccessCount += 1
        } else {
            reconnectFailureCount += 1
        }
        log("reconnect: \(success ? "succeeded" : "failed") \(error.map { "(\($0))" } ?? "")")
    }

    // MARK: - Bluetooth authorization / power state

    private(set) var bluetoothAuthorization: String = "unknown"
    private(set) var bluetoothPoweredOn: Bool?

    /// `state` is CoreBluetooth's own `CBManagerState.rawValue` description
    /// (e.g. "poweredOn", "unauthorized") — never inferred, always exactly
    /// what `centralManagerDidUpdateState` reported.
    func recordBluetoothState(_ state: String, poweredOn: Bool) {
        bluetoothAuthorization = state
        bluetoothPoweredOn = poweredOn
        log("bluetooth: state=\(state) poweredOn=\(poweredOn)")
    }

    // MARK: - Discovery (BLE scan)

    struct DiscoveredDeviceInfo: Identifiable {
        let id: String
        let name: String
        let rssi: Int?
        let passedFilter: Bool
        let filterReason: String?
        let firstSeenAt: Date
        var lastSeenAt: Date
    }
    private(set) var discoveryStartedAt: Date?
    private(set) var discoveryStoppedAt: Date?
    private(set) var discoveryDuration: TimeInterval?
    private(set) var discoveredDeviceLog: [DiscoveredDeviceInfo] = []
    private(set) var sdkDiscoveryDeviceCount = 0

    func recordDiscoveryStarted() {
        discoveryStartedAt = Date()
        discoveryStoppedAt = nil
        discoveredDeviceLog.removeAll()
        log("discovery: started")
    }

    func recordDiscoveryStopped(deviceCount: Int) {
        discoveryStoppedAt = Date()
        discoveryDuration = discoveryStartedAt.map { discoveryStoppedAt!.timeIntervalSince($0) }
        sdkDiscoveryDeviceCount = deviceCount
        log("discovery: stopped duration=\(discoveryDuration.map { String(format: "%.1fs", $0) } ?? "?") devices=\(deviceCount)")
    }

    /// Records every raw `centralManager(_:didDiscover:...)` callback,
    /// even ones Sombrey's own filter (currently: `peripheral.name` must
    /// be non-nil and non-empty — no service-UUID or name-content filter
    /// exists) rejects — so "CoreBluetooth never saw the band at all"
    /// can be told apart from "it was seen and filtered out."
    func recordDiscoveredPeripheral(id: String, name: String?, rssi: Int?, passedFilter: Bool, filterReason: String?) {
        let now = Date()
        if let idx = discoveredDeviceLog.firstIndex(where: { $0.id == id }) {
            discoveredDeviceLog[idx].lastSeenAt = now
        } else {
            discoveredDeviceLog.append(DiscoveredDeviceInfo(id: id, name: name ?? "(no name)", rssi: rssi, passedFilter: passedFilter, filterReason: filterReason, firstSeenAt: now, lastSeenAt: now))
            log("discovery: peripheral id=\(id) name=\(name ?? "nil") rssi=\(rssi.map(String.init) ?? "?") passedFilter=\(passedFilter) \(filterReason.map { "reason=\($0)" } ?? "")")
        }
    }

    // MARK: - Pairing

    private(set) var pairingAttemptStartedAt: Date?
    private(set) var pairingSelectedDeviceId: String?
    private(set) var pairingResult: String?
    private(set) var pairingErrorDetail: String?

    func recordPairingAttempt(deviceId: String) {
        pairingAttemptStartedAt = Date()
        pairingSelectedDeviceId = deviceId
        pairingResult = nil
        pairingErrorDetail = nil
        log("pairing: attempt started for \(deviceId)")
    }

    func recordPairingResult(success: Bool, error: String? = nil) {
        pairingResult = success ? "success" : "failed"
        pairingErrorDetail = error
        log("pairing: \(success ? "succeeded" : "failed") \(error.map { "(\($0))" } ?? "")")
    }

    func recordDeviceName(_ name: String?) {
        currentDeviceName = name
    }

    // MARK: - Sync

    private(set) var syncStartedAt: Date?
    private(set) var syncCompletedAt: Date?
    private(set) var lastSyncDuration: TimeInterval?
    private(set) var lastSyncError: String?
    private(set) var lastSuccessfulSyncAt: Date?
    private(set) var lastFailedSyncAt: Date?
    private(set) var successfulSyncCount = 0
    private(set) var failedSyncCount = 0
    private(set) var lastSyncMetricTypes: [String] = []

    func recordSyncStarted() {
        syncStartedAt = Date()
        log("sync: started")
    }

    func recordSyncCompleted(success: Bool, metricTypes: [String], error: String? = nil) {
        let completedAt = Date()
        syncCompletedAt = completedAt
        lastSyncDuration = syncStartedAt.map { completedAt.timeIntervalSince($0) }
        lastSyncMetricTypes = metricTypes
        if success {
            successfulSyncCount += 1
            lastSuccessfulSyncAt = completedAt
        } else {
            failedSyncCount += 1
            lastFailedSyncAt = completedAt
            lastSyncError = error
        }
        log("sync: \(success ? "completed" : "failed") duration=\(lastSyncDuration.map { String(format: "%.1fs", $0) } ?? "?") metrics=\(metricTypes) \(error.map { "error=\($0)" } ?? "")")
    }

    // MARK: - Live heart rate command lifecycle

    private(set) var hrStartSentAt: Date?
    private(set) var hrLastHoldSentAt: Date?
    private(set) var hrHoldCount = 0
    private(set) var hrStopSentAt: Date?
    private(set) var hrCallbackCount = 0
    private(set) var hrLastCallbackAt: Date?
    private(set) var hrLastRawCallbackValue: Int?

    /// Whether Sombrey currently believes the real-time HR stream is
    /// active — a Start with no Stop since. This reflects Sombrey's own
    /// command state, NOT whether the band is actually still streaming;
    /// compare against `hrLastCallbackAt` to tell the two apart.
    var hrStreamActive: Bool {
        guard let start = hrStartSentAt else { return false }
        guard let stop = hrStopSentAt else { return true }
        return start > stop
    }

    func recordHRStartCommand() {
        hrStartSentAt = Date()
        log("liveHR: Start command sent")
    }

    func recordHRHoldCommand() {
        hrLastHoldSentAt = Date()
        hrHoldCount += 1
        log("liveHR: Hold command sent (#\(hrHoldCount))")
    }

    func recordHRStopCommand() {
        hrStopSentAt = Date()
        log("liveHR: Stop command sent")
    }

    func recordHRCallback(raw: Int) {
        hrCallbackCount += 1
        hrLastCallbackAt = Date()
        hrLastRawCallbackValue = raw
        log("liveHR: callback fired raw=\(raw) (#\(hrCallbackCount) this session)")
    }

    // MARK: - Generic per-metric accept/reject (fed from QCBandSDKService.emit)

    struct MetricState {
        var lastRawValue: Double?
        var lastRawAt: Date?
        var lastAcceptedValue: Double?
        var lastAcceptedAt: Date?
        var lastRejectionReason: String?
        var lastRejectionAt: Date?
        var acceptedCount = 0
        var rejectedCount = 0
    }
    private(set) var metricStates: [WearableMetricType: MetricState] = [:]

    func recordMetricEmit(type: WearableMetricType, value: Double, accepted: Bool) {
        var state = metricStates[type] ?? MetricState()
        state.lastRawValue = value
        state.lastRawAt = Date()
        if accepted {
            state.lastAcceptedValue = value
            state.lastAcceptedAt = Date()
            state.acceptedCount += 1
        } else {
            state.lastRejectionReason = "not physically plausible (value=\(value))"
            state.lastRejectionAt = Date()
            state.rejectedCount += 1
        }
        metricStates[type] = state
        // Not separately logged to the event stream — `emit()` and the
        // callers that feed it already log raw values at the point of
        // origin (currentStepInfo, realTimeHeartRate, sync's sport read);
        // this only needs to update the queryable "latest" state.
    }

    // MARK: - Active calories / steps / distance (raw, before validation)

    private(set) var lastRawCalories: Double?
    private(set) var lastRawSteps: Int?
    private(set) var lastRawDistance: Int?
    private(set) var lastRawHappenDate: String?
    private(set) var lastRawSportResponseAt: Date?

    func recordRawSportResponse(calories: Double, steps: Int, distance: Int, happenDate: String) {
        lastRawCalories = calories
        lastRawSteps = steps
        lastRawDistance = distance
        lastRawHappenDate = happenDate
        lastRawSportResponseAt = Date()
        log("sport: raw calories(cal)=\(calories) steps=\(steps) distance=\(distance) happenDate=\(happenDate)")
    }

    // MARK: - Blood pressure (and other on-demand metrics) command lifecycle

    enum CapabilityStatus: String { case unknown, supported, unsupported }

    private(set) var bpCapability: CapabilityStatus = .unknown
    private(set) var bpCommandSentAt: Date?
    private(set) var bpCallbackAt: Date?
    private(set) var bpRawResultType: String?
    private(set) var bpRawResultDescription: String?
    private(set) var bpParsedSystolic: Int?
    private(set) var bpParsedDiastolic: Int?
    private(set) var bpValidationResult: String?
    private(set) var bpFailureReason: String?

    func recordBPCapability(_ status: CapabilityStatus) {
        bpCapability = status
        log("bp: capability=\(status.rawValue)")
    }

    func recordBPCommandSent() {
        bpCommandSentAt = Date()
        bpCallbackAt = nil
        bpRawResultType = nil
        bpRawResultDescription = nil
        bpParsedSystolic = nil
        bpParsedDiastolic = nil
        bpValidationResult = nil
        bpFailureReason = nil
        bpBandPush = nil
        bpCompletion = nil
        log("bp: command sent")
    }

    func recordBPCallback(isSuccess: Bool, rawType: String, rawDescription: String, error: String?) {
        bpCallbackAt = Date()
        bpRawResultType = rawType
        bpRawResultDescription = rawDescription
        log("bp: callback isSuccess=\(isSuccess) rawType=\(rawType) error=\(error ?? "nil")")
    }

    func recordBPParsed(systolic: Int?, diastolic: Int?) {
        bpParsedSystolic = systolic
        bpParsedDiastolic = diastolic
        log("bp: parsed systolic=\(systolic.map(String.init) ?? "nil") diastolic=\(diastolic.map(String.init) ?? "nil")")
    }

    func recordBPValidation(passed: Bool, reason: String) {
        bpValidationResult = passed ? "passed" : "failed: \(reason)"
        if !passed { bpFailureReason = reason }
        log("bp: validation \(bpValidationResult ?? "")")
    }

    /// The band's own real-time BP push (`measuringHandle`) — the only
    /// genuine on-demand BP reading the SDK delivers.
    private(set) var bpBandPush: String?
    /// How the SDK's measurement window ended: its NSError code (-1 start
    /// command failed, -2 end command failed, -3 band not worn properly,
    /// -4 uncalibrated) and whether a band push arrived first.
    private(set) var bpCompletion: String?

    func recordBPBandPush(systolic: Int, diastolic: Int) {
        bpBandPush = "\(systolic)/\(diastolic) at \(Date())"
        log("BP: band pushed \(systolic)/\(diastolic)")
    }

    func recordBPCompletion(sdkErrorCode: Int?, bandPushReceived: Bool) {
        bpCompletion = "sdkErrorCode=\(sdkErrorCode.map(String.init) ?? "none") bandPushReceived=\(bandPushReceived)"
        log("BP: SDK window ended \(bpCompletion ?? "")")
    }

    // MARK: - Sport+ band-record import (evidence for physical-band validation)

    /// Every data-update report the band has sent this session, by type —
    /// shows whether the band emits the Sport+ record report (type 7).
    private(set) var dataUpdateReports: [Int: Int] = [:]
    private(set) var lastSportFetchAt: Date?
    private(set) var lastSportFetchSince: Double?
    /// The raw records from the latest fetch, exactly as the SDK returned
    /// them (start time and duration untouched).
    private(set) var lastSportRecords: [BandSportRecord] = []
    private(set) var lastSportImportSummary: String?

    func recordDataUpdateReport(type: Int, value: Int) {
        dataUpdateReports[type, default: 0] += 1
        log("dataUpdateReport: type=\(type) value=\(value)")
    }

    func recordSportRecordsFetched(since: Double, records: [BandSportRecord]) {
        lastSportFetchAt = Date()
        lastSportFetchSince = since
        lastSportRecords = records
        for r in records {
            log("sport+ record: type=\(r.sportType) source=\(r.sourceType) rawStart=\(r.rawStartTime) rawDuration=\(r.rawDuration) hr=\(r.lowestHeartRate)/\(r.averageHeartRate)/\(r.highestHeartRate) kcal=\(r.calories) dist=\(r.distanceMeters) steps=\(r.steps) hrSeries=\(r.heartRates.count) speedSeries=\(r.speeds.count) gps=\(r.route.count)")
        }
    }

    func recordSportImport(_ summary: String) {
        lastSportImportSummary = summary
        log("sport+ import: \(summary)")
    }

    func recordBPFailure(_ reason: String) {
        bpFailureReason = reason
        log("bp: failed — \(reason)")
    }

    // MARK: - Convex persistence

    private(set) var lastSuccessfulUploadAt: Date?
    private(set) var lastFailedUploadAt: Date?
    private(set) var lastUploadError: String?
    private(set) var measurementsQueuedCount = 0
    private(set) var measurementsPersistedCount = 0
    private(set) var measurementsRejectedCount = 0

    func recordMeasurementsQueued(_ count: Int) {
        measurementsQueuedCount += count
    }

    func recordMeasurementsRejectedClientSide(_ count: Int) {
        guard count > 0 else { return }
        measurementsRejectedCount += count
        log("convex: \(count) reading(s) rejected client-side before upload (failed validity)")
    }

    func recordUploadResult(success: Bool, count: Int, error: String? = nil) {
        if success {
            lastSuccessfulUploadAt = Date()
            measurementsPersistedCount += count
            log("convex: uploaded \(count) measurement(s)")
        } else {
            lastFailedUploadAt = Date()
            lastUploadError = error
            log("convex: upload FAILED for \(count) measurement(s) — \(error ?? "unknown error")")
        }
    }

    // MARK: - UI query (MetricHistoryChart -> wearable:getMeasurementsByRange)

    private(set) var lastQueryMetricType: String?
    private(set) var lastQueryRangeDays: Double?
    private(set) var lastQueryRecordCount: Int?
    private(set) var lastQueryAt: Date?
    private(set) var lastQueryError: String?

    func recordQuery(metricType: String, rangeDays: Double) {
        lastQueryMetricType = metricType
        lastQueryRangeDays = rangeDays
        log("query: \(metricType) range=\(rangeDays)d subscribing")
    }

    func recordQueryResult(metricType: String, recordCount: Int?, error: String?) {
        lastQueryMetricType = metricType
        lastQueryRecordCount = recordCount
        lastQueryAt = Date()
        lastQueryError = error
        log("query: \(metricType) resolved records=\(recordCount.map(String.init) ?? "nil") error=\(error ?? "nil")")
    }

    // MARK: - Copyable plain-text report

    /// Everything above, formatted as plain text for sharing — never
    /// includes tokens/keys/credentials, only metric values, counts,
    /// and timestamps already visible elsewhere in the app.
    func generateReport() -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm:ss"
        func fmt(_ date: Date?) -> String { date.map(df.string(from:)) ?? "never" }

        var lines: [String] = []
        lines.append("SOMBREY WEARABLE DIAGNOSTIC REPORT")
        lines.append("Generated: \(df.string(from: Date()))")
        lines.append("")
        lines.append("DEVICE")
        lines.append("  deviceId: \(currentDeviceId ?? "none")")
        lines.append("  deviceName: \(currentDeviceName ?? "unknown")")
        lines.append("  lastConnectedAt: \(fmt(lastConnectedAt))")
        lines.append("  lastDisconnectedAt: \(fmt(lastDisconnectedAt))")
        lines.append("  lastSuccessfulConnectionAt: \(fmt(lastSuccessfulConnectionAt))")
        lines.append("  reconnectAttempts: \(reconnectAttemptCount) (success=\(reconnectSuccessCount) failure=\(reconnectFailureCount))")
        lines.append("")
        lines.append("BLUETOOTH")
        lines.append("  authorization/state: \(bluetoothAuthorization)")
        lines.append("  poweredOn: \(bluetoothPoweredOn.map(String.init) ?? "unknown")")
        lines.append("")
        lines.append("DISCOVERY")
        lines.append("  started: \(fmt(discoveryStartedAt))  stopped: \(fmt(discoveryStoppedAt))")
        lines.append("  duration: \(discoveryDuration.map { String(format: "%.1fs", $0) } ?? "—")")
        lines.append("  sdkDeviceCount (raw CoreBluetooth callbacks): \(sdkDiscoveryDeviceCount)")
        lines.append("  filtering criteria: peripheral.name must be non-nil and non-empty (no service-UUID or name-content filter)")
        if discoveredDeviceLog.isEmpty {
            lines.append("  no peripherals seen this session")
        } else {
            for d in discoveredDeviceLog {
                lines.append("  - id=\(d.id) name=\(d.name) rssi=\(d.rssi.map(String.init) ?? "?") passedFilter=\(d.passedFilter) \(d.filterReason.map { "reason=\($0)" } ?? "") firstSeen=\(fmt(d.firstSeenAt)) lastSeen=\(fmt(d.lastSeenAt))")
            }
        }
        lines.append("")
        lines.append("PAIRING")
        lines.append("  attemptStartedAt: \(fmt(pairingAttemptStartedAt))")
        lines.append("  selectedDeviceId: \(pairingSelectedDeviceId ?? "none")")
        lines.append("  result: \(pairingResult ?? "none this session")")
        lines.append("  errorDetail: \(pairingErrorDetail ?? "none")")
        lines.append("")
        lines.append("SYNC")
        lines.append("  lastSuccessfulSyncAt: \(fmt(lastSuccessfulSyncAt))")
        lines.append("  lastFailedSyncAt: \(fmt(lastFailedSyncAt))")
        lines.append("  successCount: \(successfulSyncCount)  failureCount: \(failedSyncCount)")
        lines.append("  lastSyncDuration: \(lastSyncDuration.map { String(format: "%.1fs", $0) } ?? "—")")
        lines.append("  lastSyncMetricTypes: \(lastSyncMetricTypes)")
        lines.append("  lastSyncError: \(lastSyncError ?? "none")")
        lines.append("")
        lines.append("LIVE HEART RATE")
        lines.append("  streamActive (Sombrey's belief): \(hrStreamActive)")
        lines.append("  startSentAt: \(fmt(hrStartSentAt))")
        lines.append("  lastHoldSentAt: \(fmt(hrLastHoldSentAt))  holdCount: \(hrHoldCount)")
        lines.append("  stopSentAt: \(fmt(hrStopSentAt))")
        lines.append("  callbackCount: \(hrCallbackCount)  lastCallbackAt: \(fmt(hrLastCallbackAt))  lastRawValue: \(hrLastRawCallbackValue.map(String.init) ?? "none")")
        if let hrState = metricStates[.heartRate] {
            lines.append("  lastAccepted: \(hrState.lastAcceptedValue.map { "\(Int($0))" } ?? "none") at \(fmt(hrState.lastAcceptedAt))")
            lines.append("  accepted/rejected counts: \(hrState.acceptedCount)/\(hrState.rejectedCount)")
        }
        lines.append("")
        lines.append("ACTIVE CALORIES / STEPS / DISTANCE")
        lines.append("  rawSportResponseAt: \(fmt(lastRawSportResponseAt))")
        lines.append("  rawCalories (cal): \(lastRawCalories.map { "\($0)" } ?? "none")  rawHappenDate: \(lastRawHappenDate ?? "none")")
        lines.append("  rawSteps: \(lastRawSteps.map(String.init) ?? "none")  rawDistance: \(lastRawDistance.map(String.init) ?? "none")")
        if let calState = metricStates[.activeCalories] {
            lines.append("  calories accepted/rejected: \(calState.acceptedCount)/\(calState.rejectedCount)  lastAccepted: \(calState.lastAcceptedValue.map { "\($0)" } ?? "none") at \(fmt(calState.lastAcceptedAt))")
            lines.append("  lastRejectionReason: \(calState.lastRejectionReason ?? "none")")
        }
        lines.append("")
        lines.append("SPORT+ IMPORT")
        lines.append("  dataUpdateReports: \(dataUpdateReports.sorted { $0.key < $1.key }.map { "\($0.key)×\($0.value)" }.joined(separator: " "))")
        lines.append("  lastFetch: \(fmt(lastSportFetchAt)) sinceBandTs=\(lastSportFetchSince.map { "\($0)" } ?? "none") records=\(lastSportRecords.count)")
        lines.append("  lastImport: \(lastSportImportSummary ?? "none")")
        for r in lastSportRecords.prefix(10) {
            lines.append("  • type=\(r.sportType) src=\(r.sourceType) rawStart=\(r.rawStartTime) (as UTC: \(Date(timeIntervalSince1970: r.rawStartTime))) rawDuration=\(r.rawDuration) hr=\(r.lowestHeartRate)/\(r.averageHeartRate)/\(r.highestHeartRate) kcal=\(r.calories) dist=\(r.distanceMeters) steps=\(r.steps)")
        }
        lines.append("")
        lines.append("BLOOD PRESSURE")
        lines.append("  capability: \(bpCapability.rawValue)")
        lines.append("  commandSentAt: \(fmt(bpCommandSentAt))")
        lines.append("  callbackAt: \(fmt(bpCallbackAt))")
        lines.append("  bandPush: \(bpBandPush ?? "none")")
        lines.append("  sdkWindowEnd: \(bpCompletion ?? "none")")
        lines.append("  rawResultType: \(bpRawResultType ?? "none")")
        lines.append("  rawResultDescription: \(bpRawResultDescription ?? "none")")
        lines.append("  parsedSystolic: \(bpParsedSystolic.map(String.init) ?? "none")  parsedDiastolic: \(bpParsedDiastolic.map(String.init) ?? "none")")
        lines.append("  validationResult: \(bpValidationResult ?? "none")")
        lines.append("  failureReason: \(bpFailureReason ?? "none")")
        lines.append("")
        lines.append("SPO2")
        if let spo2 = metricStates[.spo2] {
            lines.append("  lastRaw: \(spo2.lastRawValue.map { "\($0)" } ?? "none") at \(fmt(spo2.lastRawAt))")
            lines.append("  lastAccepted: \(spo2.lastAcceptedValue.map { "\($0)" } ?? "none") at \(fmt(spo2.lastAcceptedAt))")
            lines.append("  accepted/rejected: \(spo2.acceptedCount)/\(spo2.rejectedCount)")
        } else {
            lines.append("  no data this session")
        }
        lines.append("")
        lines.append("TEMPERATURE")
        if let temp = metricStates[.skinTemperature] {
            lines.append("  lastRaw: \(temp.lastRawValue.map { "\($0)" } ?? "none") at \(fmt(temp.lastRawAt))")
            lines.append("  lastAccepted: \(temp.lastAcceptedValue.map { "\($0)" } ?? "none") at \(fmt(temp.lastAcceptedAt))")
            lines.append("  accepted/rejected: \(temp.acceptedCount)/\(temp.rejectedCount)")
        } else {
            lines.append("  no data this session")
        }
        lines.append("")
        lines.append("CONVEX")
        lines.append("  lastSuccessfulUploadAt: \(fmt(lastSuccessfulUploadAt))")
        lines.append("  lastFailedUploadAt: \(fmt(lastFailedUploadAt))  lastUploadError: \(lastUploadError ?? "none")")
        lines.append("  queued=\(measurementsQueuedCount) persisted=\(measurementsPersistedCount) clientRejected=\(measurementsRejectedCount)")
        lines.append("  lastQuery: \(lastQueryMetricType ?? "none") range=\(lastQueryRangeDays.map { "\($0)d" } ?? "—") records=\(lastQueryRecordCount.map(String.init) ?? "—") at \(fmt(lastQueryAt))")
        lines.append("  lastQueryError: \(lastQueryError ?? "none")")
        lines.append("")
        lines.append("RECENT EVENTS (most recent last, up to \(Self.maxEvents))")
        for event in events {
            lines.append("  [\(df.string(from: event.at))] \(event.message)")
        }
        return lines.joined(separator: "\n")
    }
}
