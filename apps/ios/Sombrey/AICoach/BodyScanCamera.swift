import SwiftUI
import AVFoundation
import Vision
import CoreMotion
import UIKit
import ImageIO

// Sombrey Body Scan — Phase 5A camera engine. Apple frameworks only:
// AVFoundation (front camera, stills), Vision (body pose, people count),
// Core Motion (phone tilt and movement). Every processed frame becomes a
// `PoseFrame`; `BodyScanQuality` (BodyScanQuality.swift) judges it. Frames
// never leave the phone and are never stored — only the captured still of
// each view is, after the user reviews it.
//
// Phase 5C: on Face ID iPhones the front camera is opened as the TrueDepth
// camera, and each still also carries its (unfiltered) depth map, kept in
// memory only for the on-device scale evidence. Without TrueDepth the scan
// works exactly as before, with no metric scale.

/// One capture: the camera's photo file and, when measured, its depth.
struct BodyScanRawCapture: Sendable {
    let photo: Data
    let depth: BodyScanDepthMap?
}

/// The capture pipeline on its own serial queue. `@unchecked Sendable`: all
/// mutable state is touched only on `queue` (or, for motion, read there).
final class BodyScanCaptureEngine: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "sombrey.bodyscan.capture")
    private let videoOutput = AVCaptureVideoDataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private let motion = CMMotionManager()
    private let poseRequest = VNDetectHumanBodyPoseRequest()
    private var onFrame: (@Sendable (PoseFrame) -> Void)?
    private var photoContinuation: CheckedContinuation<BodyScanRawCapture?, Never>?
    /// Horizontal field of view of the active format (the intrinsics fallback).
    private var fieldOfViewDeg: Float = 0
    /// Whether stills carry TrueDepth depth on this device.
    private(set) var depthEnabled = false
    private var lastProcessed = Date.distantPast
    private var previousJoints: [BodyJoint: JointPoint] = [:]
    private var configured = false
    /// ~8 analysed frames a second: responsive guidance without heating the phone.
    private let frameInterval: TimeInterval = 0.12

    enum SetupError: Error { case noCamera, cannotAddInput, cannotAddOutput }

    func start(onFrame: @escaping @Sendable (PoseFrame) -> Void) async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    self.onFrame = onFrame
                    if !self.configured { try self.configure(); self.configured = true }
                    if self.motion.isDeviceMotionAvailable, !self.motion.isDeviceMotionActive {
                        self.motion.deviceMotionUpdateInterval = 1.0 / 20
                        self.motion.startDeviceMotionUpdates()
                    }
                    if !self.session.isRunning { self.session.startRunning() }
                    c.resume()
                } catch {
                    c.resume(throwing: error)
                }
            }
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            if self.motion.isDeviceMotionActive { self.motion.stopDeviceMotionUpdates() }
            self.onFrame = nil
            self.previousJoints = [:]
        }
    }

    private func configure() throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo   // 4:3 stills — the protocol's framing
        // TrueDepth when the device has it (the same front camera, plus depth).
        guard let camera = AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else { throw SetupError.noCamera }
        let input = try AVCaptureDeviceInput(device: camera)
        guard session.canAddInput(input) else { throw SetupError.cannotAddInput }
        session.addInput(input)

        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        videoOutput.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(videoOutput), session.canAddOutput(photoOutput) else { throw SetupError.cannotAddOutput }
        session.addOutput(videoOutput)
        session.addOutput(photoOutput)
        photoOutput.maxPhotoQualityPrioritization = .quality
        if photoOutput.isDepthDataDeliverySupported { photoOutput.isDepthDataDeliveryEnabled = true }
        depthEnabled = photoOutput.isDepthDataDeliveryEnabled
        fieldOfViewDeg = camera.activeFormat.videoFieldOfView

        // Portrait frames. Analysis frames are mirrored like the preview (so
        // the guide lines up with what the user sees); stills are NOT
        // mirrored — the stored image is the body as it really is.
        if let c = videoOutput.connection(with: .video) {
            if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
            if c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = true }
        }
        if let c = photoOutput.connection(with: .video) {
            if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
            if c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = false }
        }
    }

    // MARK: Frames

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = Date()
        guard now.timeIntervalSince(lastProcessed) >= frameInterval, let onFrame, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastProcessed = now

        let width = Double(CVPixelBufferGetWidth(pixels)), height = Double(CVPixelBufferGetHeight(pixels))
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:])
        var people: [[BodyJoint: JointPoint]] = []
        if (try? handler.perform([poseRequest])) != nil {
            for observation in poseRequest.results ?? [] {
                people.append(Self.joints(observation))
            }
        }
        // The subject: the person spanning most of the frame.
        let subject = people.max { Self.span($0) < Self.span($1) } ?? [:]
        let visible = people.filter { Self.span($0) > 0.2 }.count

        var motionG = 0.0, pitch = 0.0, roll = 0.0
        if let m = motion.deviceMotion {
            let a = m.userAcceleration
            motionG = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            let g = m.gravity   // upright portrait ≈ (0, -1, 0)
            pitch = atan2(g.z, -g.y) * 180 / .pi
            roll = atan2(g.x, -g.y) * 180 / .pi
        }

        let frame = PoseFrame(
            people: subject.isEmpty ? 0 : max(1, visible),
            joints: subject,
            aspect: height > 0 ? width / height : 0.75,
            brightness: Self.meanLuma(pixels),
            pitchDegrees: pitch,
            rollDegrees: roll,
            subjectMotion: Self.displacement(previousJoints, subject),
            deviceMotion: motionG
        )
        previousJoints = subject
        onFrame(frame)
    }

    private static let jointMap: [(VNHumanBodyPoseObservation.JointName, BodyJoint)] = [
        (.nose, .nose), (.leftEye, .leftEye), (.rightEye, .rightEye), (.leftEar, .leftEar), (.rightEar, .rightEar), (.neck, .neck),
        (.leftShoulder, .leftShoulder), (.rightShoulder, .rightShoulder), (.leftElbow, .leftElbow), (.rightElbow, .rightElbow),
        (.leftWrist, .leftWrist), (.rightWrist, .rightWrist), (.root, .root), (.leftHip, .leftHip), (.rightHip, .rightHip),
        (.leftKnee, .leftKnee), (.rightKnee, .rightKnee), (.leftAnkle, .leftAnkle), (.rightAnkle, .rightAnkle),
    ]

    /// Vision points are normalised with the origin bottom-left; the gates
    /// use top-left.
    static func joints(_ o: VNHumanBodyPoseObservation) -> [BodyJoint: JointPoint] {
        guard let points = try? o.recognizedPoints(.all) else { return [:] }
        var out: [BodyJoint: JointPoint] = [:]
        for (name, joint) in jointMap {
            if let p = points[name], p.confidence > 0 {
                out[joint] = JointPoint(x: Double(p.location.x), y: 1 - Double(p.location.y), confidence: Double(p.confidence))
            }
        }
        return out
    }

    static func span(_ j: [BodyJoint: JointPoint]) -> Double {
        let ys = j.values.filter { $0.confidence >= 0.3 }.map(\.y)
        guard let lo = ys.min(), let hi = ys.max() else { return 0 }
        return hi - lo
    }

    static func displacement(_ a: [BodyJoint: JointPoint], _ b: [BodyJoint: JointPoint]) -> Double {
        let keys: [BodyJoint] = [.neck, .leftShoulder, .rightShoulder, .leftHip, .rightHip, .leftKnee, .rightKnee]
        let d = keys.compactMap { k -> Double? in
            guard let p = a[k], let q = b[k], p.confidence >= 0.3, q.confidence >= 0.3 else { return nil }
            return ((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)).squareRoot()
        }
        return d.isEmpty ? 0 : d.reduce(0, +) / Double(d.count)
    }

    /// Mean of the luma plane, sampled sparsely (every 8th pixel/row).
    static func meanLuma(_ pixels: CVPixelBuffer) -> Double? {
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pixels) > 0, let base = CVPixelBufferGetBaseAddressOfPlane(pixels, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(pixels, 0), h = CVPixelBufferGetHeightOfPlane(pixels, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixels, 0)
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var sum = 0, count = 0
        var y = 0
        while y < h {
            var x = 0
            while x < w { sum += Int(bytes[y * stride + x]); count += 1; x += 8 }
            y += 8
        }
        return count > 0 ? Double(sum) / Double(count) / 255 : nil
    }

    // MARK: Stills

    /// Captures one still (JPEG as the camera produced it, plus TrueDepth
    /// depth when available), or nil.
    func capturePhoto() async -> BodyScanRawCapture? {
        await withCheckedContinuation { (c: CheckedContinuation<BodyScanRawCapture?, Never>) in
            queue.async {
                guard self.photoContinuation == nil, self.session.isRunning else { c.resume(returning: nil); return }
                self.photoContinuation = c
                let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                settings.photoQualityPrioritization = .quality
                if self.photoOutput.isDepthDataDeliveryEnabled {
                    settings.isDepthDataDeliveryEnabled = true
                    settings.isDepthDataFiltered = false       // holes stay holes — never invented depth
                    settings.embedsDepthDataInPhoto = false    // the stored photo carries no depth
                }
                self.photoOutput.capturePhoto(with: settings, delegate: self)
            }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = error == nil ? photo.fileDataRepresentation() : nil
        let exif = (photo.metadata[kCGImagePropertyOrientation as String] as? NSNumber)?.uint32Value ?? 1
        let fov = fieldOfViewDeg
        let depth: BodyScanDepthMap? = error == nil
            ? photo.depthData.flatMap { BodyScanDepthCapture.trueDepthMap($0, exifOrientation: exif, fieldOfViewDeg: fov) }
            : nil
        queue.async {
            self.photoContinuation?.resume(returning: data.map { BodyScanRawCapture(photo: $0, depth: depth) })
            self.photoContinuation = nil
        }
    }

    /// The stored image: upright (EXIF orientation applied), never mirrored,
    /// long side ≤ 2048 px, JPEG 0.9 — re-rendered, so no EXIF/GPS/camera
    /// metadata survives. No retouching, smoothing or reshaping of any kind.
    static func normalize(_ data: Data) -> (jpeg: Data, width: Int, height: Int)? {
        guard let image = UIImage(data: data) else { return nil }
        let pixelSize = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let target = BodyScanImageSpec.storedSize(for: pixelSize)
        guard target.width > 0, target.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let jpeg = rendered.jpegData(compressionQuality: BodyScanImageSpec.jpegQuality) else { return nil }
        return (jpeg, Int(target.width), Int(target.height))
    }
}

/// The camera, its live assessment and the hands-free self-timer, for the
/// capture screen.
@Observable
@MainActor
final class BodyScanCameraModel {
    enum Status: Equatable { case starting, running, denied, unavailable }

    private(set) var status: Status = .starting
    private(set) var assessment = QualityAssessment(issues: [.noPerson], score: 0, instruction: "Step into the frame")
    private(set) var joints: [BodyJoint: JointPoint] = [:]
    private(set) var countdown = CaptureCountdown()
    private(set) var capturing = false
    private(set) var captureFailed = false
    /// Bumps on each gated second (3, 2, 1) — a restrained haptic tick.
    private(set) var holdTick = 0
    /// The gates in use (tunable on dev builds; recorded with each capture).
    var config = BodyScanProtocolConfig.load()
    var view: BodyScanView = .front {
        didSet { cancelCountdown() }
    }
    /// Delivered on the main actor with each accepted capture.
    var onCapture: ((BodyScanView, CapturedView) -> Void)?
    /// Front (standard, TrueDepth where available) or rear (LiDAR metric mode).
    private(set) var mode: BodyScanCaptureMode = .front

    let engine = BodyScanCaptureEngine()
    let lidar = BodyScanLiDAREngine()
    private let voice = BodyScanVoiceGuide()
    private var lastFrame: PoseFrame?
    private var timerTask: Task<Void, Never>?
    /// The rear mode: seconds to walk round to the front of the phone.
    nonisolated static let rearSeconds = 15

    /// Chosen before the camera starts; fixed for the whole scan.
    func use(_ mode: BodyScanCaptureMode) {
        guard mode != self.mode else { return }
        stop()
        self.mode = mode == .rear && !BodyScanLiDAREngine.isSupported ? .front : mode
        status = .starting
    }

    func start() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { status = .denied; return }
        default:
            status = .denied
            return
        }
        do {
            let deliver: @Sendable (PoseFrame) -> Void = { [weak self] frame in
                Task { @MainActor in self?.handle(frame) }
            }
            if mode == .rear {
                try await lidar.start(onFrame: deliver)
                voice.activate()
            } else {
                try await engine.start(onFrame: deliver)
            }
            status = .running
        } catch {
            status = .unavailable
        }
    }

    func stop() {
        cancelCountdown()
        engine.stop()
        lidar.stop()
        if mode == .rear { voice.deactivate() }
    }

    private func handle(_ frame: PoseFrame) {
        guard status == .running, !capturing else { return }
        lastFrame = frame
        joints = frame.joints
        assessment = BodyScanQuality.assess(frame, for: view, config: config)
        let wasPaused = countdown.isPaused
        countdown.observe(valid: assessment.ready)
        if wasPaused != countdown.isPaused, countdown.isHolding { holdTick += 1 }
        // Rear mode: the screen faces away, so the one instruction is spoken.
        if mode == .rear, countdown.isActive, !countdown.isHolding || countdown.isPaused, !assessment.ready {
            voice.say(countdown.isPaused ? "Paused. \(assessment.instruction)" : assessment.instruction)
        }
    }

    /// Start: the 10-second self-timer. The user walks into position; the last
    /// three seconds must pass the gates (see CaptureCountdown).
    func startCountdown() {
        guard status == .running, !capturing else { return }
        captureFailed = false
        countdown.start(seconds: mode == .rear ? Self.rearSeconds : CaptureCountdown.seconds)
        if mode == .rear { voice.say("Timer started. Walk to your spot, facing the phone.", urgent: true) }
        timerTask?.cancel()
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self, !Task.isCancelled else { return }
                self.countdown.tick(valid: self.assessment.ready)
                if self.countdown.isHolding { self.holdTick += 1 }
                if self.mode == .rear, self.countdown.isHolding, let n = self.countdown.remaining { self.voice.say("\(n)", urgent: true) }
                if self.countdown.phase == .capture {
                    await self.capture()
                    return
                }
                if !self.countdown.isActive { return }
            }
        }
    }

    func cancelCountdown() {
        timerTask?.cancel()
        timerTask = nil
        countdown.cancel()
    }

    private func capture() async {
        // The countdown only reaches .capture after three valid seconds; the
        // frame is checked once more at the shutter.
        guard assessment.ready, let frame = lastFrame else {
            countdown.finish()
            captureFailed = true
            return
        }
        capturing = true
        captureFailed = false
        let quality = assessment
        let view = self.view
        let conditions = CaptureConditions(
            pitchDegrees: (frame.pitchDegrees * 10).rounded() / 10,
            rollDegrees: (frame.rollDegrees * 10).rounded() / 10,
            bodySpan: ((quality.measured["span"] ?? 0) * 1000).rounded() / 1000,
            brightness: frame.brightness.map { ($0 * 1000).rounded() / 1000 },
            protocolConfig: config.id
        )
        let raw = mode == .rear ? await lidar.capturePhoto() : await engine.capturePhoto()
        let photo = raw?.photo
        let normalized = await Task.detached { photo.flatMap { BodyScanCaptureEngine.normalize($0) } }.value
        capturing = false
        countdown.finish()
        timerTask = nil
        guard let normalized else {
            captureFailed = true
            if mode == .rear { voice.say("That didn't capture. Come back to the phone and tap Start.", urgent: true) }
            return
        }
        if mode == .rear { voice.say("Got it. Come back to the phone.", urgent: true) }
        onCapture?(view, CapturedView(
            jpeg: normalized.jpeg, width: normalized.width, height: normalized.height,
            qualityScore: quality.score, issues: quality.issues, capturedAt: Date(), conditions: conditions,
            depth: raw?.depth
        ))
    }
}

/// The live front-camera preview (mirrored, as users expect of themselves).
struct BodyScanPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        if let c = view.previewLayer.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

/// Maps frame-normalised points onto the preview (aspect-fill: the 3:4
/// frame fills the screen's height; its sides are cropped equally).
enum BodyScanGeometry {
    static func point(_ p: JointPoint, frameAspect: Double, in size: CGSize) -> CGPoint {
        let frameH = max(size.height, size.width / frameAspect)
        let frameW = frameH * frameAspect
        return CGPoint(x: (size.width - frameW) / 2 + p.x * frameW, y: (size.height - frameH) / 2 + p.y * frameH)
    }
}
