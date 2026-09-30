import SwiftUI
import ConvexMobile

// Sombrey Body Scan — Phase 5D validation screen (DEVELOPMENT BUILDS ONLY).
// Reached from the scan history's "DEV · Validation" button on builds that
// point at a non-production deployment, and usable only where the server
// enables validation (bodyScanValidation:enabled). It records hand-measured
// ground truth under a pseudonymous subject code, labels saved scans with
// their capture conditions, and shows the pilot analysis (scanner vs truth,
// repeatability, calibration) with a CSV export. It never edits the profile,
// the weight history or any scanner result.

struct BodyScanValidationView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var enabled = ConvexQuery<Bool>()
    @State private var truths = ConvexQuery<[TruthRow]>()
    @State private var tags = ConvexQuery<[TagRow]>()
    @State private var scans = ConvexQuery<[BodyScanDTO]>()
    @State private var report = ConvexQuery<BodyScanValidationReportDTO>()

    @State private var subject = "S01"
    @State private var session = Self.today()
    @State private var measurementKey = "height"
    @State private var valueText = ""
    @State private var unit = "cm"
    @State private var protocolName = "stadiometer_barefoot"
    @State private var operatorName = "assistant"
    @State private var repeatNumber = 1
    @State private var tagging: BodyScanDTO?
    @State private var showReport = false
    @State private var confirmWipe = false
    @State private var message: String?

    struct TruthRow: Decodable, Equatable, Identifiable {
        let id: String
        let subjectCode: String
        let measuredAt: Double
        let measurement: String
        let value: Double
        let unit: String
        let `protocol`: String
        let `operator`: String
        let `repeat`: Double
    }
    struct TagRow: Decodable, Equatable {
        struct Tag: Decodable, Equatable {
            let subjectCode, session, `repeat`: String
            let distanceM: Double
            let phoneHeight, lighting, clothing, pose: String
        }
        let scanId: String
        let createdAt: Double
        let tag: Tag
    }

    private var measurement: BodyScanValidationVocabulary.Measurement {
        BodyScanValidationVocabulary.measurements.first { $0.key == measurementKey } ?? BodyScanValidationVocabulary.measurements[0]
    }

    var body: some View {
        NavigationStack {
            Form {
                if enabled.value == true {
                    subjectSection
                    truthSection
                    scansSection
                    reportSection
                } else if enabled.isLoading {
                    ProgressView()
                } else {
                    Text("Validation tooling isn't enabled on this deployment. It exists only on development backends.")
                }
                if let message { Section { Text(message).font(.footnote) } }
            }
            .navigationTitle("Body Scan validation (dev)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $tagging) { scan in
                BodyScanValidationTagSheet(scan: scan, subject: subject, session: session, existing: tags.value?.first { $0.scanId == scan.scanId }?.tag) { text in message = text }
            }
            .sheet(isPresented: $showReport) { reportSheet }
            .confirmationDialog("Delete all validation data?", isPresented: $confirmWipe, titleVisibility: .visible) {
                Button("Delete ground truth and scan labels", role: .destructive) { Task { await wipe() } }
            } message: { Text("Your scans and their measurements are kept; only validation records are removed.") }
        }
        .task {
            enabled.subscribe(to: "bodyScanValidation:enabled")
            truths.subscribe(to: "bodyScanValidation:truths")
            tags.subscribe(to: "bodyScanValidation:tags")
            scans.subscribe(to: "bodyScans:list")
            report.subscribe(to: "bodyScanValidation:report")
        }
    }

    // MARK: Sections

    private var subjectSection: some View {
        Section {
            TextField("Subject code (e.g. S01 — never a name)", text: $subject)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            TextField("Session (groups repeats of one set-up)", text: $session)
                .autocorrectionDisabled()
        } header: { Text("Subject") } footer: {
            Text("Pseudonymous codes only. Measure other people only with their consent; their scans are stored on this account.")
        }
    }

    private var truthSection: some View {
        Section("Ground truth (tape · stadiometer · scale)") {
            Picker("Measurement", selection: $measurementKey) {
                ForEach(BodyScanValidationVocabulary.measurements, id: \.key) { Text($0.label).tag($0.key) }
            }
            .onChange(of: measurementKey) { _, _ in
                unit = BodyScanValidationVocabulary.units(for: measurement)[0]
                protocolName = measurement.protocols[0]
                if measurement.isPercent { operatorName = "clinician" }   // DXA is never self-reported
            }
            HStack {
                TextField("Value", text: $valueText).keyboardType(.decimalPad)
                Picker("Unit", selection: $unit) {
                    ForEach(BodyScanValidationVocabulary.units(for: measurement), id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
            }
            Picker("Protocol", selection: $protocolName) {
                ForEach(measurement.protocols, id: \.self) { Text($0).tag($0) }
            }
            Picker("Measured by", selection: $operatorName) {
                ForEach(BodyScanValidationVocabulary.operators, id: \.self) { Text($0).tag($0) }
            }
            Stepper("Repeat \(repeatNumber)", value: $repeatNumber, in: 1...5)
            Button("Save measurement") { Task { await saveTruth() } }
                .disabled(BodyScanValidationVocabulary.number(valueText) == nil || BodyScanValidationVocabulary.cleanSubjectCode(subject) == nil)
            ForEach(truths.value ?? []) { t in
                Text("\(t.subjectCode) \(t.measurement) \(String(format: "%.2f", t.value)) \(t.unit) · #\(Int(t.repeat)) · \(t.protocol) · \(Date(timeIntervalSince1970: t.measuredAt / 1000).formatted(date: .abbreviated, time: .shortened))")
                    .font(.system(size: 11, design: .monospaced))
                    .swipeActions { Button("Delete", role: .destructive) { Task { await deleteTruth(t.id) } } }
            }
        }
    }

    private var scansSection: some View {
        Section {
            ForEach((scans.value ?? []).filter { $0.status == "complete" }) { scan in
                Button { tagging = scan } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(scan.date.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 13, weight: .medium))
                        if let t = tags.value?.first(where: { $0.scanId == scan.scanId })?.tag {
                            Text("\(t.subjectCode) · \(t.session) · \(t.repeat) · \(String(format: "%.1f", t.distanceM)) m · \(t.phoneHeight) · \(t.lighting) · \(t.clothing) · \(t.pose)")
                                .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                        } else {
                            Text("Not labelled — tap to add its conditions").font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } header: { Text("Scans") } footer: {
            Text("Label each validation scan: A normal, B immediate repeat, C after moving and replacing the phone. Distance is tape-measured from the camera to the toes.")
        }
    }

    private var reportSection: some View {
        Section("Analysis") {
            Button("Show pilot report") { showReport = true }.disabled(report.value == nil)
            if let csv = report.value?.csv {
                ShareLink(item: csv, preview: SharePreview("body-scan-validation.csv")) { Text("Export observations (CSV)") }
            }
            Button("Delete all validation data", role: .destructive) { confirmWipe = true }
        }
    }

    private var reportSheet: some View {
        NavigationStack {
            ScrollView {
                if let r = report.value {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(BodyScanValidationFormat.lines(r.report).joined(separator: "\n"))
                        if !r.paired.isEmpty {
                            Text("SCANNER vs TRUTH").font(.system(size: 11, weight: .bold, design: .monospaced)).padding(.top, 8)
                            Text(r.paired.map(BodyScanValidationFormat.pairedLine).joined(separator: "\n"))
                        }
                    }
                    .font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled)
                    .padding()
                }
            }
            .navigationTitle("Pilot report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { showReport = false } } }
        }
    }

    // MARK: Actions (Convex arguments built inside each call — Swift 6 sending rules)

    @MainActor
    private func saveTruth() async {
        guard let code = BodyScanValidationVocabulary.cleanSubjectCode(subject), let value = BodyScanValidationVocabulary.number(valueText) else { return }
        let args: [String: ConvexEncodable?] = [
            "subjectCode": code,
            "measuredAt": Date().timeIntervalSince1970 * 1000,
            "measurement": measurementKey,
            "value": value,
            "unit": unit,
            "protocol": protocolName,
            "operator": operatorName,
            "repeat": Double(repeatNumber),
        ]
        do {
            try await ConvexClientProvider.client.mutation("bodyScanValidation:recordTruth", with: args)
            message = "Saved \(measurement.label) \(valueText) \(unit) for \(code) (#\(repeatNumber))."
            valueText = ""
            if repeatNumber < 5 { repeatNumber += 1 }
        } catch {
            message = "Not saved: \(error)"
        }
    }

    @MainActor
    private func deleteTruth(_ id: String) async {
        do { try await ConvexClientProvider.client.mutation("bodyScanValidation:deleteTruth", with: ["id": id]) } catch { message = "Not deleted: \(error)" }
    }

    @MainActor
    private func wipe() async {
        do { try await ConvexClientProvider.client.mutation("bodyScanValidation:deleteAll", with: [:]); message = "Validation data deleted." } catch { message = "Not deleted: \(error)" }
    }

    static func today() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}

/// Labels one saved scan with the conditions it was captured under.
struct BodyScanValidationTagSheet: View {
    let scan: BodyScanDTO
    let subject: String
    let session: String
    let existing: BodyScanValidationView.TagRow.Tag?
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var repeatLabel = "A"
    @State private var distance = 1.5
    @State private var phoneHeight = "waist"
    @State private var lighting = "bright"
    @State private var clothing = "minimal"
    @State private var pose = "ideal"
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Scan \(scan.date.formatted(date: .abbreviated, time: .shortened))") {
                    Text("Subject \(BodyScanValidationVocabulary.cleanSubjectCode(subject) ?? "—") · session \(session)").font(.footnote)
                    Picker("Repeat", selection: $repeatLabel) { ForEach(BodyScanValidationVocabulary.repeats, id: \.self) { Text($0).tag($0) } }
                    Picker("Distance (camera → toes)", selection: $distance) {
                        ForEach(BodyScanValidationVocabulary.distances, id: \.self) { Text(String(format: "%.1f m", $0)).tag($0) }
                    }
                    Picker("Phone height", selection: $phoneHeight) { ForEach(BodyScanValidationVocabulary.phoneHeights, id: \.self) { Text($0).tag($0) } }
                    Picker("Lighting", selection: $lighting) { ForEach(BodyScanValidationVocabulary.lighting, id: \.self) { Text($0).tag($0) } }
                    Picker("Clothing", selection: $clothing) { ForEach(BodyScanValidationVocabulary.clothing, id: \.self) { Text($0).tag($0) } }
                    Picker("Pose", selection: $pose) { ForEach(BodyScanValidationVocabulary.poses, id: \.self) { Text($0).tag($0) } }
                }
                if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
            }
            .navigationTitle("Label scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } } }
            }
            .onAppear {
                guard let e = existing else { return }
                repeatLabel = e.repeat; distance = e.distanceM; phoneHeight = e.phoneHeight
                lighting = e.lighting; clothing = e.clothing; pose = e.pose
            }
        }
    }

    @MainActor
    private func save() async {
        guard let code = BodyScanValidationVocabulary.cleanSubjectCode(existing?.subjectCode ?? subject) else { problem = "Enter a subject code first."; return }
        let args: [String: ConvexEncodable?] = [
            "scanId": scan.scanId,
            "subjectCode": code,
            "session": existing?.session ?? session,
            "repeat": repeatLabel,
            "distanceM": distance,
            "phoneHeight": phoneHeight,
            "lighting": lighting,
            "clothing": clothing,
            "pose": pose,
        ]
        do {
            try await ConvexClientProvider.client.mutation("bodyScanValidation:tagScan", with: args)
            onDone("Labelled the scan as \(code) \(repeatLabel).")
            dismiss()
        } catch {
            problem = "Not saved: \(error)"
        }
    }
}
