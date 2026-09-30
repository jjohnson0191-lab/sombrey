import Foundation
import CoreGraphics

// Sombrey Body Scan — Phase 5F: the longitudinal experience's plain logic.
//
// What a value may be called ("Measured" / "Calculated" / "Experimental" /
// "Not available"), what each build may show, how two scans' photos are
// aligned for comparison, and the DTOs of the 5F queries. Nothing here makes
// a value more certain than the server says it is: until a measurement passes
// the production validation gate (convex/bodyScan/history.ts), no scanner value
// is "Measured", and experimental values appear only on development builds.
//
// Plain logic (Foundation + CoreGraphics) — tested in SombreyAppTests/BodyScanTests.swift.

enum BodyScanProvenance: String, Decodable, Equatable, Sendable {
    case measured, calculated, experimental
    case notAvailable = "not_available"

    var label: String {
        switch self {
        case .measured: return "Measured"
        case .calculated: return "Calculated"
        case .experimental: return "Experimental"
        case .notAvailable: return "Not available"
        }
    }
}

/// What a build may show. Production shows only validated ("Measured") and
/// calculated values; experimental values are for development builds.
struct BodyScanDisplayPolicy: Equatable, Sendable {
    let showsExperimental: Bool

    func shows(_ p: BodyScanProvenance) -> Bool {
        switch p {
        case .measured, .calculated: return true
        case .experimental: return showsExperimental
        case .notAvailable: return false
        }
    }
}

/// Measurement lines grouped by provenance, in the result hierarchy's order.
enum BodyScanResultPresentation {
    struct Line: Equatable, Sendable {
        let label: String
        let text: String
        let provenance: BodyScanProvenance
    }

    /// Scanner measurements the policy allows, each labelled with its provenance.
    /// Values are whole centimetres with their ± range; low-confidence and
    /// unavailable results are never shown.
    static func measurements(_ m: BodyScanMeasurementsDTO, policy: BodyScanDisplayPolicy) -> [Line] {
        BodyScanMeasurementPresentation.order.compactMap { entry in
            guard let item = m.measurements.first(where: { $0.name == entry.name }), item.status == "available",
                  item.unit == "cm", let value = item.value else { return nil }
            let p = item.provenance ?? .experimental
            guard policy.shows(p) else { return nil }
            let plusMinus = max(1, Int((item.uncertainty ?? 0).rounded(.up)))
            return Line(label: entry.label, text: "\(Int(value.rounded())) ± \(plusMinus) cm", provenance: p)
        }
    }

    /// Body proportions (scale-free shape ratios). Always experimental today.
    static let proportionOrder: [(name: String, label: String)] = [
        ("waistToHeight", "Waist-to-height"), ("shoulderToWaist", "Shoulder-to-waist"), ("waistToHip", "Waist-to-hip"),
    ]

    static func proportions(_ m: BodyScanMeasurementsDTO, policy: BodyScanDisplayPolicy) -> [Line] {
        proportionOrder.compactMap { entry in
            guard let item = m.measurements.first(where: { $0.name == entry.name }), item.status == "available", let value = item.value else { return nil }
            let p = item.provenance ?? .experimental
            guard policy.shows(p) else { return nil }
            let range = item.uncertainty.map { String(format: " ± %.2f", $0) } ?? ""
            return Line(label: entry.label, text: String(format: "%.2f", value) + range, provenance: p)
        }
    }
}

/// What the user wears for a scan (recorded with it).
enum BodyScanClothing: String, Codable, Equatable, Sendable {
    case recommended
    case fittedAthletic = "fitted_athletic"

    /// Neutral, never judging: only says what it means for the scan.
    var note: String? {
        self == .fittedAthletic ? "That's fine — measurements may be a little less accurate, because clothing changes the outline the scanner sees." : nil
    }
}

// MARK: - DTOs (5F)

/// The 5F summary on each `bodyScans:list` row.
struct BodyScanSummaryDTO: Decodable, Equatable, Sendable {
    struct BMI: Decodable, Equatable, Sendable { let value: Double; let displayable: Bool }
    var captureQuality: Double? = nil
    let depthSource: String
    let processed: Bool
    let measured: [String]
    let experimental: [String]
    var bmi: BMI? = nil
    let composition: String
    let changeDetection: String
}

/// `bodyScans:details` — everything recorded about one scan.
struct BodyScanDetailsDTO: Decodable, Equatable, Sendable {
    struct Capture: Decodable, Equatable, Sendable {
        let deviceModel: String
        let osVersion: String
        let appVersion: String
        let camera: String
        var depth: String? = nil
        var clothing: String? = nil
    }
    struct View: Decodable, Equatable, Sendable {
        let view: String
        let qualityScore: Double
        var protocolConfig: String? = nil
    }
    struct Model: Decodable, Equatable, Sendable { let model: String; let version: String; let validationStatus: String; let status: String }
    let createdAt: Double
    let protocolVersion: String
    let consentVersion: String
    let capture: Capture
    let context: BodyScanProfileDTO.Context
    let removedViews: [String]
    let views: [View]
    var cvVersion: String? = nil
    var captureQualityOverall: Double? = nil
    var scaleSource: String? = nil
    var scaleOk: Bool? = nil
    var measurementMethodVersion: String? = nil
    var compositionVersion: String? = nil
    let compositionModels: [Model]
    let validated: Bool
}

/// `bodyScans:trends`.
struct BodyScanTrendsDTO: Decodable, Equatable, Sendable {
    struct Point: Decodable, Equatable, Sendable { let scanId: String; let at: Double; let value: Double; var uncertainty: Double? = nil }
    struct Trend: Decodable, Equatable, Sendable { let name: String; let points: [Point]; let shown: Bool; var reason: String? = nil }
    let trends: [Trend]
    let validated: Bool
}

/// `bodyScans:compare` with the 5F frames for the visual comparison.
struct BodyScanComparisonDTO: Decodable, Equatable, Sendable {
    struct Frame: Decodable, Equatable, Sendable { let top: Double; let bottom: Double; let left: Double; let right: Double }
    struct ViewFrames: Decodable, Equatable, Sendable {
        let view: String
        let available: Bool
        let reasons: [String]
        var a: Frame? = nil
        var b: Frame? = nil
    }
    let comparable: Bool
    var reasons: [String]? = nil
    var changes: [BodyScanChangeDTO.Change]? = nil
    var frames: [ViewFrames]? = nil
    var mdcValidated: Bool? = nil
    let validated: Bool

    var change: BodyScanChangeDTO { BodyScanChangeDTO(comparable: comparable, reasons: reasons, changes: changes, mdcValidated: mdcValidated, validated: validated) }
}

/// `bodyScans:trainingConsent`.
struct BodyScanTrainingConsentDTO: Decodable, Equatable, Sendable {
    let currentVersion: String
    let granted: Bool
    var version: String? = nil
    var at: Double? = nil
    let pipelineActive: Bool
}

// MARK: - Visual comparison

enum BodyScanComparisonPresentation {
    /// Why two scans can't be compared, in plain words (never forced).
    static func refusal(_ reasons: [String]) -> String {
        if reasons.contains("not_processed") { return "Comparison appears once both scans have been analysed on your phone." }
        if reasons.contains(where: { $0.contains("depth_source") || $0.contains("scale_source") }) {
            return "These scans were captured with different cameras, so they can't be reliably compared."
        }
        if reasons.contains(where: { $0.contains("method_version") }) {
            return "These scans were analysed by different versions of the scanner, so they can't be reliably compared."
        }
        return "These scans were captured under different conditions (distance, phone angle or pose) and can't be reliably compared."
    }

    static func viewRefusal(_ reasons: [String]) -> String {
        reasons.contains("image_missing")
            ? "One of these scans no longer has this view's image."
            : "This view's outline wasn't detected clearly enough in both scans to align them."
    }
}

enum BodyScanAlignment {
    /// Where to draw an image so its body outline spans `top`…`bottom` of the
    /// container height, centred horizontally — the same placement for both
    /// scans, so outlines line up. Returns the image's drawn size and centre.
    static func placement(frame: BodyScanComparisonDTO.Frame, imageSize: CGSize, container: CGSize,
                          top: Double = 0.06, bottom: Double = 0.94) -> (size: CGSize, center: CGPoint)? {
        let silhouettePx = (frame.bottom - frame.top) * Double(imageSize.height)
        guard silhouettePx > 1, imageSize.width > 0, container.height > 0 else { return nil }
        let scale = (bottom - top) * Double(container.height) / silhouettePx
        let size = CGSize(width: Double(imageSize.width) * scale, height: Double(imageSize.height) * scale)
        let bodyCentreX = (frame.left + frame.right) / 2 * Double(imageSize.width) * scale
        let originX = Double(container.width) / 2 - bodyCentreX
        let originY = top * Double(container.height) - frame.top * Double(imageSize.height) * scale
        return (size, CGPoint(x: originX + Double(size.width) / 2, y: originY + Double(size.height) / 2))
    }
}

enum BodyScanTrendPresentation {
    static let labels: [String: String] = [
        "waistToHeight": "Waist-to-height", "shoulderToWaist": "Shoulder-to-waist", "waistToHip": "Waist-to-hip",
        "armSymmetry": "Arm symmetry", "legSymmetry": "Leg symmetry",
    ]
    static let note = "Body-shape proportions. They describe shape only — not fat loss, muscle gain or health."
    static func shown(_ t: BodyScanTrendsDTO) -> [BodyScanTrendsDTO.Trend] { t.trends.filter(\.shown) }
}

enum BodyScanDetailsPresentation {
    /// "Analysis details" rows — shown only when expanded.
    static func rows(_ d: BodyScanDetailsDTO) -> [(String, String)] {
        var rows: [(String, String)] = [
            ("Device", d.capture.deviceModel), ("iOS", d.capture.osVersion), ("App version", d.capture.appVersion),
            ("Camera", d.capture.camera == "rear" ? "Back camera (LiDAR)" : "Front camera"),
            ("Depth", depthLabel(d.capture.depth)),
            ("Clothing", d.capture.clothing == "fitted_athletic" ? "Fitted athletic clothing (may reduce accuracy)" : (d.capture.clothing == "recommended" ? "Recommended" : "Not recorded")),
            ("Capture protocol", d.protocolVersion),
        ]
        let gates = Set(d.views.compactMap(\.protocolConfig)).sorted()
        if !gates.isEmpty { rows.append(("Capture settings", gates.joined(separator: ", "))) }
        if let q = d.captureQualityOverall { rows.append(("Capture quality", String(format: "%.2f", q))) }
        rows.append(("Analysis", [d.cvVersion.map { "features \($0)" }, d.measurementMethodVersion.map { "method \($0)" }, d.compositionVersion.map { "composition \($0)" }].compactMap { $0 }.joined(separator: " · ").ifEmpty("Not analysed yet")))
        if let ok = d.scaleOk { rows.append(("Distance measurement", ok ? "Used (\(depthLabel(d.scaleSource)))" : "Not usable for this scan")) }
        let c = d.context
        let snapshot = [c.heightCm.map { "\(Int($0.rounded())) cm" }, c.weightKg.map { String(format: "%.1f kg", $0) }, c.sex, c.ageYears.map { "\(Int($0)) y" }].compactMap { $0 }
        rows.append(("Your details at this scan", snapshot.isEmpty ? "None recorded" : snapshot.joined(separator: " · ")))
        rows.append(("Consent", d.consentVersion))
        rows.append(("Validation", d.validated ? "Validated" : "Not yet validated"))
        return rows
    }

    static func depthLabel(_ s: String?) -> String {
        switch s {
        case "truedepth": return "TrueDepth (front)"
        case "lidar": return "LiDAR (back)"
        default: return "None"
        }
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
