import SwiftUI

/// Developer-only diagnostic panel for the live-HR/wearable pipeline —
/// reached via a long-press on Home's Sombrey Band card, never a visible
/// button, so a normal user won't stumble into it. Every line here is a
/// direct, unmodified read of `WearableManager`'s real state (no
/// separate "diagnostics" data path, so this can never show a fake
/// "successful" state that disagrees with what the rest of the app
/// actually sees) — built specifically to answer, from a physical
/// device, exactly where the pipeline stops if live HR still doesn't
/// appear: Bluetooth connection → HR subscription → HR callback →
/// measurement received → published state.
struct WearableDiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(WearableManager.self) private var wearableManager

    var body: some View {
        NavigationStack {
            List {
                Section("Bluetooth / Connection") {
                    diagnosticRow("Paired device", wearableManager.pairedDevice != nil ? wearableManager.pairedDevice!.id : "none")
                    diagnosticRow("Connection state", "\(wearableManager.displayState)")
                    diagnosticRow("Battery received", wearableManager.status?.batteryPct.map { "\(Int($0.rounded()))%" } ?? "not yet")
                    diagnosticRow("Last seen", wearableManager.status?.lastSeenAt.map(Self.timeString) ?? "never")
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
                Section("Live heart rate") {
                    diagnosticRow("HR callback subscribed", wearableManager.displayState == .connected ? "yes (started on connect)" : "no — not connected")
                    diagnosticRow("Last HR received", wearableManager.latestMeasurements[.heartRate].map { "\(Int($0.value.rounded())) BPM" } ?? "none this session")
                    diagnosticRow("Last HR timestamp", wearableManager.latestMeasurements[.heartRate].map { Self.timeString($0.recordedAt) } ?? "—")
                }
                Section("Blood pressure") {
                    diagnosticRow("Measurement in progress", wearableManager.activeOnDemandMeasurement == .bloodPressure ? "yes" : "no")
                    diagnosticRow("Unsupported by this band", wearableManager.lastMeasurementUnsupportedByDevice ? "yes" : "no")
                    if let systolic = wearableManager.latestMeasurements[.bloodPressureSystolic],
                       let diastolic = wearableManager.latestMeasurements[.bloodPressureDiastolic] {
                        diagnosticRow("Last accepted result", "\(Int(systolic.value.rounded()))/\(Int(diastolic.value.rounded())) mmHg")
                        diagnosticRow("Last result timestamp", Self.timeString(systolic.recordedAt))
                    } else {
                        diagnosticRow("Last accepted result", "none this session")
                    }
                }
                Section("Active calories / Steps / Distance") {
                    diagnosticRow("Last accepted calories", wearableManager.latestMeasurements[.activeCalories].map { "\(Int($0.value.rounded())) kcal" } ?? "none")
                    diagnosticRow("Calories timestamp", wearableManager.latestMeasurements[.activeCalories].map { Self.timeString($0.recordedAt) } ?? "—")
                    diagnosticRow("Counted as today?", wearableManager.latestMeasurementForToday(.activeCalories) != nil ? "yes" : "no")
                    diagnosticRow("Last accepted steps", wearableManager.latestMeasurements[.steps].map { "\(Int($0.value.rounded()))" } ?? "none")
                    diagnosticRow("Steps timestamp", wearableManager.latestMeasurements[.steps].map { Self.timeString($0.recordedAt) } ?? "—")
                    diagnosticRow("Last accepted distance", wearableManager.latestMeasurements[.distanceMeters].map { "\(Int($0.value.rounded())) m" } ?? "none")
                }
                Section("Temperature / SpO2") {
                    diagnosticRow("Last temperature", wearableManager.latestMeasurements[.skinTemperature].map { String(format: "%.1f°C", $0.value) } ?? "none")
                    diagnosticRow("Temperature timestamp", wearableManager.latestMeasurements[.skinTemperature].map { Self.timeString($0.recordedAt) } ?? "—")
                    diagnosticRow("Last SpO2", wearableManager.latestMeasurements[.spo2].map { "\(Int($0.value.rounded()))%" } ?? "none")
                    diagnosticRow("SpO2 timestamp", wearableManager.latestMeasurements[.spo2].map { Self.timeString($0.recordedAt) } ?? "—")
                }
                Section("Sync / Convex") {
                    diagnosticRow("Last historical sync", wearableManager.lastSyncAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last sync result", wearableManager.lastSyncResult.map { "\($0.status) · \($0.recordsSynced) record(s)" } ?? "—")
                    diagnosticRow("Measurements received (session)", "\(wearableManager.measurementsReceivedCount)")
                    diagnosticRow("Last successful Convex upload", wearableManager.lastSuccessfulUploadAt.map(Self.timeString) ?? "never this session")
                }
                Section("Last error") {
                    Text(wearableManager.lastError ?? "none")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(wearableManager.lastError == nil ? Color.secondary : Color.red)
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

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "h:mm:ss a"
        return f
    }()

    private static func timeString(_ date: Date) -> String {
        formatter.string(from: date)
    }
}
