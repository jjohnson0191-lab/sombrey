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
// through a URL (convex/bodyScans.ts, convex/http.ts).
//
// Phase 5C: where the phone can measure distance (TrueDepth on the front, or
// the optional LiDAR rear mode) each view also yields scale evidence, and the
// server derives measurements with uncertainty. Only measurements that pass
// their checks are shown — on development builds, labelled as unvalidated
// scanner estimates. The profile's height and weight are never changed.

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
    /// On-device CV per view, started as soon as the view is captured.
    @State private var cvTasks: [BodyScanView: Task<ViewFeatures?, Never>] = [:]
    /// What this device can measure (hardware; decided once).
    @State private var capabilities = BodyScanCapabilities(trueDepth: false, lidar: false)
    /// Front (standard) or rear (LiDAR). Fixed once a view is captured.
    @State private var captureMode: BodyScanCaptureMode = .front

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
        .task {
            capabilities = BodyScanDepthCapture.capabilities()
            profile.subscribe(to: "bodyScans:profile")
        }
        .onChange(of: profile.value) { _, p in
            if stage == nil, let p, !showResults { stage = firstStage(p) }
        }
        .onAppear {
            camera.onCapture = { view, captured in
                draft.record(view, captured)
                capturedTick += 1
                camera.stop()
                startProcessing(view, captured)
                stage = draft.afterCapture(view)
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
            case .viewReview(let v): scroll { viewReview(v) }
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
            if capabilities.offersRearMode { modeChoice }
            VStack(alignment: .leading, spacing: 10) {
                if captureMode == .rear {
                    point("iphone", "Stand your phone upright at about waist height against something steady, with its back camera facing where you'll stand.")
                    point("figure.stand", "Your spot is about 2 m in front of the back camera. Check the frame on screen once, then tap Start.")
                    point("speaker.wave.2", "You'll have 15 seconds to walk to your spot. The screen faces away, so Sombrey tells you out loud what to adjust, counts down and says when it's done.")
                    point("sun.max", "Face even light; a plain wall behind you works best.")
                } else {
                    point("iphone", "Stand your phone upright at about waist height, against something steady.")
                    point("figure.stand", "Step back about 1.5 m, until the frame holds your whole body, head to feet.")
                    point("sun.max", "Face even light; a plain wall behind you works best.")
                    point("timer", "Tap Start, then hold still when the frame lights — Sombrey captures each view by itself.")
                }
            }
            Text(capabilities.summary(for: captureMode))
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("bodyScan.capability")
            if let problem { problemText(problem) }
            Button { beginCapture() } label: { Text("Open camera").frame(maxWidth: .infinity) }
                .buttonStyle(.illuminatedCTA)
                .accessibilityIdentifier("bodyScan.begin")
        }
    }

    /// LiDAR devices only: the standard front scan, or the back camera's
    /// distance measurement. Plain words, no technical mode names.
    private var modeChoice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("HOW TO SCAN")
                .font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
            Picker("How to scan", selection: $captureMode) {
                Text("Front camera").tag(BodyScanCaptureMode.front)
                Text("Back camera · measures distance").tag(BodyScanCaptureMode.rear)
            }
            .pickerStyle(.segmented)
            .disabled(!draft.views.isEmpty)
            .accessibilityIdentifier("bodyScan.mode")
            Text(captureMode == .rear
                 ? "The back camera's LiDAR measures how far away you are, for measurements. You won't see yourself while it scans."
                 : "You see yourself while you scan. Measurements depend on this iPhone's front sensor.")
                .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
        }
    }

    nonisolated static func clothingGuidance(_ sex: String?) -> String {
        switch sex {
        case "male": return "Shirtless, with shorts or fitted athletic bottoms."
        case "female": return "A sports bra, with fitted shorts or athletic leggings."
        default: return "Close-fitting athletic wear — a fitted top or sports bra, with shorts or leggings."
        }
    }

    // MARK: One view's review

    private func viewReview(_ v: BodyScanView) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            header("\(v.title.uppercased()) VIEW", "Check this view", "Your whole body, head to feet, standing as asked. Use it, or retake just this view.")
            ZStack {
                if let c = draft.views[v], let image = UIImage(data: c.jpeg) {
                    Image(uiImage: image).resizable().scaledToFit()
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 420)
            .background { SombreyGlassChamber(cornerRadius: 20) }
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .accessibilityLabel("\(v.title) view as captured")
            VStack(spacing: 10) {
                Button { accept(v) } label: { Text(draft.nextView == nil || draft.retaking == v ? "Use photo" : "Use photo — next view").frame(maxWidth: .infinity) }
                    .buttonStyle(.illuminatedCTA)
                    .accessibilityIdentifier("bodyScan.usePhoto")
                Button { recapture(v) } label: { Text("Retake").frame(maxWidth: .infinity) }
                    .buttonStyle(.outlineCTA)
                    .accessibilityIdentifier("bodyScan.retakeView")
            }
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
        openCamera(first)
    }

    private func openCamera(_ view: BodyScanView) {
        camera.use(captureMode)
        camera.view = view
        stage = .capture(view)
        Task { await camera.start() }
    }

    /// From the full review: retake one view, then come back to the review.
    private func retake(_ view: BodyScanView) {
        cvTasks[view]?.cancel()
        cvTasks[view] = nil
        draft.retake(view)
        openCamera(view)
    }

    /// From a view's own review: capture it again.
    private func recapture(_ view: BodyScanView) {
        cvTasks[view]?.cancel()
        cvTasks[view] = nil
        draft.recapture(view)
        openCamera(view)
    }

    private func accept(_ view: BodyScanView) {
        let next = draft.afterAccepting(view)
        if case .capture(let v) = next { openCamera(v) } else { stage = next }
    }

    /// Phase 5B: Apple Vision on the phone, off the main thread, as soon as a
    /// view is captured — segmentation + pose → scale-free features. The
    /// image isn't sent anywhere for this.
    private func startProcessing(_ view: BodyScanView, _ captured: CapturedView) {
        cvTasks[view]?.cancel()
        let jpeg = captured.jpeg, depth = captured.depth, score = captured.qualityScore
        let brightness = captured.conditions?.brightness
        let still = !captured.issues.contains(.motion)
        cvTasks[view] = Task.detached(priority: .utility) {
            BodyScanVision.process(jpeg: jpeg, depth: depth, view: view, captureScore: score, brightness: brightness, subjectStill: still)?.features
        }
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
        let mode = captureMode
        // The depth source this scan captured with: the rear mode is LiDAR by
        // definition; the front camera records TrueDepth only if a view
        // actually carried depth. (No evidence → no metric scale either way.)
        let depthSource: BodyScanDepthSource = mode == .rear ? .lidar : (draft.views.values.compactMap(\.depth).first?.source ?? .none)
        Task {
            do {
                savingStep = "Preparing"
                let _: BodyScanStartResult = try await ConvexClientProvider.client.mutation("bodyScans:start", with: [
                    "scanId": draft.scanId,
                    "capture": BodyScanCaptureInfo.current(mode: mode, depth: depthSource),
                ])
                serverScanStarted = true
                for view in BodyScanView.allCases {
                    guard let c = draft.views[view] else { continue }
                    savingStep = "Saving \(view.rawValue) view"
                    let storageId = try await BodyScanUpload.upload(c.jpeg)
                    var args: [String: ConvexEncodable?] = [
                        "scanId": draft.scanId,
                        "view": view.rawValue,
                        "storageId": storageId,
                        "width": Double(c.width),
                        "height": Double(c.height),
                        "qualityScore": c.qualityScore,
                        "issues": c.issues.map { $0.rawValue as ConvexEncodable? },
                        "capturedAt": c.capturedAt.timeIntervalSince1970 * 1000,
                    ]
                    // Added only when present: an explicit null isn't "absent" to Convex.
                    if let conditions = c.conditions { args["conditions"] = ConditionsPayload(conditions) }
                    let attached: BodyScanAttachResult = try await ConvexClientProvider.client.mutation("bodyScans:attachView", with: args)
                    guard attached.ok else { throw BodyScanSaveError.refused(view, attached.error ?? "") }
                }
                savingStep = "Finishing"
                let _: BodyScanCompleteResult = try await ConvexClientProvider.client.mutation("bodyScans:complete", with: ["scanId": draft.scanId])
                // The scan is saved. Its on-device features follow; if that
                // fails the scan stays saved (features can be re-derived).
                savingStep = "Finishing analysis"
                var views: [ViewFeatures] = []
                for v in BodyScanView.allCases { if let f = await cvTasks[v]?.value { views.append(f) } }
                if !views.isEmpty {
                    try? await BodyScanFeatureUpload.send(scanId: draft.scanId, set: BodyScanFeatureExtractor.combine(views, scaleSource: depthSource))
                }
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
        captureMode = .front
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

/// Dev builds (a non-production backend) can tune the gates on the phone.
enum BodyScanDevTools {
    static var enabled: Bool { ConvexClientProvider.deploymentUrl != ConvexClientProvider.productionUrl }
}

/// The front camera with Sombrey's body frame, the live instruction, and the
/// hands-free self-timer: Start → 10…4 get into position → 3-2-1 hold still
/// (paused, with the reason, whenever the frame stops qualifying) → capture.
struct BodyScanCaptureScreen: View {
    let camera: BodyScanCameraModel
    let view: BodyScanView
    let captured: Int
    let onCancel: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tuning = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch camera.status {
            case .running, .starting:
                if camera.mode == .rear {
                    BodyScanARPreview(session: camera.lidar.session).ignoresSafeArea()
                } else {
                    BodyScanPreview(session: camera.engine.session).ignoresSafeArea()
                }
                BodyFrameGuide(config: camera.config, joints: camera.joints, ready: camera.assessment.ready, holding: camera.countdown.isHolding)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            case .denied:
                cameraNotice("Camera access is off", "Allow camera access for Sombrey in iPhone Settings to take your scan.", settingsLink: true)
            case .unavailable:
                cameraNotice("Camera unavailable", camera.mode == .rear
                    ? "The back camera couldn't start. Close other camera apps and try again, or use the front camera."
                    : "The front camera couldn't start. Close other camera apps and try again.", settingsLink: false)
            }
            chrome
        }
        .statusBarHidden()
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.5), trigger: camera.holdTick)
        .sheet(isPresented: $tuning) { BodyScanTuningView(camera: camera) }
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            HStack {
                Button(camera.countdown.isActive ? "Stop" : "Cancel") {
                    if camera.countdown.isActive { camera.cancelCountdown() } else { onCancel() }
                }
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
                if BodyScanDevTools.enabled {
                    Button("Tune") { tuning = true }
                        .font(StudioFont.body(13, weight: .medium)).foregroundStyle(StudioColor.paper).frame(minWidth: 60, minHeight: 44)
                } else {
                    Color.clear.frame(width: 60, height: 44)
                }
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
            countdownDisplay
            Spacer()

            VStack(spacing: 14) {
                Text(statusLine)
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background { Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .light) }
                    .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: statusLine)
                    .accessibilityAddTraits(.updatesFrequently)
                    .accessibilityIdentifier("bodyScan.instruction")
                if !camera.countdown.isActive && !camera.capturing {
                    Button { camera.startCountdown() } label: {
                        Text("Start").frame(maxWidth: 220)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(camera.status != .running)
                    .accessibilityHint(camera.mode == .rear
                        ? "Starts a 15 second timer with spoken guidance. Walk to your spot facing the back camera and hold still; the photo is taken automatically."
                        : "Starts a 10 second timer. Place the phone, step into the frame and hold still; the photo is taken automatically.")
                    .accessibilityIdentifier("bodyScan.startTimer")
                }
                if BodyScanDevTools.enabled { diagnostics }
            }
            .padding(.bottom, 30)
        }
    }

    /// 10…4: get into position. 3-2-1: hold still (paused if not valid).
    @ViewBuilder
    private var countdownDisplay: some View {
        if let n = camera.countdown.remaining, !camera.capturing {
            VStack(spacing: 6) {
                Text("\(n)")
                    .font(StudioFont.hero(camera.countdown.isHolding || camera.countdown.isPaused ? 140 : 112, weight: .bold))
                    .foregroundStyle(camera.countdown.isPaused ? StudioColor.paper.opacity(0.45) : StudioColor.paper)
                    .monospacedDigit()
                    .contentTransition(reduceMotion ? .identity : .numericText(countsDown: true))
                    .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: n)
                Text(camera.countdown.isPaused ? "PAUSED" : (camera.countdown.isHolding ? "HOLD STILL" : "GET INTO POSITION"))
                    .font(StudioFont.body(12, weight: .semibold)).tracking(2).foregroundStyle(StudioColor.paperSoft)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(camera.countdown.isPaused ? "Paused: \(camera.assessment.instruction)" : "Capturing in \(n)")
        } else if camera.capturing {
            Text("Capturing…").font(StudioFont.hero(28, weight: .semibold)).foregroundStyle(StudioColor.paper)
        }
    }

    private var statusLine: String {
        if camera.capturing { return "Hold still" }
        if camera.captureFailed { return "That didn't capture — tap Start to try again" }
        if camera.countdown.isPaused { return "Paused — \(camera.assessment.instruction)" }
        if camera.countdown.isActive && !camera.countdown.isHolding { return camera.assessment.ready ? "In position — stay there" : camera.assessment.instruction }
        if camera.countdown.isHolding { return "Hold still" }
        return camera.assessment.ready ? "Ready — tap Start" : "Tap Start, then \(camera.assessment.instruction.lowercased())"
    }

    /// Dev builds: what the gates measure right now.
    private var diagnostics: some View {
        let m = camera.assessment.measured
        let f = { (k: String) in m[k].map { String(format: "%.2f", $0) } ?? "—" }
        return Text("span \(f("span")) · centre \(f("centre")) · facing \(f("facingRatio")) · pitch \(f("pitch"))° · roll \(f("roll"))° · light \(f("brightness"))")
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(StudioColor.paperSoft)
            .padding(.horizontal, 12)
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

/// Sombrey's body frame: a full-height figure showing exactly where the
/// head, shoulders and feet belong — drawn from the SAME configuration the
/// gates check, mapped through the same preview geometry — with the user's
/// detected outline over it. It lights only when the pose qualifies.
struct BodyFrameGuide: View {
    let config: BodyScanProtocolConfig
    let joints: [BodyJoint: JointPoint]
    let ready: Bool
    let holding: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Guide landmarks in frame coordinates (0–1), from the gate config.
    struct Landmarks: Equatable {
        let headTop, nose, shoulders, hips, knees, ankles, feet: Double
        let shoulderHalfWidth, hipHalfWidth, footHalfWidth: Double

        init(_ c: BodyScanProtocolConfig, aspect: Double = 0.75) {
            let span = c.guideSpan                     // nose → ankles
            nose = c.guideNoseY
            ankles = c.guideAnkleY
            let h = span / 0.87                        // ≈ standing height (nose→ankle ≈ 0.87 H)
            headTop = max(0.005, nose - 0.07 * h)
            shoulders = nose + 0.12 * h
            hips = nose + 0.43 * h
            knees = nose + 0.66 * h
            feet = min(0.995, ankles + 0.03 * h)
            // Widths in frame-x units (heights are in frame-y units).
            shoulderHalfWidth = 0.13 * h / aspect
            hipHalfWidth = 0.10 * h / aspect
            footHalfWidth = 0.09 * h / aspect
        }
    }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let g = Landmarks(config)
            let pt: (Double, Double) -> CGPoint = { x, y in BodyScanGeometry.point(JointPoint(x: x, y: y, confidence: 1), frameAspect: 0.75, in: size) }
            let guideColor = ready ? StudioColor.accentInkDark : StudioColor.paper.opacity(0.6)
            ZStack {
                Path { p in
                    // Head.
                    let headCentre = pt(0.5, (g.headTop + g.shoulders) / 2 - 0.02)
                    let headR = (pt(0.5, g.shoulders).y - pt(0.5, g.headTop).y) * 0.42
                    p.addEllipse(in: CGRect(x: headCentre.x - headR * 0.8, y: pt(0.5, g.headTop).y, width: headR * 1.6, height: headR * 2))
                    // Shoulders → arms (A-pose) and torso.
                    let ls = pt(0.5 - g.shoulderHalfWidth, g.shoulders), rs = pt(0.5 + g.shoulderHalfWidth, g.shoulders)
                    p.move(to: ls); p.addLine(to: rs)
                    p.move(to: ls); p.addLine(to: pt(0.5 - g.shoulderHalfWidth * 1.45, g.hips + 0.02))
                    p.move(to: rs); p.addLine(to: pt(0.5 + g.shoulderHalfWidth * 1.45, g.hips + 0.02))
                    p.move(to: ls); p.addLine(to: pt(0.5 - g.hipHalfWidth, g.hips))
                    p.move(to: rs); p.addLine(to: pt(0.5 + g.hipHalfWidth, g.hips))
                    // Legs to the feet line.
                    p.move(to: pt(0.5 - g.hipHalfWidth, g.hips)); p.addLine(to: pt(0.5 - g.footHalfWidth, g.feet))
                    p.move(to: pt(0.5 + g.hipHalfWidth, g.hips)); p.addLine(to: pt(0.5 + g.footHalfWidth, g.feet))
                    p.move(to: pt(0.5 - g.hipHalfWidth, g.hips)); p.addLine(to: pt(0.5 + g.hipHalfWidth, g.hips))
                    // Feet line — where the feet stand.
                    p.move(to: pt(0.5 - g.footHalfWidth * 2, g.feet)); p.addLine(to: pt(0.5 + g.footHalfWidth * 2, g.feet))
                }
                .stroke(guideColor, style: StrokeStyle(lineWidth: ready ? 2.2 : 1.4, lineCap: .round, lineJoin: .round, dash: ready ? [] : [5, 7]))
                .shadow(color: ready ? StudioColor.accent.opacity(0.45) : .clear, radius: 10)

                // The user's detected outline.
                Path { p in
                    let jp: (BodyJoint) -> CGPoint? = { j in
                        guard let v = joints[j], v.confidence >= 0.3 else { return nil }
                        return BodyScanGeometry.point(v, frameAspect: 0.75, in: size)
                    }
                    let chains: [[BodyJoint]] = [
                        [.leftShoulder, .rightShoulder], [.leftShoulder, .leftHip, .leftKnee, .leftAnkle],
                        [.rightShoulder, .rightHip, .rightKnee, .rightAnkle], [.leftHip, .rightHip],
                        [.leftShoulder, .leftElbow, .leftWrist], [.rightShoulder, .rightElbow, .rightWrist],
                    ]
                    for chain in chains {
                        let points = chain.compactMap(jp)
                        guard points.count == chain.count, let first = points.first else { continue }
                        p.move(to: first)
                        for q in points.dropFirst() { p.addLine(to: q) }
                    }
                }
                .stroke(StudioColor.paper.opacity(holding ? 0.95 : 0.55), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            }
            .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: ready)
        }
        .accessibilityHidden(true)
    }
}

/// Dev builds only: tune the gates on the phone during physical testing.
/// Tuned values are recorded with every captured view ("tuned:…").
struct BodyScanTuningView: View {
    let camera: BodyScanCameraModel
    @State private var c = BodyScanProtocolConfig.standard
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Distance (nose-to-ankle span of the frame)") {
                    Stepper("Min span \(String(format: "%.2f", c.spanMin))", value: $c.spanMin, in: 0.3...0.9, step: 0.02)
                    Stepper("Max span \(String(format: "%.2f", c.spanMax))", value: $c.spanMax, in: 0.5...0.97, step: 0.02)
                }
                Section("Phone") {
                    Stepper("Max tilt \(Int(c.maxPitch))°", value: $c.maxPitch, in: 5...45, step: 1)
                    Stepper("Max roll \(Int(c.maxRoll))°", value: $c.maxRoll, in: 2...20, step: 1)
                }
                Section("Light") {
                    Stepper("Min brightness \(String(format: "%.2f", c.minBrightness))", value: $c.minBrightness, in: 0...0.6, step: 0.02)
                }
                Section("Now") {
                    Text(camera.assessment.measured.sorted { $0.key < $1.key }.map { "\($0.key) \(String(format: "%.2f", $0.value))" }.joined(separator: "\n"))
                        .font(.system(size: 12, design: .monospaced))
                }
                Section {
                    Button("Reset to protocol defaults") { c = .standard }
                    Text("Active: \(c.id)").font(.system(size: 11, design: .monospaced))
                }
            }
            .navigationTitle("Capture gates (dev)")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        guard c.isSane else { return }
                        c.save()
                        camera.config = c
                        dismiss()
                    }
                    .disabled(!c.isSane)
                }
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .onAppear { c = camera.config }
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
        var update = BodyProfileUpdate()
        if missing.contains("height") {
            guard let h = BodyDetailsInput.number(height), (100...250).contains(h) else { problem = "Enter a height between 100 and 250 cm."; return }
            update.heightCm = h
        }
        if missing.contains("weight") {
            guard let w = BodyDetailsInput.number(weight), (20...400).contains(w) else { problem = "Enter a weight between 20 and 400 kg."; return }
            update.weightKg = w
        }
        if missing.contains("sex") { update.sex = sex }
        if missing.contains("age") { update.dateOfBirth = BodyDetailsInput.isoDate(birthDate) }
        saving = true
        problem = nil
        Task {
            do {
                try await update.send()
                saving = false
                onSaved()
            } catch {
                saving = false
                problem = "Couldn't save your details. Check your connection and try again."
            }
        }
    }
}

/// A validated profile change (plain Sendable values). The Convex argument
/// dictionary is built inside `send()` — it isn't Sendable, so it must not
/// cross into a Task from outside (Swift 6 strict concurrency).
struct BodyProfileUpdate: Sendable, Equatable {
    var heightCm: Double?
    var weightKg: Double?
    var sex: String?
    var dateOfBirth: String?

    var isEmpty: Bool { heightCm == nil && weightKg == nil && sex == nil && dateOfBirth == nil }

    @MainActor
    func send() async throws {
        var args: [String: ConvexEncodable?] = [:]
        if let heightCm { args["heightCm"] = heightCm }
        if let weightKg { args["weightKg"] = weightKg }
        if let sex { args["sex"] = sex }
        if let dateOfBirth { args["dateOfBirth"] = dateOfBirth }
        try await ConvexClientProvider.client.mutation("bodyScans:updateProfile", with: args)
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
    @State private var showValidation = false

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
                    if BodyScanMeasurementsView.enabled { BodyScanMeasurementsView(scanId: scan.scanId) }
                    if saved.count > 1 { earlier }
                    Text(BodyScanMeasurementsView.enabled
                         ? "A private, consistent record for seeing how your body changes. Sombrey doesn't estimate body fat, weight or BMI from these photos."
                         : "A private, consistent record for seeing how your body changes. Sombrey doesn't estimate body fat or measurements from these photos yet.")
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
                if BodyScanDevTools.enabled {
                    // Phase 5D engineering validation — development builds only.
                    Button("DEV · Validation") { showValidation = true }
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(StudioColor.inkSoft)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .accessibilityIdentifier("bodyScan.devValidation")
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .task { scans.subscribe(to: "bodyScans:list") }
        .sheet(isPresented: $showValidation) { BodyScanValidationView() }
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
            if BodyScanDevTools.enabled {
                // Dev builds only: whether on-device CV features were stored (never their values).
                Text((scan.featureVersions ?? []).isEmpty ? "DEV · no CV features stored" : "DEV · CV features stored: \((scan.featureVersions ?? []).joined(separator: ", "))")
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(StudioColor.inkFaint)
            }
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

/// Phase 5C: a scan's measurements. Shown only on development builds until a
/// validation study signs the method off: available results as whole-cm
/// estimates with their range, scale-free proportions by name, the height
/// note — and, for the physical test, every result with its status and reasons.
struct BodyScanMeasurementsView: View {
    let scanId: String
    @State private var result = ConvexQuery<BodyScanMeasurementsDTO?>()

    static var enabled: Bool { BodyScanDevTools.enabled }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("MEASUREMENTS").font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
            if let m = result.value ?? nil {
                let lines = BodyScanMeasurementPresentation.lines(m)
                ForEach(lines, id: \.label) { line in
                    HStack {
                        Text(line.label).font(StudioFont.body(14)).foregroundStyle(StudioColor.ink)
                        Spacer()
                        Text(line.text).font(StudioFont.body(14, weight: .semibold)).foregroundStyle(StudioColor.ink).monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
                Text(BodyScanMeasurementPresentation.summary(m))
                    .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
                let proportions = BodyScanMeasurementPresentation.proportions(m)
                if !proportions.isEmpty {
                    Text("Available as proportions: \(proportions.joined(separator: ", ")).")
                        .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
                }
                if let note = BodyScanMeasurementPresentation.heightNote(m) {
                    Text(note).font(StudioFont.body(12, weight: .medium)).foregroundStyle(StudioColor.ink).fixedSize(horizontal: false, vertical: true)
                }
                diagnostics(m)
            } else if result.isLoading {
                ProgressView().tint(StudioColor.ink)
            } else {
                Text("Measurements appear here once the scan has been analysed on your phone.")
                    .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 20) }
        .task(id: scanId) { result.subscribe(to: "bodyScans:measurements", with: ["scanId": scanId]) }
    }

    /// Dev builds only (the physical test): every result, whatever its status.
    private func diagnostics(_ m: BodyScanMeasurementsDTO) -> some View {
        let rows = m.measurements.map { x -> String in
            let v = x.value.map { String(format: "%.1f", $0) } ?? "—"
            let u = x.uncertainty.map { String(format: "±%.1f", $0) } ?? ""
            return "\(x.name) \(x.status) \(v)\(u) \(x.unit) c\(String(format: "%.2f", x.confidence)) \(x.reasons.joined(separator: ","))"
        }
        let head = "DEV · \(m.cvVersion)/\(m.methodVersion) · scale \(m.scale.source) \(m.scale.ok ? "ok" : "none") [\(m.scale.views.joined(separator: ","))] \(m.scale.reasons.joined(separator: ","))"
        return DisclosureGroup("DEV · all results") {
            Text(([head] + rows).joined(separator: "\n"))
                .font(.system(size: 10, design: .monospaced)).foregroundStyle(StudioColor.inkFaint)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 11, design: .monospaced)).tint(StudioColor.inkSoft)
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

/// The capture conditions stored with each scan — nothing that identifies the
/// phone beyond its model. 5C: which camera, and the depth source it used.
struct BodyScanCaptureInfo: ConvexEncodable, Encodable {
    let deviceModel: String
    let osVersion: String
    let appVersion: String
    let camera: String
    let depth: String
    let imageMaxPixel: Double
    let jpegQuality: Double

    @MainActor
    static func current(mode: BodyScanCaptureMode = .front, depth: BodyScanDepthSource = .none) -> BodyScanCaptureInfo {
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
            camera: mode.camera,
            depth: depth.rawValue,
            imageMaxPixel: Double(BodyScanImageSpec.maxPixel),
            jpegQuality: BodyScanImageSpec.jpegQuality
        )
    }
}

struct BodyScanStartResult: Decodable { let scanId: String; let status: String }

/// A view's capture conditions (tilt, body span, light, gate configuration).
struct ConditionsPayload: Encodable, ConvexEncodable {
    let pitchDegrees: Double
    let rollDegrees: Double
    let bodySpan: Double
    let brightness: Double?
    let protocolConfig: String
    init(_ c: CaptureConditions) {
        pitchDegrees = c.pitchDegrees; rollDegrees = c.rollDegrees; bodySpan = c.bodySpan
        brightness = c.brightness; protocolConfig = c.protocolConfig
    }
}
enum BodyScanSaveError: Error { case refused(BodyScanView, String) }
/// `bodyScans:attachView`: ok, or a validation refusal (the upload was deleted).
struct BodyScanAttachResult: Decodable {
    let ok: Bool
    let view: String
    var replaced: Bool? = nil
    var error: String? = nil
}
struct BodyScanCompleteResult: Decodable { let status: String }
