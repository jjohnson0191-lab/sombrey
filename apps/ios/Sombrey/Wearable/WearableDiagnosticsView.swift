import SwiftUI
import UIKit

/// Developer-only diagnostic panel for the wearable pipeline — reached
/// via a long-press on Home's Sombrey Band card, never a visible button,
/// so a normal user won't stumble into it. Combines two sources, both
/// direct, unmodified reads of real state (never a separate "diagnostics"
/// data path that could disagree with what the rest of the app sees):
/// `WearableManager`'s current published state, and `WearableRuntimeDiagnostics`'
/// command/callback-level event history — added after a physical-device
/// regression where live HR, BP, calories, and historical graphs all
/// stopped working at once, specifically so the next physical test
/// produces evidence instead of another guess. "Copy Report" exports
/// everything below as plain text (no tokens/keys/credentials — only
/// metric values, counts, and timestamps already visible elsewhere in
/// the app) for sharing without needing Console.app.
struct WearableDiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(WearableManager.self) private var wearableManager
    private var runtime: WearableRuntimeDiagnostics { WearableRuntimeDiagnostics.shared }
    @State private var didCopy = false

    var body: some View {
        NavigationStack {
            List {
                Section("Bluetooth") {
                    diagnosticRow("Authorization / state", runtime.bluetoothAuthorization)
                    diagnosticRow("Powered on", runtime.bluetoothPoweredOn.map(String.init) ?? "unknown")
                }
                Section("Discovery (BLE scan)") {
                    diagnosticRow("Started / stopped", "\(runtime.discoveryStartedAt.map(Self.timeString) ?? "never") / \(runtime.discoveryStoppedAt.map(Self.timeString) ?? "never")")
                    diagnosticRow("Duration", runtime.discoveryDuration.map { String(format: "%.1fs", $0) } ?? "—")
                    diagnosticRow("Devices matching filter", "\(runtime.sdkDiscoveryDeviceCount)")
                    diagnosticRow("Filter criteria", "peripheral.name non-nil and non-empty")
                    if runtime.discoveredDeviceLog.isEmpty {
                        Text("No peripherals seen this session (CoreBluetooth callback never fired, or no scan has run yet).")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(runtime.discoveredDeviceLog) { device in
                            deviceRow(device)
                        }
                    }
                }
                Section("Pairing") {
                    diagnosticRow("Attempt started", runtime.pairingAttemptStartedAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Selected device", runtime.pairingSelectedDeviceId ?? "none")
                    diagnosticRow("Result", runtime.pairingResult ?? "none this session")
                    diagnosticRow("Error detail", runtime.pairingErrorDetail ?? "none")
                }
                Section("Connection") {
                    diagnosticRow("Paired device", wearableManager.pairedDevice != nil ? wearableManager.pairedDevice!.id : "none")
                    diagnosticRow("Device name", runtime.currentDeviceName ?? "unknown")
                    diagnosticRow("Connection state", "\(wearableManager.displayState)")
                    diagnosticRow("Battery received", wearableManager.status?.batteryPct.map { "\(Int($0.rounded()))%" } ?? "not yet")
                    diagnosticRow("Last seen", wearableManager.status?.lastSeenAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last connected at", runtime.lastConnectedAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last disconnected at", runtime.lastDisconnectedAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last successful connection", runtime.lastSuccessfulConnectionAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Reconnect attempts", "\(runtime.reconnectAttemptCount) (success \(runtime.reconnectSuccessCount) / failure \(runtime.reconnectFailureCount))")
                    if wearableManager.pairedDevice != nil {
                        Text("Sombrey believes a device IS paired (pairedDeviceID set). If you're seeing the scan/pairing screen instead of a reconnect option, that's a UI-state mismatch worth reporting.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                Section("Band capabilities (from setTime:)") {
                    if wearableManager.bandCapabilities.isEmpty {
                        Text("No successful sync yet — capabilities unknown.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(wearableManager.bandCapabilities.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                            diagnosticRow(key, value ? "supported" : "NOT supported")
                        }
                    }
                }
                Section("Sync") {
                    diagnosticRow("Last successful sync", runtime.lastSuccessfulSyncAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last failed sync", runtime.lastFailedSyncAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Success / failure counts", "\(runtime.successfulSyncCount) / \(runtime.failedSyncCount)")
                    diagnosticRow("Last sync duration", runtime.lastSyncDuration.map { String(format: "%.1fs", $0) } ?? "—")
                    diagnosticRow("Last sync metric types", runtime.lastSyncMetricTypes.isEmpty ? "none" : runtime.lastSyncMetricTypes.joined(separator: ", "))
                    diagnosticRow("Last sync error", runtime.lastSyncError ?? "none")
                }
                Section("Live heart rate") {
                    diagnosticRow("Stream active (Sombrey's belief)", runtime.hrStreamActive ? "yes" : "no")
                    diagnosticRow("Start command sent", runtime.hrStartSentAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last Hold sent", "\(runtime.hrLastHoldSentAt.map(Self.timeString) ?? "never") (count: \(runtime.hrHoldCount))")
                    diagnosticRow("Stop command sent", runtime.hrStopSentAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Callbacks received", "\(runtime.hrCallbackCount)")
                    diagnosticRow("Last callback", "\(runtime.hrLastCallbackAt.map(Self.timeString) ?? "never") raw=\(runtime.hrLastRawCallbackValue.map(String.init) ?? "—")")
                    diagnosticRow("Last accepted BPM", wearableManager.latestMeasurements[.heartRate].map { "\(Int($0.value.rounded()))" } ?? "none this session")
                    diagnosticRow("Last accepted timestamp", wearableManager.latestMeasurements[.heartRate].map { Self.timeString($0.recordedAt) } ?? "—")
                }
                Section("Blood pressure") {
                    diagnosticRow("Capability", runtime.bpCapability.rawValue)
                    diagnosticRow("Measurement in progress", wearableManager.activeOnDemandMeasurement == .bloodPressure ? "yes" : "no")
                    diagnosticRow("Command sent", runtime.bpCommandSentAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Callback received", runtime.bpCallbackAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Raw result type", runtime.bpRawResultType ?? "—")
                    diagnosticRow("Parsed systolic/diastolic", "\(runtime.bpParsedSystolic.map(String.init) ?? "—") / \(runtime.bpParsedDiastolic.map(String.init) ?? "—")")
                    diagnosticRow("Validation result", runtime.bpValidationResult ?? "—")
                    diagnosticRow("Failure reason", runtime.bpFailureReason ?? "none")
                    if let systolic = wearableManager.latestMeasurements[.bloodPressureSystolic],
                       let diastolic = wearableManager.latestMeasurements[.bloodPressureDiastolic] {
                        diagnosticRow("Last accepted result", "\(Int(systolic.value.rounded()))/\(Int(diastolic.value.rounded())) mmHg at \(Self.timeString(systolic.recordedAt))")
                    } else {
                        diagnosticRow("Last accepted result", "none this session")
                    }
                }
                Section("Active calories / Steps / Distance (raw, pre-validation)") {
                    diagnosticRow("Raw sport response at", runtime.lastRawSportResponseAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Raw calories (band, cal)", runtime.lastRawCalories.map { "\($0)" } ?? "none")
                    diagnosticRow("Raw happenDate", runtime.lastRawHappenDate ?? "none")
                    diagnosticRow("Raw steps / distance", "\(runtime.lastRawSteps.map(String.init) ?? "—") / \(runtime.lastRawDistance.map(String.init) ?? "—")")
                    diagnosticRow("Accepted calories", wearableManager.latestMeasurements[.activeCalories].map { "\(String(format: "%.3f", $0.value)) kcal (\($0.sdkSource ?? "?"))" } ?? "none")
                    diagnosticRow("Calories counted as today?", wearableManager.latestMeasurementForToday(.activeCalories) != nil ? "yes" : "no")
                    diagnosticRow("Accepted steps", wearableManager.latestMeasurements[.steps].map { "\(Int($0.value.rounded()))" } ?? "none")
                }
                Section("Temperature / SpO2") {
                    diagnosticRow("Last temperature (raw / accepted)", "\(wearableManager.latestMeasurements[.skinTemperature].map { String(format: "%.1f°C", $0.value) } ?? "none")")
                    diagnosticRow("Temperature timestamp", wearableManager.latestMeasurements[.skinTemperature].map { Self.timeString($0.recordedAt) } ?? "—")
                    diagnosticRow("Last SpO2 (raw / accepted)", "\(wearableManager.latestMeasurements[.spo2].map { "\(Int($0.value.rounded()))%" } ?? "none")")
                    diagnosticRow("SpO2 timestamp", wearableManager.latestMeasurements[.spo2].map { Self.timeString($0.recordedAt) } ?? "—")
                }
                Section("Convex") {
                    diagnosticRow("Last successful upload", runtime.lastSuccessfulUploadAt.map(Self.timeString) ?? "never this session")
                    diagnosticRow("Last failed upload", "\(runtime.lastFailedUploadAt.map(Self.timeString) ?? "never") \(runtime.lastUploadError.map { "(\($0))" } ?? "")")
                    diagnosticRow("Queued / persisted / client-rejected", "\(runtime.measurementsQueuedCount) / \(runtime.measurementsPersistedCount) / \(runtime.measurementsRejectedCount)")
                    diagnosticRow("Last query", "\(runtime.lastQueryMetricType ?? "none") · \(runtime.lastQueryRecordCount.map(String.init) ?? "—") record(s)")
                    diagnosticRow("Last query error", runtime.lastQueryError ?? "none")
                }
                Section("Last error") {
                    Text(wearableManager.lastError ?? "none")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(wearableManager.lastError == nil ? Color.secondary : Color.red)
                }
                Section {
                    Button {
                        UIPasteboard.general.string = runtime.generateReport()
                        didCopy = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            didCopy = false
                        }
                    } label: {
                        Text(didCopy ? "Copied ✓" : "Copy Full Diagnostic Report")
                    }
                }
                Section {
                    Text("Full command/callback-level logs are also written to Console.app (subsystem \"com.sombrey.app\", category \"wearable\") when this device is connected to a Mac.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Wearable Diagnostics")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func diagnosticRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.system(.footnote, design: .monospaced)).multilineTextAlignment(.trailing)
        }
    }

    /// Pulled out of the `ForEach` body and built from plain, pre-computed
    /// `String`s rather than one compound interpolated expression — the
    /// inline version failed a real Codemagic build ("the compiler is
    /// unable to type-check this expression in reasonable time"), a
    /// well-known Swift type-checker limit for deeply nested string
    /// interpolation, not a logic bug.
    private func deviceRow(_ device: WearableRuntimeDiagnostics.DiscoveredDeviceInfo) -> some View {
        let rssiText = device.rssi.map(String.init) ?? "?"
        let filterText = device.passedFilter ? "✓ passed filter" : "✗ \(device.filterReason ?? "filtered")"
        let detailText = "id=\(device.id) rssi=\(rssiText) \(filterText)"
        return VStack(alignment: .leading, spacing: 2) {
            Text(device.name).font(.footnote.weight(.medium))
            Text(detailText)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(device.passedFilter ? Color.secondary : Color.red)
        }
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "h:mm:ss a"
        return f
    }()

    private static func timeString(_ date: Date) -> String {
        formatter.string(from: date)
    }
}
