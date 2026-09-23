import SwiftUI

// MARK: - Time range

/// The one time-range vocabulary every metric instrument shares. A metric
/// offers only the ranges its data can honestly fill: LIVE only exists
/// where the band streams real-time readings (heart rate today).
enum InstrumentRange: String, CaseIterable, Identifiable, Hashable {
    case live = "LIVE"
    case today = "TODAY"
    case sevenDays = "7D"
    case thirtyDays = "30D"

    var id: String { rawValue }

    /// Start of the stored-history window, epoch ms. `nil` for LIVE,
    /// which reads the in-memory stream instead of stored history.
    func sinceMs(now: Date = Date(), calendar: Calendar = .current) -> Double? {
        switch self {
        case .live: return nil
        case .today: return calendar.startOfDay(for: now).timeIntervalSince1970 * 1000
        case .sevenDays: return now.addingTimeInterval(-7 * 24 * 3600).timeIntervalSince1970 * 1000
        case .thirtyDays: return now.addingTimeInterval(-30 * 24 * 3600).timeIntervalSince1970 * 1000
        }
    }

    /// Used in honest empty states: "No readings today."
    var phrase: String {
        switch self {
        case .live: return "from the live signal yet"
        case .today: return "today"
        case .sevenDays: return "in the last 7 days"
        case .thirtyDays: return "in the last 30 days"
        }
    }

    var accessibilityName: String {
        switch self {
        case .live: return "Live"
        case .today: return "Today"
        case .sevenDays: return "Last 7 days"
        case .thirtyDays: return "Last 30 days"
        }
    }
}

/// Range control in the navigation-tick grammar (`NavTicks`): a small
/// lit mark above the active label, dim marks above the rest, the lit
/// mark travelling between positions. Not a segmented control — it
/// should read as a dial position on the instrument, not a form field.
struct InstrumentRangeSelector: View {
    let ranges: [InstrumentRange]
    @Binding var selection: InstrumentRange
    /// LIVE is disabled (not hidden) while the band isn't streaming, so
    /// the control's shape doesn't change as the connection comes and
    /// goes.
    var liveAvailable: Bool = true

    @Namespace private var markSpace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 6) {
            ForEach(ranges) { range in
                let isActive = range == selection
                let isEnabled = range != .live || liveAvailable
                Button {
                    withAnimation(StudioMotion.resolve(StudioMotion.rangeMorph, reduceMotion: reduceMotion)) {
                        selection = range
                    }
                } label: {
                    VStack(spacing: 6) {
                        ZStack {
                            Capsule()
                                .fill(StudioColor.ink.opacity(0.18))
                                .frame(width: 12, height: 3)
                            if isActive {
                                Capsule()
                                    .fill(StudioColor.accentInk)
                                    .frame(width: 20, height: 3)
                                    .matchedGeometryEffect(id: "rangeMark", in: markSpace)
                            }
                        }
                        .frame(height: 3)
                        Text(range.rawValue)
                            .font(StudioFont.body(10, weight: isActive ? .semibold : .medium))
                            .tracking(1.2)
                            .foregroundStyle(isActive ? StudioColor.ink : StudioColor.inkSoft)
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!isEnabled)
                .opacity(isEnabled ? 1 : 0.35)
                .accessibilityLabel(range.accessibilityName)
                .accessibilityAddTraits(isActive ? .isSelected : [])
            }
        }
        .sensoryFeedback(StudioHaptic.rangeChange, trigger: selection)
    }
}

// MARK: - Metric instrument

/// A metric that behaves like an instrument rather than a static card:
/// a restrained readout at rest, and on interaction the SAME surface
/// opens in place to reveal its history, range, and context — spatial
/// continuity, not navigation to another screen.
///
/// - `readout`: the at-rest state — the current value and its signal
///   glyph. Tapping it opens the instrument too.
/// - `accessory`: a trailing control in the header (e.g. Measure Now).
/// - `detail`: revealed on expansion — typically `InstrumentHistoryChart`
///   plus any metric-specific context. Only built while expanded, so a
///   collapsed instrument costs no history subscription.
struct MetricInstrument<Readout: View, Accessory: View, Detail: View>: View {
    let title: String
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var readout: () -> Readout
    @ViewBuilder var detail: () -> Detail

    @State private var isExpanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        title: String,
        @ViewBuilder accessory: @escaping () -> Accessory,
        @ViewBuilder readout: @escaping () -> Readout,
        @ViewBuilder detail: @escaping () -> Detail
    ) {
        self.title = title
        self.accessory = accessory
        self.readout = readout
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                Button(action: toggle) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(StudioFont.body(11, weight: .semibold))
                            .tracking(1.3)
                            .foregroundStyle(StudioColor.inkSoft)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(StudioColor.inkFaint)
                            .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    }
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(title.capitalized)
                .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
                .accessibilityHint(isExpanded ? "Hides history" : "Shows history and trends")
                Spacer(minLength: 8)
                accessory()
            }

            readout()
                .contentShape(Rectangle())
                .onTapGesture(perform: toggle)

            if isExpanded {
                detail()
                    .transition(reduceMotion
                        ? .opacity
                        : .asymmetric(insertion: .opacity.combined(with: .offset(y: -6)), removal: .opacity))
            }
        }
        .studioCard()
        .overlay {
            // The instrument's "backlight": a faint border lift while
            // open, so the expanded state is visible without color.
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(StudioColor.ink.opacity(isExpanded ? 0.10 : 0), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .sensoryFeedback(trigger: isExpanded) { _, expanded in
            expanded ? StudioHaptic.expand : StudioHaptic.collapse
        }
    }

    private func toggle() {
        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) {
            isExpanded.toggle()
        }
    }
}

extension MetricInstrument where Accessory == EmptyView {
    init(
        title: String,
        @ViewBuilder readout: @escaping () -> Readout,
        @ViewBuilder detail: @escaping () -> Detail
    ) {
        self.init(title: title, accessory: { EmptyView() }, readout: readout, detail: detail)
    }
}

// MARK: - Signal glyphs
//
// Small, metric-specific marks that give each instrument its own
// physical character at rest — a pulse, a range, a field — while sharing
// the same container and interaction. Each draws only real values; with
// no value it shows an empty instrument, never a placeholder reading.

/// Heart rate as a pulse: a mark that beats at the band's reported live
/// rate. It shows the cadence of the current reading — not individual
/// heartbeats, which the band doesn't stream. Still (and hollow when
/// there's no live reading) under Reduce Motion or without a signal.
struct LivePulseMark: View {
    /// The current live BPM, or `nil` when the band isn't streaming.
    let bpm: Double?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let bpm, bpm > 0, !reduceMotion {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                    PulseFrame(phase: Self.phase(at: context.date, bpm: bpm))
                }
            } else if bpm != nil {
                Circle()
                    .fill(StudioColor.accentInk)
                    .frame(width: 7, height: 7)
            } else {
                Circle()
                    .strokeBorder(StudioColor.inkFaint, lineWidth: 1)
                    .frame(width: 7, height: 7)
            }
        }
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }

    /// Position within the current beat, 0..<1, at the reported rate.
    static func phase(at date: Date, bpm: Double) -> Double {
        let interval: Double = 60.0 / bpm
        return date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: interval) / interval
    }
}

/// One frame of `LivePulseMark`: a fast rise and long decay for the core,
/// and a ring that widens and fades across the beat.
private struct PulseFrame: View {
    let phase: Double

    private var beat: Double {
        if phase < 0.12 { return phase / 0.12 }
        let decay: Double = 1 - (phase - 0.12) / 0.45
        return max(0, decay)
    }

    var body: some View {
        let ringOpacity: Double = 0.35 * (1 - phase)
        let ringScale: CGFloat = 0.6 + phase * 0.9
        let coreScale: CGFloat = 1 + 0.4 * beat
        return ZStack {
            Circle()
                .stroke(StudioColor.accentInk.opacity(ringOpacity), lineWidth: 1)
                .scaleEffect(ringScale)
            Circle()
                .fill(StudioColor.accentInk)
                .frame(width: 7, height: 7)
                .scaleEffect(coreScale)
        }
    }
}

/// Blood pressure as a measured range: a vertical scale with the reading
/// spanning diastolic → systolic. A fixed, unlabeled scale — it shows
/// shape and position, not clinical thresholds.
struct RangeGaugeMark: View {
    let systolic: Double?
    let diastolic: Double?
    var scale: ClosedRange<Double> = 40...200

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack(alignment: .bottom) {
                Capsule()
                    .fill(StudioColor.ink.opacity(0.08))
                    .frame(width: 4)
                    .frame(maxHeight: .infinity)
                if let systolic, let diastolic {
                    let low = position(diastolic) * height
                    let high = position(systolic) * height
                    Capsule()
                        .fill(StudioColor.accentInk)
                        .frame(width: 6, height: max(6, high - low))
                        .offset(y: -low)
                }
            }
            .frame(width: geo.size.width, height: height)
        }
        .frame(width: 10, height: 64)
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: systolic)
        .accessibilityHidden(true)
    }

    private func position(_ value: Double) -> Double {
        let clamped = min(max(value, scale.lowerBound), scale.upperBound)
        return (clamped - scale.lowerBound) / (scale.upperBound - scale.lowerBound)
    }
}

/// A reading as a position in a field around the user's own baseline
/// (temperature today): the center tick is the baseline, the mark sits
/// where the current reading deviates. Without a baseline there is no
/// field to place it in, so nothing is drawn.
struct FieldDeviationMark: View {
    /// Current minus baseline, in the metric's unit.
    let deviation: Double?
    /// Deviation at the field's edge.
    var span: Double = 1.5

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack {
                Capsule()
                    .fill(LinearGradient(
                        colors: [StudioColor.ink.opacity(0.03), StudioColor.ink.opacity(0.10), StudioColor.ink.opacity(0.03)],
                        startPoint: .leading, endPoint: .trailing))
                    .frame(height: 6)
                Rectangle()
                    .fill(StudioColor.inkFaint)
                    .frame(width: 1, height: 14)
                if let deviation {
                    let clamped = min(max(deviation, -span), span)
                    Circle()
                        .fill(StudioColor.accentInk)
                        .frame(width: 9, height: 9)
                        .offset(x: CGFloat(clamped / span) * (width / 2 - 5))
                }
            }
            .frame(width: width, height: geo.size.height)
        }
        .frame(width: 120, height: 16)
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: deviation)
        .accessibilityHidden(true)
    }
}
