import Foundation

// Sombrey Body Scan — Phase 5D validation (DEVELOPMENT BUILDS ONLY): the
// vocabulary the validation screen offers (the same controlled lists the
// server validates, convex/bodyScan/validation.ts), the report it decodes, and
// the plain-text rendering of that report. Engineering tooling: nothing here
// is shown in the normal app, and nothing here changes a measurement.
//
// Plain logic (Foundation only) — tested in SombreyAppTests/BodyScanTests.swift.

enum BodyScanValidationVocabulary {
    struct Measurement: Equatable, Sendable {
        let key: String
        let label: String
        let isMass: Bool
        let protocols: [String]
        /// 5E: DXA body fat (%), recorded by a clinician / technologist only.
        var isPercent = false
    }

    static let measurements: [Measurement] = [
        .init(key: "height", label: "Height", isMass: false, protocols: ["stadiometer_barefoot", "wall_mark_barefoot"]),
        .init(key: "weight", label: "Weight", isMass: true, protocols: ["scale_calibrated_morning"]),
        .init(key: "chest", label: "Chest", isMass: false, protocols: ["tape_isak_style"]),
        .init(key: "waist", label: "Waist", isMass: false, protocols: ["tape_isak_style"]),
        .init(key: "hips", label: "Hips", isMass: false, protocols: ["tape_isak_style"]),
        .init(key: "upperArm", label: "Upper arm", isMass: false, protocols: ["tape_isak_style"]),
        .init(key: "thigh", label: "Thigh", isMass: false, protocols: ["tape_isak_style"]),
        .init(key: "calf", label: "Calf", isMass: false, protocols: ["tape_isak_style"]),
        .init(key: "shoulderWidth", label: "Shoulder width", isMass: false, protocols: ["tape_shoulder_silhouette", "caliper_biacromial"]),
        .init(key: "bodyFat", label: "Body fat (DXA)", isMass: false, protocols: ["dxa_whole_body"], isPercent: true),
    ]
    static func units(for m: Measurement) -> [String] { m.isPercent ? ["%"] : m.isMass ? ["kg", "lb"] : ["cm", "mm", "in"] }

    static let operators = ["self", "assistant", "clinician"]
    static let repeats = ["A", "B", "C", "D", "E"]
    static let distances: [Double] = [1.0, 1.3, 1.5, 1.7, 2.0, 2.5]
    static let phoneHeights = ["waist", "chest", "other"]
    static let lighting = ["bright", "moderate", "dim"]
    static let clothing = ["minimal", "fitted_athletic", "other"]
    static let poses = ["ideal", "natural", "arms_close", "feet_moved", "torso_rotated"]

    /// Subject codes are pseudonymous (e.g. S01): capitals, digits, dashes.
    static func cleanSubjectCode(_ s: String) -> String? {
        let up = s.uppercased().trimmingCharacters(in: .whitespaces)
        guard (1...12).contains(up.count), up.first?.isLetter == true || up.first?.isNumber == true,
              up.allSatisfy({ ($0.isASCII && ($0.isUppercase || $0.isNumber)) || $0 == "-" }) else { return nil }
        return up
    }

    /// A number typed with a comma or a dot.
    static func number(_ s: String) -> Double? {
        Double(s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
    }
}

/// `bodyScanValidation:report` — the parts the DEV screen shows.
struct BodyScanValidationReportDTO: Decodable, Equatable, Sendable {
    struct Accuracy: Decodable, Equatable, Sendable {
        let n: Int
        let pilot: Bool
        let mae: Double
        let medianAbsolute: Double
        let rmse: Double
        let meanBias: Double
        let sdError: Double
        let limitsOfAgreement: [Double]
        let mape: Double
    }
    struct Calibration: Decodable, Equatable, Sendable {
        let n: Int
        let coverage: Double
        let coverageInterval: [Double]
        let verdict: String
        var suggestedRangeMultiplier: Double? = nil
    }
    struct Repeatability: Decodable, Equatable, Sendable {
        let groups: Int
        let subjects: Int
        let df: Int
        let withinSd: Double
        let cvPercent: Double
        let mdc95: Double
        var icc: Double? = nil
    }
    struct PerMeasurement: Decodable, Equatable, Sendable {
        let measurement: String
        let scans: Int
        let statusCounts: [String: Int]
        var accuracyAll: Accuracy? = nil
        var accuracyAvailable: Accuracy? = nil
        var calibration: Calibration? = nil
        var repeatability: Repeatability? = nil
        var immediateRepeatMeanAbsDiff: Double? = nil
        var repositionMeanAbsDiff: Double? = nil
        var truthOperatorSd: Double? = nil
    }
    struct FactorLevel: Decodable, Equatable, Sendable {
        let level: String
        let scans: Int
        let metricScaleShare: Double
        var heightMae: Double? = nil
        var heightBias: Double? = nil
        var waistMae: Double? = nil
    }
    struct Report: Decodable, Equatable, Sendable {
        let analysisVersion: String
        let scans: Int
        let subjects: Int
        let truths: Int
        let methodVersions: [String]
        let measurements: [PerMeasurement]
        let factors: [String: [FactorLevel]]
        let scaleFailureReasons: [String: Int]
        let notes: [String]
    }
    struct Paired: Decodable, Equatable, Sendable {
        let scanId: String
        let subject: String
        let session: String
        let `repeat`: String
        let measurement: String
        let status: String
        var scanner: Double? = nil
        var uncertainty: Double? = nil
        var truth: Double? = nil
        var signedError: Double? = nil
        let distanceM: Double
        let depthSource: String
    }
    let report: Report
    let csv: String
    let paired: [Paired]
}

/// The report as monospaced engineering text. Statistics the server withheld
/// (too few results) print as "n/a" — never as zero.
enum BodyScanValidationFormat {
    private static func f(_ x: Double?, _ d: Int = 1) -> String { x.map { String(format: "%.\(d)f", $0) } ?? "n/a" }

    static func lines(_ r: BodyScanValidationReportDTO.Report) -> [String] {
        var out = ["PILOT VALIDATION \(r.analysisVersion) · \(r.scans) scans · \(r.subjects) subject(s) · \(r.truths) truth entries · methods \(r.methodVersions.joined(separator: ","))"]
        for m in r.measurements where m.scans > 0 {
            let status = m.statusCounts.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ")
            out.append("")
            out.append("\(m.measurement.uppercased()) — \(m.scans) scans (\(status))")
            if let a = m.accuracyAll {
                out.append("  all values  n=\(a.n) MAE \(f(a.mae)) · median \(f(a.medianAbsolute)) · RMSE \(f(a.rmse)) · bias \(f(a.meanBias)) · SD \(f(a.sdError)) · LoA [\(f(a.limitsOfAgreement.first)), \(f(a.limitsOfAgreement.last))] · MAPE \(f(a.mape))%")
            } else {
                out.append("  accuracy: n/a (needs ≥ 3 paired results)")
            }
            if let a = m.accuracyAvailable { out.append("  available   n=\(a.n) MAE \(f(a.mae)) · bias \(f(a.meanBias))") }
            if let c = m.calibration {
                out.append("  calibration n=\(c.n) coverage \(f(c.coverage * 100, 0))% [\(f((c.coverageInterval.first ?? 0) * 100, 0))–\(f((c.coverageInterval.last ?? 0) * 100, 0))%] \(c.verdict) · range ×\(f(c.suggestedRangeMultiplier, 2))")
            }
            if let p = m.repeatability {
                out.append("  repeat      df=\(p.df) SEM \(f(p.withinSd, 2)) · CV \(f(p.cvPercent))% · MDC95 \(f(p.mdc95)) · ICC \(f(p.icc, 3))")
            }
            if m.immediateRepeatMeanAbsDiff != nil || m.repositionMeanAbsDiff != nil {
                out.append("  A↔B \(f(m.immediateRepeatMeanAbsDiff)) · A/B↔C (repositioned) \(f(m.repositionMeanAbsDiff)) · tape SD \(f(m.truthOperatorSd, 2))")
            }
        }
        for (factor, levels) in r.factors.sorted(by: { $0.key < $1.key }) where levels.count > 1 {
            out.append("")
            out.append("BY \(factor.uppercased())")
            for l in levels { out.append("  \(l.level): \(l.scans) scans · metric \(f(l.metricScaleShare * 100, 0))% · height MAE \(f(l.heightMae)) bias \(f(l.heightBias)) · waist MAE \(f(l.waistMae))") }
        }
        if !r.scaleFailureReasons.isEmpty {
            out.append("")
            out.append("SCALE FAILURES " + r.scaleFailureReasons.sorted { $0.value > $1.value }.map { "\($0.key)×\($0.value)" }.joined(separator: " "))
        }
        out.append("")
        out.append(contentsOf: r.notes.map { "note: \($0)" })
        return out
    }

    static func pairedLine(_ p: BodyScanValidationReportDTO.Paired) -> String {
        let scanner = p.scanner.map { String(format: "%.1f", $0) } ?? "—"
        let range = p.uncertainty.map { String(format: "±%.1f", $0) } ?? ""
        let err = p.signedError.map { String(format: "%+.1f", $0) } ?? "—"
        return "\(p.subject) \(p.session) \(p.repeat) \(String(format: "%.1f", p.distanceM))m \(p.depthSource) \(p.measurement): scan \(scanner)\(range) [\(p.status)] truth \(f(p.truth)) err \(err)"
    }
}
