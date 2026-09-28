import Foundation
import Vision
import CoreImage
import UIKit
import ConvexMobile

// Sombrey Body Scan — Phase 5B: on-device computer vision for one captured
// view. Apple Vision only (no third-party models, no network):
//   • VNGeneratePersonSegmentationRequest (.accurate) → the person mask
//   • VNDetectHumanBodyPoseRequest → 19 body keypoints
// run on the STORED image (upright, unmirrored), then turned into scale-free
// features by BodyScanFeatureExtractor. The image never leaves the phone for
// this; only the resulting numbers are sent (bodyScans:attachFeatures).

enum BodyScanVision {
    /// The mask is downsampled to at most this height — plenty for widths at
    /// silhouette scale, and it keeps memory small (~0.4 MB).
    static let maskMaxHeight = 512

    struct Result: Sendable {
        let features: ViewFeatures
    }

    /// Processes one stored JPEG. Returns nil only if the image can't be read.
    static func process(jpeg: Data, view: BodyScanView, captureScore: Double, brightness: Double?, subjectStill: Bool) -> Result? {
        let started = Date()
        guard let image = UIImage(data: jpeg), let cg = image.cgImage else { return nil }
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])

        let segmentation = VNGeneratePersonSegmentationRequest()
        segmentation.qualityLevel = .accurate
        segmentation.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let pose = VNDetectHumanBodyPoseRequest()
        try? handler.perform([segmentation, pose])

        let personMask: SilhouetteMask? = segmentation.results?.first.flatMap { Self.mask(from: $0.pixelBuffer) }
        // The person with the largest keypoint span is the subject.
        let people: [[BodyJoint: JointPoint]] = (pose.results ?? []).map { Self.joints($0) }
        let subject = people.max { Self.span($0) < Self.span($1) } ?? [:]

        var features = BodyScanFeatureExtractor.extract(
            view: view, mask: personMask, joints: subject, imageWidth: cg.width, imageHeight: cg.height,
            captureScore: captureScore, brightness: brightness, subjectStill: subjectStill
        )
        features.processingMs = (Date().timeIntervalSince(started) * 1000).rounded()
        return Result(features: features)
    }

    private static let jointMap: [(VNHumanBodyPoseObservation.JointName, BodyJoint)] = [
        (.nose, .nose), (.leftEye, .leftEye), (.rightEye, .rightEye), (.leftEar, .leftEar), (.rightEar, .rightEar), (.neck, .neck),
        (.leftShoulder, .leftShoulder), (.rightShoulder, .rightShoulder), (.leftElbow, .leftElbow), (.rightElbow, .rightElbow),
        (.leftWrist, .leftWrist), (.rightWrist, .rightWrist), (.root, .root), (.leftHip, .leftHip), (.rightHip, .rightHip),
        (.leftKnee, .leftKnee), (.rightKnee, .rightKnee), (.leftAnkle, .leftAnkle), (.rightAnkle, .rightAnkle),
    ]

    private static func joints(_ o: VNHumanBodyPoseObservation) -> [BodyJoint: JointPoint] {
        guard let points = try? o.recognizedPoints(.all) else { return [:] }
        var out: [BodyJoint: JointPoint] = [:]
        for (name, joint) in jointMap {
            if let p = points[name], p.confidence > 0 {
                out[joint] = JointPoint(x: Double(p.location.x), y: 1 - Double(p.location.y), confidence: Double(p.confidence))
            }
        }
        return out
    }

    private static func span(_ j: [BodyJoint: JointPoint]) -> Double {
        let ys = j.values.filter { $0.confidence >= 0.3 }.map(\.y)
        guard let lo = ys.min(), let hi = ys.max() else { return 0 }
        return hi - lo
    }

    /// OneComponent8 mask → SilhouetteMask, box-downsampled to ≤ maskMaxHeight rows.
    private static func mask(from buffer: CVPixelBuffer) -> SilhouetteMask? {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        guard w > 0, h > 0 else { return nil }
        let step = max(1, Int((Double(h) / Double(maskMaxHeight)).rounded(.up)))
        let ow = w / step, oh = h / step
        guard ow > 0, oh > 0 else { return nil }
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var out = [UInt8](repeating: 0, count: ow * oh)
        for oy in 0..<oh {
            for ox in 0..<ow {
                var sum = 0
                for dy in 0..<step { for dx in 0..<step { sum += Int(bytes[(oy * step + dy) * stride + ox * step + dx]) } }
                out[oy * ow + ox] = UInt8(sum / (step * step))
            }
        }
        return SilhouetteMask(width: ow, height: oh, values: out)
    }
}

/// Sends a scan's features to `bodyScans:attachFeatures`. The Convex argument
/// dictionary is built here, inside the async call (Swift 6 sending rules).
enum BodyScanFeatureUpload {
    @MainActor
    static func send(scanId: String, set: BodyScanFeatureSet) async throws {
        let info = BodyScanCaptureInfo.current()
        let views: [ConvexEncodable?] = set.views.map { ViewPayload($0) as ConvexEncodable? }
        let args: [String: ConvexEncodable?] = [
            "scanId": scanId,
            "cvVersion": set.cvVersion,
            "processedAt": set.processedAt.timeIntervalSince1970 * 1000,
            "processing": ProcessingPayload(deviceModel: info.deviceModel, osVersion: info.osVersion, appVersion: info.appVersion, components: set.components),
            "scale": ScalePayload(kind: "none"),
            "views": views,
            "multiView": MultiViewPayload(ratios: set.multiViewRatios, consistency: set.consistency),
            "quality": QualityPayload(set.quality),
        ]
        let _: FeatureUploadResult = try await ConvexClientProvider.client.mutation("bodyScans:attachFeatures", with: args)
    }

    struct FeatureUploadResult: Decodable { let stored: Bool; let cvVersion: String }
}

struct ProcessingPayload: Encodable, ConvexEncodable {
    let deviceModel: String
    let osVersion: String
    let appVersion: String
    let components: [String]
}

/// A 5B feature set has no metric scale (a plain front-camera photo).
struct ScalePayload: Encodable, ConvexEncodable {
    let kind: String
}

struct MultiViewPayload: Encodable, ConvexEncodable {
    let ratios: [String: Double]
    let consistency: [String: Double]
}

struct QualityPayload: Encodable, ConvexEncodable {
    let overallScore, framing, pose, lighting, segmentation, motion, multiViewConsistency: Double
    init(_ q: [String: Double]) {
        overallScore = q["overallScore"] ?? 0; framing = q["framing"] ?? 0; pose = q["pose"] ?? 0; lighting = q["lighting"] ?? 0
        segmentation = q["segmentation"] ?? 0; motion = q["motion"] ?? 0; multiViewConsistency = q["multiViewConsistency"] ?? 0
    }
}

struct ViewPayload: Encodable, ConvexEncodable {
    struct KP: Encodable { let name: String; let x, y, confidence: Double }
    struct Sil: Encodable {
        let maskWidth, maskHeight: Double
        let top, bottom, left, right, heightFraction, areaPerHeight2, mainComponentFraction, keypointAgreement: Double
    }
    let view: String
    let imageWidth, imageHeight, processingMs: Double
    let keypoints: [KP]
    let silhouette: Sil?
    let widths, ratios, quality: [String: Double]
    let issues: [String]

    init(_ v: ViewFeatures) {
        view = v.view.rawValue
        imageWidth = Double(v.imageWidth); imageHeight = Double(v.imageHeight); processingMs = v.processingMs
        keypoints = v.keypoints.map { KP(name: $0.name, x: $0.x, y: $0.y, confidence: $0.confidence) }
        silhouette = v.silhouette.map {
            Sil(maskWidth: Double($0.maskWidth), maskHeight: Double($0.maskHeight), top: $0.top, bottom: $0.bottom, left: $0.left, right: $0.right,
                heightFraction: $0.heightFraction, areaPerHeight2: $0.areaPerHeight2, mainComponentFraction: $0.mainComponentFraction, keypointAgreement: $0.keypointAgreement)
        }
        widths = v.widths; ratios = v.ratios; quality = v.quality; issues = v.issues
    }
}
