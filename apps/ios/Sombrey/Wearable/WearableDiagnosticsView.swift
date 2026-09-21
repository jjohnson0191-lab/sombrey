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
                Section("Connection") {
                    diagnosticRow("Paired device", wearableManager.pairedDevice != nil ? wearableManager.pairedDevice!.id : "none")
                    diagnosticRow("Connection state", "\(wearableManager.displayState)")
                    diagnosticRow("Battery received", wearableManager.status?.batteryPct.map { "\(Int($0.rounded()))%" } ?? "not yet")
                    diagnosticRow("Last seen", wearableManager.status?.lastSeenAt.map(Self.timeString) ?? "never")
                }
                Section("Live heart rate") {
                    diagnosticRow("HR callback subscribed", wearableManager.displayState == .connected ? "yes (started on connect)" : "no — not connected")
                    diagnosticRow("Last HR received", wearableManager.latestMeasurements[.heartRate].map { "\(Int($0.value.rounded())) BPM" } ?? "none this session")
                    diagnosticRow("Last HR timestamp", wearableManager.latestMeasurements[.heartRate].map { Self.timeString($0.recordedAt) } ?? "—")
                }
                Section("Sync") {
                    diagnosticRow("Last historical sync", wearableManager.lastSyncAt.map(Self.timeString) ?? "never")
                    diagnosticRow("Last sync result", wearableManager.lastSyncResult.map { "\($0.status) · \($0.recordsSynced) record(s)" } ?? "—")
                    diagnosticRow("Measurements received (session)", "\(wearableManager.measurementsReceivedCount)")
                }
                Section("Last error") {
                    Text(wearableManager.lastError ?? "none")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(wearableManager.lastError == nil ? .secondary : .red)
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
