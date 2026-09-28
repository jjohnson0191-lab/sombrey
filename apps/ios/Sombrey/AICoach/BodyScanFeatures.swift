import Foundation

// Sombrey Body Scan — Phase 5B: scale-free body features from one scan.
//
// Input per view: a person-segmentation mask (Apple Vision) and 2D body
// keypoints (Apple Vision), both from the stored image. Output: numbers that
// describe SHAPE, each normalised by the body's own height in the image —
// so they don't depend on camera distance or crop, and none of them is a
// measurement in cm or kg (there's no metric scale in a plain photo).
//
// These are engineering inputs for a future, validated body-composition
// model. They are not shown to the user and no single feature is claimed to
// mean anything about body fat.
//
// Plain logic (Foundation only) — tested in SombreyAppTests/BodyScanTests.swift.

/// A person mask: row-major, `width × height`, 0–255 (≥ 128 = person).
struct SilhouetteMask: Equatable, Sendable {
    let width: Int
    let height: Int
    let values: [UInt8]

    func isOn(_ x: Int, _ y: Int) -> Bool {
        guard x >= 0, y >= 0, x < width, y < height else { return false }
        return values[y * width + x] >= 128
    }

    /// The contiguous run of person pixels in row `y` that contains column
    /// `x` (or the nearest person pixel within `search` px): (left, right) or nil.
    func run(row y: Int, through x: Int, search: Int = 4) -> (Int, Int)? {
        guard y >= 0, y < height else { return nil }
        var start: Int?
        for d in 0...search {
            if isOn(x - d, y) { start = x - d; break }
            if isOn(x + d, y) { start = x + d; break }
        }
        guard let s = start else { return nil }
        var l = s, r = s
        while isOn(l - 1, y) { l -= 1 }
        while isOn(r + 1, y) { r += 1 }
        return (l, r)
    }
}

/// One view's features — exactly the shape `bodyScans:attachFeatures` stores.
struct ViewFeatures: Equatable, Sendable {
    struct Keypoint: Equatable, Sendable { let name: String; let x: Double; let y: Double; let confidence: Double }
    struct Silhouette: Equatable, Sendable {
        let maskWidth: Int, maskHeight: Int
        let top: Double, bottom: Double, left: Double, right: Double
        let heightFraction: Double
        let areaPerHeight2: Double
        let mainComponentFraction: Double
        let keypointAgreement: Double
    }
    let view: BodyScanView
    let imageWidth: Int
    let imageHeight: Int
    var processingMs: Double
    let keypoints: [Keypoint]
    let silhouette: Silhouette?
    let widths: [String: Double]
    let ratios: [String: Double]
    let quality: [String: Double]
    let issues: [String]
}

struct BodyScanFeatureSet: Equatable, Sendable {
    let cvVersion: String
    let processedAt: Date
    let components: [String]
    let views: [ViewFeatures]
    let multiViewRatios: [String: Double]
    let consistency: [String: Double]
    let quality: [String: Double]   // overallScore, framing, pose, lighting, segmentation, motion, multiViewConsistency
}

enum BodyScanFeatureExtractor {
    /// Bump when any rule below changes: stored separately, never overwritten.
    static let version = "5b.1"
    static let components = ["vision.personSegmentation.accurate", "vision.bodyPose2D", "sombrey.features.1"]

    private static func r4(_ v: Double) -> Double { (v * 10_000).rounded() / 10_000 }

    // MARK: One view

    /// - Parameters:
    ///   - joints: normalised to the image (x, y 0–1 from the top-left).
    ///   - captureScore: the live gate score at capture (pose/framing quality).
    ///   - brightness / motion: from the capture conditions, when known.
    static func extract(view: BodyScanView, mask: SilhouetteMask?, joints: [BodyJoint: JointPoint], imageWidth: Int, imageHeight: Int,
                        captureScore: Double, brightness: Double?, subjectStill: Bool) -> ViewFeatures {
        var issues: [String] = []
        let conf: (BodyJoint) -> JointPoint? = { j in
            guard let p = joints[j], p.confidence >= 0.3 else { return nil }
            return p
        }
        let keypoints = BodyJoint.allCases.compactMap { j -> ViewFeatures.Keypoint? in
            guard let p = joints[j] else { return nil }
            return .init(name: j.rawValue, x: r4(p.x), y: r4(p.y), confidence: r4(min(1, max(0, p.confidence))))
        }
        if keypoints.filter({ $0.confidence >= 0.3 }).count < 10 { issues.append("few_keypoints") }

        var widths: [String: Double] = [:]
        var ratios: [String: Double] = [:]
        var silhouette: ViewFeatures.Silhouette?
        var segmentationQuality = 0.0
        var framing = 0.0

        if let m = mask, m.width > 0, m.height > 0 {
            // The body's column: between the hips when detected, else the mask's centroid.
            let centreX: Int = {
                if let lh = conf(.leftHip), let rh = conf(.rightHip) { return Int(((lh.x + rh.x) / 2 * Double(m.width)).rounded()) }
                var sum = 0, n = 0
                for y in stride(from: 0, to: m.height, by: 4) { for x in stride(from: 0, to: m.width, by: 4) where m.isOn(x, y) { sum += x; n += 1 } }
                return n > 0 ? sum / n : m.width / 2
            }()
            // Rows where the body column holds a person run: the silhouette.
            var top = -1, bottom = -1, left = m.width, right = 0, mainArea = 0, totalArea = 0
            for y in 0..<m.height {
                for x in 0..<m.width where m.isOn(x, y) { totalArea += 1 }
                if let (l, r) = m.run(row: y, through: centreX, search: m.width / 20) {
                    if top < 0 { top = y }
                    bottom = y
                    left = min(left, l); right = max(right, r)
                    mainArea += r - l + 1
                }
            }
            if top >= 0, bottom > top {
                let h = Double(bottom - top + 1)
                // Keypoints that land on the mask (segmentation ↔ pose agreement).
                let confident = BodyJoint.allCases.compactMap(conf)
                let inside = confident.filter { m.isOn(Int($0.x * Double(m.width)), Int($0.y * Double(m.height))) }.count
                let agreement = confident.isEmpty ? 0 : Double(inside) / Double(confident.count)
                let mainFraction = totalArea > 0 ? Double(mainArea) / Double(totalArea) : 0
                silhouette = .init(
                    maskWidth: m.width, maskHeight: m.height,
                    top: r4(Double(top) / Double(m.height)), bottom: r4(Double(bottom) / Double(m.height)),
                    left: r4(Double(left) / Double(m.width)), right: r4(Double(right) / Double(m.width)),
                    heightFraction: r4(h / Double(m.height)),
                    areaPerHeight2: r4(Double(mainArea) / (h * h)),
                    mainComponentFraction: r4(min(1, mainFraction)),
                    keypointAgreement: r4(agreement)
                )
                segmentationQuality = min(1, 0.5 * agreement + 0.5 * mainFraction)
                framing = (top > 0 && bottom < m.height - 1) ? 1 : 0.4
                if top == 0 { issues.append("head_touches_edge") }
                if bottom >= m.height - 1 { issues.append("feet_touch_edge") }

                // Landmark rows (mask pixels) and widths ÷ silhouette height.
                let yOf: (JointPoint) -> Int = { Int(($0.y * Double(m.height)).rounded()) }
                let xOf: (JointPoint) -> Int = { Int(($0.x * Double(m.width)).rounded()) }
                func bandWidth(_ y0: Int, _ y1: Int, x: Int, pick: ([Int]) -> Int?) -> Double? {
                    let lo = max(top, min(y0, y1)), hi = min(bottom, max(y0, y1))
                    guard hi >= lo else { return nil }
                    let ws = (lo...hi).compactMap { y in m.run(row: y, through: x).map { $0.1 - $0.0 + 1 } }
                    guard let w = pick(ws) else { return nil }
                    return r4(Double(w) / h)
                }
                let shoulderY = [conf(.leftShoulder), conf(.rightShoulder)].compactMap { $0 }.map(yOf)
                let hipY = [conf(.leftHip), conf(.rightHip)].compactMap { $0 }.map(yOf)
                let isSide = view == .side
                if let sY = shoulderY.max(), let hY = hipY.max(), hY > sY {
                    let torso = hY - sY
                    let names = isSide
                        ? (shoulder: "shoulderDepth", chest: "chestDepth", waist: "waistDepth", hip: "hipDepth")
                        : (shoulder: "shoulder", chest: "chest", waist: "waist", hip: "hip")
                    widths[names.shoulder] = bandWidth(sY, sY + max(1, torso / 12), x: centreX) { $0.max() }
                    widths[names.chest] = bandWidth(sY + torso / 4, sY + torso * 35 / 100, x: centreX) { ws in ws.sorted().dropFirst(ws.count / 2).first }
                    widths[names.waist] = bandWidth(sY + torso * 45 / 100, sY + torso * 85 / 100, x: centreX) { $0.min() }
                    widths[names.hip] = bandWidth(hY - torso / 20, hY + torso / 5, x: centreX) { $0.max() }
                } else {
                    issues.append("torso_not_found")
                }
                // Limbs (front/back): each limb segment's midpoint; a run that
                // reaches the other leg's centre means the legs are touching.
                if !isSide {
                    let limbs: [(String, BodyJoint, BodyJoint, BodyJoint?)] = [
                        ("thighLeft", .leftHip, .leftKnee, .rightKnee), ("thighRight", .rightHip, .rightKnee, .leftKnee),
                        ("calfLeft", .leftKnee, .leftAnkle, .rightAnkle), ("calfRight", .rightKnee, .rightAnkle, .leftAnkle),
                        ("upperArmLeft", .leftShoulder, .leftElbow, nil), ("upperArmRight", .rightShoulder, .rightElbow, nil),
                    ]
                    for (name, a, b, other) in limbs {
                        guard let pa = conf(a), let pb = conf(b) else { continue }
                        let mx = xOf(JointPoint(x: (pa.x + pb.x) / 2, y: 0, confidence: 1)), my = yOf(JointPoint(x: 0, y: (pa.y + pb.y) / 2, confidence: 1))
                        guard let (l, r) = m.run(row: my, through: mx) else { continue }
                        if let o = other.flatMap(conf), (l...r).contains(xOf(o)) { issues.append("legs_touching"); continue }
                        widths[name] = r4(Double(r - l + 1) / h)
                    }
                }
                if let w = widths["waist"], let hp = widths["hip"], hp > 0 { ratios["waistToHip"] = r4(w / hp) }
                if let s = widths["shoulder"], let w = widths["waist"], w > 0 { ratios["shoulderToWaist"] = r4(s / w) }
                if let wd = widths["waistDepth"], let hd = widths["hipDepth"], hd > 0 { ratios["waistDepthToHipDepth"] = r4(wd / hd) }
                ratios["areaPerHeight2"] = r4(Double(mainArea) / (h * h))
            } else {
                issues.append("no_silhouette")
            }
        } else {
            issues.append("no_mask")
        }

        // Pose proportions (from keypoints; aspect-corrected to square units).
        let aspect = imageHeight > 0 ? Double(imageWidth) / Double(imageHeight) : 0.75
        func dist(_ a: JointPoint?, _ b: JointPoint?) -> Double? {
            guard let a, let b else { return nil }
            let dx = (a.x - b.x) * aspect, dy = a.y - b.y
            return (dx * dx + dy * dy).squareRoot()
        }
        func mid(_ a: JointPoint?, _ b: JointPoint?) -> JointPoint? {
            guard let a, let b else { return a ?? b }
            return JointPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, confidence: min(a.confidence, b.confidence))
        }
        let hipMid = mid(conf(.leftHip), conf(.rightHip)), ankleMid = mid(conf(.leftAnkle), conf(.rightAnkle))
        let bodyH = silhouette.map { $0.bottom - $0.top } ?? {
            guard let top = (conf(.nose) ?? conf(.neck)), let a = ankleMid else { return 0 }
            return a.y - top.y
        }()
        if bodyH > 0 {
            if let t = dist(conf(.neck), hipMid) { ratios["torsoToHeight"] = r4(t / bodyH) }
            if let l = dist(hipMid, ankleMid) { ratios["legToHeight"] = r4(l / bodyH) }
        }
        if let t = dist(conf(.neck), hipMid), let l = dist(hipMid, ankleMid), l > 0 { ratios["torsoToLeg"] = r4(t / l) }
        let thigh = [dist(conf(.leftHip), conf(.leftKnee)), dist(conf(.rightHip), conf(.rightKnee))].compactMap { $0 }
        let shin = [dist(conf(.leftKnee), conf(.leftAnkle)), dist(conf(.rightKnee), conf(.rightAnkle))].compactMap { $0 }
        if !thigh.isEmpty, !shin.isEmpty { ratios["thighToLowerLeg"] = r4((thigh.reduce(0, +) / Double(thigh.count)) / (shin.reduce(0, +) / Double(shin.count))) }
        let armL = [dist(conf(.leftShoulder), conf(.leftElbow)), dist(conf(.leftElbow), conf(.leftWrist))]
        let armR = [dist(conf(.rightShoulder), conf(.rightElbow)), dist(conf(.rightElbow), conf(.rightWrist))]
        let lenL = armL.allSatisfy { $0 != nil } ? armL.compactMap { $0 }.reduce(0, +) : nil
        let lenR = armR.allSatisfy { $0 != nil } ? armR.compactMap { $0 }.reduce(0, +) : nil
        if let t = dist(conf(.neck), hipMid), t > 0, let a = lenL ?? lenR { ratios["armToTorso"] = r4(a / t) }
        if let l = lenL, let r = lenR, l + r > 0 { ratios["armSymmetry"] = r4(abs(l - r) / ((l + r) / 2)) }
        let legL = [dist(conf(.leftHip), conf(.leftKnee)), dist(conf(.leftKnee), conf(.leftAnkle))]
        let legR = [dist(conf(.rightHip), conf(.rightKnee)), dist(conf(.rightKnee), conf(.rightAnkle))]
        if legL.allSatisfy({ $0 != nil }), legR.allSatisfy({ $0 != nil }) {
            let l = legL.compactMap { $0 }.reduce(0, +), r = legR.compactMap { $0 }.reduce(0, +)
            if l + r > 0 { ratios["legSymmetry"] = r4(abs(l - r) / ((l + r) / 2)) }
        }
        if view != .side, let ls = conf(.leftShoulder), let rs = conf(.rightShoulder) {
            ratios["shoulderTiltDeg"] = r4(atan2((rs.y - ls.y), (rs.x - ls.x) * aspect) * 180 / .pi)
        }
        if view != .side, let lh = conf(.leftHip), let rh = conf(.rightHip) {
            ratios["hipTiltDeg"] = r4(atan2((rh.y - lh.y), (rh.x - lh.x) * aspect) * 180 / .pi)
        }

        let lighting = brightness.map { min(1, max(0, ($0 - 0.12) / 0.3)) } ?? 0.5
        let quality: [String: Double] = [
            "framing": r4(framing),
            "pose": r4(min(1, max(0, captureScore))),
            "segmentation": r4(segmentationQuality),
            "lighting": r4(lighting),
            "motion": subjectStill ? 1 : 0.5,
        ]
        return ViewFeatures(view: view, imageWidth: imageWidth, imageHeight: imageHeight, processingMs: 0,
                            keypoints: keypoints, silhouette: silhouette, widths: widths, ratios: ratios, quality: quality, issues: issues)
    }

    // MARK: All views

    /// Cross-view features and the scan's internal quality object. Front and
    /// side pixels are never mixed directly — only ratios, each already
    /// normalised by its own view's silhouette height, are combined.
    static func combine(_ views: [ViewFeatures], processedAt: Date = Date()) -> BodyScanFeatureSet {
        let by = Dictionary(uniqueKeysWithValues: views.map { ($0.view, $0) })
        var ratios: [String: Double] = [:]
        var consistency: [String: Double] = [:]
        for part in ["chest", "waist", "hip"] {
            guard let w = by[.front]?.widths[part], let d = by[.side]?.widths["\(part)Depth"], d > 0 else { continue }
            ratios["\(part)WidthToDepth"] = r4(w / d)
            // Ellipse perimeter (Ramanujan) from width and depth, ÷ height: a
            // girth *index* — unitless, for shape comparison, not a circumference.
            let a = w / 2, b = d / 2
            ratios["\(part)GirthIndex"] = r4(.pi * (3 * (a + b) - ((3 * a + b) * (a + 3 * b)).squareRoot()))
        }
        // The same person at the same distance: silhouette heights should agree.
        let heights = views.compactMap { $0.silhouette?.heightFraction }
        if heights.count >= 2, let mx = heights.max(), let mn = heights.min(), mx > 0 { consistency["heightAgreement"] = r4(1 - (mx - mn) / mx) }
        if let f = by[.front]?.widths["waist"], let b = by[.back]?.widths["waist"], max(f, b) > 0 {
            consistency["frontBackWaistAgreement"] = r4(1 - abs(f - b) / max(f, b))
        }
        if let f = by[.front]?.widths["hip"], let b = by[.back]?.widths["hip"], max(f, b) > 0 {
            consistency["frontBackHipAgreement"] = r4(1 - abs(f - b) / max(f, b))
        }
        consistency["viewCoverage"] = r4(Double(views.count) / Double(BodyScanView.allCases.count))

        func mean(_ key: String) -> Double {
            let vs = views.compactMap { $0.quality[key] }
            return vs.isEmpty ? 0 : vs.reduce(0, +) / Double(vs.count)
        }
        let multiView = consistency.isEmpty ? 0 : consistency.values.reduce(0, +) / Double(consistency.count)
        var quality: [String: Double] = [
            "framing": r4(mean("framing")), "pose": r4(mean("pose")), "lighting": r4(mean("lighting")),
            "segmentation": r4(mean("segmentation")), "motion": r4(mean("motion")), "multiViewConsistency": r4(multiView),
        ]
        // The weakest component weighs most: a scan is only as good as its worst aspect.
        let parts = quality.values
        let overall = parts.isEmpty ? 0 : 0.5 * (parts.min() ?? 0) + 0.5 * parts.reduce(0, +) / Double(parts.count)
        quality["overallScore"] = r4(overall)
        return BodyScanFeatureSet(cvVersion: version, processedAt: processedAt, components: components, views: views,
                                  multiViewRatios: ratios, consistency: consistency, quality: quality)
    }
}
