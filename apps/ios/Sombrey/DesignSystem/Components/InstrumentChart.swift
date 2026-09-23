import SwiftUI
import Charts

// MARK: - Series model

/// One real reading on an instrument chart. `low` is set only for range
/// readings (blood pressure: `value` systolic, `low` diastolic).
struct InstrumentPoint: Identifiable, Equatable {
    /// Where the point came from, shown while scrubbing so a user always
    /// knows what they're looking at.
    enum Kind: String {
        /// Streamed in real time by the band this session.
        case live = "LIVE"
        /// A stored band reading.
        case reading = "READING"
        /// An aggregate of several readings (reserved — nothing
        /// aggregates today; every point is an individual reading).
        case summary = "SUMMARY"
    }

    let date: Date
    let value: Double
    var low: Double? = nil
    let kind: Kind

    var id: Double { date.timeIntervalSince1970 }
}

/// Min/avg/max of the readings actually in range — never extrapolated.
struct InstrumentStats: Equatable {
    let count: Int
    let min: Double
    let max: Double
    let mean: Double

    static func of(_ values: [Double]) -> InstrumentStats? {
        guard let lo = values.min(), let hi = values.max() else { return nil }
        return InstrumentStats(count: values.count, min: lo, max: hi, mean: values.reduce(0, +) / Double(values.count))
    }
}

/// Pure builders from real data sources to chart points.
enum InstrumentSeries {
    static func stored(_ rows: [WearableMeasurementDTO]) -> [InstrumentPoint] {
        rows
            .map { InstrumentPoint(date: Date(timeIntervalSince1970: $0.recordedAt / 1000), value: $0.value, kind: .reading) }
            .sorted { $0.date < $1.date }
    }

    /// Pairs two stored series by exact `recordedAt` — how Sombrey
    /// persists a blood-pressure reading (both halves share one
    /// timestamp). A half without its partner is dropped, never drawn
    /// as a range it doesn't have.
    static func pairedRange(high: [WearableMeasurementDTO], low: [WearableMeasurementDTO]) -> [InstrumentPoint] {
        let lowByTime = Dictionary(low.map { ($0.recordedAt, $0.value) }, uniquingKeysWith: { first, _ in first })
        return high
            .compactMap { row in
                lowByTime[row.recordedAt].map {
                    InstrumentPoint(date: Date(timeIntervalSince1970: row.recordedAt / 1000), value: row.value, low: $0, kind: .reading)
                }
            }
            .sorted { $0.date < $1.date }
    }

    static func live(_ trace: [WearableMeasurement]) -> [InstrumentPoint] {
        trace.map { InstrumentPoint(date: $0.recordedAt, value: $0.value, kind: .live) }
    }

    /// Y domain around the real values (and baseline, if any) with a
    /// little air, so the signal fills the instrument instead of being
    /// flattened against zero.
    static func yDomain(_ points: [InstrumentPoint], baseline: Double?) -> ClosedRange<Double> {
        var values = points.flatMap { [$0.value] + ($0.low.map { [$0] } ?? []) }
        if let baseline { values.append(baseline) }
        guard let lo = values.min(), let hi = values.max() else { return 0...1 }
        let pad = Swift.max((hi - lo) * 0.18, Swift.max(abs(hi) * 0.02, 0.5))
        return (lo - pad)...(hi + pad)
    }
}

// MARK: - History chart

/// The expanded instrument's history: range selector, a readout row that
/// shows range statistics at rest and the exact reading while scrubbing,
/// and the chart itself. Reads only real data — stored readings via
/// `wearable:getMeasurementsByRange`, or the band's live stream for LIVE —
/// and says plainly when a range doesn't hold enough of it.
struct InstrumentHistoryChart: View {
    enum Style {
        /// A continuous signal (heart rate, SpO2, temperature).
        case line
        /// A measured span per reading (blood pressure).
        case range
    }

    struct Baseline {
        let value: Double
        /// What the baseline is, e.g. "30-day median".
        let label: String
    }

    let metric: WearableMetricType
    var lowMetric: WearableMetricType? = nil
    var style: Style = .line
    let unit: String
    let format: (Double) -> String
    var ranges: [InstrumentRange] = [.today, .sevenDays, .thirtyDays]
    var livePoints: [InstrumentPoint] = []
    var liveAvailable: Bool = false
    var baseline: Baseline? = nil
    var tint: Color = StudioColor.accentInk
    /// Fewer real readings than this in a range is stated, not charted.
    var minimumReadings: Int = 2

    @State private var range: InstrumentRange = .today
    @State private var didPickInitialRange = false
    @State private var high = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var low = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var selectedDate: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var points: [InstrumentPoint] {
        if range == .live { return livePoints }
        guard let highRows = high.value else { return [] }
        if style == .range {
            return InstrumentSeries.pairedRange(high: highRows, low: low.value ?? [])
        }
        return InstrumentSeries.stored(highRows)
    }

    private var isLoading: Bool {
        range != .live && (high.isLoading || (style == .range && low.isLoading))
    }

    private var loadError: String? { range == .live ? nil : (high.errorMessage ?? low.errorMessage) }

    private var selectedPoint: InstrumentPoint? {
        guard let selectedDate else { return nil }
        return points.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            InstrumentRangeSelector(ranges: ranges, selection: $range, liveAvailable: liveAvailable)
            readoutRow
                .frame(minHeight: 36, alignment: .leading)
            chartArea
                .frame(height: 150)
        }
        .onAppear(perform: pickInitialRange)
        .task(id: range) { subscribe() }
        .onChange(of: range) { _, _ in selectedDate = nil }
        .onChange(of: liveAvailable) { _, available in
            if !available && range == .live, let fallback = ranges.first(where: { $0 != .live }) {
                range = fallback
            }
        }
        .sensoryFeedback(trigger: selectedPoint?.id) { _, newID in
            newID == nil ? nil : StudioHaptic.scrubStep
        }
    }

    // MARK: Readout

    @ViewBuilder
    private var readoutRow: some View {
        if let point = selectedPoint {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                (Text(valueText(point)).font(StudioFont.hero(22, weight: .semibold)).foregroundStyle(StudioColor.ink)
                    + Text(" \(unit)").font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft))
                    .monospacedDigit()
                Text(timestamp(point.date))
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
                Text(point.kind.rawValue)
                    .font(StudioFont.body(9, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(point.kind == .live ? StudioColor.accentInk : StudioColor.inkFaint)
            }
            .accessibilityElement(children: .combine)
        } else if points.count >= minimumReadings, let stats = rangeStats {
            HStack(alignment: .firstTextBaseline, spacing: 18) {
                ForEach(stats, id: \.label) { stat in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(stat.label)
                            .font(StudioFont.body(9, weight: .semibold))
                            .tracking(1.1)
                            .foregroundStyle(StudioColor.inkSoft)
                        Text(stat.value)
                            .font(StudioFont.body(14, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
                Spacer(minLength: 0)
                Text("\(points.count) reading\(points.count == 1 ? "" : "s")")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    private struct StatCell { let label: String; let value: String }

    private var rangeStats: [StatCell]? {
        if style == .range {
            guard let sys = InstrumentStats.of(points.map(\.value)),
                  let dia = InstrumentStats.of(points.compactMap(\.low)) else { return nil }
            return [StatCell(label: "AVG", value: "\(format(sys.mean))/\(format(dia.mean))"),
                    StatCell(label: "HIGHEST", value: "\(format(sys.max))/\(format(dia.max))")]
        }
        guard let stats = InstrumentStats.of(points.map(\.value)) else { return nil }
        if range == .live, let last = points.last {
            return [StatCell(label: "NOW", value: format(last.value)),
                    StatCell(label: "LOW", value: format(stats.min)),
                    StatCell(label: "HIGH", value: format(stats.max))]
        }
        return [StatCell(label: "LOW", value: format(stats.min)),
                StatCell(label: "AVG", value: format(stats.mean)),
                StatCell(label: "HIGH", value: format(stats.max))]
    }

    // MARK: Chart

    @ViewBuilder
    private var chartArea: some View {
        if isLoading && points.isEmpty {
            quietState("Reading history…")
        } else if let loadError {
            quietState("Couldn't load history: \(loadError)")
        } else if points.isEmpty {
            quietState(range == .live
                ? (liveAvailable ? "Waiting for the band's live signal." : "Connect the band to see the live signal.")
                : "No readings \(range.phrase).")
        } else if points.count < minimumReadings {
            quietState("\(points.count) reading \(range.phrase) — not enough to draw a trend yet.")
        } else {
            chart
        }
    }

    private var chart: some View {
        let pts = points
        let domain = InstrumentSeries.yDomain(pts, baseline: baseline?.value)
        return Chart {
            if let baseline {
                RuleMark(y: .value("Baseline", baseline.value))
                    .foregroundStyle(StudioColor.inkFaint)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .annotation(position: .top, alignment: .leading) {
                        Text(baseline.label.uppercased())
                            .font(StudioFont.body(8, weight: .semibold))
                            .tracking(1)
                            .foregroundStyle(StudioColor.inkFaint)
                    }
            }
            ForEach(pts) { point in
                if style == .range, let lowValue = point.low {
                    RuleMark(
                        x: .value("Time", point.date),
                        yStart: .value("Diastolic", lowValue),
                        yEnd: .value("Systolic", point.value)
                    )
                    .foregroundStyle(tint.opacity(0.8))
                    .lineStyle(StrokeStyle(lineWidth: 5, lineCap: .round))
                } else {
                    AreaMark(
                        x: .value("Time", point.date),
                        yStart: .value("Floor", domain.lowerBound),
                        yEnd: .value(unit, point.value)
                    )
                    .foregroundStyle(LinearGradient(colors: [tint.opacity(0.14), tint.opacity(0)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
                    LineMark(
                        x: .value("Time", point.date),
                        y: .value(unit, point.value)
                    )
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    .interpolationMethod(.monotone)
                }
            }
            if range == .live, let last = pts.last, selectedPoint == nil {
                PointMark(x: .value("Time", last.date), y: .value(unit, last.value))
                    .foregroundStyle(tint)
                    .symbolSize(36)
            }
            if let selected = selectedPoint {
                RuleMark(x: .value("Selected", selected.date))
                    .foregroundStyle(StudioColor.ink.opacity(0.22))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                PointMark(x: .value("Time", selected.date), y: .value(unit, selected.value))
                    .foregroundStyle(StudioColor.ink)
                    .symbolSize(44)
            }
        }
        .chartYScale(domain: domain)
        .chartXScale(domain: xDomain(pts))
        .chartXSelection(value: $selectedDate)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                AxisValueLabel(format: xLabelFormat)
                    .font(StudioFont.body(9))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { _ in
                AxisGridLine().foregroundStyle(StudioColor.ink.opacity(0.06))
                AxisValueLabel()
                    .font(StudioFont.body(9))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
        .animation(StudioMotion.resolve(range == .live ? StudioMotion.release : StudioMotion.rangeMorph, reduceMotion: reduceMotion), value: pts)
        .accessibilityLabel("\(metric.rawValue.replacingOccurrences(of: "_", with: " ")) history, \(range.accessibilityName)")
    }

    private func quietState(_ message: String) -> some View {
        VStack(spacing: 10) {
            Capsule()
                .fill(StudioColor.ink.opacity(0.08))
                .frame(height: 1)
            Text(message)
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkFaint)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Scales & formatting

    /// Stored ranges show their whole real window (gaps stay visible as
    /// gaps); LIVE follows the stream.
    private func xDomain(_ pts: [InstrumentPoint]) -> ClosedRange<Date> {
        let now = Date()
        if range == .live, let first = pts.first, let last = pts.last {
            return min(first.date, last.date.addingTimeInterval(-60))...last.date
        }
        let start = range.sinceMs(now: now).map { Date(timeIntervalSince1970: $0 / 1000) } ?? now.addingTimeInterval(-86400)
        return start...now
    }

    private var xLabelFormat: Date.FormatStyle {
        switch range {
        case .live, .today: return .dateTime.hour().minute()
        case .sevenDays: return .dateTime.weekday(.abbreviated)
        case .thirtyDays: return .dateTime.month(.abbreviated).day()
        }
    }

    private func valueText(_ point: InstrumentPoint) -> String {
        if let lowValue = point.low { return "\(format(point.value))/\(format(lowValue))" }
        return format(point.value)
    }

    private func timestamp(_ date: Date) -> String {
        switch range {
        case .live: return date.formatted(.dateTime.hour().minute().second())
        case .today: return date.formatted(.dateTime.hour().minute())
        case .sevenDays, .thirtyDays: return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
        }
    }

    // MARK: Data

    private func pickInitialRange() {
        guard !didPickInitialRange else { return }
        didPickInitialRange = true
        if ranges.contains(.live) && liveAvailable && !livePoints.isEmpty {
            range = .live
        } else {
            range = ranges.first(where: { $0 != .live }) ?? .today
        }
    }

    private func subscribe() {
        guard let sinceMs = range.sinceMs() else { return }
        WearableRuntimeDiagnostics.shared.recordQuery(metricType: metric.rawValue, rangeDays: rangeDays)
        high.subscribe(to: "wearable:getMeasurementsByRange", with: ["metricType": metric.rawValue, "sinceMs": sinceMs])
        if style == .range, let lowMetric {
            low.subscribe(to: "wearable:getMeasurementsByRange", with: ["metricType": lowMetric.rawValue, "sinceMs": sinceMs])
        }
    }

    private var rangeDays: Double {
        switch range {
        case .live: return 0
        case .today: return 1
        case .sevenDays: return 7
        case .thirtyDays: return 30
        }
    }
}
