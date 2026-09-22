import SwiftUI
import Charts

/// A single reusable interactive graph — every point-sample Vitals
/// section (heart rate, SpO2, temperature, blood pressure, steps,
/// distance, calories) uses this exact component rather than each
/// hand-rolling its own chart, so there's one real implementation to get
/// right instead of seven near-duplicates. Owns its own range
/// (1D/7D/30D) and `wearable:getMeasurementsByRange` subscription —
/// real stored measurements only, never generated points.
///
/// Interaction uses SwiftUI Charts' native `chartXSelection` (iOS 17+),
/// which already handles both tap and drag — no hand-rolled gesture math,
/// no third-party charting dependency.
struct MetricHistoryChart: View {
    let metricType: WearableMetricType
    let unit: String
    let valueFormatter: (Double) -> String
    var accentColor: Color = StudioColor.accentInk

    enum TimeRange: String, CaseIterable, Identifiable {
        case oneDay = "1D"
        case sevenDays = "7D"
        case thirtyDays = "30D"

        var id: String { rawValue }

        var days: Double {
            switch self {
            case .oneDay: return 1
            case .sevenDays: return 7
            case .thirtyDays: return 30
            }
        }

        var sinceMs: Double {
            Date().addingTimeInterval(-days * 24 * 3600).timeIntervalSince1970 * 1000
        }
    }

    @State private var range: TimeRange = .oneDay
    @State private var measurements = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var selectedDate: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Range", selection: $range) {
                ForEach(TimeRange.allCases) { r in
                    Text(r.rawValue).tag(r)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: range) { _, _ in subscribe() }

            let points = measurements.value ?? []
            if points.isEmpty {
                // `errorMessage` used to be silently swallowed here — a
                // failed subscription (auth, network, a bad query
                // argument) rendered identically to "genuinely no
                // measurements exist yet," which made a real regression
                // indistinguishable from cold-start. Surfacing it is a
                // correctness fix, not new UI: an error is data the user
                // (and whoever's diagnosing this) needs, never one this
                // view manufactures.
                Text(measurements.isLoading ? "Loading…" : (measurements.errorMessage.map { "Couldn't load history: \($0)" } ?? "No data for this range."))
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
                    .frame(height: 160, alignment: .center)
                    .frame(maxWidth: .infinity)
            } else {
                Chart(points, id: \.recordedAt) { point in
                    LineMark(
                        x: .value("Time", Date(timeIntervalSince1970: point.recordedAt / 1000)),
                        y: .value(unit, point.value)
                    )
                    .foregroundStyle(accentColor)
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                }
                .chartXSelection(value: $selectedDate)
                .frame(height: 160)

                if let selected = nearestPoint(to: selectedDate, in: points) {
                    Text("\(valueFormatter(selected.value)) \(unit) · \(Self.timeString(selected.recordedAt))")
                        .font(StudioFont.body(12, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                }
            }
        }
        .task { subscribe() }
        .onChange(of: measurements.isLoading) { _, isLoading in
            guard !isLoading else { return }
            WearableDiagnostics.log("MetricHistoryChart(\(metricType.rawValue)): resolved, points=\(measurements.value?.count ?? -1) error=\(measurements.errorMessage ?? "nil")")
            WearableRuntimeDiagnostics.shared.recordQueryResult(metricType: metricType.rawValue, recordCount: measurements.value?.count, error: measurements.errorMessage)
        }
    }

    private func subscribe() {
        WearableDiagnostics.log("MetricHistoryChart(\(metricType.rawValue)): subscribing, range=\(range.rawValue) sinceMs=\(range.sinceMs)")
        WearableRuntimeDiagnostics.shared.recordQuery(metricType: metricType.rawValue, rangeDays: range.days)
        measurements.subscribe(to: "wearable:getMeasurementsByRange", with: [
            "metricType": metricType.rawValue,
            "sinceMs": range.sinceMs,
        ])
    }

    private func nearestPoint(to date: Date?, in points: [WearableMeasurementDTO]) -> WearableMeasurementDTO? {
        guard let date else { return nil }
        let targetMs = date.timeIntervalSince1970 * 1000
        return points.min { abs($0.recordedAt - targetMs) < abs($1.recordedAt - targetMs) }
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter
    }()

    private static func timeString(_ recordedAtMs: Double) -> String {
        timeFormatter.string(from: Date(timeIntervalSince1970: recordedAtMs / 1000))
    }
}

/// A compact bar trend for session-shaped data (sleep duration per night,
/// training duration per session) — distinct from `MetricHistoryChart`
/// since these aren't a single point-sample series; data is passed in
/// already-fetched from whichever existing query the caller already
/// subscribes to (`wearable:getRecentSleepSessions`,
/// `sportPlusSessions:getRecentSessions`), never a new query of its own.
struct DurationHistoryChart: View {
    struct Point: Identifiable {
        let date: Date
        let minutes: Double
        var id: Date { date }
    }

    let points: [Point]
    var accentColor: Color = StudioColor.accentInk

    var body: some View {
        if points.isEmpty {
            Text("No history yet.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkFaint)
                .frame(height: 120, alignment: .center)
                .frame(maxWidth: .infinity)
        } else {
            Chart(points) { point in
                BarMark(
                    x: .value("Date", point.date, unit: .day),
                    y: .value("Minutes", point.minutes)
                )
                .foregroundStyle(accentColor)
                .cornerRadius(3)
            }
            .frame(height: 120)
        }
    }
}
