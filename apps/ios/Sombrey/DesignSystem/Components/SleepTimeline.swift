import SwiftUI

// MARK: - Model

/// Sleep as time, not as a number. Pure, so the placement rules are
/// testable:
/// - A stage is placed only at the time the band recorded for it
///   (`SleepStageDTO.startedAt`). A stage without a timestamp is never
///   placed at a guessed time — the session then shows as undivided.
/// - Gaps between stages (periods the band filtered out as unworn or
///   unknown) stay visible as gaps; nothing is filled in.
enum SleepTimelineModel {
    enum Stage: String, CaseIterable {
        case awake, rem, light, deep

        /// Lane order top → bottom: lighter states above deeper ones.
        var lane: Int {
            switch self {
            case .awake: return 0
            case .rem: return 1
            case .light: return 2
            case .deep: return 3
            }
        }

        var label: String {
            switch self {
            case .awake: return "AWAKE"
            case .rem: return "REM"
            case .light: return "LIGHT"
            case .deep: return "DEEP"
            }
        }
    }

    struct Block: Identifiable, Equatable {
        let stage: Stage
        let start: Date
        let end: Date
        var id: Date { start }
        var minutes: Int { Int((end.timeIntervalSince(start) / 60).rounded()) }
    }

    struct Session: Identifiable, Equatable {
        let start: Date
        let end: Date
        let totalSleepMinutes: Int
        /// Empty when the band recorded no timestamped stages.
        let blocks: [Block]
        var id: Date { start }
    }

    static func session(_ dto: SleepSessionSummaryDTO) -> Session {
        let blocks: [Block] = (dto.stages ?? []).compactMap { stage in
            guard let kind = Stage(rawValue: stage.stage), let startedAt = stage.startedAt, stage.durationMinutes > 0 else { return nil }
            let start = Date(timeIntervalSince1970: startedAt / 1000)
            return Block(stage: kind, start: start, end: start.addingTimeInterval(Double(stage.durationMinutes) * 60))
        }
        .sorted { $0.start < $1.start }
        return Session(
            start: Date(timeIntervalSince1970: dto.startedAt / 1000),
            end: Date(timeIntervalSince1970: dto.endedAt / 1000),
            totalSleepMinutes: dto.totalSleepMinutes,
            blocks: blocks
        )
    }

    static func minutesByStage(_ blocks: [Block]) -> [Stage: Int] {
        blocks.reduce(into: [:]) { totals, block in totals[block.stage, default: 0] += block.minutes }
    }

    /// The window a session is drawn across: its own start/end, widened
    /// if a recorded stage runs outside it.
    static func window(_ session: Session) -> ClosedRange<Date> {
        let start = min(session.start, session.blocks.first?.start ?? session.start)
        let end = max(session.end, session.blocks.map(\.end).max() ?? session.end)
        return start...max(end, start.addingTimeInterval(60))
    }

    /// Hours past 6 PM for a time — a shared clock axis so nights line up
    /// by when they happened, regardless of date.
    static func eveningClock(_ date: Date, calendar: Calendar = .current) -> Double {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        let hours = Double(components.hour ?? 0) + Double(components.minute ?? 0) / 60
        return (hours - 18 + 24).truncatingRemainder(dividingBy: 24)
    }

    /// Average of other real sessions' totals, only once there are enough
    /// of them to mean something.
    static func recentAverage(excluding latest: Session, in sessions: [Session], minimum: Int = 3) -> Double? {
        let others = sessions.filter { $0.id != latest.id }
        guard others.count >= minimum else { return nil }
        return Double(others.map(\.totalSleepMinutes).reduce(0, +)) / Double(others.count)
    }
}

// MARK: - Instrument

/// Sleep as a timeline instrument. At rest: the last session's length,
/// its bed and wake times, and a compact hypnogram of the stages where
/// they happened. Opened, the hypnogram unfolds — lanes separate and gain
/// labels and totals, a finger can move through the night — and recent
/// nights line up beneath on a shared clock.
struct SleepTimelineInstrument: View {
    /// Newest first, as `wearable:getRecentSleepSessions` returns them.
    let sessions: [SleepSessionSummaryDTO]?
    let isPaired: Bool
    var isLoading: Bool = false

    @State private var isExpanded = false
    @State private var scrubbed: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var models: [SleepTimelineModel.Session] { (sessions ?? []).map(SleepTimelineModel.session) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: toggle) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Text("SLEEP")
                            .font(StudioFont.body(11, weight: .semibold))
                            .tracking(1.3)
                            .foregroundStyle(StudioColor.inkSoft)
                        if models.first != nil {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(StudioColor.inkFaint)
                                .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        }
                        Spacer()
                    }
                    summary
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(models.first == nil)
            .accessibilityHint(isExpanded ? "Folds the sleep timeline" : "Unfolds the sleep timeline")

            if let latest = models.first {
                Hypnogram(session: latest, expanded: isExpanded, scrubbed: $scrubbed)
                    .frame(height: isExpanded ? 150 : 46)
                if isExpanded {
                    detail(latest)
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -8)))
                }
            }
        }
        .studioCard()
        .sensoryFeedback(trigger: isExpanded) { _, expanded in
            expanded ? StudioHaptic.expand : StudioHaptic.collapse
        }
    }

    @ViewBuilder
    private var summary: some View {
        if let latest = models.first {
            HStack(alignment: .firstTextBaseline) {
                Text(Self.duration(latest.totalSleepMinutes))
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Spacer()
                Text("\(latest.start.formatted(.dateTime.hour().minute())) – \(latest.end.formatted(.dateTime.hour().minute()))")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .monospacedDigit()
            }
        } else if !isPaired {
            Text("Wear your Sombrey Band overnight to begin collecting sleep.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkFaint)
        } else {
            Text(isLoading ? "Reading sleep…" : "No sleep synced yet.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkFaint)
        }
    }

    private func detail(_ latest: SleepTimelineModel.Session) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if let average = SleepTimelineModel.recentAverage(excluding: latest, in: models) {
                let delta = Double(latest.totalSleepMinutes) - average
                Text("\(delta >= 0 ? "+" : "−")\(Self.duration(Int(abs(delta).rounded()))) vs your recent average of \(Self.duration(Int(average.rounded())))")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            } else {
                Text("A comparison appears once three earlier nights are synced.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            if models.count > 1 {
                RecentNights(sessions: Array(models.prefix(7)))
            }
        }
    }

    private func toggle() {
        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) {
            isExpanded.toggle()
            scrubbed = nil
        }
    }

    static func duration(_ minutes: Int) -> String {
        "\(minutes / 60)h \(minutes % 60)m"
    }
}

/// The night's structure: one lane per stage, blocks placed at their
/// recorded times. Collapsed the lanes sit close as a compact strip;
/// expanded they separate, gain labels and totals, and follow a finger.
private struct Hypnogram: View {
    let session: SleepTimelineModel.Session
    let expanded: Bool
    @Binding var scrubbed: Date?

    private var window: ClosedRange<Date> { SleepTimelineModel.window(session) }
    private var labelWidth: CGFloat { expanded ? 48 : 0 }
    private var totalWidth: CGFloat { expanded ? 44 : 0 }

    var body: some View {
        if session.blocks.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Capsule()
                    .fill(StudioColor.ink.opacity(0.3))
                    .frame(height: 8)
                Text("Stage detail wasn't recorded for this session.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        } else {
            GeometryReader { geo in
                let plotWidth = max(geo.size.width - labelWidth - totalWidth, 1)
                let axisHeight: CGFloat = expanded ? 16 : 0
                let laneHeight = (geo.size.height - axisHeight) / 4
                ZStack(alignment: .topLeading) {
                    if expanded { laneLabels(laneHeight: laneHeight, plotWidth: plotWidth) }
                    ForEach(session.blocks) { block in
                        blockView(block, plotWidth: plotWidth, laneHeight: laneHeight)
                    }
                    if expanded { axis(plotWidth: plotWidth, top: laneHeight * 4) }
                    if let scrubbed, expanded {
                        scrubLine(at: scrubbed, plotWidth: plotWidth, height: laneHeight * 4)
                    }
                }
                .contentShape(Rectangle())
                .gesture(expanded ? scrubGesture(plotWidth: plotWidth) : nil)
            }
            .sensoryFeedback(StudioHaptic.focus, trigger: scrubbedBlock?.id)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)
        }
    }

    private var scrubbedBlock: SleepTimelineModel.Block? {
        guard let scrubbed else { return nil }
        return session.blocks.first { $0.start <= scrubbed && scrubbed < $0.end }
    }

    private func x(_ date: Date, plotWidth: CGFloat) -> CGFloat {
        let span = window.upperBound.timeIntervalSince(window.lowerBound)
        return labelWidth + CGFloat(date.timeIntervalSince(window.lowerBound) / span) * plotWidth
    }

    private func blockView(_ block: SleepTimelineModel.Block, plotWidth: CGFloat, laneHeight: CGFloat) -> some View {
        let startX = x(block.start, plotWidth: plotWidth)
        let width = max(x(block.end, plotWidth: plotWidth) - startX, 1.5)
        let barHeight = expanded ? laneHeight * 0.62 : laneHeight * 0.9
        let y = CGFloat(block.stage.lane) * laneHeight + (laneHeight - barHeight) / 2
        let isScrubbed = scrubbedBlock == block
        return RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(isScrubbed ? StudioColor.accentInk : Self.color(block.stage))
            .frame(width: width, height: barHeight)
            .offset(x: startX, y: y)
    }

    private func laneLabels(laneHeight: CGFloat, plotWidth: CGFloat) -> some View {
        let totals = SleepTimelineModel.minutesByStage(session.blocks)
        return ForEach(SleepTimelineModel.Stage.allCases, id: \.self) { stage in
            let y = CGFloat(stage.lane) * laneHeight
            ZStack(alignment: .topLeading) {
                Text(stage.label)
                    .font(StudioFont.body(8, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(StudioColor.inkSoft)
                    .frame(width: labelWidth, height: laneHeight, alignment: .leading)
                Rectangle()
                    .fill(StudioColor.ink.opacity(0.05))
                    .frame(width: plotWidth, height: 1)
                    .offset(x: labelWidth, y: laneHeight / 2)
                Text(totals[stage].map { SleepTimelineInstrument.duration($0) } ?? "—")
                    .font(StudioFont.body(9))
                    .foregroundStyle(StudioColor.inkSoft)
                    .monospacedDigit()
                    .frame(width: totalWidth, height: laneHeight, alignment: .trailing)
                    .offset(x: labelWidth + plotWidth)
            }
            .offset(y: y)
            .transition(.opacity)
        }
    }

    private func axis(plotWidth: CGFloat, top: CGFloat) -> some View {
        let marks = Self.hourMarks(in: window)
        return ForEach(marks, id: \.self) { mark in
            Text(mark.formatted(.dateTime.hour()))
                .font(StudioFont.body(8))
                .foregroundStyle(StudioColor.inkFaint)
                .fixedSize()
                .offset(x: x(mark, plotWidth: plotWidth) - 8, y: top + 3)
        }
    }

    private func scrubLine(at date: Date, plotWidth: CGFloat, height: CGFloat) -> some View {
        let lineX = x(date, plotWidth: plotWidth)
        let caption = "\(date.formatted(.dateTime.hour().minute())) · \(scrubbedBlock?.stage.label.capitalized ?? "No stage recorded")"
        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(StudioColor.ink.opacity(0.35))
                .frame(width: 1, height: height)
                .offset(x: lineX)
            Text(caption)
                .font(StudioFont.body(10, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(.ultraThinMaterial, in: Capsule())
                .fixedSize()
                .offset(x: min(max(lineX - 50, 0), plotWidth - 60), y: -18)
        }
    }

    private func scrubGesture(plotWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let fraction = Double((value.location.x - labelWidth) / plotWidth)
                let clamped = min(max(fraction, 0), 1)
                let span = window.upperBound.timeIntervalSince(window.lowerBound)
                scrubbed = window.lowerBound.addingTimeInterval(clamped * span)
            }
            .onEnded { _ in scrubbed = nil }
    }

    private var accessibilitySummary: String {
        let totals = SleepTimelineModel.minutesByStage(session.blocks)
        let parts = SleepTimelineModel.Stage.allCases.compactMap { stage in
            totals[stage].map { "\(stage.label.lowercased()) \(SleepTimelineInstrument.duration($0))" }
        }
        return "Sleep stages: " + parts.joined(separator: ", ")
    }

    static func color(_ stage: SleepTimelineModel.Stage) -> Color {
        switch stage {
        case .awake: return StudioColor.accentInk.opacity(0.55)
        case .rem: return StudioColor.ink.opacity(0.55)
        case .light: return StudioColor.ink.opacity(0.3)
        case .deep: return StudioColor.ink.opacity(0.85)
        }
    }

    /// Whole hours inside the window, thinned to at most five marks.
    static func hourMarks(in window: ClosedRange<Date>, calendar: Calendar = .current) -> [Date] {
        guard var mark = calendar.nextDate(after: window.lowerBound, matching: DateComponents(minute: 0), matchingPolicy: .nextTime) else { return [] }
        var marks: [Date] = []
        while mark < window.upperBound {
            marks.append(mark)
            mark = mark.addingTimeInterval(3600)
        }
        let stride = max(1, Int((Double(marks.count) / 5).rounded(.up)))
        return marks.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
    }
}

/// Recent nights as thin timelines on one evening-to-evening clock
/// (6 PM → 6 PM), so bedtime and wake time line up across nights.
private struct RecentNights: View {
    let sessions: [SleepTimelineModel.Session]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("RECENT NIGHTS · 6 PM TO 6 PM")
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(StudioColor.inkSoft)
            ForEach(sessions) { session in
                HStack(spacing: 10) {
                    Text(session.end.formatted(.dateTime.weekday(.abbreviated)))
                        .font(StudioFont.body(10))
                        .foregroundStyle(StudioColor.inkSoft)
                        .frame(width: 30, alignment: .leading)
                    GeometryReader { geo in
                        let startX = CGFloat(SleepTimelineModel.eveningClock(session.start) / 24) * geo.size.width
                        let endClock = SleepTimelineModel.eveningClock(session.end)
                        let endX = CGFloat((endClock < SleepTimelineModel.eveningClock(session.start) ? 24 : endClock) / 24) * geo.size.width
                        ZStack(alignment: .leading) {
                            Capsule().fill(StudioColor.ink.opacity(0.06)).frame(height: 4)
                            Capsule()
                                .fill(StudioColor.ink.opacity(0.6))
                                .frame(width: max(endX - startX, 2), height: 4)
                                .offset(x: startX)
                        }
                        .frame(height: geo.size.height)
                    }
                    .frame(height: 10)
                    Text(SleepTimelineInstrument.duration(session.totalSleepMinutes))
                        .font(StudioFont.body(10))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                        .frame(width: 46, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
