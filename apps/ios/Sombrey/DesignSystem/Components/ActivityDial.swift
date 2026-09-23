import SwiftUI

// MARK: - Model

/// Turns the band's cumulative since-midnight step snapshots into what
/// the day dial draws. Pure, so the rules are testable:
/// - A span is the interval between two real snapshots; its steps are
///   the exact difference between them. Nothing is spread, smoothed or
///   interpolated.
/// - Snapshots closer than `minimumSpan` are coalesced (the live stream
///   ticks every few seconds), keeping the later one, so each span's
///   step rate is meaningful. Differences stay exact.
/// - The first span runs from local midnight — the band's counter
///   starts there — to the first snapshot.
/// - A counter that goes backwards (a band reset) is not a negative
///   span; the next span starts from the new value.
enum ActivityDay {
    struct Snapshot: Equatable {
        let date: Date
        let steps: Double
    }

    struct Span: Identifiable, Equatable {
        let start: Date
        let end: Date
        let steps: Double
        var id: Date { start }
        var stepsPerMinute: Double {
            let minutes = end.timeIntervalSince(start) / 60
            return minutes > 0 ? steps / minutes : 0
        }
    }

    static let minimumSpan: TimeInterval = 5 * 60

    static func spans(_ snapshots: [Snapshot], dayStart: Date) -> [Span] {
        let ordered = snapshots
            .filter { $0.date >= dayStart }
            .sorted { $0.date < $1.date }
        guard let last = ordered.last else { return [] }
        var kept: [Snapshot] = []
        for snapshot in ordered {
            if let previous = kept.last, snapshot.date.timeIntervalSince(previous.date) < minimumSpan, snapshot != last {
                continue
            }
            kept.append(snapshot)
        }
        var result: [Span] = []
        var cursor = Snapshot(date: dayStart, steps: 0)
        for snapshot in kept {
            let delta = snapshot.steps - cursor.steps
            if delta > 0, snapshot.date > cursor.date {
                result.append(Span(start: cursor.date, end: snapshot.date, steps: delta))
            }
            cursor = snapshot
        }
        return result
    }

    /// Each local day's final cumulative count (its highest snapshot),
    /// keyed by start of day. Days with no snapshots are absent, not zero.
    static func dailyTotals(_ snapshots: [Snapshot], calendar: Calendar = .current) -> [Date: Double] {
        var totals: [Date: Double] = [:]
        for snapshot in snapshots {
            let day = calendar.startOfDay(for: snapshot.date)
            totals[day] = max(totals[day] ?? 0, snapshot.steps)
        }
        return totals
    }

    /// Fraction of a full turn for a time of day (midnight at the top).
    static func turn(_ date: Date, dayStart: Date) -> Double {
        min(max(date.timeIntervalSince(dayStart) / 86_400, 0), 1)
    }
}

// MARK: - Instrument

/// Activity as a 24-hour day dial. The ring is the day itself — midnight
/// at the top, the current time marked — and the band's steps are drawn
/// around it where they actually happened, heavier where the pace was
/// higher. There is deliberately no goal ring: Sombrey has no real step
/// goal to measure against (see the UI3 report), and a made-up target
/// would be a fake completion. Opened, the dial grows its hour marks,
/// lets a finger travel around the day to read any span, and shows the
/// week as small day dials scaled to the week's own most active day.
struct ActivityDialInstrument: View {
    /// Today's latest band counters (`WearableManager.latestMeasurementForToday`).
    let steps: WearableMeasurement?
    let activeCalories: WearableMeasurement?
    let distance: WearableMeasurement?
    let isPaired: Bool

    @State private var isExpanded = false
    @State private var revealed = false
    @State private var focusedSpan: ActivityDay.Span?
    @State private var history = ConvexQuery<[WearableMeasurementDTO]>()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var dayStart: Date { Calendar.current.startOfDay(for: Date()) }

    private var snapshots: [ActivityDay.Snapshot] {
        var result = (history.value ?? []).map {
            ActivityDay.Snapshot(date: Date(timeIntervalSince1970: $0.recordedAt / 1000), steps: $0.value)
        }
        // The live counter can be newer than the last stored row.
        if let steps, !result.contains(where: { $0.date >= steps.recordedAt }) {
            result.append(ActivityDay.Snapshot(date: steps.recordedAt, steps: steps.value))
        }
        return result
    }

    private var todaySpans: [ActivityDay.Span] { ActivityDay.spans(snapshots, dayStart: dayStart) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: toggle) {
                HStack(spacing: 8) {
                    Text("ACTIVITY")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(StudioColor.inkFaint)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    Spacer()
                    if let steps {
                        Text("As of \(steps.recordedAt.formatted(.dateTime.hour().minute()))")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Activity")
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            .accessibilityHint(isExpanded ? "Hides the day detail" : "Shows when today's steps happened and the past week")

            if !isPaired {
                Text("Put on your Sombrey Band to begin collecting activity.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                HStack(alignment: isExpanded ? .top : .center, spacing: 20) {
                    dial
                    if !isExpanded {
                        secondary
                            .transition(.opacity)
                    }
                }
                .frame(maxWidth: .infinity, alignment: isExpanded ? .center : .leading)
                .contentShape(Rectangle())
                .onTapGesture { if !isExpanded { toggle() } }

                if isExpanded {
                    detail
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -8)))
                }
            }
        }
        .studioCard()
        .task { history.subscribe(to: "wearable:getMeasurementsByRange", with: ["metricType": "steps", "sinceMs": weekStartMs]) }
        .onAppear(perform: reveal)
        .sensoryFeedback(trigger: isExpanded) { _, expanded in
            expanded ? StudioHaptic.expand : StudioHaptic.collapse
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: focusedSpan?.id)
    }

    private var weekStartMs: Double {
        (Calendar.current.date(byAdding: .day, value: -6, to: dayStart) ?? dayStart).timeIntervalSince1970 * 1000
    }

    // MARK: Dial

    private var dialSize: CGFloat { isExpanded ? 240 : 128 }

    private var dial: some View {
        ZStack {
            DayRing(spans: todaySpans, dayStart: dayStart, focused: focusedSpan, showsHours: isExpanded)
                .mask {
                    // The day draws itself round from midnight once.
                    Circle()
                        .trim(from: 0, to: revealed ? 1 : 0)
                        .stroke(style: StrokeStyle(lineWidth: dialSize / 2))
                        .rotationEffect(.degrees(-90))
                        .padding(dialSize / 4)
                }
            VStack(spacing: 2) {
                Text(steps.map { $0.value.formatted(.number.precision(.fractionLength(0))) } ?? "—")
                    .font(StudioFont.hero(isExpanded ? 32 : 24, weight: .semibold))
                    .foregroundStyle(steps == nil ? StudioColor.inkFaint : StudioColor.ink)
                    .monospacedDigit()
                    .studioNumericTransition(steps?.value ?? 0)
                Text(steps == nil ? "NO STEPS YET" : "STEPS TODAY")
                    .font(StudioFont.body(8, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
        .frame(width: dialSize, height: dialSize)
        .gesture(isExpanded ? scrub : nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(steps.map { "\(Int($0.value)) steps today" } ?? "No steps recorded today")
    }

    /// Travel a finger around the day to read the span under it.
    private var scrub: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let center = CGPoint(x: dialSize / 2, y: dialSize / 2)
                let dx = Double(value.location.x - center.x)
                let dy = Double(value.location.y - center.y)
                var turn = (atan2(dy, dx) + .pi / 2) / (2 * .pi)
                if turn < 0 { turn += 1 }
                let time = dayStart.addingTimeInterval(turn * 86_400)
                focusedSpan = todaySpans.first { $0.start <= time && time <= $0.end }
            }
            .onEnded { _ in }
    }

    // MARK: Secondary (at rest)

    private var secondary: some View {
        VStack(alignment: .leading, spacing: 12) {
            MetricView(
                label: "Active Calories",
                value: activeCalories.map { HomeScreen.kilocalorieText($0.value) } ?? "—",
                unit: activeCalories == nil ? nil : "kcal"
            )
            MetricView(
                label: "Distance",
                value: distance.map { String(format: "%.1f", $0.value / 1000) } ?? "—",
                unit: distance == nil ? nil : "km"
            )
        }
    }

    // MARK: Detail (opened)

    private var detail: some View {
        VStack(alignment: .leading, spacing: 16) {
            spanReadout
                .frame(minHeight: 34, alignment: .leading)
            HStack(spacing: 28) {
                secondaryInline("ACTIVE CALORIES", activeCalories.map { "\(HomeScreen.kilocalorieText($0.value)) kcal" })
                secondaryInline("DISTANCE", distance.map { String(format: "%.2f km", $0.value / 1000) })
            }
            weekStrip
        }
    }

    @ViewBuilder
    private var spanReadout: some View {
        if let span = focusedSpan {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(span.start.formatted(.dateTime.hour().minute()))–\(span.end.formatted(.dateTime.hour().minute()))")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
                Text("\(Int(span.steps)) steps · \(Int(span.stepsPerMinute.rounded()))/min")
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
            }
        } else if let busiest = todaySpans.max(by: { $0.steps < $1.steps }) {
            VStack(alignment: .leading, spacing: 2) {
                Text("MOST STEPS IN ONE STRETCH")
                    .font(StudioFont.body(9, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(StudioColor.inkSoft)
                Text("\(Int(busiest.steps)) steps · \(busiest.start.formatted(.dateTime.hour().minute()))–\(busiest.end.formatted(.dateTime.hour().minute()))")
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("Drag around the ring to read any part of the day.")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        } else {
            Text(history.isLoading ? "Reading today's activity…" : "No steps recorded yet today.")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkFaint)
        }
    }

    private func secondaryInline(_ label: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
            Text(value ?? "—")
                .font(StudioFont.body(14, weight: .semibold))
                .foregroundStyle(value == nil ? StudioColor.inkFaint : StudioColor.ink)
                .monospacedDigit()
        }
    }

    /// The last 7 days as small day dials, each filled relative to the
    /// week's own most active day — a comparison between real days, not
    /// progress toward a target. A day with no data is an empty ring.
    private var weekStrip: some View {
        let totals = ActivityDay.dailyTotals(snapshots)
        let days: [Date] = (0..<7).reversed().compactMap { Calendar.current.date(byAdding: .day, value: -$0, to: dayStart) }
        let weekMax = days.compactMap { totals[$0] }.max() ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            Text("THIS WEEK · RELATIVE TO YOUR MOST ACTIVE DAY")
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(spacing: 0) {
                ForEach(days, id: \.self) { day in
                    WeekDayDial(
                        label: day.formatted(.dateTime.weekday(.narrow)),
                        total: totals[day],
                        fraction: weekMax > 0 ? (totals[day] ?? 0) / weekMax : 0,
                        isToday: day == dayStart
                    )
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // MARK: Behaviour

    private func reveal() {
        guard !revealed else { return }
        if let animation = StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion) {
            withAnimation(animation) { revealed = true }
        } else {
            revealed = true
        }
    }

    private func toggle() {
        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) {
            isExpanded.toggle()
            if !isExpanded { focusedSpan = nil }
        }
    }
}

/// The 24-hour ring: faint track, the day's spans as arcs (weight and
/// opacity scale with that span's pace relative to the day's fastest),
/// hour marks, and a "now" mark. Drawn in one Canvas — a live day can
/// hold many spans.
private struct DayRing: View {
    let spans: [ActivityDay.Span]
    let dayStart: Date
    let focused: ActivityDay.Span?
    let showsHours: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Canvas { canvas, size in
                draw(in: &canvas, size: size, now: context.date)
            }
        }
        .accessibilityHidden(true)
    }

    private func draw(in canvas: inout GraphicsContext, size: CGSize, now: Date) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius = min(size.width, size.height) / 2 - (showsHours ? 20 : 8)
        let ringWidth: CGFloat = showsHours ? 12 : 9

        var track = Path()
        track.addArc(center: center, radius: radius, startAngle: .degrees(0), endAngle: .degrees(360), clockwise: false)
        canvas.stroke(track, with: .color(StudioColor.ink.opacity(0.07)), lineWidth: ringWidth)

        let maxRate = spans.map(\.stepsPerMinute).max() ?? 0
        for span in spans {
            let relative = maxRate > 0 ? span.stepsPerMinute / maxRate : 0
            let isFocused = focused == span
            var arc = Path()
            arc.addArc(
                center: center,
                radius: radius,
                startAngle: angle(span.start),
                endAngle: angle(span.end),
                clockwise: false
            )
            let color = isFocused ? StudioColor.accentInk : StudioColor.ink.opacity(0.25 + 0.65 * relative)
            canvas.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: ringWidth * CGFloat(0.55 + 0.45 * relative), lineCap: .butt))
        }

        // Hour marks: every 3 hours, labelled at 12a/6a/12p/6p when open.
        for hour in stride(from: 0, to: 24, by: 3) {
            let date = dayStart.addingTimeInterval(Double(hour) * 3600)
            let a = angle(date).radians
            let isQuarter = hour % 6 == 0
            let inner = radius + ringWidth / 2 + 2
            let outer = inner + (isQuarter ? 5 : 3)
            var tick = Path()
            tick.move(to: CGPoint(x: center.x + CGFloat(cos(a)) * inner, y: center.y + CGFloat(sin(a)) * inner))
            tick.addLine(to: CGPoint(x: center.x + CGFloat(cos(a)) * outer, y: center.y + CGFloat(sin(a)) * outer))
            canvas.stroke(tick, with: .color(StudioColor.ink.opacity(isQuarter ? 0.4 : 0.2)), lineWidth: 1)
            if showsHours && isQuarter {
                let labelRadius = outer + 8
                let label = Text(Self.hourLabel(hour)).font(StudioFont.body(8, weight: .semibold)).foregroundColor(StudioColor.inkSoft)
                canvas.draw(label, at: CGPoint(x: center.x + CGFloat(cos(a)) * labelRadius, y: center.y + CGFloat(sin(a)) * labelRadius))
            }
        }

        // Now: where the day currently stands.
        let nowAngle = angle(now).radians
        var nowMark = Path()
        let nowInner = radius - ringWidth / 2 - 3
        let nowOuter = radius + ringWidth / 2 + 3
        nowMark.move(to: CGPoint(x: center.x + CGFloat(cos(nowAngle)) * nowInner, y: center.y + CGFloat(sin(nowAngle)) * nowInner))
        nowMark.addLine(to: CGPoint(x: center.x + CGFloat(cos(nowAngle)) * nowOuter, y: center.y + CGFloat(sin(nowAngle)) * nowOuter))
        canvas.stroke(nowMark, with: .color(StudioColor.accentInk), style: StrokeStyle(lineWidth: 2, lineCap: .round))
    }

    private func angle(_ date: Date) -> Angle {
        .degrees(ActivityDay.turn(date, dayStart: dayStart) * 360 - 90)
    }

    private static func hourLabel(_ hour: Int) -> String {
        switch hour {
        case 0: return "12A"
        case 6: return "6A"
        case 12: return "12P"
        default: return "6P"
        }
    }
}

/// One day in the week strip.
private struct WeekDayDial: View {
    let label: String
    let total: Double?
    let fraction: Double
    let isToday: Bool

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .stroke(StudioColor.ink.opacity(0.08), lineWidth: 3)
                if total != nil {
                    Circle()
                        .trim(from: 0, to: CGFloat(fraction))
                        .stroke(isToday ? StudioColor.accentInk : StudioColor.ink.opacity(0.7), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            }
            .frame(width: 26, height: 26)
            Text(label)
                .font(StudioFont.body(9, weight: isToday ? .semibold : .regular))
                .foregroundStyle(isToday ? StudioColor.ink : StudioColor.inkSoft)
            Text(total.map { Self.compact($0) } ?? "—")
                .font(StudioFont.body(9))
                .foregroundStyle(StudioColor.inkFaint)
                .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label), \(total.map { "\(Int($0)) steps" } ?? "no data")")
    }

    private static func compact(_ steps: Double) -> String {
        steps >= 1000 ? String(format: "%.1fk", steps / 1000) : "\(Int(steps))"
    }
}
