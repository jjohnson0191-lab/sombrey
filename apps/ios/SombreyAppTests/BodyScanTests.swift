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
        #expect(BodyScanQuality.assess(Self.frame(Self.joints(top: 0.04, ankle: 0.95)), for: .front).issues.contains(.tooClose))
        #expect(BodyScanQuality.assess(Self.frame(Self.joints(top: 0.30, ankle: 0.85)), for: .front).issues.contains(.tooFar))
        let feet = BodyScanQuality.assess(Self.frame(Self.joints(ankle: 0.97)), for: .front)
        #expect(feet.issues.contains(.feetOutOfFrame))
        let head = BodyScanQuality.assess(Self.frame(Self.joints(top: 0.02)), for: .front)
        #expect(head.issues.contains(.headOutOfFrame))
        let off = BodyScanQuality.assess(Self.frame(Self.joints(centre: 0.22)), for: .front)
        #expect(off.issues.contains(.offCentre) && off.instruction == "Move to the centre")
    }

    @Test func phoneAndLightAndMovementAreChecked() {
        #expect(BodyScanQuality.assess(Self.frame(pitch: 28), for: .front).instruction == "Stand the phone more upright")
        #expect(!BodyScanQuality.assess(Self.frame(pitch: 15), for: .front).issues.contains(.tilted), "a propped phone is fine")
        #expect(BodyScanQuality.assess(Self.frame(roll: 9), for: .front).issues.contains(.tilted))
        #expect(BodyScanQuality.assess(Self.frame(brightness: 0.1), for: .front).instruction == "Find brighter, even light")
        #expect(BodyScanQuality.assess(Self.frame(motion: 0.05), for: .front).instruction == "Hold still")
        let a = BodyScanQuality.assess(Self.frame(), for: .front)
        #expect(a.measured["span"] != nil && a.measured["pitch"] == 2, "what the gates measured is kept for the capture record")
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
        let a = BodyScanQuality.assess(Self.frame(Self.joints(ankle: 0.97), brightness: 0.1, motion: 0.05), for: .front)
        #expect(a.instruction == "Find brighter, even light")
        #expect(a.issues.count >= 3 && a.score < 1)
    }

    @Test func issueCodesMatchTheBackendsClosedSet() {
        let backend: Set<String> = ["no_person", "multiple_people", "head_out_of_frame", "feet_out_of_frame", "too_close", "too_far",
                                    "off_centre", "tilted", "wrong_orientation", "arms_position", "low_light", "motion", "low_confidence"]
        #expect(Set(ScanQualityIssue.allCases.map(\.rawValue)) == backend)
    }

    // MARK: Self-timer

    @Test func theTimerCountsTenSecondsAndOnlyTheLastThreeAreGated() {
        var c = CaptureCountdown()
        #expect(c.phase == .idle && !c.isActive)
        c.start()
        #expect(c.phase == .running(10))
        // 10 → 3 while the user walks into place: counts even with no valid frame.
        for _ in 0..<7 { c.tick(valid: false) }
        #expect(c.phase == .running(3) && c.isHolding)
        c.tick(valid: true); c.tick(valid: true)
        #expect(c.phase == .running(1))
        c.tick(valid: true)
        #expect(c.phase == .capture)
    }

    @Test func anInvalidFrameInTheLastThreeSecondsPausesAndRestartsFromThree() {
        var c = CaptureCountdown()
        c.start()
        for _ in 0..<8 { c.tick(valid: true) }
        #expect(c.phase == .running(2))
        c.observe(valid: false)                         // stepped out / moved / feet left the frame
        #expect(c.phase == .paused(3) && c.isPaused)
        c.tick(valid: false)
        #expect(c.phase == .paused(3), "a paused timer never advances")
        c.observe(valid: true)
        #expect(c.phase == .running(3))
        c.tick(valid: false)
        #expect(c.phase == .paused(3), "a tick on an invalid frame pauses too")
    }

    @Test func theTimerNeverReachesCaptureOnAnInvalidFrame() {
        var c = CaptureCountdown()
        c.start()
        for _ in 0..<50 { c.tick(valid: false) }
        #expect(c.phase == .paused(3))
    }

    @Test func stoppingTheTimerReturnsToIdle() {
        var c = CaptureCountdown()
        c.start(); c.tick(valid: true)
        c.cancel()
        #expect(c.phase == .idle && c.remaining == nil)
        c.start(); for _ in 0..<10 { c.tick(valid: true) }
        c.finish()
        #expect(c.phase == .idle)
    }

    // MARK: Gate configuration & frame

    @Test func theDefaultGatesAllowAPracticalSelfCaptureDistance() {
        let d = BodyScanProtocolConfig.standard
        #expect(d.spanMax >= 0.88 && d.spanMin <= 0.62)
        #expect(d.maxPitch >= 15, "a phone propped against something leans back")
        #expect(d.id == "default")
        var tuned = d; tuned.spanMax = 0.94
        #expect(tuned.id.hasPrefix("tuned:"))
    }

    @Test func tuningCanNotProduceANonsenseConfiguration() {
        var c = BodyScanProtocolConfig.standard
        c.spanMin = 0.95; c.spanMax = 0.5
        #expect(!c.isSane)
        c = .standard; c.maxPitch = 80
        #expect(!c.isSane)
        #expect(BodyScanProtocolConfig.standard.isSane)
    }

    @Test func theFrameIsLargeAndMatchesTheGates() {
        let c = BodyScanProtocolConfig.standard
        let g = BodyFrameGuide.Landmarks(c)
        #expect(g.headTop < 0.08 && g.feet > 0.92, "the figure spans almost the whole frame height")
        // The drawn nose/ankles sit inside the gated span.
        let drawnSpan = g.ankles - g.nose
        #expect(drawnSpan >= c.spanMin && drawnSpan <= c.spanMax)
        #expect(g.nose >= c.minHeadY && g.ankles <= c.maxAnkleY)
        // A person standing on the guide passes the distance and framing gates.
        let onGuide = Self.frame(Self.joints(top: g.nose, ankle: g.ankles))
        let a = BodyScanQuality.assess(onGuide, for: .front, config: c)
        #expect(!a.issues.contains(.tooClose) && !a.issues.contains(.tooFar) && !a.issues.contains(.headOutOfFrame) && !a.issues.contains(.feetOutOfFrame))
    }

    // MARK: Flow

    static func captured(_ n: Int = 1) -> CapturedView {
        CapturedView(jpeg: Data([0xFF, 0xD8, UInt8(n)]), width: 1536, height: 2048, qualityScore: 1, issues: [], capturedAt: Date(timeIntervalSince1970: 1000))
    }

    @Test func viewsAreCapturedInOrderThenReviewed() {
        var d = BodyScanDraft(scanId: "3F2504E0-4F89-11D3-9A0C-0305E82C3301")
        #expect(d.nextView == .front && !d.isComplete)
        d.record(.front, Self.captured())
        #expect(d.afterCapture(.front) == .viewReview(.front))
        #expect(d.afterAccepting(.front) == .capture(.side))
        d.record(.side, Self.captured())
        #expect(d.afterAccepting(.side) == .capture(.back))
        d.record(.back, Self.captured())
        #expect(d.isComplete && d.afterAccepting(.back) == .review)
    }

    @Test func retakingOneViewKeepsTheOthersAndReturnsToReview() {
        var d = BodyScanDraft()
        for v in BodyScanView.allCases { d.record(v, Self.captured(1)) }
        d.retake(.side)
        #expect(d.views[.front] != nil && d.views[.back] != nil && d.views[.side] == nil)
        #expect(d.nextView == .side && !d.isComplete)
        d.record(.side, Self.captured(2))
        #expect(d.afterCapture(.side) == .viewReview(.side))
        #expect(d.afterAccepting(.side) == .review && d.views[.side]?.jpeg == Self.captured(2).jpeg && d.retaking == nil)
    }

    @Test func retakingFromAViewsOwnReviewCarriesOnToTheNextView() {
        var d = BodyScanDraft()
        d.record(.front, Self.captured(1))
        d.recapture(.front)
        #expect(d.views[.front] == nil && d.retaking == nil)
        d.record(.front, Self.captured(2))
        #expect(d.afterAccepting(.front) == .capture(.side))
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

    // MARK: Phase 5B features

    /// A synthetic person mask (300 × 400) with known geometry: head, torso
    /// (waist narrower), arms apart from the torso, legs apart.
    static func personMask() -> SilhouetteMask {
        let w = 300, h = 400
        var v = [UInt8](repeating: 0, count: w * h)
        func fill(_ x0: Int, _ x1: Int, _ y0: Int, _ y1: Int) { for y in y0...y1 { for x in x0...x1 { v[y * w + x] = 255 } } }
        for y in 30...70 { for x in 130...170 where (x - 150) * (x - 150) + (y - 50) * (y - 50) <= 400 { v[y * w + x] = 255 } }
        fill(120, 180, 70, 129); fill(130, 170, 130, 170); fill(120, 180, 171, 199)
        fill(95, 110, 80, 190); fill(190, 205, 80, 190)
        fill(125, 145, 200, 380); fill(155, 175, 200, 380)
        return SilhouetteMask(width: w, height: h, values: v)
    }

    static func maskJoints() -> [BodyJoint: JointPoint] {
        let p = { (x: Double, y: Double) in JointPoint(x: x / 300, y: y / 400, confidence: 0.9) }
        return [
            .nose: p(150, 48), .neck: p(150, 68), .leftShoulder: p(120, 76), .rightShoulder: p(180, 76),
            .leftElbow: p(102, 140), .rightElbow: p(198, 140), .leftWrist: p(102, 188), .rightWrist: p(198, 188),
            .leftHip: p(135, 200), .rightHip: p(165, 200), .leftKnee: p(135, 288), .rightKnee: p(165, 288),
            .leftAnkle: p(135, 372), .rightAnkle: p(165, 372),
        ]
    }

    @Test func silhouetteWidthsAreNormalisedByTheBodysOwnHeight() {
        let f = BodyScanFeatureExtractor.extract(view: .front, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048,
                                                 captureScore: 1, brightness: 0.5, subjectStill: true)
        let h = 351.0   // rows 30…380
        #expect(abs((f.silhouette?.heightFraction ?? 0) - h / 400) < 0.001)
        #expect(abs((f.widths["shoulder"] ?? 0) - 61 / h) < 0.001)
        #expect(abs((f.widths["waist"] ?? 0) - 41 / h) < 0.001, "the narrowest torso row")
        #expect(abs((f.widths["thighLeft"] ?? 0) - 21 / h) < 0.001)
        #expect((f.ratios["waistToHip"] ?? 1) < 1 && (f.ratios["shoulderToWaist"] ?? 0) > 1)
        #expect(f.silhouette?.keypointAgreement == 1)
        #expect(f.issues.isEmpty, "\(f.issues)")
        #expect(f.widths["upperArmLeft"] != nil, "arms apart from the torso are measured separately")
    }

    @Test func featuresDontDependOnImageResolution() {
        // The same body at half the mask resolution gives the same ratios (within a pixel's rounding).
        let big = Self.personMask()
        var small = [UInt8](repeating: 0, count: 150 * 200)
        for y in 0..<200 { for x in 0..<150 { small[y * 150 + x] = big.values[(y * 2) * 300 + x * 2] } }
        let a = BodyScanFeatureExtractor.extract(view: .front, mask: big, joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        let b = BodyScanFeatureExtractor.extract(view: .front, mask: SilhouetteMask(width: 150, height: 200, values: small), joints: Self.maskJoints(), imageWidth: 768, imageHeight: 1024, captureScore: 1, brightness: 0.5, subjectStill: true)
        #expect(abs((a.widths["waist"] ?? 0) - (b.widths["waist"] ?? 1)) < 0.01)
        #expect(abs((a.ratios["torsoToLeg"] ?? 0) - (b.ratios["torsoToLeg"] ?? 1)) < 0.001)
    }

    @Test func aMissingMaskOrTouchingLegsIsReportedNotGuessed() {
        let none = BodyScanFeatureExtractor.extract(view: .front, mask: nil, joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: nil, subjectStill: true)
        #expect(none.silhouette == nil && none.issues.contains("no_mask") && none.widths.isEmpty)
        #expect(none.ratios["torsoToLeg"] != nil, "pose proportions still come from keypoints")
        // Legs drawn touching: thigh widths are withheld.
        var v = Self.personMask().values
        for y in 200...380 { for x in 145...155 { v[y * 300 + x] = 255 } }
        let touching = BodyScanFeatureExtractor.extract(view: .front, mask: SilhouetteMask(width: 300, height: 400, values: v), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        #expect(touching.widths["thighLeft"] == nil && touching.issues.contains("legs_touching"))
    }

    @Test func sideViewsYieldDepthsAndTheViewsCombineWithoutMixingPixels() {
        let front = BodyScanFeatureExtractor.extract(view: .front, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        let side = BodyScanFeatureExtractor.extract(view: .side, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        #expect(side.widths["waistDepth"] != nil && side.widths["waist"] == nil)
        let set = BodyScanFeatureExtractor.combine([front, side])
        #expect(set.cvVersion == BodyScanFeatureExtractor.version)
        #expect(set.multiViewRatios["waistWidthToDepth"] != nil && set.multiViewRatios["waistGirthIndex"] != nil)
        #expect(set.consistency["heightAgreement"] == 1)
        for key in ["overallScore", "framing", "pose", "lighting", "segmentation", "motion", "multiViewConsistency"] {
            let q = set.quality[key] ?? -1
            #expect(q >= 0 && q <= 1, "\(key) = \(q)")
        }
    }

    @Test func noFeatureIsInCentimetresOrKilograms() {
        let f = BodyScanFeatureExtractor.extract(view: .front, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        for k in Array(f.widths.keys) + Array(f.ratios.keys) {
            #expect(!k.lowercased().contains("cm") && !k.lowercased().contains("kg") && !k.lowercased().contains("fat") && !k.lowercased().contains("bmi"))
        }
        #expect(f.widths.values.allSatisfy { $0 > 0 && $0 < 1 }, "widths are fractions of body height")
    }
}
