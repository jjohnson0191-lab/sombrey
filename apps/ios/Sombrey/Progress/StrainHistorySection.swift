import SwiftUI

/// Progress › Strain & load — what you did, against your normal, and whether
/// it's building. Today | 3D | 7D | 14D | 28D. Everything is the server's
/// (convex/strain/*): daily Strain values, day statuses, rolling windows.
/// Days without band data are shown as unknown, never as zero.
struct StrainHistorySection: View {
    let overview: ProgressOverviewDTO
    @State private var range = "d7"

    private var intel: StrainIntelligenceDTO? { overview.strain.intelligence }

    private static let ranges: [(value: String, label: String)] = [("today", "Today"), ("d3", "3D"), ("d7", "7D"), ("d14", "14D"), ("d28", "28D")]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                TrainEyebrow(text: "Strain & load")
                Text(headline)
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            GlassPillTabs(options: Self.ranges, selection: $range)
                .sensoryFeedback(StudioHaptic.rangeChange, trigger: range)
            if range == "today" { today } else { history }
            Text(footnote)
                .font(StudioFont.body(10))
                .foregroundStyle(StudioColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .studioCard()
        .accessibilityIdentifier("progress.strainHistory")
    }

    // MARK: Headline

    private var headline: String {
        guard let intel else { return "Load history appears as you record sessions." }
        if let w = window, let rel = w.relativeToBaseline, w.knownDays > 0 {
            let words = rel < 0.75 ? "lighter than" : rel <= 1.25 ? "about" : rel <= 2 ? "heavier than" : "well above"
            return "Last \(Int(w.days)) days: \(words == "about" ? "about your usual load" : "\(words) your usual load")"
        }
        if intel.baseline.status != "ready" {
            return "Your usual load is still being learned — \(Int(min(intel.baseline.activeDays, intel.baseline.required.activeDays))) of \(Int(intel.baseline.required.activeDays)) active days."
        }
        return "What you did, against your normal."
    }

    private var window: StrainIntelligenceDTO.Window? { intel?.windows?.first { $0.id == range } }

    // MARK: Today

    @ViewBuilder
    private var today: some View {
        if overview.todaySessions.isEmpty {
            Text("Nothing recorded yet today.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
        } else {
            VStack(spacing: 0) {
                ForEach(overview.todaySessions) { s in
                    let load = intel?.sessions.first { $0.id == s.id }
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.name)
                                .font(StudioFont.body(14, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                            Text(provenance(s, load))
                                .font(StudioFont.body(11))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        Spacer()
                        Text(s.minutes.map { "\(Int($0)) min" } ?? "Not recorded")
                            .font(StudioFont.body(13, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                    }
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                    if s.id != overview.todaySessions.last?.id {
                        Rectangle().fill(StudioColor.ink.opacity(0.06)).frame(height: 1)
                    }
                }
            }
            if let label = intel?.relativeLabel {
                Text(label)
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }

    private func provenance(_ s: TodaySessionDTO, _ load: StrainIntelligenceDTO.Session?) -> String {
        var parts = [s.kind == "workout" ? "Workout" : "Activity"]
        if let load {
            parts.append("load from " + StrainIntelligenceDTO.basisLabel(load).lowercased())
            parts.append("\(StrainIntelligenceDTO.confidenceLabel(load.confidence).lowercased()) data quality")
            if load.trimmed { parts.append("overlap counted once") }
        } else {
            parts.append("counted once with an overlapping session")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: History

    @ViewBuilder
    private var history: some View {
        let days = Int(window?.days ?? 7)
        let series = Array((intel?.series ?? []).dropLast().suffix(days))
        let points = series.compactMap { day -> PerformanceDTO.Point? in
            guard let v = day.strain, let t = StrainHistorySection.date(day.date) else { return nil }
            return PerformanceDTO.Point(t: t.timeIntervalSince1970 * 1000, value: v, source: "calculated", label: nil)
        }
        if points.count >= 2 {
            ProgressSeriesChart(points: points, unit: "", baseline: 50, baselineLabel: "Your typical day", height: 150)
        } else {
            Text(points.isEmpty ? emptyText : "One day of Strain in this range so far.")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let w = window {
            stats(w)
        }
    }

    private var emptyText: String {
        guard let intel, intel.baseline.status != "ready" else { return "No Strain values in this range — load shows once sessions are recorded." }
        return "Strain appears once your baseline is established (\(Int(min(intel.baseline.historyDays, intel.baseline.required.historyDays))) of \(Int(intel.baseline.required.historyDays)) days of history)."
    }

    private func stats(_ w: StrainIntelligenceDTO.Window) -> some View {
        let cells: [(String, String)] = [
            ("Avg strain", w.averageStrain.map { "\(Int($0))" } ?? "—"),
            ("Active days", "\(Int(w.activeDays)) of \(Int(w.knownDays))"),
            ("High-load", "\(Int(w.highLoadDays))"),
            ("No band data", "\(Int(w.unknownDays))"),
        ]
        return VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 10) {
                ForEach(cells, id: \.0) { cell in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cell.0.uppercased())
                            .font(StudioFont.body(9, weight: .semibold))
                            .tracking(1.1)
                            .foregroundStyle(StudioColor.inkSoft)
                        Text(cell.1)
                            .font(StudioFont.hero(17, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if let line = contextLine(w) {
                Text(line)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func contextLine(_ w: StrainIntelligenceDTO.Window) -> String? {
        var parts: [String] = []
        if let rel = w.relativeToBaseline { parts.append(String(format: "Load %.1f× your typical day", rel)) }
        if let trend = intel?.recent?.trend, w.id == "d7" || w.id == "d14" {
            parts.append(trend == "rising" ? "building over the last two weeks" : trend == "falling" ? "easing over the last two weeks" : "steady over the last two weeks")
        }
        if w.id == "d7", let m = intel?.monotony7 {
            parts.append(String(format: "monotony %.1f (higher = more same-load days)", m))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var footnote: String {
        let version = intel?.strainVersion.map { $0.replacingOccurrences(of: "strain-", with: "Strain v") } ?? "Strain"
        return "\(version)\(intel?.validated == true ? "" : " · not yet validated on your band") · load from heart-rate zones, lifted sets and activity type · days without band data are unknown, not zero"
    }

    static func date(_ key: String) -> Date? {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: key)
    }
}
