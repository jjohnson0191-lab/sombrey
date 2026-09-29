import SwiftUI
import AVFoundation
import ARKit
import Vision
import CoreMotion
import CoreImage
import ImageIO
import UIKit

// Sombrey Body Scan — Phase 5C device layer: measured depth.
//
//   • BodyScanDepthCapture: TrueDepth (AVDepthData) and LiDAR (ARKit scene
//     depth) → an upright BodyScanDepthMap with its pinhole intrinsics;
//     hardware capability detection.
//   • BodyScanLiDAREngine: the rear-camera metric mode — the same frames →
//     PoseFrame → gates → countdown pipeline as the front engine, from an
//     ARKit session with LiDAR scene depth. Not a second scanner.
//   • BodyScanVoiceGuide: spoken guidance for the rear mode, where the screen
//     faces away from the user.
// Depth never leaves the phone; Apple frameworks only.

enum BodyScanDepthCapture {
    /// What this device can measure (hardware, never assumed).
    static func capabilities() -> BodyScanCapabilities {
        BodyScanCapabilities(
            trueDepth: AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) != nil,
            lidar: ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        )
    }

    /// A TrueDepth photo's depth → upright metres, unfiltered, with intrinsics
    /// from the camera calibration (or, failing that, the format's field of view).
    static func trueDepthMap(_ original: AVDepthData, exifOrientation: UInt32, fieldOfViewDeg: Float) -> BodyScanDepthMap? {
        let d = original.depthDataType == kCVPixelFormatType_DepthFloat32 ? original : original.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let nativeW = CVPixelBufferGetWidth(d.depthDataMap), nativeH = CVPixelBufferGetHeight(d.depthDataMap)
        guard nativeW > 0, nativeH > 0 else { return nil }
        var focal: Double, cxN = 0.5, cyN = 0.5, source = "calibration"
        if let cal = d.cameraCalibrationData, cal.intrinsicMatrixReferenceDimensions.width > 0 {
            let m = cal.intrinsicMatrix, ref = cal.intrinsicMatrixReferenceDimensions
            let fx = Double(m.columns.0.x) * Double(nativeW) / Double(ref.width)
            let fy = Double(m.columns.1.y) * Double(nativeH) / Double(ref.height)
            focal = (fx + fy) / 2
            cxN = Double(m.columns.2.x) / Double(ref.width)
            cyN = Double(m.columns.2.y) / Double(ref.height)
        } else {
            guard fieldOfViewDeg > 0 else { return nil }
            focal = (Double(nativeW) / 2) / tan(Double(fieldOfViewDeg) * .pi / 360)
            source = "field_of_view"
        }
        let orientation = CGImagePropertyOrientation(rawValue: exifOrientation) ?? .up
        let upright = d.applyingExifOrientation(orientation)
        guard let meters = floats(upright.depthDataMap) else { return nil }
        let w = CVPixelBufferGetWidth(upright.depthDataMap), h = CVPixelBufferGetHeight(upright.depthDataMap)
        let (cx, cy) = BodyScanDepthOrientation.orient(x: cxN, y: cyN, exif: exifOrientation)
        return BodyScanDepthMap(
            source: .truedepth, width: w, height: h, meters: meters, focalPx: focal,
            principalX: cx * Double(w), principalY: cy * Double(h), intrinsics: source,
            accuracy: d.depthDataAccuracy == .absolute ? "absolute" : "relative", filtered: d.isDepthDataFiltered
        )
    }

    /// An ARKit frame's LiDAR scene depth → upright metres. Only
    /// high-confidence pixels are kept; everything else is a hole.
    static func lidarMap(_ frame: ARFrame) -> BodyScanDepthMap? {
        guard let scene = frame.sceneDepth else { return nil }
        let map = scene.depthMap
        guard var meters = floats(map) else { return nil }
        let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map)
        if let confidence = scene.confidenceMap {
            CVPixelBufferLockBaseAddress(confidence, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
            if let base = CVPixelBufferGetBaseAddress(confidence), CVPixelBufferGetWidth(confidence) == w, CVPixelBufferGetHeight(confidence) == h {
                let stride = CVPixelBufferGetBytesPerRow(confidence)
                let bytes = base.assumingMemoryBound(to: UInt8.self)
                for y in 0..<h { for x in 0..<w where bytes[y * stride + x] < UInt8(ARConfidenceLevel.high.rawValue) { meters[y * w + x] = .nan } }
            }
        }
        // The rear camera's sensor is landscape; the stored photo is rotated
        // 90° clockwise to portrait — the depth map and intrinsics follow.
        let res = frame.camera.imageResolution, k = frame.camera.intrinsics
        guard res.width > 0, res.height > 0 else { return nil }
        let focal = (Double(k.columns.0.x) + Double(k.columns.1.y)) / 2 * Double(w) / Double(res.width)
        let (cx, cy) = BodyScanDepthOrientation.orient(x: Double(k.columns.2.x) / Double(res.width), y: Double(k.columns.2.y) / Double(res.height), exif: 6)
        return BodyScanDepthMap(
            source: .lidar, width: h, height: w, meters: BodyScanDepthOrientation.rotateClockwise(meters, width: w, height: h),
            focalPx: focal, principalX: cx * Double(h), principalY: cy * Double(w),
            intrinsics: "calibration", accuracy: "absolute", filtered: false
        )
    }

    /// A Float32 depth buffer → row-major metres.
    private static func floats(_ buffer: CVPixelBuffer) -> [Float]? {
        guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_DepthFloat32 else { return nil }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer), stride = CVPixelBufferGetBytesPerRow(buffer)
        var out = [Float](repeating: .nan, count: w * h)
        for y in 0..<h {
            let row = (base + y * stride).assumingMemoryBound(to: Float32.self)
            for x in 0..<w { out[y * w + x] = row[x] }
        }
        return out
    }
}

/// The rear-camera LiDAR capture: an ARKit world-tracking session with scene
/// depth. Frames are analysed exactly like the front engine's (Vision body
/// pose + Core Motion → PoseFrame); a capture takes the next frame's image
/// (rotated upright, never mirrored) and its high-confidence depth.
/// `@unchecked Sendable`: mutable state is touched only on `queue`.
final class BodyScanLiDAREngine: NSObject, ARSessionDelegate, @unchecked Sendable {
    let session = ARSession()
    private let queue = DispatchQueue(label: "sombrey.bodyscan.lidar")
    private let motion = CMMotionManager()
    private let poseRequest = VNDetectHumanBodyPoseRequest()
    private let ciContext = CIContext()
    private var onFrame: (@Sendable (PoseFrame) -> Void)?
    private var captureContinuation: CheckedContinuation<BodyScanRawCapture?, Never>?
    private var lastProcessed = Date.distantPast
    private var previousJoints: [BodyJoint: JointPoint] = [:]
    private let frameInterval: TimeInterval = 0.12

    enum SetupError: Error { case unsupported }

    static var isSupported: Bool { ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) }

    func start(onFrame: @escaping @Sendable (PoseFrame) -> Void) async throws {
        guard Self.isSupported else { throw SetupError.unsupported }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            queue.async {
                self.onFrame = onFrame
                self.session.delegateQueue = self.queue
                self.session.delegate = self
                let config = ARWorldTrackingConfiguration()
                config.frameSemantics = [.sceneDepth]
                self.session.run(config, options: [.resetTracking, .removeExistingAnchors])
                if self.motion.isDeviceMotionAvailable, !self.motion.isDeviceMotionActive {
                    self.motion.deviceMotionUpdateInterval = 1.0 / 20
                    self.motion.startDeviceMotionUpdates()
                }
                c.resume()
            }
        }
    }

    func stop() {
        queue.async {
            self.session.pause()
            if self.motion.isDeviceMotionActive { self.motion.stopDeviceMotionUpdates() }
            self.onFrame = nil
            self.previousJoints = [:]
            self.captureContinuation?.resume(returning: nil)
            self.captureContinuation = nil
        }
    }

    /// The next frame's photo + depth (nil after 2 s without a usable frame).
    func capturePhoto() async -> BodyScanRawCapture? {
        await withCheckedContinuation { (c: CheckedContinuation<BodyScanRawCapture?, Never>) in
            queue.async {
                guard self.captureContinuation == nil else { c.resume(returning: nil); return }
                self.captureContinuation = c
                self.queue.asyncAfter(deadline: .now() + 2) {
                    self.captureContinuation?.resume(returning: nil)
                    self.captureContinuation = nil
                }
            }
        }
    }

    // ARSessionDelegate — delivered on `queue`. Frames are never retained.
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        if let c = captureContinuation {
            captureContinuation = nil
            c.resume(returning: capture(frame))
            return
        }
        let now = Date()
        guard now.timeIntervalSince(lastProcessed) >= frameInterval, let onFrame else { return }
        lastProcessed = now

        // The sensor is landscape; `.right` gives Vision the upright portrait.
        let pixels = frame.capturedImage
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:])
        var people: [[BodyJoint: JointPoint]] = []
        if (try? handler.perform([poseRequest])) != nil {
            for o in poseRequest.results ?? [] { people.append(BodyScanCaptureEngine.joints(o)) }
        }
        let subject = people.max { BodyScanCaptureEngine.span($0) < BodyScanCaptureEngine.span($1) } ?? [:]
        let visible = people.filter { BodyScanCaptureEngine.span($0) > 0.2 }.count
        var motionG = 0.0, pitch = 0.0, roll = 0.0
        if let m = motion.deviceMotion {
            let a = m.userAcceleration
            motionG = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            let g = m.gravity
            pitch = atan2(g.z, -g.y) * 180 / .pi
            roll = atan2(g.x, -g.y) * 180 / .pi
        }
        let w = Double(CVPixelBufferGetWidth(pixels)), h = Double(CVPixelBufferGetHeight(pixels))
        onFrame(PoseFrame(
            people: subject.isEmpty ? 0 : max(1, visible),
            joints: subject,
            aspect: w > 0 ? h / w : 0.75,        // portrait: rotated width / height
            brightness: BodyScanCaptureEngine.meanLuma(pixels),
            pitchDegrees: pitch,
            rollDegrees: roll,
            subjectMotion: BodyScanCaptureEngine.displacement(previousJoints, subject),
            deviceMotion: motionG
        ))
        previousJoints = subject
    }

    private func capture(_ frame: ARFrame) -> BodyScanRawCapture? {
        let image = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        guard let cg = ciContext.createCGImage(image, from: image.extent),
              let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.95) else { return nil }
        return BodyScanRawCapture(photo: jpeg, depth: BodyScanDepthCapture.lidarMap(frame))
    }
}

/// The rear mode's camera preview (the true, unmirrored image).
struct BodyScanARPreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.session = session
        view.automaticallyUpdatesLighting = false
        view.rendersCameraGrain = false
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}

/// Spoken guidance for the rear mode: the one instruction that matters, the
/// countdown and the capture — never repeated faster than every few seconds.
@MainActor
final class BodyScanVoiceGuide {
    private let synthesizer = AVSpeechSynthesizer()
    private var lastSpoken = ""
    private var lastAt = Date.distantPast

    func activate() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func deactivate() {
        synthesizer.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// `urgent` interrupts (countdown numbers, capture); otherwise a repeat of
    /// the same line waits 4 s and any new line waits for the current one.
    func say(_ text: String, urgent: Bool = false) {
        let now = Date()
        guard urgent || text != lastSpoken || now.timeIntervalSince(lastAt) > 4 else { return }
        guard urgent || !synthesizer.isSpeaking else { return }
        if urgent { synthesizer.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: text)
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(u)
        lastSpoken = text
        lastAt = now
    }
}
