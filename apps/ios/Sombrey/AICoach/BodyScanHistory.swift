import SwiftUI
import Charts
import ConvexMobile

// Sombrey Body Scan — Phase 5F: the longitudinal experience.
//
//   BodyScanResultCard    one scan: status → comparison → measured → proportions
//                         → BMI → experimental/composition → uncertainty →
//                         "Analysis details" (only when expanded)
//   BodyScanCompareView   two scans, only when the compatibility system allows:
//                         aligned side-by-side or a wipe overlay, per view
//   BodyScanTrendsView    body-shape proportions over enough comparable scans
//   BodyScanImageControls keep / delete individual images / delete the scan
//   BodyScanTrainingConsentRow  optional, separate, revocable (dev builds)
//
// Labels always say what a value is: Measured (validated), Calculated (from the
// user's recorded values), Experimental (development builds only) or Not
// available. Nothing here is a medical measurement.

extension BodyScanDisplayPolicy {
    static var current: BodyScanDisplayPolicy { BodyScanDisplayPolicy(showsExperimental: BodyScanDevTools.enabled) }
}

// MARK: - One scan's result

struct BodyScanResultCard: View {
    let scan: BodyScanDTO
    let previous: BodyScanDTO?
    let canCompare: Bool
    let onCompare: () -> Void
    @State private var result = ConvexQuery<BodyScanMeasurementsDTO?>()
    @State private var composition = ConvexQuery<BodyScanCompositionDTO?>()
    @State private var change = ConvexQuery<BodyScanComparisonDTO>()
    @State private var details = ConvexQuery<BodyScanDetailsDTO>()
    @State private var showDetails = false
    private let policy = BodyScanDisplayPolicy.current

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            status
            if canCompare {
                Button(action: onCompare) {
                    Label("Compare with another scan", systemImage: "square.split.2x1").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
                .accessibilityIdentifier("bodyScan.compare")
            }
            if let m = result.value ?? nil {
                measurementsSection(m)
                proportionsSection(m)
            } else if scan.summary?.processed == false {
                Text("Your scan is saved. Its analysis appears here once it's processed on your phone.")
                    .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            }
            compositionSection
            changeSection
            analysisDetails
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 20) }
        .task(id: scan.scanId) {
            result.subscribe(to: "bodyScans:measurements", with: ["scanId": scan.scanId])
            composition.subscribe(to: "bodyScans:composition", with: ["scanId": scan.scanId])
            details.subscribe(to: "bodyScans:details", with: ["scanId": scan.scanId])
            if let previous { change.subscribe(to: "bodyScans:compare", with: ["scanIdA": previous.scanId, "scanIdB": scan.scanId]) }
        }
    }

    // 1. Scan status
    private var status: some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle("SCAN")
            if let q = BodyScanQualityPresentation.label(scan.summary?.captureQuality ?? scan.views.map(\.qualityScore).min()) {
                Text(q).font(StudioFont.body(14)).foregroundStyle(StudioColor.ink)
            }
            Text(statusLine).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var statusLine: String {
        let views = "\(scan.views.count) of 3 views kept"
        let depth: String
        switch scan.summary?.depthSource ?? scan.depthSource {
        case "truedepth": depth = "distance measured with the front sensor"
        case "lidar": depth = "distance measured with the back camera's LiDAR"
        default: depth = "no distance measurement"
        }
        return "\(views) · \(depth)"
    }

    // 3. Measurements (Measured first; Experimental only on development builds)
    @ViewBuilder
    private func measurementsSection(_ m: BodyScanMeasurementsDTO) -> some View {
        let lines = BodyScanResultPresentation.measurements(m, policy: policy)
        sectionTitle("MEASUREMENTS")
        if lines.isEmpty {
            Text(policy.showsExperimental
                 ? "No measurement from this scan was precise enough to show."
                 : "Measurements appear here once Sombrey's scanner has been validated. Your scans are kept, so earlier scans will be included.")
                .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
        } else {
            ForEach(lines, id: \.label) { valueRow($0) }
            // 7. Uncertainty, stated once.
            Text("± is the range the scanner's own error model allows for this scan. Experimental values are not validated.")
                .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
    }

    // 4. Body proportions
    @ViewBuilder
    private func proportionsSection(_ m: BodyScanMeasurementsDTO) -> some View {
        let lines = BodyScanResultPresentation.proportions(m, policy: policy)
        if !lines.isEmpty {
            sectionTitle("BODY PROPORTIONS")
            ForEach(lines, id: \.label) { valueRow($0) }
        }
    }

    // 5–6. BMI (calculated) and body composition (experimental — never shown as a value)
    @ViewBuilder
    private var compositionSection: some View {
        if let c = composition.value ?? nil {
            ForEach(BodyScanCompositionPresentation.lines(c), id: \.label) { line in
                valueRow(.init(label: line.label, text: line.text, provenance: line.label == "BMI" ? .calculated : .experimental))
            }
            if let note = BodyScanCompositionPresentation.note(c) {
                Text(note).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // Change since the previous scan
    @ViewBuilder
    private var changeSection: some View {
        if previous != nil, let d = change.value {
            sectionTitle("SINCE YOUR PREVIOUS SCAN")
            if policy.showsExperimental {
                ForEach(BodyScanChangePresentation.lines(d.change), id: \.label) { line in
                    valueRow(.init(label: line.label, text: line.text, provenance: .experimental))
                }
                Text(BodyScanChangePresentation.summary(d.change))
                    .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(d.comparable
                     ? "Sombrey can't yet tell a real change from normal scan-to-scan variation. Use the visual comparison to see your scans side by side."
                     : BodyScanComparisonPresentation.refusal(d.reasons ?? []))
                    .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // 8. Analysis details — only when expanded
    private var analysisDetails: some View {
        DisclosureGroup("Analysis details", isExpanded: $showDetails) {
            VStack(alignment: .leading, spacing: 6) {
                if let d = details.value {
                    ForEach(Array(BodyScanDetailsPresentation.rows(d).enumerated()), id: \.offset) { _, row in
                        HStack(alignment: .firstTextBaseline) {
                            Text(row.0).font(StudioFont.body(11)).foregroundStyle(StudioColor.inkSoft)
                            Spacer(minLength: 12)
                            Text(row.1).font(StudioFont.body(11)).foregroundStyle(StudioColor.ink).multilineTextAlignment(.trailing)
                        }
                    }
                }
                if policy.showsExperimental, let m = result.value ?? nil { devDiagnostics(m) }
            }
            .padding(.top, 8)
        }
        .font(StudioFont.body(13, weight: .medium))
        .tint(StudioColor.ink)
    }

    private func devDiagnostics(_ m: BodyScanMeasurementsDTO) -> some View {
        let rows = m.measurements.map { x -> String in
            let v = x.value.map { String(format: "%.2f", $0) } ?? "—"
            let u = x.uncertainty.map { String(format: "±%.2f", $0) } ?? ""
            return "\(x.name) \(x.status) \(v)\(u) \(x.unit) \(x.provenance?.rawValue ?? "?") \(x.reasons.joined(separator: ","))"
        }
        let comp = ((composition.value ?? nil)?.results ?? []).map { r in
            "composition \(r.model) v\(r.modelVersion) \(r.status) \(r.value.map { String(format: "%.1f", $0) } ?? "—") shown:\(r.displayable) \(r.reasons.joined(separator: ","))"
        }
        let head = "DEV · \(m.cvVersion)/\(m.methodVersion) · scale \(m.scale.source) \(m.scale.ok ? "ok" : "none") \(m.scale.reasons.joined(separator: ","))"
        return Text(([head] + rows + comp).joined(separator: "\n"))
            .font(.system(size: 10, design: .monospaced)).foregroundStyle(StudioColor.inkFaint)
            .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
    }

    private func sectionTitle(_ s: String) -> some View {
        Text(s).font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft).padding(.top, 4)
    }

    private func valueRow(_ line: BodyScanResultPresentation.Line) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(line.label).font(StudioFont.body(14)).foregroundStyle(StudioColor.ink)
            Spacer()
            Text(line.text).font(StudioFont.body(14, weight: .semibold)).foregroundStyle(StudioColor.ink).monospacedDigit().multilineTextAlignment(.trailing)
            Text(line.provenance.label.uppercased())
                .font(StudioFont.body(8, weight: .semibold)).tracking(0.8)
                .foregroundStyle(line.provenance == .experimental ? StudioColor.caution : StudioColor.inkSoft)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .overlay(Capsule().stroke(StudioColor.inkFaint, lineWidth: 0.5))
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Visual comparison

struct BodyScanCompareView: View {
    let scans: [BodyScanDTO]            // saved scans, newest first
    @State var earlier: String
    @State var later: String
    @Environment(\.dismiss) private var dismiss
    @State private var comparison = ConvexQuery<BodyScanComparisonDTO>()
    @State private var view: BodyScanView = .front
    @State private var overlay = false
    @State private var wipe = 0.5

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    pickers
                    if let c = comparison.value {
                        if c.comparable {
                            viewPicker(c)
                            if let frames = c.frames?.first(where: { $0.view == view.rawValue }) {
                                if frames.available, let fa = frames.a, let fb = frames.b {
                                    Picker("Mode", selection: $overlay) {
                                        Text("Side by side").tag(false)
                                        Text("Overlay").tag(true)
                                    }
                                    .pickerStyle(.segmented)
                                    BodyScanAlignedPair(earlier: earlier, later: later, view: view, frameA: fa, frameB: fb, overlay: overlay, wipe: wipe)
                                        .frame(height: 460)
                                    if overlay {
                                        Slider(value: $wipe, in: 0...1) { Text("Earlier ↔ Later") }
                                            .accessibilityLabel("Move between the earlier and the later scan")
                                    }
                                    Text("Both photos are scaled so the body outline has the same height, and centred. Posture, light and clothing also show up as differences.")
                                        .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint).fixedSize(horizontal: false, vertical: true)
                                } else {
                                    notice(BodyScanComparisonPresentation.viewRefusal(frames.reasons))
                                }
                            }
                        } else {
                            notice(BodyScanComparisonPresentation.refusal(c.reasons ?? []))
                        }
                    } else if comparison.isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Compare scans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: "\(earlier)|\(later)") {
                comparison.subscribe(to: "bodyScans:compare", with: ["scanIdA": earlier, "scanIdB": later])
            }
        }
    }

    private var pickers: some View {
        HStack(spacing: 12) {
            scanPicker("Earlier", selection: $earlier, excluding: later)
            scanPicker("Later", selection: $later, excluding: earlier)
        }
    }

    private func scanPicker(_ title: String, selection: Binding<String>, excluding: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(StudioFont.body(10, weight: .semibold)).tracking(1.4).foregroundStyle(StudioColor.inkSoft)
            Picker(title, selection: selection) {
                ForEach(scans.filter { $0.scanId != excluding }) { s in
                    Text(s.date.formatted(.dateTime.day().month(.abbreviated).year())).tag(s.scanId)
                }
            }
            .pickerStyle(.menu)
            .tint(StudioColor.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func viewPicker(_ c: BodyScanComparisonDTO) -> some View {
        Picker("View", selection: $view) {
            ForEach(BodyScanView.allCases) { v in
                Text(v.title + ((c.frames?.first { $0.view == v.rawValue }?.available ?? false) ? "" : " —")).tag(v)
            }
        }
        .pickerStyle(.segmented)
    }

    private func notice(_ text: String) -> some View {
        Text(text).font(StudioFont.body(14)).foregroundStyle(StudioColor.ink).fixedSize(horizontal: false, vertical: true)
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background { SombreyGlassChamber(cornerRadius: 16) }
    }
}

/// Two photos of one view, aligned by body outline: side by side, or overlaid
/// with a wipe. Loaded from the authenticated endpoint, in memory only.
struct BodyScanAlignedPair: View {
    let earlier: String
    let later: String
    let view: BodyScanView
    let frameA: BodyScanComparisonDTO.Frame
    let frameB: BodyScanComparisonDTO.Frame
    let overlay: Bool
    let wipe: Double
    @State private var imageA: UIImage?
    @State private var imageB: UIImage?
    @State private var failed = false

    var body: some View {
        GeometryReader { geo in
            if let a = imageA, let b = imageB {
                if overlay {
                    ZStack(alignment: .topLeading) {
                        aligned(a, frameA, in: geo.size)
                        aligned(b, frameB, in: geo.size)
                            .mask(alignment: .leading) { Rectangle().frame(width: geo.size.width * wipe) }
                        Rectangle().fill(StudioColor.paper).frame(width: 1.5).offset(x: geo.size.width * wipe)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(alignment: .top) { captions }
                } else {
                    HStack(spacing: 8) {
                        aligned(a, frameA, in: CGSize(width: (geo.size.width - 8) / 2, height: geo.size.height))
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        aligned(b, frameB, in: CGSize(width: (geo.size.width - 8) / 2, height: geo.size.height))
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .overlay(alignment: .top) { captions }
                }
            } else if failed {
                Text("Couldn't load these photos.").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background { SombreyGlassChamber(cornerRadius: 18) }
        .task(id: "\(earlier)|\(later)|\(view.rawValue)") {
            imageA = nil; imageB = nil; failed = false
            do {
                imageA = try await BodyScanImageLoader.load(scanId: earlier, view: view)
                imageB = try await BodyScanImageLoader.load(scanId: later, view: view)
            } catch { failed = true }
        }
        .accessibilityLabel("\(view.title) view, earlier and later scans")
    }

    private var captions: some View {
        HStack {
            Text("EARLIER"); Spacer(); Text("LATER")
        }
        .font(StudioFont.body(9, weight: .semibold)).tracking(1.4).foregroundStyle(StudioColor.paper)
        .padding(10)
    }

    @ViewBuilder
    private func aligned(_ image: UIImage, _ frame: BodyScanComparisonDTO.Frame, in size: CGSize) -> some View {
        if let p = BodyScanAlignment.placement(frame: frame, imageSize: image.size, container: size) {
            Image(uiImage: image).resizable()
                .frame(width: p.size.width, height: p.size.height)
                .position(p.center)
                .frame(width: size.width, height: size.height)
                .clipped()
        }
    }
}

// MARK: - Proportion trends

struct BodyScanTrendsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var trends = ConvexQuery<BodyScanTrendsDTO>()
    private let policy = BodyScanDisplayPolicy.current

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(BodyScanTrendPresentation.note).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
                    if !policy.showsExperimental {
                        Text("Proportion trends appear once Sombrey's scanner has been validated.")
                            .font(StudioFont.body(14)).foregroundStyle(StudioColor.ink)
                    } else if let t = trends.value {
                        let shown = BodyScanTrendPresentation.shown(t)
                        if shown.isEmpty {
                            Text("Trends appear after three comparable scans (same scanner version and capture set-up).")
                                .font(StudioFont.body(14)).foregroundStyle(StudioColor.ink).fixedSize(horizontal: false, vertical: true)
                        }
                        ForEach(shown, id: \.name) { trend in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(BodyScanTrendPresentation.labels[trend.name] ?? trend.name).font(StudioFont.body(14, weight: .semibold))
                                    Spacer()
                                    Text("EXPERIMENTAL").font(StudioFont.body(8, weight: .semibold)).tracking(0.8).foregroundStyle(StudioColor.caution)
                                }
                                Chart(trend.points, id: \.scanId) { p in
                                    LineMark(x: .value("Date", Date(timeIntervalSince1970: p.at / 1000)), y: .value("Value", p.value))
                                    PointMark(x: .value("Date", Date(timeIntervalSince1970: p.at / 1000)), y: .value("Value", p.value))
                                    if let u = p.uncertainty {
                                        RuleMark(x: .value("Date", Date(timeIntervalSince1970: p.at / 1000)), yStart: .value("Low", p.value - u), yEnd: .value("High", p.value + u))
                                            .foregroundStyle(StudioColor.inkFaint)
                                    }
                                }
                                .frame(height: 140)
                            }
                            .padding(14)
                            .background { SombreyGlassChamber(cornerRadius: 16) }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Proportion trends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { trends.subscribe(to: "bodyScans:trends") }
        }
    }
}

// MARK: - Image retention

struct BodyScanImageControls: View {
    let scan: BodyScanDTO
    let onDeleteScan: () -> Void
    @State private var confirmView: BodyScanView?
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("YOUR SCAN IMAGES").font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
            Text("Keeping scan images allows Sombrey to compare your physique over time. They're private to your account, never shared with other services, and never used to train models.")
                .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            ForEach(BodyScanView.allCases) { v in
                if scan.views.contains(where: { $0.view == v.rawValue }) {
                    Button("Delete \(v.rawValue) image", role: .destructive) { confirmView = v }
                        .font(StudioFont.body(13)).frame(minHeight: 36)
                } else if (scan.removedViews ?? []).contains(v.rawValue) {
                    Text("\(v.title) image deleted").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkFaint)
                }
            }
            Button("Delete this scan", role: .destructive, action: onDeleteScan)
                .font(StudioFont.body(13, weight: .medium)).frame(minHeight: 44)
            if let problem { Text(problem).font(StudioFont.body(12)).foregroundStyle(StudioColor.caution) }
        }
        .confirmationDialog("Delete the \(confirmView?.rawValue ?? "") image?", isPresented: Binding(get: { confirmView != nil }, set: { if !$0 { confirmView = nil } }), titleVisibility: .visible, presenting: confirmView) { v in
            Button("Delete image", role: .destructive) { Task { await delete(v) } }
        } message: { _ in
            Text("The photo is permanently removed. The scan's other photos and its analysis are kept, but this view can't be compared any more. Delete the scan to remove everything.")
        }
    }

    @MainActor
    private func delete(_ v: BodyScanView) async {
        do { try await ConvexClientProvider.client.mutation("bodyScans:removeView", with: ["scanId": scan.scanId, "view": v.rawValue]) }
        catch { problem = "Couldn't delete the image. Check your connection and try again." }
    }
}

// MARK: - Optional training consent (development builds; wording pending review)

struct BodyScanTrainingConsentRow: View {
    @State private var consent = ConvexQuery<BodyScanTrainingConsentDTO>()
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("IMPROVING SOMBREY (OPTIONAL)").font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
            if let c = consent.value {
                Toggle(isOn: Binding(get: { c.granted }, set: { value in Task { await set(value, version: c.currentVersion) } })) {
                    Text("I agree that Sombrey may use my de-identified Body Scan data to improve Sombrey's body-analysis models.")
                        .font(StudioFont.body(12)).foregroundStyle(StudioColor.ink).fixedSize(horizontal: false, vertical: true)
                }
                .tint(StudioColor.ink)
                Text("Separate from your Body Scan consent, off unless you turn it on, and you can turn it off at any time. Nothing is used for training today — this only records your choice (\(c.currentVersion)).")
                    .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint).fixedSize(horizontal: false, vertical: true)
            }
            if let problem { Text(problem).font(StudioFont.body(12)).foregroundStyle(StudioColor.caution) }
        }
        .task { consent.subscribe(to: "bodyScans:trainingConsent") }
    }

    @MainActor
    private func set(_ granted: Bool, version: String) async {
        do { try await ConvexClientProvider.client.mutation("bodyScans:setTrainingConsent", with: ["granted": granted, "version": version]) }
        catch { problem = "Couldn't save your choice. Check your connection and try again." }
    }
}
