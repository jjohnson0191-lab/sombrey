import Foundation
import CoreGraphics

// Sombrey Body Scan — the pure rules of the guided capture (protocol 5a.2).
//
// Everything here is plain logic (no camera, no UI) so it's unit-tested
// directly (SombreyAppTests/BodyScanTests.swift). The camera engine
// (BodyScanCamera.swift) turns each video frame into a `PoseFrame` using
// Apple Vision + Core Motion; `BodyScanQuality.assess` decides whether the
// frame is a usable, repeatable capture and, if not, the one instruction to
// show. The same `BodyScanProtocolConfig` drives both the gates and the
// on-screen body frame, so what the user is asked to fill is exactly what's
// checked. Nothing here measures the body.

/// The protocol's views, in capture order (backend: convex/bodyScan/rules.ts).
enum BodyScanView: String, CaseIterable, Codable, Identifiable, Hashable, Sendable {
    case front, side, back
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var instruction: String {
        switch self {
        case .front: return "Face the camera. Feet hip-width apart, arms slightly away from your sides."
        case .side: return "Turn to your right. Arms relaxed by your sides, looking straight ahead."
        case .back: return "Turn your back to the camera. Same stance as the front."
        }
    }
}

/// Body joints as the gates use them (mapped from Vision's joint names).
enum BodyJoint: String, CaseIterable, Hashable, Sendable {
    case nose, leftEye, rightEye, leftEar, rightEar, neck
    case leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist
    case root, leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle
}

/// One joint in the (upright, portrait) frame: x 0→1 left→right, y 0→1
/// top→bottom, and the detector's confidence.
struct JointPoint: Equatable, Sendable {
    var x: Double
    var y: Double
    var confidence: Double
}

/// What one camera frame shows, as the gates need it.
struct PoseFrame: Equatable, Sendable {
    var people: Int
    var joints: [BodyJoint: JointPoint]
    /// Frame width / height (portrait < 1) — puts x and y on one scale.
    var aspect: Double
    var brightness: Double?
    /// Phone tilt from upright, degrees: forward/back and sideways.
    var pitchDegrees: Double
    var rollDegrees: Double
    var subjectMotion: Double
    var deviceMotion: Double
}

/// The capture gates. One source of truth for the checks AND the on-screen
/// frame. Defaults were set for self-capture with the front camera (phone
/// propped upright ~waist height): a nose-to-ankle span of 0.60–0.90 of the
/// frame is roughly 1.2–1.7 m away for an adult. Dev builds can tune them on
/// the phone (BodyScanTuningView); the active configuration is recorded with
/// every captured view, so tuned captures are always identifiable.
struct BodyScanProtocolConfig: Equatable, Codable, Sendable {
    /// Nose (or ears/neck from behind) to ankles, as a fraction of frame height.
    var spanMin = 0.60
    var spanMax = 0.90
    /// The head must be at least this far below the top edge (nose/ear y).
    var minHeadY = 0.04
    /// Ankles no lower than this — the feet below them stay in frame.
    var maxAnkleY = 0.95
    /// Hips' midpoint, horizontally.
    var centreMin = 0.33
    var centreMax = 0.67
    /// Phone tilt: a propped-up phone leans back; perspective is recorded.
    var maxPitch = 20.0
    var maxRoll = 6.0
    var minBrightness = 0.20
    var maxSubjectMotion = 0.015
    var maxDeviceMotion = 0.06

    static let standard = BodyScanProtocolConfig()

    /// Recorded with each view ("default", or the tuned values).
    var id: String {
        guard self != .standard else { return "default" }
        let f = { (v: Double) in String(format: "%.2f", v) }
        return "tuned:span=\(f(spanMin))-\(f(spanMax)),pitch=\(f(maxPitch)),roll=\(f(maxRoll)),light=\(f(minBrightness))"
    }

    /// Where the frame is drawn: the ideal body position inside the gates —
    /// the upper part of the allowed span (a large, easy-to-read figure).
    var guideSpan: Double { spanMin + 0.75 * (spanMax - spanMin) }
    var guideAnkleY: Double { maxAnkleY - 0.02 }
    var guideNoseY: Double { guideAnkleY - guideSpan }

    private static let key = "bodyScan.protocolConfig"
    static func load(_ defaults: UserDefaults = .standard) -> BodyScanProtocolConfig {
        guard let data = defaults.data(forKey: key), let c = try? JSONDecoder().decode(BodyScanProtocolConfig.self, from: data), c.isSane else { return .standard }
        return c
    }
    func save(_ defaults: UserDefaults = .standard) {
        if self == .standard { defaults.removeObject(forKey: Self.key) } else if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }
    /// Tuning can never produce a configuration that captures nonsense.
    var isSane: Bool {
        (0.3...0.95).contains(spanMin) && (0.4...0.97).contains(spanMax) && spanMin < spanMax
            && (0...0.2).contains(minHeadY) && (0.8...0.99).contains(maxAnkleY)
            && (0...45).contains(maxPitch) && (0...20).contains(maxRoll) && (0...0.6).contains(minBrightness)
    }
}

/// Issue codes — the same closed set the backend accepts.
enum ScanQualityIssue: String, CaseIterable, Codable, Sendable {
    case noPerson = "no_person"
    case multiplePeople = "multiple_people"
    case headOutOfFrame = "head_out_of_frame"
    case feetOutOfFrame = "feet_out_of_frame"
    case tooClose = "too_close"
    case tooFar = "too_far"
    case offCentre = "off_centre"
    case tilted
    case wrongOrientation = "wrong_orientation"
    case armsPosition = "arms_position"
    case lowLight = "low_light"
    case motion
    case lowConfidence = "low_confidence"
}

struct QualityAssessment: Equatable, Sendable {
    var issues: [ScanQualityIssue]
    /// 0–1: how close the frame is to the protocol (stored with the view).
    var score: Double
    /// The single most useful instruction right now.
    var instruction: String
    /// What the gates measured (dev diagnostics; the body span is recorded
    /// with each capture). Keys: span, centre, facingRatio, pitch, roll, brightness.
    var measured: [String: Double] = [:]
    var ready: Bool { issues.isEmpty }
}

enum BodyScanQuality {
    static let minJointConfidence = 0.3
    static let minMeanConfidence = 0.45
    /// Shoulder width / torso length (same units): wide facing the camera,
    /// narrow side-on.
    static let minFacingRatio = 0.55
    static let maxSideRatio = 0.38
    /// A-pose: each wrist this far (× shoulder width) from its hip.
    static let minArmClearance = 0.3

    /// In priority order: the first issue present is the instruction shown.
    static let priority: [ScanQualityIssue] = [
        .noPerson, .multiplePeople, .lowLight, .tilted, .tooClose, .tooFar, .headOutOfFrame,
        .feetOutOfFrame, .offCentre, .wrongOrientation, .armsPosition, .motion, .lowConfidence,
    ]

    static func instruction(_ issue: ScanQualityIssue, view: BodyScanView) -> String {
        switch issue {
        case .noPerson: return "Step into the frame"
        case .multiplePeople: return "Only you in the frame"
        case .headOutOfFrame: return "Keep your head in the frame"
        case .feetOutOfFrame: return "Keep your feet visible"
        case .tooClose: return "Move back"
        case .tooFar: return "Move closer"
        case .offCentre: return "Move to the centre"
        case .tilted: return "Stand the phone more upright"
        case .wrongOrientation:
            switch view {
            case .front: return "Face the camera"
            case .side: return "Turn sideways"
            case .back: return "Turn your back to the camera"
            }
        case .armsPosition: return "Arms slightly away from your body"
        case .lowLight: return "Find brighter, even light"
        case .motion: return "Hold still"
        case .lowConfidence: return "Stand clear of the background"
        }
    }

    static func assess(_ f: PoseFrame, for view: BodyScanView, config c: BodyScanProtocolConfig = .standard) -> QualityAssessment {
        var issues = Set<ScanQualityIssue>()
        var measured: [String: Double] = ["pitch": f.pitchDegrees, "roll": f.rollDegrees]
        if let b = f.brightness { measured["brightness"] = b }
        let seen: (BodyJoint) -> JointPoint? = { j in
            guard let p = f.joints[j], p.confidence >= minJointConfidence else { return nil }
            return p
        }

        if f.people == 0 || f.joints.isEmpty {
            issues.insert(.noPerson)
        } else if f.people > 1 {
            issues.insert(.multiplePeople)
        }
        if let b = f.brightness, b < c.minBrightness { issues.insert(.lowLight) }
        if abs(f.pitchDegrees) > c.maxPitch || abs(f.rollDegrees) > c.maxRoll { issues.insert(.tilted) }
        if f.deviceMotion > c.maxDeviceMotion { issues.insert(.motion) }

        if !issues.contains(.noPerson) && !issues.contains(.multiplePeople) {
            let head = seen(.nose) ?? seen(.leftEar) ?? seen(.rightEar)
            let neck = seen(.neck)
            if let head { if head.y < c.minHeadY { issues.insert(.headOutOfFrame) } }
            else if let neck { if neck.y < c.minHeadY + 0.06 { issues.insert(.headOutOfFrame) } }
            else { issues.insert(.headOutOfFrame) }

            let ankles = [seen(.leftAnkle), seen(.rightAnkle)].compactMap { $0 }
            if ankles.isEmpty || ankles.contains(where: { $0.y > c.maxAnkleY }) { issues.insert(.feetOutOfFrame) }

            let top = (head ?? neck).map { $0.y }
            let bottom = ankles.map(\.y).max()
            if let top, let bottom {
                let span = bottom - top
                measured["span"] = span
                if span > c.spanMax { issues.insert(.tooClose) }
                if span < c.spanMin { issues.insert(.tooFar) }
            }

            if let lh = seen(.leftHip), let rh = seen(.rightHip) {
                let centre = (lh.x + rh.x) / 2
                measured["centre"] = centre
                if centre < c.centreMin || centre > c.centreMax { issues.insert(.offCentre) }
            }

            if let ls = seen(.leftShoulder), let rs = seen(.rightShoulder), let lh = seen(.leftHip), let rh = seen(.rightHip) {
                let shoulderWidth = abs(ls.x - rs.x) * f.aspect
                let torso = abs((lh.y + rh.y) / 2 - (ls.y + rs.y) / 2)
                let ratio = torso > 0 ? shoulderWidth / torso : 0
                measured["facingRatio"] = ratio
                let faceVisible = (f.joints[.nose]?.confidence ?? 0) >= 0.5
                switch view {
                case .front: if ratio < minFacingRatio || !faceVisible { issues.insert(.wrongOrientation) }
                case .back: if ratio < minFacingRatio || faceVisible { issues.insert(.wrongOrientation) }
                case .side: if ratio > maxSideRatio { issues.insert(.wrongOrientation) }
                }
                if view != .side, !issues.contains(.wrongOrientation) {
                    let clearance = minArmClearance * abs(ls.x - rs.x)
                    let pairs: [(BodyJoint, BodyJoint)] = [(.leftWrist, .leftHip), (.rightWrist, .rightHip)]
                    for (w, h) in pairs {
                        if let wp = seen(w), let hp = seen(h), abs(wp.x - hp.x) < clearance { issues.insert(.armsPosition) }
                    }
                }
            } else {
                issues.insert(.lowConfidence)
            }

            if f.subjectMotion > c.maxSubjectMotion { issues.insert(.motion) }

            let key: [BodyJoint] = [.leftShoulder, .rightShoulder, .leftHip, .rightHip, .leftKnee, .rightKnee, .leftAnkle, .rightAnkle]
            let confidences = key.map { f.joints[$0]?.confidence ?? 0 }
            if confidences.reduce(0, +) / Double(confidences.count) < minMeanConfidence { issues.insert(.lowConfidence) }
        }

        let ordered = priority.filter { issues.contains($0) }
        let penalty = ordered.reduce(0.0) { acc, i in acc + (i == .noPerson || i == .multiplePeople ? 1 : 0.18) }
        let score = max(0, min(1, 1 - penalty))
        let message = ordered.first.map { Self.instruction($0, view: view) } ?? "Hold still"
        return QualityAssessment(issues: ordered, score: (score * 1000).rounded() / 1000, instruction: message, measured: measured)
    }
}

/// The hands-free self-timer: Start → 10…1 → capture.
///
/// Seconds 10–4 are for walking into position (they count down whatever the
/// frame shows). Seconds 3–1 must pass the gates continuously: the moment a
/// frame fails, the countdown PAUSES at 3 and shows why; once the frame
/// passes again it resumes from 3. A capture only ever happens at the end of
/// three consecutive valid seconds — never on a bad frame.
struct CaptureCountdown: Equatable, Sendable {
    static let seconds = 10
    static let holdSeconds = 3

    enum Phase: Equatable, Sendable {
        case idle
        case running(Int)
        case paused(Int)
        case capture
    }

    private(set) var phase: Phase = .idle

    var isActive: Bool { if case .idle = phase { return false } else { return true } }
    /// The number to show (nil when idle).
    var remaining: Int? {
        switch phase {
        case .running(let n), .paused(let n): return n
        case .capture: return 0
        case .idle: return nil
        }
    }
    var isPaused: Bool { if case .paused = phase { return true } else { return false } }
    /// In the final, gated seconds.
    var isHolding: Bool {
        if case .running(let n) = phase { return n <= Self.holdSeconds }
        return false
    }

    /// The rear (LiDAR) mode gives longer to walk round to the front of the phone.
    mutating func start(seconds: Int = Self.seconds) { phase = .running(max(Self.holdSeconds + 1, seconds)) }
    mutating func cancel() { phase = .idle }

    /// Every assessed frame: pause on failure in the hold window, resume on success.
    mutating func observe(valid: Bool) {
        switch phase {
        case .running(let n) where n <= Self.holdSeconds && !valid: phase = .paused(Self.holdSeconds)
        case .paused where valid: phase = .running(Self.holdSeconds)
        default: break
        }
    }

    /// One second passed.
    mutating func tick(valid: Bool) {
        guard case .running(let n) = phase else { return }
        if n <= Self.holdSeconds && !valid { phase = .paused(Self.holdSeconds); return }
        phase = n <= 1 ? .capture : .running(n - 1)
    }

    /// After the capture has been taken (or failed): back to idle.
    mutating func finish() { phase = .idle }
}

// MARK: - The scan being captured

/// Conditions at the moment of capture, stored with the view.
struct CaptureConditions: Equatable, Sendable {
    let pitchDegrees: Double
    let rollDegrees: Double
    let bodySpan: Double
    let brightness: Double?
    let protocolConfig: String
}

/// One captured view, before it's saved.
struct CapturedView: Equatable, Sendable {
    let jpeg: Data
    let width: Int
    let height: Int
    let qualityScore: Double
    let issues: [ScanQualityIssue]
    let capturedAt: Date
    var conditions: CaptureConditions? = nil
    /// Phase 5C: the view's measured depth (TrueDepth or LiDAR), in memory
    /// only — never uploaded, never written to disk.
    var depth: BodyScanDepthMap? = nil
}

/// Front → side → back, each reviewed as it's taken, with per-view retakes.
/// Pure, so the flow's rules are tested without a camera.
struct BodyScanDraft: Equatable, Sendable {
    let scanId: String
    private(set) var views: [BodyScanView: CapturedView] = [:]
    /// Retaking one view returns to the full review afterwards.
    private(set) var retaking: BodyScanView?

    init(scanId: String = UUID().uuidString) { self.scanId = scanId }

    var nextView: BodyScanView? { BodyScanView.allCases.first { views[$0] == nil } }
    var isComplete: Bool { nextView == nil }

    mutating func record(_ view: BodyScanView, _ captured: CapturedView) {
        views[view] = captured
    }

    /// Captures a view again straight from its own review (first pass):
    /// the flow then carries on to the next view as before.
    mutating func recapture(_ view: BodyScanView) {
        views[view] = nil
    }

    /// Discards one view from the full review so it can be captured again;
    /// the others are kept and the flow returns to the full review.
    mutating func retake(_ view: BodyScanView) {
        views[view] = nil
        retaking = view
    }

    /// After a capture: that view's own review first.
    func afterCapture(_ view: BodyScanView) -> BodyScanStage { .viewReview(view) }

    /// After accepting a view's review: the full review when retaking or
    /// done, otherwise the next view.
    mutating func afterAccepting(_ view: BodyScanView) -> BodyScanStage {
        if retaking == view { retaking = nil; return .review }
        return nextView.map { .capture($0) } ?? .review
    }
}

enum BodyScanStage: Equatable, Sendable {
    case consent, details, prepare, capture(BodyScanView), viewReview(BodyScanView), review, saving, saved
}

// MARK: - Stored image

/// How a captured frame becomes the stored image: upright, never mirrored,
/// no metadata, long side 2048 px, JPEG 0.9.
///
/// Why 2048: body-model stages (segmentation, keypoints, silhouette fitting)
/// work at roughly 256–1024 px on the body crop; 2048 keeps enough detail for
/// silhouette edges at the protocol distance with headroom, at ~0.5–1 MB per
/// view. JPEG 0.9 avoids the edge ringing that lower qualities add around the
/// body outline. No retouching of any kind is applied.
enum BodyScanImageSpec {
    static let maxPixel = 2048
    static let jpegQuality = 0.9

    static func storedSize(for size: CGSize, maxPixel: Int = maxPixel) -> CGSize {
        let long = max(size.width, size.height)
        guard long > 0 else { return .zero }
        let scale = min(1, CGFloat(maxPixel) / long)
        return CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    }
}

// MARK: - Backend shapes

struct BodyScanProfileDTO: Decodable, Equatable {
    struct Context: Decodable, Equatable {
        var heightCm: Double? = nil
        var weightKg: Double? = nil
        var weightSource: String? = nil
        var weightRecordedAt: Double? = nil
        var sex: String? = nil
        var ageYears: Double? = nil
    }
    struct Consent: Decodable, Equatable {
        let currentVersion: String
        let acceptedVersion: String?
        let accepted: Bool
    }
    let context: Context
    let missing: [String]
    let consent: Consent
    let protocolVersion: String
}

/// One scan from `bodyScans:list` — never a storage id or URL.
struct BodyScanDTO: Decodable, Equatable, Identifiable {
    struct ViewInfo: Decodable, Equatable {
        let view: String
        let width: Double
        let height: Double
        let qualityScore: Double
        let issues: [String]
        let capturedAt: Double
    }
    let scanId: String
    let status: String
    let protocolVersion: String
    let createdAt: Double
    let completedAt: Double?
    let context: BodyScanProfileDTO.Context
    var featureVersions: [String]? = nil
    let views: [ViewInfo]
    var id: String { scanId }
    var date: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}
