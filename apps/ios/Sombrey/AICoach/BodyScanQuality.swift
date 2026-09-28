import Foundation
import CoreGraphics

// Sombrey Body Scan — Phase 5A: the pure rules of the guided capture.
//
// Everything here is plain logic (no camera, no UI) so it's unit-tested
// directly (SombreyAppTests/BodyScanTests.swift). The camera engine
// (BodyScanCamera.swift) turns each video frame into a `PoseFrame` using
// Apple Vision + Core Motion; `BodyScanQuality.assess` decides whether the
// frame is a usable, repeatable capture and, if not, the one instruction to
// show. Nothing here measures the body — the gates only standardise how
// images are taken, so later phases can compare scans reliably.

/// The protocol's views, in capture order (backend: convex/bodyScan/rules.ts).
enum BodyScanView: String, CaseIterable, Codable, Identifiable, Hashable {
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
enum BodyJoint: String, CaseIterable, Hashable {
    case nose, leftEye, rightEye, leftEar, rightEar, neck
    case leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist
    case root, leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle
}

/// One joint in the (upright, portrait) frame: x 0→1 left→right, y 0→1
/// top→bottom, and the detector's confidence.
struct JointPoint: Equatable {
    var x: Double
    var y: Double
    var confidence: Double
}

/// What one camera frame shows, as the gates need it.
struct PoseFrame: Equatable {
    /// People detected in the frame.
    var people: Int
    /// The (single) person's joints; empty when nobody is detected.
    var joints: [BodyJoint: JointPoint]
    /// Frame width / height (portrait < 1) — puts x and y on one scale.
    var aspect: Double
    /// Mean luma 0–1, when measured.
    var brightness: Double?
    /// Phone tilt from upright, degrees: forward/back and sideways.
    var pitchDegrees: Double
    var rollDegrees: Double
    /// How much the body moved since the previous frame (normalised).
    var subjectMotion: Double
    /// How much the phone itself moved (g).
    var deviceMotion: Double
}

/// Issue codes — the same closed set the backend accepts.
enum ScanQualityIssue: String, CaseIterable, Codable {
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

struct QualityAssessment: Equatable {
    var issues: [ScanQualityIssue]
    /// 0–1: how close the frame is to the protocol (stored with the view).
    var score: Double
    /// The single most useful instruction right now.
    var instruction: String
    var ready: Bool { issues.isEmpty }
}

enum BodyScanQuality {
    // Thresholds — the protocol. Changing one means a new protocol version.
    /// Nose-to-ankle span as a fraction of frame height: ~0.87 of standing
    /// height, so this keeps the whole body in frame with a margin.
    static let spanRange: ClosedRange<Double> = 0.66...0.84
    static let centreRange: ClosedRange<Double> = 0.36...0.64
    static let maxPitch = 10.0
    static let maxRoll = 4.0
    static let minBrightness = 0.22
    static let maxSubjectMotion = 0.012
    static let maxDeviceMotion = 0.06
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
        case .tilted: return "Stand the phone upright"
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

    static func assess(_ f: PoseFrame, for view: BodyScanView) -> QualityAssessment {
        var issues = Set<ScanQualityIssue>()
        let seen: (BodyJoint) -> JointPoint? = { j in
            guard let p = f.joints[j], p.confidence >= minJointConfidence else { return nil }
            return p
        }

        if f.people == 0 || f.joints.isEmpty {
            issues.insert(.noPerson)
        } else if f.people > 1 {
            issues.insert(.multiplePeople)
        }
        if let b = f.brightness, b < minBrightness { issues.insert(.lowLight) }
        if abs(f.pitchDegrees) > maxPitch || abs(f.rollDegrees) > maxRoll { issues.insert(.tilted) }
        if f.deviceMotion > maxDeviceMotion { issues.insert(.motion) }

        if !issues.contains(.noPerson) && !issues.contains(.multiplePeople) {
            // Head: the nose (or, from behind, the neck) well inside the top edge.
            let head = seen(.nose) ?? seen(.leftEar) ?? seen(.rightEar)
            let neck = seen(.neck)
            if let head { if head.y < 0.06 { issues.insert(.headOutOfFrame) } }
            else if let neck { if neck.y < 0.12 { issues.insert(.headOutOfFrame) } }
            else { issues.insert(.headOutOfFrame) }

            // Feet: both ankles visible and inside the bottom edge.
            let ankles = [seen(.leftAnkle), seen(.rightAnkle)].compactMap { $0 }
            if ankles.isEmpty || ankles.contains(where: { $0.y > 0.96 }) { issues.insert(.feetOutOfFrame) }

            // Distance: the body's span in the frame.
            let top = (head ?? neck).map { $0.y }
            let bottom = ankles.map(\.y).max()
            if let top, let bottom {
                let span = bottom - top
                if span > spanRange.upperBound { issues.insert(.tooClose) }
                if span < spanRange.lowerBound { issues.insert(.tooFar) }
            }

            // Centre: the hips' midpoint.
            if let lh = seen(.leftHip), let rh = seen(.rightHip) {
                if !centreRange.contains((lh.x + rh.x) / 2) { issues.insert(.offCentre) }
            }

            // Orientation: shoulder width vs torso length, and whether the face shows.
            if let ls = seen(.leftShoulder), let rs = seen(.rightShoulder), let lh = seen(.leftHip), let rh = seen(.rightHip) {
                let shoulderWidth = abs(ls.x - rs.x) * f.aspect
                let torso = abs((lh.y + rh.y) / 2 - (ls.y + rs.y) / 2)
                let ratio = torso > 0 ? shoulderWidth / torso : 0
                let faceVisible = (f.joints[.nose]?.confidence ?? 0) >= 0.5
                switch view {
                case .front: if ratio < minFacingRatio || !faceVisible { issues.insert(.wrongOrientation) }
                case .back: if ratio < minFacingRatio || faceVisible { issues.insert(.wrongOrientation) }
                case .side: if ratio > maxSideRatio { issues.insert(.wrongOrientation) }
                }
                // A-pose for front/back: both wrists clear of the hips.
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

            if f.subjectMotion > maxSubjectMotion { issues.insert(.motion) }

            let key: [BodyJoint] = [.leftShoulder, .rightShoulder, .leftHip, .rightHip, .leftKnee, .rightKnee, .leftAnkle, .rightAnkle]
            let confidences = key.map { f.joints[$0]?.confidence ?? 0 }
            if confidences.reduce(0, +) / Double(confidences.count) < minMeanConfidence { issues.insert(.lowConfidence) }
        }

        let ordered = priority.filter { issues.contains($0) }
        let penalty = ordered.reduce(0.0) { acc, i in acc + (i == .noPerson || i == .multiplePeople ? 1 : 0.18) }
        let score = max(0, min(1, 1 - penalty))
        let message = ordered.first.map { Self.instruction($0, view: view) } ?? "Hold still — capturing"
        return QualityAssessment(issues: ordered, score: (score * 1000).rounded() / 1000, instruction: message)
    }
}

/// Auto-capture: the frame must stay "ready" this long before the
/// countdown, so a passing moment mid-movement is never captured.
struct CaptureStability {
    static let holdSeconds = 1.2
    private(set) var readySince: Date?

    /// Feeds one assessment; returns true when a capture should begin.
    mutating func update(ready: Bool, at now: Date) -> Bool {
        guard ready else { readySince = nil; return false }
        if readySince == nil { readySince = now }
        return now.timeIntervalSince(readySince!) >= Self.holdSeconds
    }

    mutating func reset() { readySince = nil }
}

// MARK: - The scan being captured

/// One captured view, before it's saved.
struct CapturedView: Equatable {
    let jpeg: Data
    let width: Int
    let height: Int
    let qualityScore: Double
    let issues: [ScanQualityIssue]
    let capturedAt: Date
}

/// Front → side → back, with per-view retakes. Pure, so the flow's rules
/// are tested without a camera.
struct BodyScanDraft: Equatable {
    let scanId: String
    private(set) var views: [BodyScanView: CapturedView] = [:]
    /// Retaking one view returns to review afterwards (not through the rest).
    private(set) var retaking: BodyScanView?

    init(scanId: String = UUID().uuidString) { self.scanId = scanId }

    /// The next view to capture, in protocol order; nil when all are done.
    var nextView: BodyScanView? { BodyScanView.allCases.first { views[$0] == nil } }
    var isComplete: Bool { nextView == nil }

    mutating func record(_ view: BodyScanView, _ captured: CapturedView) {
        views[view] = captured
        if retaking == view { retaking = nil }
    }

    /// Discards one view so it can be captured again; the others are kept.
    mutating func retake(_ view: BodyScanView) {
        views[view] = nil
        retaking = view
    }

    /// Where the flow goes after a capture: review once everything's there.
    var afterCapture: BodyScanStage { nextView.map { .capture($0) } ?? .review }
}

enum BodyScanStage: Equatable {
    case consent, details, prepare, capture(BodyScanView), review, saving, saved
}

// MARK: - Stored image

/// How a captured frame becomes the stored image: upright, never mirrored,
/// no metadata, long side 2048 px, JPEG 0.9.
///
/// Why 2048: future body-model stages (segmentation, keypoints, silhouette
/// fitting) work at roughly 256–1024 px on the body crop; 2048 keeps enough
/// detail for silhouette edges at the protocol distance with headroom, at
/// ~0.5–1 MB per view. JPEG 0.9 avoids the edge ringing that lower qualities
/// add around the body outline. No retouching of any kind is applied.
enum BodyScanImageSpec {
    static let maxPixel = 2048
    static let jpegQuality = 0.9

    /// The stored size for a captured size: aspect kept, never upscaled.
    static func storedSize(for size: CGSize, maxPixel: Int = maxPixel) -> CGSize {
        let long = max(size.width, size.height)
        guard long > 0 else { return .zero }
        let scale = min(1, CGFloat(maxPixel) / long)
        return CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    }
}

// MARK: - Backend shapes

/// `bodyScans:profile`.
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
    let views: [ViewInfo]
    var id: String { scanId }
    var date: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}
