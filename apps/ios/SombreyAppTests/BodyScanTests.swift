import Testing
import Foundation
import CoreGraphics
@testable import SombreyApp

/// Body Scan, Phase 5A: the capture gates, the front → side → back flow with
/// retakes, image normalisation, the private image request, and that nothing
/// resembling a measurement is ever produced.
struct BodyScanTests {
    // A person standing well, facing the camera, in a 3:4 portrait frame.
    static func joints(nose: Double = 0.9, shoulderSpread: Double = 0.12, wristOffset: Double = 0.2, top: Double = 0.12, ankle: Double = 0.90, centre: Double = 0.5) -> [BodyJoint: JointPoint] {
        let c = centre
        return [
            .nose: JointPoint(x: c, y: top, confidence: nose),
            .leftEar: JointPoint(x: c - 0.04, y: top, confidence: 0.8), .rightEar: JointPoint(x: c + 0.04, y: top, confidence: 0.8),
            .neck: JointPoint(x: c, y: 0.20, confidence: 0.9),
            .leftShoulder: JointPoint(x: c - shoulderSpread, y: 0.22, confidence: 0.9), .rightShoulder: JointPoint(x: c + shoulderSpread, y: 0.22, confidence: 0.9),
            .leftWrist: JointPoint(x: c - wristOffset, y: 0.50, confidence: 0.9), .rightWrist: JointPoint(x: c + wristOffset, y: 0.50, confidence: 0.9),
            .leftHip: JointPoint(x: c - 0.05, y: 0.50, confidence: 0.9), .rightHip: JointPoint(x: c + 0.05, y: 0.50, confidence: 0.9),
            .leftKnee: JointPoint(x: c - 0.04, y: 0.70, confidence: 0.9), .rightKnee: JointPoint(x: c + 0.04, y: 0.70, confidence: 0.9),
            .leftAnkle: JointPoint(x: c - 0.04, y: ankle, confidence: 0.9), .rightAnkle: JointPoint(x: c + 0.04, y: ankle, confidence: 0.9),
        ]
    }

    static func frame(_ joints: [BodyJoint: JointPoint] = BodyScanTests.joints(), people: Int = 1, brightness: Double = 0.5, pitch: Double = 2, roll: Double = 1, motion: Double = 0.002, deviceMotion: Double = 0.01) -> PoseFrame {
        PoseFrame(people: people, joints: joints, aspect: 0.75, brightness: brightness, pitchDegrees: pitch, rollDegrees: roll, subjectMotion: motion, deviceMotion: deviceMotion)
    }

    // MARK: Quality gates

    @Test func aWellPositionedFrontViewIsReady() {
        let a = BodyScanQuality.assess(Self.frame(), for: .front)
        #expect(a.ready, "issues: \(a.issues)")
        #expect(a.score == 1)
    }

    @Test func nobodyOrSeveralPeopleIsNeverReady() {
        let none = BodyScanQuality.assess(Self.frame([:], people: 0), for: .front)
        #expect(none.issues == [.noPerson] && none.instruction == "Step into the frame" && none.score == 0)
        let two = BodyScanQuality.assess(Self.frame(people: 2), for: .front)
        #expect(two.issues.first == .multiplePeople && !two.ready)
    }

    @Test func distanceAndFramingProduceTheRightInstruction() {
        #expect(BodyScanQuality.assess(Self.frame(Self.joints(top: 0.08, ankle: 0.95)), for: .front).issues.contains(.tooClose))
        #expect(BodyScanQuality.assess(Self.frame(Self.joints(top: 0.30, ankle: 0.85)), for: .front).issues.contains(.tooFar))
        let feet = BodyScanQuality.assess(Self.frame(Self.joints(ankle: 0.99)), for: .front)
        #expect(feet.issues.contains(.feetOutOfFrame))
        let head = BodyScanQuality.assess(Self.frame(Self.joints(top: 0.02)), for: .front)
        #expect(head.issues.contains(.headOutOfFrame))
        let off = BodyScanQuality.assess(Self.frame(Self.joints(centre: 0.25)), for: .front)
        #expect(off.issues.contains(.offCentre) && off.instruction == "Move to the centre")
    }

    @Test func phoneAndLightAndMovementAreChecked() {
        #expect(BodyScanQuality.assess(Self.frame(pitch: 18), for: .front).instruction == "Stand the phone upright")
        #expect(BodyScanQuality.assess(Self.frame(roll: 7), for: .front).issues.contains(.tilted))
        #expect(BodyScanQuality.assess(Self.frame(brightness: 0.1), for: .front).instruction == "Find brighter, even light")
        #expect(BodyScanQuality.assess(Self.frame(motion: 0.05), for: .front).instruction == "Hold still")
        #expect(BodyScanQuality.assess(Self.frame(deviceMotion: 0.3), for: .front).issues.contains(.motion))
    }

    @Test func eachViewNeedsItsOwnOrientation() {
        // Facing the camera is wrong for the side view, and vice versa.
        #expect(BodyScanQuality.assess(Self.frame(), for: .side).instruction == "Turn sideways")
        let sideOn = Self.frame(Self.joints(shoulderSpread: 0.01, wristOffset: 0.01))
        #expect(BodyScanQuality.assess(sideOn, for: .side).ready)
        #expect(BodyScanQuality.assess(sideOn, for: .front).instruction == "Face the camera")
        // Back: shoulders wide, no face.
        let back = Self.frame(Self.joints(nose: 0.1))
        #expect(BodyScanQuality.assess(back, for: .back).ready)
        #expect(BodyScanQuality.assess(Self.frame(), for: .back).instruction == "Turn your back to the camera")
    }

    @Test func frontAndBackNeedArmsAwayFromTheBody() {
        let armsIn = Self.frame(Self.joints(wristOffset: 0.055))
        #expect(BodyScanQuality.assess(armsIn, for: .front).issues.contains(.armsPosition))
        #expect(!BodyScanQuality.assess(Self.frame(Self.joints(shoulderSpread: 0.01, wristOffset: 0.055)), for: .side).issues.contains(.armsPosition))
    }

    @Test func onlyOneInstructionShowsAtATime_theMostImportant() {
        let a = BodyScanQuality.assess(Self.frame(Self.joints(ankle: 0.99), brightness: 0.1, motion: 0.05), for: .front)
        #expect(a.instruction == "Find brighter, even light")
        #expect(a.issues.count >= 3 && a.score < 1)
    }

    @Test func issueCodesMatchTheBackendsClosedSet() {
        let backend: Set<String> = ["no_person", "multiple_people", "head_out_of_frame", "feet_out_of_frame", "too_close", "too_far",
                                    "off_centre", "tilted", "wrong_orientation", "arms_position", "low_light", "motion", "low_confidence"]
        #expect(Set(ScanQualityIssue.allCases.map(\.rawValue)) == backend)
    }

    @Test func autoCaptureWaitsForTheHoldAndResetsOnAnyFailure() {
        var s = CaptureStability()
        let t0 = Date(timeIntervalSince1970: 1000)
        #expect(!s.update(ready: true, at: t0))
        #expect(!s.update(ready: true, at: t0.addingTimeInterval(0.6)))
        #expect(!s.update(ready: false, at: t0.addingTimeInterval(0.9)))
        #expect(!s.update(ready: true, at: t0.addingTimeInterval(1.0)))
        #expect(s.update(ready: true, at: t0.addingTimeInterval(1.0 + CaptureStability.holdSeconds)))
    }

    // MARK: Flow

    static func captured(_ n: Int = 1) -> CapturedView {
        CapturedView(jpeg: Data([0xFF, 0xD8, UInt8(n)]), width: 1536, height: 2048, qualityScore: 1, issues: [], capturedAt: Date(timeIntervalSince1970: 1000))
    }

    @Test func viewsAreCapturedInOrderThenReviewed() {
        var d = BodyScanDraft(scanId: "3F2504E0-4F89-11D3-9A0C-0305E82C3301")
        #expect(d.nextView == .front && d.afterCapture == .capture(.front) && !d.isComplete)
        d.record(.front, Self.captured())
        #expect(d.afterCapture == .capture(.side))
        d.record(.side, Self.captured())
        #expect(d.afterCapture == .capture(.back))
        d.record(.back, Self.captured())
        #expect(d.isComplete && d.afterCapture == .review)
    }

    @Test func retakingOneViewKeepsTheOthersAndReturnsToReview() {
        var d = BodyScanDraft()
        for v in BodyScanView.allCases { d.record(v, Self.captured(1)) }
        d.retake(.side)
        #expect(d.views[.front] != nil && d.views[.back] != nil && d.views[.side] == nil)
        #expect(d.afterCapture == .capture(.side) && !d.isComplete)
        d.record(.side, Self.captured(2))
        #expect(d.afterCapture == .review && d.views[.side]?.jpeg == Self.captured(2).jpeg && d.retaking == nil)
    }

    @Test func anIncompleteScanCanNotBeSaved() {
        var d = BodyScanDraft()
        d.record(.front, Self.captured())
        d.record(.side, Self.captured())
        #expect(!d.isComplete && d.nextView == .back)
    }

    @Test func eachScanHasItsOwnStableId() {
        let a = BodyScanDraft(), b = BodyScanDraft()
        #expect(a.scanId != b.scanId)
        #expect(UUID(uuidString: a.scanId) != nil)
    }

    // MARK: Images

    @Test func storedImagesAreAtMost2048AndNeverUpscaled() {
        #expect(BodyScanImageSpec.storedSize(for: CGSize(width: 3024, height: 4032)) == CGSize(width: 1536, height: 2048))
        #expect(BodyScanImageSpec.storedSize(for: CGSize(width: 1080, height: 1440)) == CGSize(width: 1080, height: 1440))
        #expect(BodyScanImageSpec.storedSize(for: .zero) == .zero)
        #expect(BodyScanImageSpec.jpegQuality >= 0.9)
    }

    @Test func imagesAreRequestedWithTheUsersTokenAndNeverByUrl() {
        let r = BodyScanImageLoader.request(scanId: "3F2504E0-4F89-11D3-9A0C-0305E82C3301", view: .side, token: "tok", site: URL(string: "https://example-123.convex.site")!)
        #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        #expect(r.url?.path == "/body-scan-image")
        #expect(r.url?.query?.contains("view=side") == true)
        #expect(r.cachePolicy == .reloadIgnoringLocalAndRemoteCacheData)
    }

    @Test func scanListDecodesWithoutAnyStorageIdOrUrl() throws {
        let json = #"[{"scanId":"3F2504E0-4F89-11D3-9A0C-0305E82C3301","status":"complete","protocolVersion":"5a.1","createdAt":1000,"completedAt":2000,"context":{"heightCm":178,"weightKg":82.4,"weightSource":"manual"},"views":[{"view":"front","width":1536,"height":2048,"qualityScore":1,"issues":[],"capturedAt":900}]}]"#
        let scans = try JSONDecoder().decode([BodyScanDTO].self, from: Data(json.utf8))
        #expect(scans.first?.views.first?.view == "front")
        #expect(scans.first?.context.weightKg == 82.4)
    }

    // MARK: Nothing invented

    @Test func theScanShowsRecordedDetailsOnlyAndNeverAnEstimate() {
        let line = BodyScanHistoryView.contextLine(.init(heightCm: 178, weightKg: 82.4))
        #expect(line == "Your recorded details at this scan: 178 cm · 82.4 kg")
        #expect(BodyScanHistoryView.contextLine(.init()) == nil)
        #expect(!(line ?? "").lowercased().contains("body fat") && !(line ?? "").contains("BMI"))
    }

    @Test func clothingGuidanceIsSpecificAndRespectful() {
        #expect(BodyScanFlow.clothingGuidance("male").contains("Shirtless"))
        #expect(BodyScanFlow.clothingGuidance("female").contains("sports bra"))
        #expect(BodyScanFlow.clothingGuidance(nil).contains("athletic"))
    }

    @Test func profileInputParsingAcceptsCommasAndRejectsJunk() {
        #expect(BodyDetailsInput.number("178,5") == 178.5)
        #expect(BodyDetailsInput.number(" 82 ") == 82)
        #expect(BodyDetailsInput.number("abc") == nil)
        #expect(BodyDetailsInput.number("") == nil)
    }

    // MARK: Deployment

    @Test func onlyAConvexCloudHttpsUrlCanRedirectTheApp() {
        #expect(ConvexClientProvider.resolveDeploymentUrl(nil) == ConvexClientProvider.productionUrl)
        #expect(ConvexClientProvider.resolveDeploymentUrl("") == ConvexClientProvider.productionUrl)
        #expect(ConvexClientProvider.resolveDeploymentUrl("$(SOMBREY_CONVEX_URL)") == ConvexClientProvider.productionUrl)
        #expect(ConvexClientProvider.resolveDeploymentUrl("http://adamant-chicken-676.convex.cloud") == ConvexClientProvider.productionUrl)
        #expect(ConvexClientProvider.resolveDeploymentUrl("https://evil.example.com") == ConvexClientProvider.productionUrl)
        #expect(ConvexClientProvider.resolveDeploymentUrl("https://adamant-chicken-676.convex.cloud") == "https://adamant-chicken-676.convex.cloud")
    }
}
