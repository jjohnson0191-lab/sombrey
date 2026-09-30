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

    // MARK: Phase 5C — metric scale from measured depth

    @Test func capabilitiesComeFromHardwareAndDegradeGracefully() {
        let faceID = BodyScanCapabilities(trueDepth: true, lidar: false)
        #expect(faceID.frontDepth == .truedepth && !faceID.offersRearMode)
        #expect(faceID.depthSource(for: .rear) == .none, "no LiDAR → the rear mode measures nothing")
        let pro = BodyScanCapabilities(trueDepth: true, lidar: true)
        #expect(pro.offersRearMode && pro.depthSource(for: .rear) == .lidar && pro.depthSource(for: .front) == .truedepth)
        let old = BodyScanCapabilities(trueDepth: false, lidar: false)
        #expect(old.frontDepth == .none && !old.offersRearMode)
        #expect(old.summary(for: .front).contains("Body proportions available"))
        #expect(!faceID.summary(for: .front).contains("Body proportions available"))
        #expect(BodyScanCaptureMode.rear.camera == "rear" && BodyScanCaptureMode.front.camera == "front")
    }

    /// A plane z = a·x + b·y + c seen by a pinhole camera (480 × 640, f = 500, centred).
    static func depthMap(source: BodyScanDepthSource = .truedepth, a: Double = 0, b: Double = 0, c: Double = 1.2, hole: ((Int, Int) -> Bool)? = nil) -> BodyScanDepthMap {
        var m = [Float](repeating: .nan, count: 480 * 640)
        for v in 0..<640 {
            for u in 0..<480 where hole?(u, v) != true {
                let rx = (Double(u) + 0.5 - 240) / 500, ry = (Double(v) + 0.5 - 320) / 500
                m[v * 480 + u] = Float(c / (1 - a * rx - b * ry))
            }
        }
        return BodyScanDepthMap(source: source, width: 480, height: 640, meters: m, focalPx: 500, principalX: 240, principalY: 320,
                                intrinsics: "calibration", accuracy: "absolute", filtered: false)
    }

    /// A 480 × 640 mask: a body rectangle, rows 64..<576, columns 190..<290.
    static func rectMask() -> SilhouetteMask {
        var v = [UInt8](repeating: 0, count: 480 * 640)
        for y in 64..<576 { for x in 190..<290 { v[y * 480 + x] = 255 } }
        return SilhouetteMask(width: 480, height: 640, values: v)
    }

    static let rectJoints: [BodyJoint: JointPoint] = [
        .leftShoulder: JointPoint(x: 0.42, y: 0.2, confidence: 1), .rightShoulder: JointPoint(x: 0.58, y: 0.2, confidence: 1),
        .leftHip: JointPoint(x: 0.45, y: 0.5, confidence: 1), .rightHip: JointPoint(x: 0.55, y: 0.5, confidence: 1),
    ]

    @Test func depthAvailableAFlatSurfaceGivesTheExactProjectedHeight() throws {
        let e = try BodyScanScale.evidence(view: .front, depth: Self.depthMap(), mask: Self.rectMask(), joints: Self.rectJoints).get()
        #expect(abs(e.surfaceHeightM - 512 * 1.2 / 500) < 0.0002)
        #expect(abs(e.distanceM - 1.2) < 0.0001 && e.planeTiltDeg < 0.001 && e.residualM < 0.0001)
        #expect(e.validFraction == 1 && e.samples > 1000 && e.accuracy == "absolute")
    }

    @Test func aTiltedPhoneIsCorrectedByTheFittedPlane() throws {
        let (b, c) = (0.2, 1.3)
        let e = try BodyScanScale.evidence(view: .back, depth: Self.depthMap(b: b, c: c), mask: Self.rectMask(), joints: Self.rectJoints).get()
        func point(_ v: Double) -> (Double, Double) { let ry = (v - 320) / 500, t = c / (1 - b * ry); return (t * ry, t) }
        let (y0, z0) = point(64), (y1, z1) = point(576)
        #expect(abs(e.surfaceHeightM - ((y0 - y1) * (y0 - y1) + (z0 - z1) * (z0 - z1)).squareRoot()) < 0.0002)
        #expect(abs(e.planeTiltDeg - atan(0.2) * 180 / .pi) < 0.01)
        #expect(abs(e.distanceM - c / (1 + b * b).squareRoot()) < 0.0002)
    }

    @Test func insufficientDepthIsReportedNeverFilled() throws {
        // Half the torso without depth: the evidence says so (the server decides).
        let half = try BodyScanScale.evidence(view: .front, depth: Self.depthMap(hole: { u, _ in u >= 240 }), mask: Self.rectMask(), joints: Self.rectJoints).get()
        #expect(abs(half.validFraction - 0.5) < 0.02)
        // No depth at all, no torso, a side view: failures, not numbers.
        #expect(BodyScanScale.evidence(view: .front, depth: Self.depthMap(hole: { _, _ in true }), mask: Self.rectMask(), joints: Self.rectJoints) == .failure(.noDepth))
        #expect(BodyScanScale.evidence(view: .front, depth: Self.depthMap(), mask: Self.rectMask(), joints: [:]) == .failure(.noTorso))
        #expect(BodyScanScale.evidence(view: .side, depth: Self.depthMap(), mask: Self.rectMask(), joints: Self.rectJoints) == .failure(.notAFrontOrBackView))
        let empty = SilhouetteMask(width: 480, height: 640, values: [UInt8](repeating: 0, count: 480 * 640))
        #expect(BodyScanScale.evidence(view: .front, depth: Self.depthMap(), mask: empty, joints: Self.rectJoints) == .failure(.noSilhouette))
    }

    @Test func depthFromLiDARAndTrueDepthIsTheSameGeometry() throws {
        let td = try BodyScanScale.evidence(view: .front, depth: Self.depthMap(source: .truedepth), mask: Self.rectMask(), joints: Self.rectJoints).get()
        let li = try BodyScanScale.evidence(view: .front, depth: Self.depthMap(source: .lidar), mask: Self.rectMask(), joints: Self.rectJoints).get()
        #expect(td.surfaceHeightM == li.surfaceHeightM, "the source changes the error model on the server, not the geometry")
    }

    @Test func sensorOrientationMapsToTheUprightPhoto() {
        #expect(BodyScanDepthOrientation.rotateClockwise([1, 2, 3, 4, 5, 6], width: 3, height: 2) == [4, 1, 5, 2, 6, 3])
        let p = BodyScanDepthOrientation.orient(x: 0.2, y: 0.1, exif: 6)
        #expect(abs(p.x - 0.9) < 1e-12 && abs(p.y - 0.2) < 1e-12)
        let q = BodyScanDepthOrientation.orient(x: 0.2, y: 0.1, exif: 1)
        #expect(q.x == 0.2 && q.y == 0.1)
        let r = BodyScanDepthOrientation.orient(x: 0.2, y: 0.1, exif: 8)
        #expect(abs(r.x - 0.1) < 1e-12 && abs(r.y - 0.8) < 1e-12)
    }

    @Test func profilesAndSideLegDepthsAreScaleFree() {
        let h = 351.0
        let front = BodyScanFeatureExtractor.extract(view: .front, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        let p = front.profile ?? []
        #expect(p.count == BodyScanFeatureExtractor.profileSamples)
        #expect(abs(p[10] - 61 / h) < 0.001, "torso row: the torso only, arms apart aren't counted")
        #expect(abs(p[30] - 42 / h) < 0.001, "leg row: the two legs added")
        let side = BodyScanFeatureExtractor.extract(view: .side, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        #expect(abs((side.widths["thighDepth"] ?? 0) - 21 / h) < 0.001)
        #expect(abs((side.widths["calfDepth"] ?? 0) - 21 / h) < 0.001)
        #expect(BodyScanFeatureExtractor.version == "5c.1")
    }

    @Test func aMetricSourceIsClaimedOnlyWithEvidence() throws {
        var front = BodyScanFeatureExtractor.extract(view: .front, mask: Self.personMask(), joints: Self.maskJoints(), imageWidth: 1536, imageHeight: 2048, captureScore: 1, brightness: 0.5, subjectStill: true)
        #expect(BodyScanFeatureExtractor.combine([front], scaleSource: .truedepth).scaleSource == .none, "depth source but no evidence → no scale")
        front.scaleEvidence = try BodyScanScale.evidence(view: .front, depth: Self.depthMap(), mask: Self.rectMask(), joints: Self.rectJoints).get()
        let set = BodyScanFeatureExtractor.combine([front], scaleSource: .truedepth)
        #expect(set.scaleSource == .truedepth && set.evidence.count == 1)
    }

    @Test func theRearModeGivesLongerToWalkRound() {
        var c = CaptureCountdown()
        c.start(seconds: BodyScanCameraModel.rearSeconds)
        #expect(c.remaining == 15)
        c.start(seconds: 1)
        #expect(c.remaining == CaptureCountdown.holdSeconds + 1, "never shorter than the hold")
        c.start()
        #expect(c.remaining == CaptureCountdown.seconds)
    }

    static func measurements(_ items: [BodyScanMeasurementsDTO.Item], ok: Bool = true, source: String = "truedepth", differs: Bool = false) -> BodyScanMeasurementsDTO {
        BodyScanMeasurementsDTO(cvVersion: "5c.1", methodVersion: "m1", computedAt: 0,
                                scale: .init(source: source, ok: ok, views: ok ? ["front"] : [], reasons: []),
                                measurements: items,
                                profileComparison: .init(profileHeightCm: 179, scannerHeightCm: 171, differenceCm: -8, differs: differs),
                                validated: false)
    }
    static func item(_ name: String, _ status: String, _ value: Double?, _ u: Double?, unit: String = "cm") -> BodyScanMeasurementsDTO.Item {
        .init(name: name, kind: "length", status: status, unit: unit, value: value, uncertainty: u, confidence: 0.5, method: "m", reasons: [])
    }

    @Test func onlyAvailableMeasurementsAreShownWithoutFalsePrecision() {
        let m = Self.measurements([
            Self.item("height", "available", 178.43, 3.2),
            Self.item("waistCircumference", "low_confidence", 82.4, 9.1),
            Self.item("shoulderWidth", "available", 43.8, 0.4),
            Self.item("trunkLegVolume", "available", 61.2, 4, unit: "L"),
            Self.item("weight", "unavailable", nil, nil, unit: "kg"),
        ])
        let lines = BodyScanMeasurementPresentation.lines(m)
        #expect(lines == [.init(label: "Height", text: "178 ± 4 cm"), .init(label: "Shoulder width", text: "44 ± 1 cm")])
        #expect(!lines.contains { $0.label == "Waist" }, "low-confidence values are never shown")
        #expect(!lines.contains { $0.text.contains(".") }, "whole centimetres only")
        #expect(BodyScanMeasurementPresentation.summary(m).contains("not yet validated"))
    }

    @Test func withoutScaleOnlyProportionsAreOffered() {
        let m = Self.measurements([Self.item("height", "unavailable", nil, nil), Self.item("waistToHip", "available", 0.85, nil, unit: "ratio")], ok: false, source: "none")
        #expect(BodyScanMeasurementPresentation.lines(m).isEmpty)
        #expect(BodyScanMeasurementPresentation.summary(m).contains("Body proportions available"))
        #expect(BodyScanMeasurementPresentation.proportions(m) == ["waist-to-hip"])
    }

    @Test func aHeightGapIsNotedNeverCorrected() {
        #expect(BodyScanMeasurementPresentation.heightNote(Self.measurements([], differs: false)) == nil)
        let note = BodyScanMeasurementPresentation.heightNote(Self.measurements([], differs: true)) ?? ""
        #expect(note.hasPrefix("Scanner estimate differs from your saved height"))
        #expect(!note.lowercased().contains("wrong") && !note.lowercased().contains("incorrect"))
    }

    // MARK: Phase 5D — validation tooling (development builds only)

    @Test func validationSubjectCodesArePseudonymous() {
        #expect(BodyScanValidationVocabulary.cleanSubjectCode("s01") == "S01")
        #expect(BodyScanValidationVocabulary.cleanSubjectCode(" S-02 ") == "S-02")
        #expect(BodyScanValidationVocabulary.cleanSubjectCode("John Smith") == nil, "no names")
        #expect(BodyScanValidationVocabulary.cleanSubjectCode("") == nil)
        #expect(BodyScanValidationVocabulary.cleanSubjectCode("ABCDEFGHIJKLM") == nil)
        #expect(BodyScanValidationVocabulary.number("84,5") == 84.5)
        #expect(BodyScanValidationVocabulary.number("abc") == nil)
    }

    @Test func validationUnitsAndProtocolsMatchTheServer() {
        let byKey = Dictionary(uniqueKeysWithValues: BodyScanValidationVocabulary.measurements.map { ($0.key, $0) })
        #expect(Set(byKey.keys) == ["height", "weight", "chest", "waist", "hips", "upperArm", "thigh", "calf", "shoulderWidth", "bodyFat"])
        #expect(BodyScanValidationVocabulary.units(for: byKey["bodyFat"]!) == ["%"] && byKey["bodyFat"]!.protocols == ["dxa_whole_body"])
        #expect(BodyScanValidationVocabulary.units(for: byKey["weight"]!) == ["kg", "lb"])
        #expect(BodyScanValidationVocabulary.units(for: byKey["waist"]!) == ["cm", "mm", "in"])
        #expect(byKey["height"]!.protocols.allSatisfy { $0.hasSuffix("barefoot") })
        #expect(BodyScanValidationVocabulary.distances == [1.0, 1.3, 1.5, 1.7, 2.0, 2.5])
    }

    @Test func validationReportDecodesAndWithheldStatisticsPrintAsNA() throws {
        let json = """
        {"report":{"analysisVersion":"v1","pilot":true,"scans":3,"subjects":1,"truths":2,"methodVersions":["m1"],
          "measurements":[{"measurement":"height","scans":3,"statusCounts":{"low_confidence":3},
            "accuracyAll":{"n":3,"pilot":true,"mae":2.1,"medianAbsolute":2,"rmse":2.3,"meanBias":1.9,"sdError":1.2,"limitsOfAgreement":[-0.45,4.25],"mape":1.18},
            "accuracyAvailable":null,"calibration":null,"repeatability":{"groups":1,"subjects":1,"df":2,"pilot":true,"withinSd":0.9,"cvPercent":0.5,"mdc95":2.49,"icc":null},
            "immediateRepeatMeanAbsDiff":0.5,"repositionMeanAbsDiff":1.5,"truthOperatorSd":null,"operatingCurve":[]},
            {"measurement":"weight","scans":0,"statusCounts":{},"accuracyAll":null,"accuracyAvailable":null,"calibration":null,"repeatability":null,
             "immediateRepeatMeanAbsDiff":null,"repositionMeanAbsDiff":null,"truthOperatorSd":null,"operatingCurve":[]}],
          "factors":{"distanceM":[{"level":"1.0","scans":2,"metricScaleShare":1,"heightMae":null,"heightBias":null,"waistMae":null},{"level":"2.0","scans":1,"metricScaleShare":0,"heightMae":null,"heightBias":null,"waistMae":null}]},
          "scaleFailureReasons":{"front:sparse_depth":1},"notes":["Pilot validation: engineering evidence only — no accuracy claim may be made from it."]},
         "csv":"scanId,subject","paired":[{"scanId":"x","subject":"S01","session":"d1","repeat":"A","measurement":"height","status":"low_confidence","scanner":180.2,"uncertainty":8.1,"truth":178,"signedError":2.2,"distanceM":1.5,"depthSource":"truedepth"}]}
        """
        let dto = try JSONDecoder().decode(BodyScanValidationReportDTO.self, from: Data(json.utf8))
        let text = BodyScanValidationFormat.lines(dto.report).joined(separator: "\n")
        #expect(text.hasPrefix("PILOT VALIDATION v1 · 3 scans"))
        #expect(text.contains("MAE 2.1") && text.contains("MDC95 2.5") && text.contains("ICC n/a"))
        #expect(!text.contains("WEIGHT"), "a measurement with no scans isn't listed")
        #expect(text.contains("BY DISTANCEM") && text.contains("height MAE n/a"), "withheld statistics are n/a, never 0")
        #expect(text.contains("front:sparse_depth×1"))
        #expect(BodyScanValidationFormat.pairedLine(dto.paired[0]) == "S01 d1 A 1.5m truedepth height: scan 180.2±8.1 [low_confidence] truth 178.0 err +2.2")
    }

    // MARK: Phase 5E — composition, change over time, server capture config, uploads

    static func serverConfig(spanMin: Double = 0.5, spanMax: Double = 0.92, maxPitch: Double = 22) -> BodyScanServerCaptureConfig {
        BodyScanServerCaptureConfig(version: "5e-test", spanMin: spanMin, spanMax: spanMax, minHeadY: 0.04, maxAnkleY: 0.95, centreMin: 0.33, centreMax: 0.67,
                                    maxPitch: maxPitch, maxRoll: 6, minBrightness: 0.2, maxSubjectMotion: 0.015, maxDeviceMotion: 0.06)
    }

    @Test func serverCaptureGatesApplyOnlyWithinTheAppsOwnBounds() {
        let c = Self.serverConfig().config
        #expect(c != nil && c?.spanMin == 0.5 && c?.id == "server:5e-test", "recorded as the server's config")
        #expect(Self.serverConfig(spanMin: 0.95, spanMax: 0.9).config == nil, "an inverted span is refused")
        #expect(Self.serverConfig(maxPitch: 80).config == nil, "a tilt the app would never accept is refused")
        var tuned = c!
        tuned.label = nil
        #expect(tuned.id.hasPrefix("tuned:"), "once tuned locally it's never labelled as the server's")
        #expect(BodyScanProtocolConfig.standard.id == "default")
    }

    static func composition(_ results: [BodyScanCompositionDTO.Result]) -> BodyScanCompositionDTO {
        BodyScanCompositionDTO(compositionVersion: "c1", measurementMethodVersion: "m2", results: results, validated: false)
    }
    static func compResult(_ name: String, _ model: String, status: String, value: Double?, low: Double? = nil, high: Double? = nil, displayable: Bool) -> BodyScanCompositionDTO.Result {
        .init(name: name, model: model, modelVersion: "1", modelKind: "equation", validationStatus: "experimental", status: status,
              value: value, low: low, high: high, displayable: displayable, reasons: [])
    }

    @Test func bodyFatStaysHiddenWhileExperimentalAndBMINamesItsSource() {
        let c = Self.composition([
            Self.compResult("bodyFatPercent", "rfm", status: "estimate", value: 22.4, low: 14.1, high: 30.7, displayable: false),
            Self.compResult("bmi", "bmi.recorded", status: "calculated", value: 25.61, displayable: true),
            Self.compResult("bodyFatPercent", "sombrey.bodyfat", status: "unavailable", value: nil, displayable: false),
        ])
        let lines = BodyScanCompositionPresentation.lines(c)
        #expect(lines == [.init(label: "BMI", text: "25.6 · from your recorded height and weight")])
        #expect(!lines.contains { $0.label.contains("Body fat") }, "no body-fat number while experimental")
        #expect(BodyScanCompositionPresentation.note(c)?.contains("validation is pending") == true)
        // If a future version marks body fat displayable, it's a range — never a point value.
        let future = Self.composition([Self.compResult("bodyFatPercent", "sombrey.bodyfat", status: "estimate", value: 22.4, low: 19.6, high: 25.2, displayable: true)])
        #expect(BodyScanCompositionPresentation.lines(future) == [.init(label: "Body fat", text: "20–25 % · experimental")])
    }

    static func change(_ state: String, delta: Double, name: String = "waistCircumference", comparable: Bool = true, mdcValidated: Bool = false) -> BodyScanChangeDTO {
        BodyScanChangeDTO(comparable: comparable, reasons: comparable ? nil : ["alignment:front:pose_differs"],
                          changes: [.init(name: name, unit: "cm", a: 84, b: 84 + delta, delta: delta, noise: 2.1, state: state)],
                          mdcValidated: mdcValidated, validated: false)
    }

    @Test func changeOverTimeIsNeverMoreCertainThanTheScanner() {
        #expect(BodyScanChangePresentation.lines(Self.change("no_meaningful_change", delta: 1.2)) == [.init(label: "Waist", text: "No meaningful change")])
        #expect(BodyScanChangePresentation.lines(Self.change("possible_change", delta: -3.4)) == [.init(label: "Waist", text: "Possible change (−3 cm) · not confirmed")])
        #expect(BodyScanChangePresentation.lines(Self.change("meaningful_change", delta: 4.6, mdcValidated: true)) == [.init(label: "Waist", text: "Change (+5 cm)")])
        #expect(BodyScanChangePresentation.summary(Self.change("possible_change", delta: 3)).contains("aren't confirmed"))
        let misaligned = Self.change("possible_change", delta: 3, comparable: false)
        #expect(BodyScanChangePresentation.lines(misaligned).isEmpty)
        #expect(BodyScanChangePresentation.summary(misaligned).contains("weren't taken the same way"))
    }

    @Test func scanQualityIsALabelNotANumber() {
        #expect(BodyScanQualityPresentation.label(0.93) == "Scan quality: good")
        #expect(BodyScanQualityPresentation.label(0.7) == "Scan quality: fair")
        #expect(BodyScanQualityPresentation.label(0.4)?.hasPrefix("Scan quality: low") == true)
        #expect(BodyScanQualityPresentation.label(nil) == nil)
    }

    @Test func uploadsAreAuthenticatedAndNeverCarryAUrl() {
        let r = BodyScanUpload.authenticatedRequest(site: URL(string: "https://adamant-chicken-676.convex.site")!, token: "t0k", bytes: 123_456)
        #expect(r.httpMethod == "POST")
        #expect(r.url?.absoluteString == "https://adamant-chicken-676.convex.site/body-scan-upload")
        #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer t0k")
        #expect(r.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        #expect(r.cachePolicy == .reloadIgnoringLocalAndRemoteCacheData)
    }

    // MARK: Phase 5F — longitudinal experience

    static func item(_ name: String, _ status: String, _ value: Double?, _ u: Double?, unit: String = "cm", provenance: BodyScanProvenance? = nil) -> BodyScanMeasurementsDTO.Item {
        .init(name: name, kind: "length", status: status, unit: unit, value: value, uncertainty: u, confidence: 0.5, method: "m", reasons: [], provenance: provenance)
    }

    @Test func experimentalValuesAreNeverShownAsMeasuredAndStayOnDevelopmentBuilds() {
        let m = Self.measurements([
            Self.item("height", "available", 178.4, 3.2, provenance: .experimental),
            Self.item("waistCircumference", "available", 82.2, 4.1, provenance: .measured),
            Self.item("shoulderWidth", "low_confidence", 44, 9, provenance: .experimental),
            Self.item("waistToHeight", "available", 0.462, 0.041, unit: "ratio", provenance: .experimental),
        ])
        let production = BodyScanDisplayPolicy(showsExperimental: false)
        #expect(BodyScanResultPresentation.measurements(m, policy: production) == [.init(label: "Waist", text: "82 ± 5 cm", provenance: .measured)],
                "production: only released ('Measured') values")
        #expect(BodyScanResultPresentation.proportions(m, policy: production).isEmpty, "experimental proportions aren't shown in production")
        let dev = BodyScanDisplayPolicy(showsExperimental: true)
        let lines = BodyScanResultPresentation.measurements(m, policy: dev)
        #expect(lines.map(\.provenance) == [.experimental, .measured], "each value keeps its own label")
        #expect(!lines.contains { $0.label == "Shoulder width" }, "low-confidence results are never shown")
        #expect(BodyScanResultPresentation.proportions(m, policy: dev) == [.init(label: "Waist-to-height", text: "0.46 ± 0.04", provenance: .experimental)])
        #expect(BodyScanProvenance.calculated.label == "Calculated" && BodyScanProvenance.notAvailable.label == "Not available")
        #expect(!production.shows(.experimental) && production.shows(.calculated) && !dev.shows(.notAvailable))
    }

    @Test func comparisonPhotosAreAlignedByBodyOutline() {
        // Two photos: the body spans rows 0.10–0.90 in one and 0.20–0.80 in the other.
        let container = CGSize(width: 300, height: 400)
        let a = BodyScanComparisonDTO.Frame(top: 0.1, bottom: 0.9, left: 0.4, right: 0.6)
        let b = BodyScanComparisonDTO.Frame(top: 0.2, bottom: 0.8, left: 0.3, right: 0.5)
        let img = CGSize(width: 1536, height: 2048)
        guard let pa = BodyScanAlignment.placement(frame: a, imageSize: img, container: container),
              let pb = BodyScanAlignment.placement(frame: b, imageSize: img, container: container) else { #expect(Bool(false)); return }
        func onScreen(_ p: (size: CGSize, center: CGPoint), _ y: Double) -> Double { Double(p.center.y) - Double(p.size.height) / 2 + y * Double(p.size.height) }
        #expect(abs(onScreen(pa, 0.1) - 24) < 0.001 && abs(onScreen(pb, 0.2) - 24) < 0.001, "both outlines start at 6 % of the container")
        #expect(abs(onScreen(pa, 0.9) - 376) < 0.001 && abs(onScreen(pb, 0.8) - 376) < 0.001, "…and end at 94 %")
        let centreX = { (p: (size: CGSize, center: CGPoint), f: BodyScanComparisonDTO.Frame) in Double(p.center.x) - Double(p.size.width) / 2 + (f.left + f.right) / 2 * Double(p.size.width) }
        #expect(abs(centreX(pa, a) - 150) < 0.001 && abs(centreX(pb, b) - 150) < 0.001, "both bodies centred")
        #expect(BodyScanAlignment.placement(frame: .init(top: 0.5, bottom: 0.5, left: 0, right: 1), imageSize: img, container: container) == nil, "no outline, no forced alignment")
    }

    @Test func refusedComparisonsAreExplainedPlainly() {
        #expect(BodyScanComparisonPresentation.refusal(["alignment:front:distance_differs"]) == "These scans were captured under different conditions (distance, phone angle or pose) and can't be reliably compared.")
        #expect(BodyScanComparisonPresentation.refusal(["scale_source_differs"]).contains("different cameras"))
        #expect(BodyScanComparisonPresentation.refusal(["not_processed"]).contains("once both scans have been analysed"))
        #expect(BodyScanComparisonPresentation.viewRefusal(["image_missing"]).contains("no longer has this view's image"))
    }

    @Test func analysisDetailsCarryTheScansProvenance() throws {
        let json = """
        {"createdAt":1790000000000,"protocolVersion":"5a.2","consentVersion":"2026-09-28",
         "capture":{"deviceModel":"iPhone16,1","osVersion":"iOS 26.0","appVersion":"1.0 (53)","camera":"front","depth":"truedepth","clothing":"fitted_athletic","imageMaxPixel":2048,"jpegQuality":0.9},
         "context":{"heightCm":179,"weightKg":82,"sex":"male","ageYears":35},"removedViews":["back"],
         "views":[{"view":"front","qualityScore":0.95,"issues":[],"capturedAt":1,"protocolConfig":"server:5f.1"}],
         "cvVersion":"5c.1","captureQualityOverall":0.91,"scaleSource":"truedepth","scaleOk":false,"measurementMethodVersion":"m2","compositionVersion":"c1",
         "compositionModels":[{"model":"rfm","version":"0","validationStatus":"experimental","status":"estimate"}],"validated":false}
        """
        let d = try JSONDecoder().decode(BodyScanDetailsDTO.self, from: Data(json.utf8))
        let rows = Dictionary(uniqueKeysWithValues: BodyScanDetailsPresentation.rows(d))
        #expect(rows["Device"] == "iPhone16,1" && rows["App version"] == "1.0 (53)" && rows["Depth"] == "TrueDepth (front)")
        #expect(rows["Clothing"]?.contains("may reduce accuracy") == true)
        #expect(rows["Capture settings"] == "server:5f.1")
        #expect(rows["Analysis"] == "features 5c.1 · method m2 · composition c1")
        #expect(rows["Distance measurement"] == "Not usable for this scan")
        #expect(rows["Your details at this scan"] == "179 cm · 82.0 kg · male · 35 y")
        #expect(rows["Validation"] == "Not yet validated")
    }

    @Test func historySummariesDecodeAndClothingIsNeutral() throws {
        let json = """
        {"captureQuality":0.88,"depthSource":"truedepth","processed":true,"measured":[],"experimental":["shoulderWidth"],"bmi":{"value":25.6,"displayable":true},"composition":"experimental","changeDetection":"possible_only"}
        """
        let s = try JSONDecoder().decode(BodyScanSummaryDTO.self, from: Data(json.utf8))
        #expect(s.bmi?.value == 25.6 && s.changeDetection == "possible_only" && s.measured.isEmpty)
        #expect(BodyScanClothing.recommended.note == nil)
        let note = BodyScanClothing.fittedAthletic.note ?? ""
        #expect(note.contains("less accurate") && !note.lowercased().contains("must") && !note.lowercased().contains("wrong"))
    }
}
