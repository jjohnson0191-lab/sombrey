import SwiftUI
import UIKit
import ConvexMobile

// Sombrey Body Scan — Phase 5A: the guided, private capture.
//
//   CONSENT (first time) → YOUR DETAILS (only what's missing) → PREPARE
//   → FRONT → SIDE → BACK → REVIEW (retake any view) → SAVE → your scans
//
// The front camera shows the user themselves with Sombrey's body frame over
// it; Apple Vision + Core Motion gate every view (BodyScanQuality.swift) and
// capture automatically once the pose has held, so nobody has to walk back
// to the phone. Scans are private to the account: images are stored only as
// the user's own assets and loaded through the authenticated endpoint, never
// through a URL (convex/bodyScans.ts, convex/http.ts). Nothing is measured
// or estimated in this phase, and nothing on screen claims otherwise.

// MARK: - Entry (Sombrey Coach)

/// Body Scan's doorway in Sombrey Coach — with what Sombrey already knows
/// (the last saved scan), never an invented reading.
struct BodyScanEntry: View {
    let scans: [BodyScanDTO]
    let open: () -> Void

    var body: some View {
        let saved = scans.filter { $0.status == "complete" }
        SombreyFeatureEntry(
            eyebrow: "BODY SCAN",
            title: saved.isEmpty ? "Take your baseline" : "Track your physique",
            detail: "Front, side and back — private to you, compared with your own history.",
            status: saved.first.map { "Last scan \($0.date.formatted(.dateTime.day().month(.abbreviated)))" } ?? "No scans yet",
            glyph: "viewfinder",
            action: open
        )
        .accessibilityIdentifier("sombrey.bodyScanEntry")
    }
}

// MARK: - Flow

struct BodyScanFlow: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var stage: BodyScanStage?
    @State private var showResults: Bool
    @State private var profile = ConvexQuery<BodyScanProfileDTO>()
    @State private var draft = BodyScanDraft()
    @State private var camera = BodyScanCameraModel()
    @State private var problem: String?
    @State private var busy = false
    @State private var savingStep = ""
    @State private var serverScanStarted = false
    @State private var capturedTick = 0
    @State private var savedTick = 0

    init(startWithResults: Bool = false) {
        _showResults = State(initialValue: startWithResults)
    }

    var body: some View {
        Group {
            if case .capture(let view) = stage {
                BodyScanCaptureScreen(camera: camera, view: view, captured: draft.views.count, onCancel: { cancelCapture() })
                    .transition(.opacity)
            } else {
                EnvironmentView(scene: .aiCoach) {
                    VStack(spacing: 0) {
                        topBar
                        content
                    }
                }
            }
        }
        .animation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion), value: stage)
        .sensoryFeedback(StudioHaptic.setLogged, trigger: capturedTick)
        .sensoryFeedback(.success, trigger: savedTick)
        .task { profile.subscribe(to: "bodyScans:profile") }
        .onChange(of: profile.value) { _, p in
            if stage == nil, let p, !showResults { stage = firstStage(p) }
        }
        .onAppear {
            camera.onCapture = { view, captured in
                draft.record(view, captured)
                capturedTick += 1
                let next = draft.afterCapture
                if case .capture(let v) = next { camera.view = v } else { camera.stop() }
                stage = next
            }
        }
        .onDisappear { camera.stop() }
    }

    private func firstStage(_ p: BodyScanProfileDTO) -> BodyScanStage {
        if !p.consent.accepted { return .consent }
        if !p.missing.isEmpty { return .details }
        return .prepare
    }

    private var topBar: some View {
        HStack {
            Button(showResults ? "Done" : "Cancel") { close() }
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .frame(minHeight: 44)
            Spacer()
            SombreyLogo(size: .header, tone: .onLight)
            Spacer()
            Color.clear.frame(width: 60, height: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var content: some View {
        if showResults {
            BodyScanHistoryView(onNewScan: { startNewScan() })
        } else {
            switch stage {
            case nil:
                if let error = profile.errorMessage {
                    notice("Body Scan isn't available right now", error.isEmpty ? "Check your connection and try again." : "Check your connection and try again.")
                } else {
                    ProgressView().tint(StudioColor.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            case .consent: scroll { consent }
            case .details: scroll { BodyDetailsForm(profile: profile.value, onSaved: { advanceFromDetails() }) }
            case .prepare: scroll { prepare }
            case .review: scroll { review }
            case .saving: saving
            case .saved, .capture: EmptyView()
            }
        }
    }

    private func scroll<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        ScrollView { c().padding(.horizontal, 24).padding(.bottom, 32) }
            .scrollDismissesKeyboard(.interactively)
    }

    // MARK: Consent

    private var consent: some View {
        VStack(alignment: .leading, spacing: 20) {
            header("BODY SCAN", "Your private body record", "Three guided photos — front, side and back — taken the same way each time, so you can see how your body changes.")
            VStack(alignment: .leading, spacing: 12) {
                point("lock", "Private to your account. Only you can open your scans — not other users, and never through a public link.")
                point("arrow.left.arrow.right", "Stored securely so each new scan can be compared with your earlier ones.")
                point("waveform.path.ecg", "Future Sombrey body-analysis features may process your scans on your behalf. Sombrey doesn't send them to other AI services.")
                point("trash", "Delete any scan, any time — its photos are removed with it.")
                point("info.circle", "A scan is a fitness record, not a medical measurement or diagnosis.")
            }
            DisclosureGroup("Privacy details") {
                Text("Images are stored in Sombrey's secure storage as assets of your account and are served only to you, after checking your sign-in on every request. They're kept until you delete the scan or your account; deleting either removes the images. Images aren't used to train models without your separate, explicit permission. Sombrey stores the device model, app version and camera settings used for each scan, plus the height, weight, sex and age on your profile at the time, so later scans can be compared fairly. No location or other photo metadata is kept.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
            .font(StudioFont.body(13, weight: .medium))
            .tint(StudioColor.ink)
            if let problem { problemText(problem) }
            Button { acceptConsent() } label: {
                Group { if busy { ProgressView().tint(StudioColor.ink) } else { Text("I understand — continue") } }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .disabled(busy)
            .accessibilityIdentifier("bodyScan.consent")
        }
    }

    // MARK: Prepare

    private var prepare: some View {
        let sex = profile.value?.context.sex
        return VStack(alignment: .leading, spacing: 20) {
            header("BEFORE YOU START", "Set up once, the same every time", "Consistency is what makes scans comparable — the same clothing, place and light each time.")
            VStack(alignment: .leading, spacing: 10) {
                Text("WHAT TO WEAR")
                    .font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
                Text(Self.clothingGuidance(sex))
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Close-fitting clothing lets the scanner see your body's outline, so each scan measures the same way. Get ready before opening the camera.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { SombreyGlassChamber(cornerRadius: 20) }
            VStack(alignment: .leading, spacing: 10) {
                point("iphone", "Stand your phone upright at about waist height, against something steady.")
                point("figure.stand", "Step back 2–3 m until the frame holds your whole body, head to feet.")
                point("sun.max", "Face even light; a plain wall behind you works best.")
                point("timer", "Hold still when the frame lights — Sombrey captures each view by itself.")
            }
            if let problem { problemText(problem) }
            Button { beginCapture() } label: { Text("Open camera").frame(maxWidth: .infinity) }
                .buttonStyle(.illuminatedCTA)
                .accessibilityIdentifier("bodyScan.begin")
        }
    }

    nonisolated static func clothingGuidance(_ sex: String?) -> String {
        switch sex {
        case "male": return "Shirtless, with shorts or fitted athletic bottoms."
        case "female": return "A sports bra, with fitted shorts or athletic leggings."
        default: return "Close-fitting athletic wear — a fitted top or sports bra, with shorts or leggings."
        }
    }

    // MARK: Review

    private var review: some View {
        VStack(alignment: .leading, spacing: 18) {
            header("REVIEW", "Your scan", "Check each view. Retake any that isn't right — the others are kept.")
            HStack(alignment: .top, spacing: 10) {
                ForEach(BodyScanView.allCases) { v in
                    VStack(spacing: 8) {
                        ZStack {
                            if let c = draft.views[v], let image = UIImage(data: c.jpeg) {
                                Image(uiImage: image).resizable().scaledToFill()
                            } else {
                                Text("Missing").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 200)
                        .background { SombreyGlassChamber(cornerRadius: 16) }
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityLabel(draft.views[v] == nil ? "\(v.title) view missing" : "\(v.title) view")
                        Text(v.title.uppercased())
                            .font(StudioFont.body(10, weight: .semibold)).tracking(1.4).foregroundStyle(StudioColor.inkSoft)
                        Button("Retake") { retake(v) }
                            .font(StudioFont.body(13, weight: .medium))
                            .foregroundStyle(StudioColor.ink)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Retake \(v.title.lowercased()) view")
                    }
                }
            }
            if let problem { problemText(problem) }
            VStack(spacing: 8) {
                Button { save() } label: { Text("Save scan").frame(maxWidth: .infinity) }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(!draft.isComplete || busy)
                    .accessibilityIdentifier("bodyScan.save")
                Text("Nothing is uploaded until you save. Photos are stored exactly as captured — no filters or retouching.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var saving: some View {
        VStack(spacing: 14) {
            Spacer()
            ProgressView().tint(StudioColor.ink)
            Text("Saving your scan")
                .font(StudioFont.hero(22, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text(savingStep)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Pieces

    private func header(_ eyebrow: String, _ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow).font(StudioFont.body(11, weight: .semibold)).tracking(1.8).foregroundStyle(StudioColor.inkSoft)
            Text(title).font(StudioFont.hero(30, weight: .semibold)).foregroundStyle(StudioColor.ink).accessibilityAddTraits(.isHeader)
            Text(detail).font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 16)
    }

    private func point(_ glyph: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: glyph).font(.system(size: 13)).foregroundStyle(StudioColor.inkSoft).frame(width: 18).accessibilityHidden(true)
            Text(text).font(StudioFont.body(13)).foregroundStyle(StudioColor.ink).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func problemText(_ text: String) -> some View {
        Text(text).font(StudioFont.body(13)).foregroundStyle(StudioColor.caution).fixedSize(horizontal: false, vertical: true)
    }

    private func notice(_ title: String, _ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(StudioFont.hero(18, weight: .semibold)).foregroundStyle(StudioColor.ink)
            Text(message).font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 20) }
        .padding(24)
    }

    // MARK: Actions

    private func acceptConsent() {
        guard let version = profile.value?.consent.currentVersion else { return }
        busy = true
        problem = nil
        Task {
            do {
                try await ConvexClientProvider.client.mutation("bodyScans:acceptConsent", with: ["version": version])
                busy = false
                stage = (profile.value?.missing.isEmpty ?? false) ? .prepare : .details
            } catch {
                busy = false
                problem = "Couldn't continue. Check your connection and try again."
            }
        }
    }

    private func advanceFromDetails() { stage = .prepare }

    private func beginCapture() {
        problem = nil
        let first = draft.nextView ?? .front
        camera.view = first
        stage = .capture(first)
        Task { await camera.start() }
    }

    private func retake(_ view: BodyScanView) {
        draft.retake(view)
        camera.view = view
        stage = .capture(view)
        Task { await camera.start() }
    }

    private func cancelCapture() {
        camera.stop()
        stage = draft.views.isEmpty ? .prepare : .review
    }

    private func save() {
        guard draft.isComplete, !busy else { return }
        busy = true
        problem = nil
        stage = .saving
        let draft = self.draft
        Task {
            do {
                savingStep = "Preparing"
                let _: BodyScanStartResult = try await ConvexClientProvider.client.mutation("bodyScans:start", with: [
                    "scanId": draft.scanId,
                    "capture": BodyScanCaptureInfo.current(),
                ])
                serverScanStarted = true
                for view in BodyScanView.allCases {
                    guard let c = draft.views[view] else { continue }
                    savingStep = "Saving \(view.rawValue) view"
                    let storageId = try await BodyScanUpload.upload(c.jpeg)
                    let attached: BodyScanAttachResult = try await ConvexClientProvider.client.mutation("bodyScans:attachView", with: [
                        "scanId": draft.scanId,
                        "view": view.rawValue,
                        "storageId": storageId,
                        "width": Double(c.width),
                        "height": Double(c.height),
                        "qualityScore": c.qualityScore,
                        "issues": c.issues.map { $0.rawValue as ConvexEncodable? },
                        "capturedAt": c.capturedAt.timeIntervalSince1970 * 1000,
                    ])
                    guard attached.ok else { throw BodyScanSaveError.refused(view, attached.error ?? "") }
                }
                savingStep = "Finishing"
                let _: BodyScanCompleteResult = try await ConvexClientProvider.client.mutation("bodyScans:complete", with: ["scanId": draft.scanId])
                busy = false
                savedTick += 1
                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { showResults = true }
            } catch BodyScanSaveError.refused(let view, _) {
                busy = false
                problem = "The \(view.rawValue) view couldn't be saved. Please retake it."
                stage = .review
            } catch {
                busy = false
                problem = "Couldn't save the scan. Check your connection and try again — your photos are still here."
                stage = .review
            }
        }
    }

    private func startNewScan() {
        draft = BodyScanDraft()
        serverScanStarted = false
        showResults = false
        stage = profile.value.map { firstStage($0) }
    }

    /// Leaving before saving discards anything already sent (a scan is only
    /// kept once it's complete). The photos on the phone go with the view.
    private func close() {
        camera.stop()
        if serverScanStarted, !showResults {
            let id = draft.scanId
            Task { try? await ConvexClientProvider.client.mutation("bodyScans:discard", with: ["scanId": id]) }
        }
        dismiss()
    }
}

// MARK: - Capture screen

struct BodyScanCaptureScreen: View {
    let camera: BodyScanCameraModel
    let view: BodyScanView
    let captured: Int
    let onCancel: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch camera.status {
            case .running, .starting:
                BodyScanPreview(session: camera.engine.session)
                    .ignoresSafeArea()
                BodyFrameGuide(joints: camera.joints, ready: camera.assessment.ready, counting: camera.countdown != nil)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            case .denied:
                cameraNotice("Camera access is off", "Allow camera access for Sombrey in iPhone Settings to take your scan.", settingsLink: true)
            case .unavailable:
                cameraNotice("Camera unavailable", "The front camera couldn't start. Close other camera apps and try again.", settingsLink: false)
            }
            chrome
        }
        .statusBarHidden()
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel", action: onCancel)
                    .font(StudioFont.body(15, weight: .medium))
                    .foregroundStyle(StudioColor.paper)
                    .frame(minHeight: 44)
                Spacer()
                VStack(spacing: 2) {
                    Text(view.title.uppercased())
                        .font(StudioFont.body(13, weight: .semibold)).tracking(2).foregroundStyle(StudioColor.paper)
                    HStack(spacing: 5) {
                        ForEach(BodyScanView.allCases) { v in
                            Capsule().fill(v == view ? StudioColor.paper : StudioColor.paper.opacity(0.3)).frame(width: v == view ? 18 : 8, height: 3)
                        }
                    }
                    .accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(view.title) view, \(BodyScanView.allCases.firstIndex(of: view).map { $0 + 1 } ?? 1) of 3")
                Spacer()
                Color.clear.frame(width: 60, height: 44)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            Text(view.instruction)
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.paperSoft)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.top, 6)

            Spacer()

            if let n = camera.countdown {
                Text("\(n)")
                    .font(StudioFont.hero(88, weight: .bold))
                    .foregroundStyle(StudioColor.paper)
                    .contentTransition(.numericText())
                    .accessibilityLabel("Capturing in \(n)")
                    .transition(.opacity)
            }

            Spacer()

            VStack(spacing: 14) {
                Text(camera.capturing ? "Capturing…" : (camera.captureFailed ? "That didn't capture — hold still and try again" : camera.assessment.instruction))
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background { Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .light) }
                    .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: camera.assessment.instruction)
                    .accessibilityAddTraits(.updatesFrequently)
                    .accessibilityIdentifier("bodyScan.instruction")
                Button { camera.captureNow() } label: {
                    ZStack {
                        Circle().strokeBorder(StudioColor.paper.opacity(camera.assessment.ready ? 0.95 : 0.35), lineWidth: 3).frame(width: 72, height: 72)
                        Circle().fill(StudioColor.paper.opacity(camera.assessment.ready ? 0.9 : 0.2)).frame(width: 58, height: 58)
                    }
                }
                .disabled(!camera.assessment.ready || camera.capturing)
                .accessibilityLabel("Capture \(view.title.lowercased()) view")
                .accessibilityHint(camera.assessment.ready ? "Captures now" : camera.assessment.instruction)
            }
            .padding(.bottom, 30)
        }
    }

    private func cameraNotice(_ title: String, _ message: String, settingsLink: Bool) -> some View {
        VStack(spacing: 12) {
            Text(title).font(StudioFont.hero(22, weight: .semibold)).foregroundStyle(StudioColor.paper)
            Text(message).font(StudioFont.body(14)).foregroundStyle(StudioColor.paperSoft).multilineTextAlignment(.center)
            if settingsLink, let url = URL(string: UIApplication.openSettingsURLString) {
                Link("Open Settings", destination: url)
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                    .frame(minHeight: 44)
            }
        }
        .padding(32)
    }
}

/// Sombrey's body frame: where the head, shoulders and feet belong, drawn
/// as quiet guide marks — and the user's own detected outline (shoulders,
/// hips, knees, ankles) over it, so the frame reacts as they move. It lights
/// only when the pose qualifies.
struct BodyFrameGuide: View {
    let joints: [BodyJoint: JointPoint]
    let ready: Bool
    let counting: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Guide positions (fraction of the frame): head top, shoulders, feet.
    static let headTop = 0.07, shoulders = 0.22, feet = 0.93, halfWidth = 0.19

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let guideColor = ready ? StudioColor.accentInkDark : StudioColor.paper.opacity(0.55)
            ZStack {
                // Guide marks: head arc, shoulder line, feet line, side rails.
                Path { p in
                    let x0 = size.width * (0.5 - Self.halfWidth), x1 = size.width * (0.5 + Self.halfWidth)
                    let yHead = size.height * Self.headTop, yShoulder = size.height * Self.shoulders, yFeet = size.height * Self.feet
                    p.addArc(center: CGPoint(x: size.width / 2, y: yHead + size.width * 0.06), radius: size.width * 0.06, startAngle: .degrees(200), endAngle: .degrees(340), clockwise: false)
                    p.move(to: CGPoint(x: x0, y: yShoulder)); p.addLine(to: CGPoint(x: x1, y: yShoulder))
                    p.move(to: CGPoint(x: x0 - 12, y: yFeet)); p.addLine(to: CGPoint(x: x1 + 12, y: yFeet))
                    for x in [x0 - 18, x1 + 18] {
                        p.move(to: CGPoint(x: x, y: yShoulder + 20)); p.addLine(to: CGPoint(x: x, y: yFeet - 20))
                    }
                }
                .stroke(guideColor, style: StrokeStyle(lineWidth: ready ? 2 : 1.2, lineCap: .round, dash: ready ? [] : [4, 6]))
                .shadow(color: ready ? StudioColor.accent.opacity(0.45) : .clear, radius: 8)

                // The user's detected outline.
                Path { p in
                    let pt: (BodyJoint) -> CGPoint? = { j in
                        guard let jp = joints[j], jp.confidence >= 0.3 else { return nil }
                        return BodyScanGeometry.point(jp, frameAspect: 0.75, in: size)
                    }
                    let chains: [[BodyJoint]] = [
                        [.leftShoulder, .rightShoulder], [.leftShoulder, .leftHip, .leftKnee, .leftAnkle],
                        [.rightShoulder, .rightHip, .rightKnee, .rightAnkle], [.leftHip, .rightHip],
                    ]
                    for chain in chains {
                        let points = chain.compactMap(pt)
                        guard points.count == chain.count, let first = points.first else { continue }
                        p.move(to: first)
                        for q in points.dropFirst() { p.addLine(to: q) }
                    }
                }
                .stroke(StudioColor.paper.opacity(counting ? 0.9 : 0.5), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            }
            .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: ready)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Details (only what's missing)

/// Height, weight, sex and birth date — asked here only when Sombrey doesn't
/// already have them, and editable any time in Settings. Never body
/// circumferences: those are the scanner's future job, not the user's.
struct BodyDetailsForm: View {
    let profile: BodyScanProfileDTO?
    let onSaved: () -> Void
    @State private var height = ""
    @State private var weight = ""
    @State private var sex = "male"
    @State private var birthDate = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var saving = false
    @State private var problem: String?

    private var missing: Set<String> { Set(profile?.missing ?? []) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("YOUR DETAILS").font(StudioFont.body(11, weight: .semibold)).tracking(1.8).foregroundStyle(StudioColor.inkSoft)
                Text("A few details, once").font(StudioFont.hero(30, weight: .semibold)).foregroundStyle(StudioColor.ink).accessibilityAddTraits(.isHeader)
                Text("Saved with each scan so they're compared fairly. Change them any time in Settings — earlier scans keep the values they had.")
                    .font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 16)
            if missing.contains("height") { numberField("HEIGHT", "cm", $height, "Height in centimetres") }
            if missing.contains("weight") { numberField("WEIGHT", "kg", $weight, "Weight in kilograms") }
            if missing.contains("sex") {
                VStack(alignment: .leading, spacing: 8) {
                    label("SEX")
                    StudioModePills(options: [
                        StudioModeOption(value: "male", label: "MALE", accessibilityLabel: "Male"),
                        StudioModeOption(value: "female", label: "FEMALE", accessibilityLabel: "Female"),
                        StudioModeOption(value: "other", label: "OTHER", accessibilityLabel: "Other"),
                    ], selection: $sex)
                }
            }
            if missing.contains("age") {
                VStack(alignment: .leading, spacing: 8) {
                    label("DATE OF BIRTH")
                    DatePicker("Date of birth", selection: $birthDate, in: ...Date(), displayedComponents: .date)
                        .labelsHidden()
                        .tint(StudioColor.ink)
                        .frame(minHeight: 44)
                }
            }
            if let problem { Text(problem).font(StudioFont.body(13)).foregroundStyle(StudioColor.caution) }
            Button { save() } label: {
                Group { if saving { ProgressView().tint(StudioColor.ink) } else { Text("Continue") } }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .disabled(saving)
        }
    }

    private func label(_ s: String) -> some View {
        Text(s).font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
    }

    private func numberField(_ title: String, _ unit: String, _ text: Binding<String>, _ a11y: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label(title)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                TextField("0", text: text)
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .keyboardType(.decimalPad)
                    .accessibilityLabel(a11y)
                Text(unit).font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft)
            }
            .padding(14)
            .background { SombreyGlassChamber(cornerRadius: 16) }
        }
    }

    private func save() {
        var args: [String: ConvexEncodable?] = [:]
        if missing.contains("height") {
            guard let h = BodyDetailsInput.number(height), (100...250).contains(h) else { problem = "Enter a height between 100 and 250 cm."; return }
            args["heightCm"] = h
        }
        if missing.contains("weight") {
            guard let w = BodyDetailsInput.number(weight), (20...400).contains(w) else { problem = "Enter a weight between 20 and 400 kg."; return }
            args["weightKg"] = w
        }
        if missing.contains("sex") { args["sex"] = sex }
        if missing.contains("age") { args["dateOfBirth"] = BodyDetailsInput.isoDate(birthDate) }
        saving = true
        problem = nil
        Task {
            do {
                try await ConvexClientProvider.client.mutation("bodyScans:updateProfile", with: args)
                saving = false
                onSaved()
            } catch {
                saving = false
                problem = "Couldn't save your details. Check your connection and try again."
            }
        }
    }
}

/// Input parsing shared by the details form and Settings.
enum BodyDetailsInput {
    /// "178", "178.5" or "178,5" → 178.5; anything else → nil.
    nonisolated static func number(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let v = Double(t), v.isFinite else { return nil }
        return v
    }

    nonisolated static func isoDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

// MARK: - History

/// The user's scans: the latest (its three views), then earlier ones. Each
/// scan stays its own record; nothing here is a measurement.
struct BodyScanHistoryView: View {
    let onNewScan: () -> Void
    @State private var scans = ConvexQuery<[BodyScanDTO]>()
    @State private var selected: String?
    @State private var confirmingDelete: BodyScanDTO?

    private var saved: [BodyScanDTO] { (scans.value ?? []).filter { $0.status == "complete" } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let scan = saved.first(where: { $0.scanId == selected }) ?? saved.first {
                    header(scan)
                    HStack(spacing: 10) {
                        ForEach(BodyScanView.allCases) { v in
                            VStack(spacing: 6) {
                                BodyScanImageView(scanId: scan.scanId, view: v)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 220)
                                    .background { SombreyGlassChamber(cornerRadius: 16) }
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                Text(v.title.uppercased()).font(StudioFont.body(10, weight: .semibold)).tracking(1.4).foregroundStyle(StudioColor.inkSoft)
                            }
                        }
                    }
                    if let line = Self.contextLine(scan.context) {
                        Text(line).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
                    }
                    if saved.count > 1 { earlier }
                    Text("A private, consistent record for seeing how your body changes. Sombrey doesn't estimate body fat or measurements from these photos yet.")
                        .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint).fixedSize(horizontal: false, vertical: true)
                    Button("Delete this scan", role: .destructive) { confirmingDelete = scan }
                        .font(StudioFont.body(13, weight: .medium))
                        .frame(minHeight: 44)
                } else if scans.isLoading {
                    ProgressView().tint(StudioColor.ink).padding(.top, 60).frame(maxWidth: .infinity)
                } else {
                    Text("No scans yet.").font(StudioFont.hero(22, weight: .semibold)).foregroundStyle(StudioColor.ink).padding(.top, 40)
                }
                Button { onNewScan() } label: { Text("New scan").frame(maxWidth: .infinity) }
                    .buttonStyle(.illuminatedCTA)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .task { scans.subscribe(to: "bodyScans:list") }
        .confirmationDialog("Delete this scan?", isPresented: Binding(get: { confirmingDelete != nil }, set: { if !$0 { confirmingDelete = nil } }), titleVisibility: .visible, presenting: confirmingDelete) { scan in
            Button("Delete scan and photos", role: .destructive) { delete(scan) }
        } message: { _ in
            Text("Its three photos are permanently removed.")
        }
    }

    private func header(_ scan: BodyScanDTO) -> some View {
        let isBaseline = saved.last?.scanId == scan.scanId
        return VStack(alignment: .leading, spacing: 6) {
            Text(isBaseline ? "BASELINE" : "BODY SCAN").font(StudioFont.body(11, weight: .semibold)).tracking(1.8).foregroundStyle(StudioColor.inkSoft)
            Text(scan.date.formatted(.dateTime.day().month(.wide).year())).font(StudioFont.hero(30, weight: .semibold)).foregroundStyle(StudioColor.ink)
            Text("3 views · private to your account").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft)
        }
        .padding(.top, 16)
    }

    private var earlier: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("YOUR SCANS").font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
            ForEach(saved) { scan in
                Button { selected = scan.scanId } label: {
                    HStack {
                        Text(scan.date.formatted(.dateTime.day().month(.abbreviated).year()))
                            .font(StudioFont.body(14, weight: (selected ?? saved.first?.scanId) == scan.scanId ? .semibold : .regular))
                            .foregroundStyle(StudioColor.ink)
                        Spacer()
                        if saved.last?.scanId == scan.scanId { Text("Baseline").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkSoft) }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// The user's own recorded values at the time of the scan, labelled —
    /// never an estimate.
    nonisolated static func contextLine(_ c: BodyScanProfileDTO.Context) -> String? {
        var parts: [String] = []
        if let h = c.heightCm { parts.append("\(Int(h.rounded())) cm") }
        if let w = c.weightKg { parts.append(String(format: "%.1f kg", w)) }
        guard !parts.isEmpty else { return nil }
        return "Your recorded details at this scan: " + parts.joined(separator: " · ")
    }

    private func delete(_ scan: BodyScanDTO) {
        Task { try? await ConvexClientProvider.client.mutation("bodyScans:remove", with: ["scanId": scan.scanId]) }
        if selected == scan.scanId { selected = nil }
    }
}

/// One view of one scan, loaded from the authenticated endpoint into memory
/// only — no URL is ever held, nothing is written to disk.
struct BodyScanImageView: View {
    let scanId: String
    let view: BodyScanView
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if failed {
                Text("Couldn't load").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
            } else {
                ProgressView().tint(StudioColor.ink)
            }
        }
        .task(id: "\(scanId)/\(view.rawValue)") {
            image = nil
            failed = false
            do { image = try await BodyScanImageLoader.load(scanId: scanId, view: view) } catch { failed = true }
        }
        .accessibilityLabel("\(view.title) view")
    }
}

// MARK: - Networking

enum BodyScanImageLoader {
    /// Ephemeral: no cookies, no URL cache, nothing on disk.
    private static let session = URLSession(configuration: .ephemeral)

    static func request(scanId: String, view: BodyScanView, token: String, site: URL) -> URLRequest {
        var components = URLComponents(url: site.appendingPathComponent("body-scan-image"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "scanId", value: scanId), URLQueryItem(name: "view", value: view.rawValue)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    @MainActor
    static func load(scanId: String, view: BodyScanView) async throws -> UIImage {
        let token = try await ClerkConvexAuthProvider.convexToken()
        let (data, response) = try await session.data(for: request(scanId: scanId, view: view, token: token, site: ConvexClientProvider.siteUrl))
        guard (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data) else { throw URLError(.badServerResponse) }
        return image
    }
}

enum BodyScanUpload {
    private struct UploadResponse: Decodable { let storageId: String }

    /// Uploads one normalised JPEG through a consent-gated upload URL.
    @MainActor
    static func upload(_ jpeg: Data) async throws -> String {
        let uploadUrl: String = try await ConvexClientProvider.client.mutation("bodyScans:generateUploadUrl")
        guard let url = URL(string: uploadUrl) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let (body, response) = try await URLSession(configuration: .ephemeral).upload(for: request, from: jpeg)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(UploadResponse.self, from: body).storageId
    }
}

/// The capture conditions stored with each scan (protocol 5a.1) — nothing
/// that identifies the phone beyond its model.
struct BodyScanCaptureInfo: ConvexEncodable, Encodable {
    let deviceModel: String
    let osVersion: String
    let appVersion: String
    let camera: String
    let imageMaxPixel: Double
    let jpegQuality: Double

    @MainActor
    static func current() -> BodyScanCaptureInfo {
        var system = utsname()
        uname(&system)
        let model = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
        let info = Bundle.main.infoDictionary
        let version = "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
        return BodyScanCaptureInfo(
            deviceModel: model.isEmpty ? "unknown" : model,
            osVersion: "iOS \(UIDevice.current.systemVersion)",
            appVersion: version,
            camera: "front",
            imageMaxPixel: Double(BodyScanImageSpec.maxPixel),
            jpegQuality: BodyScanImageSpec.jpegQuality
        )
    }
}

struct BodyScanStartResult: Decodable { let scanId: String; let status: String }
enum BodyScanSaveError: Error { case refused(BodyScanView, String) }
/// `bodyScans:attachView`: ok, or a validation refusal (the upload was deleted).
struct BodyScanAttachResult: Decodable {
    let ok: Bool
    let view: String
    var replaced: Bool? = nil
    var error: String? = nil
}
struct BodyScanCompleteResult: Decodable { let status: String }
