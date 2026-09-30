import Foundation

// Sombrey Body Scan — Phase 5C: metric scale from measured depth.
//
// A plain photo has no metric scale, so nothing here ever assumes one (no
// generic human height, no Vision default). Scale exists only when the phone
// MEASURED depth while capturing:
//   • front camera → TrueDepth (Face ID iPhones), with every normal capture;
//   • rear camera  → LiDAR (Pro iPhones/iPads), in the optional rear mode.
// The depth map stays on the phone. From it, this file derives a few numbers
// per view — the torso surface's distance, how well it was measured, and the
// silhouette's height projected onto it — and the server's versioned method
// (convex/bodyScan/measurements.ts) decides what, if anything, is measurable.
//
// Plain logic (Foundation only) — tested in SombreyAppTests/BodyScanTests.swift.

/// The depth source a capture used.
enum BodyScanDepthSource: String, Codable, Sendable {
    case none, truedepth, lidar
}

/// How a scan is captured. `.front` is the standard guided scan; `.rear` is
/// the LiDAR metric mode (the screen faces away, so guidance is spoken).
enum BodyScanCaptureMode: String, Codable, Sendable {
    case front, rear
    var camera: String { rawValue }
}

/// What this device can measure. Decided from hardware, never assumed.
struct BodyScanCapabilities: Equatable, Sendable {
    let trueDepth: Bool
    let lidar: Bool

    /// The standard (front) scan uses TrueDepth whenever the device has it.
    var frontDepth: BodyScanDepthSource { trueDepth ? .truedepth : .none }
    /// The rear metric mode is offered only where LiDAR exists.
    var offersRearMode: Bool { lidar }

    func depthSource(for mode: BodyScanCaptureMode) -> BodyScanDepthSource {
        switch mode {
        case .front: return frontDepth
        case .rear: return lidar ? .lidar : .none
        }
    }

    /// Plain-language capability line for the prepare screen.
    func summary(for mode: BodyScanCaptureMode) -> String {
        switch depthSource(for: mode) {
        case .none: return "Body proportions available. This iPhone can't measure distance, so no centimetre measurements."
        case .truedepth: return "Measurements may be available — this iPhone measures distance with its front sensor when the capture is clear enough."
        case .lidar: return "Measurements may be available — the back camera's LiDAR measures distance when the capture is clear enough."
        }
    }
}

/// One view's depth, upright (the same orientation as the stored photo).
struct BodyScanDepthMap: Equatable, Sendable {
    let source: BodyScanDepthSource
    let width: Int
    let height: Int
    /// Metres, row-major; NaN or ≤ 0 = no measurement (holes are never filled).
    let meters: [Float]
    /// Pinhole intrinsics in depth-map pixels.
    let focalPx: Double
    let principalX: Double
    let principalY: Double
    let intrinsics: String      // "calibration" | "field_of_view"
    let accuracy: String        // "absolute" | "relative"
    let filtered: Bool

    func depth(_ x: Int, _ y: Int) -> Double? {
        guard x >= 0, y >= 0, x < width, y < height else { return nil }
        let v = meters[y * width + x]
        return v.isFinite && v > 0 ? Double(v) : nil
    }
}

/// The numbers `bodyScans:attachFeatures` stores per view (scale.evidence).
struct BodyScanScaleEvidence: Equatable, Sendable {
    let view: BodyScanView
    let depthWidth: Int
    let depthHeight: Int
    let focalPx: Double
    let intrinsics: String
    let accuracy: String
    let filtered: Bool
    let samples: Int
    let validFraction: Double
    let distanceM: Double
    let planeTiltDeg: Double
    let residualM: Double
    let surfaceHeightM: Double
}

enum BodyScanDepthOrientation {
    /// A normalised point in a sensor-oriented image → the same point once
    /// the EXIF orientation (1–8) is applied.
    static func orient(x: Double, y: Double, exif: UInt32) -> (x: Double, y: Double) {
        switch exif {
        case 2: return (1 - x, y)          // up, mirrored
        case 3: return (1 - x, 1 - y)      // down
        case 4: return (x, 1 - y)          // down, mirrored
        case 5: return (y, x)              // left, mirrored (transpose)
        case 6: return (1 - y, x)          // right: rotate 90° clockwise
        case 7: return (1 - y, 1 - x)      // right, mirrored (transverse)
        case 8: return (y, 1 - x)          // left: rotate 90° counter-clockwise
        default: return (x, y)             // up
        }
    }

    /// Row-major buffer rotated 90° clockwise (sensor landscape → upright
    /// portrait for the rear camera): the result is height × width.
    static func rotateClockwise<T>(_ v: [T], width: Int, height: Int) -> [T] {
        guard width > 0, height > 0, v.count == width * height else { return [] }
        var out = v
        let newWidth = height
        for y in 0..<height {
            for x in 0..<width {
                out[x * newWidth + (height - 1 - y)] = v[y * width + x]
            }
        }
        return out
    }
}

enum BodyScanScale {
    /// Samples further than this from the torso's median depth are the arms,
    /// background or noise — never the torso surface.
    static let outlierM = 0.25
    /// Keep the plane fit on the torso: inset from each side of the body's
    /// outline, and away from shoulders/belt.
    static let sideInset = 0.2

    enum Failure: String, Error, Equatable {
        case notAFrontOrBackView = "side_view"
        case noSilhouette = "no_silhouette"
        case noTorso = "no_torso"
        case noDepth = "no_depth"
        case degenerate = "degenerate_plane"
    }

    /// One front/back view's scale evidence: fits a plane to the torso's
    /// measured surface and projects the silhouette's top and bottom onto it.
    /// Joints are image-normalised (0–1 from the top-left); the mask and the
    /// depth map cover the same (upright) image.
    static func evidence(view: BodyScanView, depth d: BodyScanDepthMap, mask m: SilhouetteMask,
                         joints: [BodyJoint: JointPoint]) -> Result<BodyScanScaleEvidence, Failure> {
        guard view != .side else { return .failure(.notAFrontOrBackView) }
        guard m.width > 0, m.height > 0, d.width > 0, d.height > 0, d.focalPx > 0 else { return .failure(.noSilhouette) }
        let conf: (BodyJoint) -> JointPoint? = { j in
            guard let p = joints[j], p.confidence >= 0.3 else { return nil }
            return p
        }
        // The body's column (as the feature extractor finds it) and its silhouette rows.
        let centreX: Int = {
            if let l = conf(.leftHip), let r = conf(.rightHip) { return Int(((l.x + r.x) / 2 * Double(m.width)).rounded()) }
            return m.width / 2
        }()
        var top: (row: Int, x: Double)?, bottom: (row: Int, x: Double)?
        for y in 0..<m.height {
            if let (l, r) = m.run(row: y, through: centreX, search: m.width / 20) {
                let mid = Double(l + r + 1) / 2
                if top == nil { top = (y, mid) }
                bottom = (y, mid)
            }
        }
        guard let top, let bottom, bottom.row > top.row else { return .failure(.noSilhouette) }

        // Torso band: between the shoulders and hips, away from both.
        let shoulders = [conf(.leftShoulder), conf(.rightShoulder)].compactMap { $0?.y }
        let hips = [conf(.leftHip), conf(.rightHip)].compactMap { $0?.y }
        guard let sY = shoulders.max(), let hY = hips.max(), hY > sY else { return .failure(.noTorso) }
        let bandTop = sY + 0.15 * (hY - sY), bandBottom = hY - 0.1 * (hY - sY)

        var candidates = 0
        var points: [(x: Double, y: Double, z: Double)] = []
        let v0 = Int((bandTop * Double(d.height)).rounded()), v1 = Int((bandBottom * Double(d.height)).rounded())
        guard v1 > v0 else { return .failure(.noTorso) }
        for v in v0...v1 {
            let my = min(m.height - 1, Int(Double(v) / Double(d.height) * Double(m.height)))
            guard let (l, r) = m.run(row: my, through: centreX, search: m.width / 20) else { continue }
            let w = Double(r - l + 1)
            let uL = Int(((Double(l) + sideInset * w) / Double(m.width) * Double(d.width)).rounded())
            let uR = Int(((Double(r + 1) - sideInset * w) / Double(m.width) * Double(d.width)).rounded())
            guard uR > uL else { continue }
            for u in uL..<uR {
                candidates += 1
                guard let z = d.depth(u, v) else { continue }
                points.append(((Double(u) + 0.5 - d.principalX) * z / d.focalPx, (Double(v) + 0.5 - d.principalY) * z / d.focalPx, z))
            }
        }
        guard candidates > 0, !points.isEmpty else { return .failure(.noDepth) }
        let median = points.map(\.z).sorted()[points.count / 2]
        let kept = points.filter { abs($0.z - median) <= outlierM }
        guard kept.count >= 3, let plane = fitPlane(kept) else { return .failure(.degenerate) }
        let (a, b, c) = plane
        let cosTilt = 1 / (a * a + b * b + 1).squareRoot()
        guard c > 0 else { return .failure(.degenerate) }
        let rms = (kept.map { p in let e = (p.z - (a * p.x + b * p.y + c)) * cosTilt; return e * e }.reduce(0, +) / Double(kept.count)).squareRoot()

        // Silhouette top edge and bottom edge, as rays onto the plane.
        func project(_ mx: Double, _ my: Double) -> (Double, Double, Double)? {
            let u = mx / Double(m.width) * Double(d.width), v = my / Double(m.height) * Double(d.height)
            let rx = (u - d.principalX) / d.focalPx, ry = (v - d.principalY) / d.focalPx
            let denom = 1 - a * rx - b * ry
            guard denom > 1e-6 else { return nil }
            let t = c / denom
            return (t * rx, t * ry, t)
        }
        guard let pt = project(top.x, Double(top.row)), let pb = project(bottom.x, Double(bottom.row + 1)) else { return .failure(.degenerate) }
        let heightM = ((pt.0 - pb.0) * (pt.0 - pb.0) + (pt.1 - pb.1) * (pt.1 - pb.1) + (pt.2 - pb.2) * (pt.2 - pb.2)).squareRoot()
        let r4 = { (x: Double) in (x * 10_000).rounded() / 10_000 }
        return .success(BodyScanScaleEvidence(
            view: view, depthWidth: d.width, depthHeight: d.height, focalPx: r4(d.focalPx),
            intrinsics: d.intrinsics, accuracy: d.accuracy, filtered: d.filtered,
            samples: kept.count, validFraction: r4(Double(kept.count) / Double(candidates)),
            distanceM: r4(c * cosTilt), planeTiltDeg: r4(acos(min(1, cosTilt)) * 180 / .pi),
            residualM: r4(rms), surfaceHeightM: r4(heightM)
        ))
    }

    /// Least-squares plane z = a·x + b·y + c (camera coordinates, metres).
    static func fitPlane(_ p: [(x: Double, y: Double, z: Double)]) -> (Double, Double, Double)? {
        var sxx = 0.0, sxy = 0.0, syy = 0.0, sx = 0.0, sy = 0.0, sxz = 0.0, syz = 0.0, sz = 0.0
        let n = Double(p.count)
        for q in p {
            sxx += q.x * q.x; sxy += q.x * q.y; syy += q.y * q.y
            sx += q.x; sy += q.y; sz += q.z; sxz += q.x * q.z; syz += q.y * q.z
        }
        // | sxx sxy sx | |a|   |sxz|
        // | sxy syy sy | |b| = |syz|
        // | sx  sy  n  | |c|   |sz |
        let det = sxx * (syy * n - sy * sy) - sxy * (sxy * n - sy * sx) + sx * (sxy * sy - syy * sx)
        guard abs(det) > 1e-12 else { return nil }
        let da = sxz * (syy * n - sy * sy) - sxy * (syz * n - sy * sz) + sx * (syz * sy - syy * sz)
        let db = sxx * (syz * n - sz * sy) - sxz * (sxy * n - sy * sx) + sx * (sxy * sz - syz * sx)
        let dc = sxx * (syy * sz - sy * syz) - sxy * (sxy * sz - syz * sx) + sxz * (sxy * sy - syy * sx)
        return (da / det, db / det, dc / det)
    }
}

// MARK: - Measurements (bodyScans:measurements)

/// A scan's derived measurements, as the server stores them: every entry has
/// a status, and only "available" ones carry a value meant for display.
struct BodyScanMeasurementsDTO: Decodable, Equatable, Sendable {
    struct Item: Decodable, Equatable, Sendable {
        let name: String
        let kind: String
        let status: String
        let unit: String
        var value: Double? = nil
        var uncertainty: Double? = nil
        let confidence: Double
        let method: String
        let reasons: [String]
        /// 5F: "measured" only once released through the validation gate.
        var provenance: BodyScanProvenance? = nil
        var released: Bool? = nil
    }
    struct Scale: Decodable, Equatable, Sendable {
        let source: String
        let ok: Bool
        let views: [String]
        let reasons: [String]
    }
    struct Comparison: Decodable, Equatable, Sendable {
        let profileHeightCm: Double
        var scannerHeightCm: Double? = nil
        var differenceCm: Double? = nil
        let differs: Bool
    }
    let cvVersion: String
    let methodVersion: String
    let computedAt: Double
    let scale: Scale
    let measurements: [Item]
    var profileComparison: Comparison? = nil
    let validated: Bool
    var snapshotHeightCm: Double? = nil
}

/// What the scan summary may show. Only "available" metric measurements, in
/// whole centimetres with a ± of at least 1 — never low-confidence values,
/// never volume, weight or BMI, never more precision than the method has.
enum BodyScanMeasurementPresentation {
    struct Line: Equatable, Sendable {
        let label: String
        let text: String
    }

    static let order: [(name: String, label: String)] = [
        ("height", "Height"), ("chestCircumference", "Chest"), ("waistCircumference", "Waist"), ("hipCircumference", "Hips"),
        ("thighCircumference", "Thigh"), ("calfCircumference", "Calf"), ("upperArmCircumference", "Upper arm"),
        ("shoulderWidth", "Shoulder width"), ("waistWidth", "Waist width"), ("hipWidth", "Hip width"), ("waistDepth", "Waist depth"),
    ]

    static func lines(_ m: BodyScanMeasurementsDTO) -> [Line] {
        order.compactMap { entry in
            guard let item = m.measurements.first(where: { $0.name == entry.name }),
                  item.status == "available", item.unit == "cm", let value = item.value else { return nil }
            let plusMinus = max(1, Int((item.uncertainty ?? 0).rounded(.up)))
            return Line(label: entry.label, text: "\(Int(value.rounded())) ± \(plusMinus) cm")
        }
    }

    /// Scale-free proportions the scan has (named, without numbers).
    static func proportions(_ m: BodyScanMeasurementsDTO) -> [String] {
        let labels = ["waistToHip": "waist-to-hip", "shoulderToWaist": "shoulder-to-waist", "waistToHeight": "waist-to-height"]
        return ["shoulderToWaist", "waistToHip", "waistToHeight"].compactMap { n in
            m.measurements.contains { $0.name == n && $0.status == "available" } ? labels[n] : nil
        }
    }

    /// The scan's one-line status.
    static func summary(_ m: BodyScanMeasurementsDTO) -> String {
        if !m.scale.ok {
            return m.scale.source == "none"
                ? "Body proportions available. This scan had no distance measurement, so there are no centimetre measurements."
                : "Body proportions available. The distance measurement wasn't clear enough this time, so there are no centimetre measurements."
        }
        return lines(m).isEmpty
            ? "Distance was measured, but no measurement was precise enough to show this time."
            : "Scanner estimates from your photos — not clinical measurements, and not yet validated."
    }

    /// The only height note: a meaningful gap, never "your height is wrong".
    static func heightNote(_ m: BodyScanMeasurementsDTO) -> String? {
        guard m.profileComparison?.differs == true else { return nil }
        return "Scanner estimate differs from your saved height. You can review your details in Settings › Profile › Body details."
    }
}

// MARK: - Composition (bodyScans:composition) — Phase 5E

struct BodyScanCompositionDTO: Decodable, Equatable, Sendable {
    struct Result: Decodable, Equatable, Sendable {
        let name: String
        let model: String
        let modelVersion: String
        let modelKind: String
        let validationStatus: String
        let status: String
        var value: Double? = nil
        var low: Double? = nil
        var high: Double? = nil
        var uncertainty: Double? = nil
        let displayable: Bool
        let reasons: [String]
    }
    let compositionVersion: String
    let measurementMethodVersion: String
    let results: [Result]
    let validated: Bool
}

enum BodyScanCompositionPresentation {
    /// Only results the server marked displayable. Body fat, if ever
    /// displayable, is a range (never a point value); BMI names its source.
    static func lines(_ c: BodyScanCompositionDTO) -> [BodyScanMeasurementPresentation.Line] {
        c.results.filter(\.displayable).compactMap { r in
            switch r.name {
            case "bmi":
                guard let v = r.value else { return nil }
                return .init(label: "BMI", text: String(format: "%.1f · from your recorded height and weight", v))
            case "bodyFatPercent":
                guard let lo = r.low, let hi = r.high else { return nil }
                return .init(label: "Body fat", text: "\(Int(lo.rounded()))–\(Int(hi.rounded())) % · experimental")
            default:
                return nil
            }
        }
    }

    /// Said whenever a body-fat result exists but isn't shown.
    static func note(_ c: BodyScanCompositionDTO) -> String? {
        let hidden = c.results.contains { $0.name == "bodyFatPercent" && !$0.displayable }
        return hidden ? "Body composition from scans is experimental and validation is pending, so no body-fat estimate is shown yet." : nil
    }
}

// MARK: - Change over time (bodyScans:compare) — Phase 5E

struct BodyScanChangeDTO: Decodable, Equatable, Sendable {
    struct Change: Decodable, Equatable, Sendable {
        let name: String
        let unit: String
        let a: Double
        let b: Double
        let delta: Double
        let noise: Double
        var mdc: Double? = nil
        let state: String
    }
    let comparable: Bool
    var reasons: [String]? = nil
    var changes: [Change]? = nil
    var mdcValidated: Bool? = nil
    let validated: Bool
}

enum BodyScanChangePresentation {
    /// One line per shown measurement. A difference inside the scans' combined
    /// range is "No meaningful change"; beyond it, without a validated minimum
    /// detectable change, only "Possible change". Whole centimetres.
    static func lines(_ d: BodyScanChangeDTO) -> [BodyScanMeasurementPresentation.Line] {
        guard d.comparable, let changes = d.changes else { return [] }
        return BodyScanMeasurementPresentation.order.compactMap { entry in
            guard let c = changes.first(where: { $0.name == entry.name }), c.unit == "cm" else { return nil }
            let signed = Int(c.delta.rounded())
            let amount = signed == 0 ? "" : " (\(signed > 0 ? "+" : "−")\(abs(signed)) cm)"
            switch c.state {
            case "meaningful_change": return .init(label: entry.label, text: "Change\(amount)")
            case "possible_change": return .init(label: entry.label, text: "Possible change\(amount) · not confirmed")
            default: return .init(label: entry.label, text: "No meaningful change")
            }
        }
    }

    static func summary(_ d: BodyScanChangeDTO) -> String {
        if !d.comparable {
            return (d.reasons ?? []).contains("not_processed")
                ? "Comparison appears once both scans have been analysed."
                : "These two scans weren't taken the same way closely enough to compare fairly (distance, phone angle, pose or camera)."
        }
        if lines(d).isEmpty { return "No measurement was precise enough in both scans to compare." }
        return d.mdcValidated == true
            ? "Compared with your previous scan."
            : "Compared with your previous scan. Small differences can come from the scan itself; changes aren't confirmed until scanner repeatability is validated."
    }
}

// MARK: - Scan quality — Phase 5E

enum BodyScanQualityPresentation {
    /// A plain label for the capture-quality score (0–1). Not a measurement.
    static func label(_ score: Double?) -> String? {
        guard let s = score else { return nil }
        switch s {
        case 0.85...: return "Scan quality: good"
        case 0.6..<0.85: return "Scan quality: fair"
        default: return "Scan quality: low — consider retaking"
        }
    }
}
