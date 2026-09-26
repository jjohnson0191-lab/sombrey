import SwiftUI
import Charts

// Progress's instruments — built on the Studio components already in use
// (graphite bezel, glass pills, MetricInstrument's expand-in-place,
// InstrumentChart's scrubbing grammar). Each section has its own
// interaction character; none invents a value.

// MARK: - Glass switch

/// Two related modes as one glass control with a lit key — Train's mode
/// pill, generalized (WORKOUTS | ACTIVITIES).
struct GlassSwitch<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var keySpace

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                let isActive = option.value == selection
                Button {
                    guard !isActive else { return }
                    withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) { selection = option.value }
                } label: {
                    Text(option.label)
                        .font(StudioFont.body(12, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(isActive ? StudioColor.ink : StudioColor.ink.opacity(0.5))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background {
                            if isActive {
                                Capsule(style: .continuous)
                                    .fill(Color.white.opacity(0.55))
                                    .overlay { Capsule(style: .continuous).strokeBorder(Color.white.opacity(0.7), lineWidth: 0.5) }
                                    .shadow(color: StudioColor.env0.opacity(0.14), radius: 6, y: 3)
                                    .matchedGeometryEffect(id: "key", in: keySpace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isActive ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(4)
        .background {
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .light)
                .overlay { Capsule(style: .continuous).fill(StudioColor.env5.opacity(0.28)) }
                .overlay {
                    Capsule(style: .continuous)
                        .strokeBorder(LinearGradient(colors: [Color.white.opacity(0.7), Color.white.opacity(0.12)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
                }
        }
        .sensoryFeedback(StudioHaptic.tabChange, trigger: selection)
    }
}

// MARK: - Series chart

/// One metric over time — the Vitals chart grammar for Progress data:
/// area + line, a dashed personal baseline, scrubbing to an exact point
/// (date, value, source) with a tick per reading, and a morph between
/// ranges. With Reduce Motion the new range simply appears.
struct ProgressSeriesChart: View {
    let points: [PerformanceDTO.Point]
    let unit: String
    var baseline: Double? = nil
    var baselineLabel = "Your average"
    var tint: Color = StudioColor.accentInk
    var height: CGFloat = 170
    @State private var selectedDate: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selected: PerformanceDTO.Point? {
        guard let selectedDate, !points.isEmpty else { return nil }
        return points.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            readout.frame(minHeight: 30, alignment: .leading)
            chart.frame(height: height)
        }
        .sensoryFeedback(trigger: selected?.id) { _, id in id == nil ? nil : StudioHaptic.scrubStep }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    @ViewBuilder
    private var readout: some View {
        if let p = selected {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(ProgressFormat.value(p.value, unit: unit))
                    .font(StudioFont.hero(22, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text(ProgressFormat.unitLabel(unit))
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                Text(p.date.formatted(.dateTime.day().month(.abbreviated).year()))
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
                if let source = ProgressProvenance.label(p.source) {
                    Text(source.uppercased())
                        .font(StudioFont.body(9, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
        } else {
            Text("Drag across the graph for each reading")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkFaint)
        }
    }

    private var domain: ClosedRange<Double> {
        let values = points.map(\.value) + (baseline.map { [$0] } ?? [])
        guard let lo = values.min(), let hi = values.max() else { return 0...1 }
        let pad = max((hi - lo) * 0.15, hi == lo ? max(abs(hi) * 0.1, 1) : 0)
        return (lo - pad)...(hi + pad)
    }

    private var chart: some View {
        let d = domain
        return Chart {
            if let baseline {
                RuleMark(y: .value("Baseline", baseline))
                    .foregroundStyle(StudioColor.inkFaint)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .annotation(position: .top, alignment: .leading) {
                        Text(baselineLabel.uppercased())
                            .font(StudioFont.body(8, weight: .semibold))
                            .tracking(1)
                            .foregroundStyle(StudioColor.inkFaint)
                    }
            }
            ForEach(points) { p in
                AreaMark(x: .value("Date", p.date), yStart: .value("Floor", d.lowerBound), yEnd: .value("Value", p.value))
                    .foregroundStyle(LinearGradient(colors: [tint.opacity(0.14), tint.opacity(0)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
                LineMark(x: .value("Date", p.date), y: .value("Value", p.value))
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    .interpolationMethod(.monotone)
                PointMark(x: .value("Date", p.date), y: .value("Value", p.value))
                    .foregroundStyle(tint)
                    .symbolSize(points.count > 30 ? 8 : 20)
            }
            if let s = selected {
                RuleMark(x: .value("Selected", s.date)).foregroundStyle(StudioColor.ink.opacity(0.22))
                PointMark(x: .value("Date", s.date), y: .value("Value", s.value)).foregroundStyle(StudioColor.ink).symbolSize(48)
            }
        }
        .chartYScale(domain: d)
        .chartXSelection(value: $selectedDate)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                AxisValueLabel(format: .dateTime.day().month(.abbreviated)).font(StudioFont.body(9)).foregroundStyle(StudioColor.inkFaint)
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { _ in
                AxisGridLine().foregroundStyle(StudioColor.ink.opacity(0.06))
                AxisValueLabel().font(StudioFont.body(9)).foregroundStyle(StudioColor.inkFaint)
            }
        }
        .animation(StudioMotion.resolve(StudioMotion.rangeMorph, reduceMotion: reduceMotion), value: points)
    }

    private var accessibilitySummary: String {
        guard let first = points.first, let last = points.last,
              let lo = points.map(\.value).min(), let hi = points.map(\.value).max() else { return "No readings" }
        return "\(points.count) readings from \(first.date.formatted(date: .abbreviated, time: .omitted)) to \(last.date.formatted(date: .abbreviated, time: .omitted)). Lowest \(ProgressFormat.value(lo, unit: unit)), highest \(ProgressFormat.value(hi, unit: unit)), latest \(ProgressFormat.value(last.value, unit: unit)) \(ProgressFormat.unitLabel(unit))."
    }
}

// MARK: - Stats row

/// Current · Low · Average · High · count — the resting readout.
struct ProgressStatsRow: View {
    let stats: PerformanceDTO.Stats
    let unit: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 16) { cells }
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 16) { cell("Latest", stats.current); cell("Low", stats.low) }
                HStack(spacing: 16) { cell("Average", stats.average); cell("High", stats.high) }
                count
            }
        }
    }

    @ViewBuilder private var cells: some View {
        cell("Latest", stats.current)
        cell("Low", stats.low)
        cell("Average", stats.average)
        cell("High", stats.high)
        Spacer(minLength: 0)
        count
    }

    private var count: some View {
        Text("\(Int(stats.count)) \(Int(stats.count) == 1 ? "reading" : "readings")")
            .font(StudioFont.body(10))
            .foregroundStyle(StudioColor.inkFaint)
    }

    private func cell(_ label: String, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(ProgressFormat.value(value, unit: unit))
                    .font(StudioFont.hero(17, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text(ProgressFormat.unitLabel(unit))
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Week load bars (strain hero)

/// Seven days of measured load, today lit — the hero's accumulation
/// visual. Bars grow in once; heights are real minutes.
struct WeekLoadBars: View {
    let week: [DailyLoadDTO]
    var usual: Double? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false

    var body: some View {
        let maxValue = max(week.map(\.activeMinutes).max() ?? 0, usual ?? 0, 1)
        VStack(spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .bottom) {
                    if let usual, usual > 0 {
                        Rectangle()
                            .fill(StudioColor.paper.opacity(0.35))
                            .frame(height: 1)
                            .offset(y: -geo.size.height * CGFloat(usual / maxValue))
                            .frame(maxHeight: .infinity, alignment: .bottom)
                    }
                    HStack(alignment: .bottom, spacing: 8) {
                        ForEach(Array(week.enumerated()), id: \.offset) { index, day in
                            let isToday = index == week.count - 1
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(isToday ? StudioColor.accent : StudioColor.paper.opacity(day.activeMinutes > 0 ? 0.45 : 0.12))
                                .frame(height: max(3, geo.size.height * CGFloat(day.activeMinutes / maxValue) * (grown ? 1 : 0.05)))
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .frame(height: 56)
            HStack(spacing: 8) {
                ForEach(Array(week.enumerated()), id: \.offset) { index, day in
                    Text(index == week.count - 1 ? "TODAY" : ProgressFormat.shortDay(day.date).uppercased())
                        .font(StudioFont.body(8, weight: .semibold))
                        .tracking(0.6)
                        .foregroundStyle(index == week.count - 1 ? StudioColor.paper : StudioColor.paperFaint)
                        .frame(maxWidth: .infinity)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
        .onAppear {
            if reduceMotion { grown = true } else { withAnimation(StudioMotion.bloomOnce) { grown = true } }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Active minutes, last 7 days: " + week.map { "\(ProgressFormat.shortDay($0.date)) \(Int($0.activeMinutes))" }.joined(separator: ", ") + (usual.map { ". Usual \(Int($0)) minutes a day." } ?? ""))
    }
}

// MARK: - Week pattern (consistency)

/// Mon–Sun, each day's state shown by shape as well as tone: trained (filled
/// block), active (ring), rest (dash), still ahead (faint dot).
struct WeekPattern: View {
    let days: [WeekDayDTO]
    var showMinutes = false

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days, id: \.date) { day in
                VStack(spacing: 6) {
                    mark(day).frame(height: 26)
                    Text(ProgressFormat.shortDay(day.date).prefix(1))
                        .font(StudioFont.body(10, weight: .semibold))
                        .foregroundStyle(day.isFuture ? StudioColor.inkFaint : StudioColor.inkSoft)
                    if showMinutes {
                        Text(day.minutes > 0 ? "\(Int(day.minutes))m" : " ")
                            .font(StudioFont.body(9))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(days.map { "\(ProgressFormat.shortDay($0.date)): \($0.isFuture ? "ahead" : $0.trained ? "trained" : $0.active ? "active" : "rest")" }.joined(separator: ", "))
    }

    @ViewBuilder
    private func mark(_ day: WeekDayDTO) -> some View {
        if day.isFuture {
            Circle().fill(StudioColor.ink.opacity(0.12)).frame(width: 5, height: 5)
        } else if day.trained {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(StudioColor.env0.opacity(0.85)).frame(width: 22, height: 22)
        } else if day.active {
            RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(StudioColor.env0.opacity(0.7), lineWidth: 2).frame(width: 22, height: 22)
        } else {
            Capsule().fill(StudioColor.ink.opacity(0.2)).frame(width: 12, height: 2)
        }
    }
}

// MARK: - Paired timeline (load & recovery)

/// Each day's measured load (bars) above that morning's readiness (value) —
/// two rows on one time axis, so their relationship reads without a chart.
struct PairedTimeline: View {
    let days: [LoadRecoveryDayDTO]
    var compact = true

    var body: some View {
        let maxLoad = max(days.map(\.activeMinutes).max() ?? 0, 1)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: compact ? 8 : 3) {
                ForEach(days, id: \.date) { d in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(StudioColor.env0.opacity(d.activeMinutes > 0 ? 0.75 : 0.12))
                        .frame(height: max(2, CGFloat(d.activeMinutes / maxLoad) * (compact ? 36 : 54)))
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: compact ? 36 : 54, alignment: .bottom)
            HStack(spacing: compact ? 8 : 3) {
                ForEach(days, id: \.date) { d in
                    Group {
                        if let r = d.readiness {
                            Text("\(Int(r))")
                                .font(StudioFont.body(compact ? 11 : 8, weight: .semibold))
                                .foregroundStyle(StudioColor.accentInk)
                        } else {
                            Text("–").font(StudioFont.body(compact ? 11 : 8)).foregroundStyle(StudioColor.inkFaint)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                }
            }
            if compact {
                HStack(spacing: 8) {
                    ForEach(days, id: \.date) { d in
                        Text(ProgressFormat.shortDay(d.date).prefix(1))
                            .font(StudioFont.body(9, weight: .semibold))
                            .foregroundStyle(StudioColor.inkFaint)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(days.map { "\(ProgressFormat.shortDay($0.date)): \(Int($0.activeMinutes)) active minutes, readiness \($0.readiness.map { "\(Int($0))" } ?? "not scored")" }.joined(separator: "; "))
    }
}
