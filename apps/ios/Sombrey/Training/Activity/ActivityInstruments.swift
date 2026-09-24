import SwiftUI

// The Activity Intelligence Framework's visual vocabulary — one set of
// Studio instruments every activity is composed from. What goes into them
// (which metrics, what they're called, what's said) comes from the
// activity's terms and the engine (`ActivityIntelligence`), never from
// per-sport view code.

// MARK: - Header

/// The activity's face: glyph, name, category and state, and the time — in
/// the dark Studio bezel, tinted by the activity's character.
struct ActivityHeader<Accessory: View>: View {
    enum Status: Equatable {
        case ready
        case live(connected: Bool)
        case paused
        case recorded(Date)
    }

    let activity: SombreyActivity
    let status: Status
    /// The big number: elapsed time live, the session's duration after.
    var time: String?
    var timeCaption: String?
    @ViewBuilder var accessory: Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: activity.glyph)
                    .font(.system(size: 30, weight: .regular))
                    .foregroundStyle(StudioColor.paper)
                    .frame(width: 40)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(activity.name)
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.paper)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    HStack(spacing: 6) {
                        Text(activity.categoryName.uppercased())
                        Text("·")
                        statusLabel
                    }
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(StudioColor.paperSoft)
                }
                Spacer(minLength: 0)
            }
            if let time {
                VStack(alignment: .leading, spacing: 2) {
                    Text(time)
                        .font(StudioFont.hero(64, weight: .bold))
                        .foregroundStyle(StudioColor.paper)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .contentTransition(.numericText())
                    if let timeCaption {
                        Text(timeCaption)
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                }
            }
            accessory
        }
        .instrumentBezel(tint: activity.terms.character.tint)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var statusLabel: some View {
        switch status {
        case .ready:
            Text("READY")
        case .live(let connected):
            HStack(spacing: 4) {
                Circle().fill(connected ? StudioColor.accent : StudioColor.paperFaint).frame(width: 5, height: 5)
                Text(connected ? "LIVE · BAND RECORDING" : "LIVE · BAND OUT OF RANGE")
            }
        case .paused:
            Text("PAUSED")
        case .recorded(let date):
            Text(date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()).uppercased())
        }
    }
}

// MARK: - Indicators

/// Headline indicators: large numerals, each with its source beneath. Heart
/// rate becomes a range instrument when the band recorded its range.
struct IndicatorBoard: View {
    let title: String
    let indicators: [ActivityIndicator]
    var readings: ActivityReadings? = nil
    var maxHeartRate: Double? = nil
    var large = true

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TrainEyebrow(text: title)
            if let hr = indicators.first(where: { $0.metric == .heartRate }),
               let r = readings, let avg = r.averageHeartRate, let low = r.lowestHeartRate, let peak = r.highestHeartRate {
                HeartRateRangeInstrument(label: hr.label, low: low, average: avg, peak: peak, maxHeartRate: maxHeartRate, source: hr.source)
            }
            let tiles = indicators.filter { !($0.metric == .heartRate && hasRange) }
            if !tiles.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], alignment: .leading, spacing: 18) {
                    ForEach(tiles) { indicator in
                        IndicatorTile(indicator: indicator, large: large)
                    }
                }
            }
        }
        .studioCard()
    }

    private var hasRange: Bool {
        guard let r = readings else { return false }
        return r.averageHeartRate != nil && r.lowestHeartRate != nil && r.highestHeartRate != nil
    }
}

struct IndicatorTile: View {
    let indicator: ActivityIndicator
    var large = true

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(indicator.label.uppercased())
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(indicator.value)
                    .font(StudioFont.hero(large ? 30 : 22, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText())
                if let unit = indicator.unit {
                    Text(unit)
                        .font(StudioFont.body(12, weight: .medium))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            }
            Text(indicator.detail.map { "\($0) · \(indicator.source.label)" } ?? indicator.source.label)
                .font(StudioFont.body(10))
                .foregroundStyle(StudioColor.inkFaint)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Heart-rate range

/// Lowest → average → peak on one track. With an age-based max estimate the
/// track is the zone scale itself, so the range reads as effort; without
/// one it is simply scaled to the session.
struct HeartRateRangeInstrument: View {
    let label: String
    let low: Double
    let average: Double
    let peak: Double
    let maxHeartRate: Double?
    let source: MetricSource
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false

    private var scale: (lo: Double, hi: Double) {
        if let maxHeartRate { return (maxHeartRate * 0.4, maxHeartRate) }
        return (max(0, low - 10), peak + 10)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(Int(average.rounded()))")
                    .font(StudioFont.hero(40, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("bpm avg")
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                Spacer()
                if let zone = ActivityIntensity.zone(heartRate: average, maxHeartRate: maxHeartRate) {
                    Text(zone.label)
                        .font(StudioFont.body(14, weight: .semibold))
                        .foregroundStyle(StudioColor.accentInk)
                }
            }
            GeometryReader { geo in
                let w = geo.size.width
                let x = { (v: Double) -> CGFloat in CGFloat((min(max(v, scale.lo), scale.hi) - scale.lo) / (scale.hi - scale.lo)) * w }
                ZStack(alignment: .leading) {
                    Capsule().fill(StudioColor.ink.opacity(0.08)).frame(height: 6)
                    if let maxHeartRate {
                        ForEach(ActivityIntensity.bounds, id: \.zone) { bound in
                            Rectangle()
                                .fill(StudioColor.ink.opacity(0.18))
                                .frame(width: 1, height: 10)
                                .offset(x: x(maxHeartRate * Double(bound.minPercent) / 100))
                        }
                    }
                    Capsule()
                        .fill(LinearGradient(colors: [StudioColor.accent.opacity(0.45), StudioColor.accentInk], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(6, (x(peak) - x(low)) * (drawn ? 1 : 0.2)), height: 6)
                        .offset(x: x(low))
                    Circle()
                        .fill(StudioColor.ink)
                        .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 2))
                        .frame(width: 12, height: 12)
                        .offset(x: x(average) - 6)
                        .opacity(drawn ? 1 : 0)
                }
                .frame(height: 12)
            }
            .frame(height: 12)
            HStack {
                Text("Lowest \(Int(low))")
                Spacer()
                Text("Peak \(Int(peak))")
            }
            .font(StudioFont.body(11, weight: .medium))
            .foregroundStyle(StudioColor.inkSoft)
            Text(maxHeartRate != nil ? "\(source.label) · zones estimated from your age" : source.label)
                .font(StudioFont.body(10))
                .foregroundStyle(StudioColor.inkFaint)
        }
        .onAppear {
            withAnimation(StudioMotion.resolve(StudioMotion.bloomOnce, reduceMotion: reduceMotion)) { drawn = true }
            if reduceMotion { drawn = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): average \(Int(average)) beats per minute, lowest \(Int(low)), peak \(Int(peak))")
    }
}

// MARK: - Intensity profile

/// How the session's effort was spread across the zones — the band's own
/// heart-rate series, placed on the age-estimated zone scale.
struct IntensityProfileBar: View {
    let zones: ZoneProfile
    var series: [Double] = []

    private let order = [0, 1, 2, 3, 4, 5]

    private func shade(_ zone: Int) -> Color {
        zone == 0 ? StudioColor.ink.opacity(0.1) : StudioColor.accentInk.opacity(0.2 + Double(zone) * 0.16)
    }

    private func name(_ zone: Int) -> String {
        zone == 0 ? "Below" : ActivityIntensity.bounds.first { $0.zone == zone }?.label ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if series.count >= 4 {
                HeartRateTrace(values: series)
                    .frame(height: 56)
            }
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(order.filter { zones.share($0) > 0 }, id: \.self) { zone in
                        Rectangle()
                            .fill(shade(zone))
                            .frame(width: max(2, geo.size.width * zones.share(zone) - 2))
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 10)
            let shown = order.filter { zones.share($0) >= 0.05 }
            HStack(spacing: 12) {
                ForEach(shown, id: \.self) { zone in
                    HStack(spacing: 4) {
                        Circle().fill(shade(zone)).frame(width: 7, height: 7)
                        Text(zones.minutes(zone).map { "\(name(zone)) \(Int($0.rounded())) min" } ?? "\(name(zone)) \(Int((zones.share(zone) * 100).rounded()))%")
                            .font(StudioFont.body(10, weight: .medium))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                }
            }
            Text("Band heart-rate series · zones estimated from your age")
                .font(StudioFont.body(10))
                .foregroundStyle(StudioColor.inkFaint)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Effort by zone: " + order.filter { zones.share($0) > 0 }.map { "\(name($0)) \(Int((zones.share($0) * 100).rounded())) percent" }.joined(separator: ", "))
    }
}

// MARK: - Insights

/// Sombrey's read: deterministic observations from the user's own data,
/// each with what it's based on. Nothing here is AI-generated.
struct InsightCard: View {
    let title: String
    let insights: [ActivityInsight]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            TrainEyebrow(text: title)
            ForEach(Array(insights.enumerated()), id: \.element.id) { index, insight in
                HStack(alignment: .top, spacing: 10) {
                    Capsule()
                        .fill(index == 0 ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
                        .frame(width: 3, height: 18)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(insight.text)
                            .font(StudioFont.body(14, weight: .medium))
                            .foregroundStyle(StudioColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(insight.basis)
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                .studioReveal(index: index)
            }
        }
        .studioCard()
    }
}

// MARK: - About

/// How Sombrey reads this activity, what the band can't measure for it, and
/// general recovery guidance — clearly marked as not from the user's data.
struct AboutActivityCard: View {
    let activity: SombreyActivity

    var body: some View {
        let terms = activity.terms
        VStack(alignment: .leading, spacing: 12) {
            TrainEyebrow(text: "About \(activity.name)")
            Text(terms.focus)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let note = terms.notMeasured {
                Text(note)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Recovery")
                    .font(StudioFont.body(12, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text(terms.recoveryNote)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                Text("General guidance — not from your data")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
        .studioCard()
    }
}

// MARK: - Heart-rate trace

/// A band heart-rate series drawn as one calm line — its rises and
/// recoveries, scaled to its own range. Values only; no invented points.
struct HeartRateTrace: View {
    let values: [Double]
    var tone: Color = StudioColor.accentInk
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let lo = (values.min() ?? 0) - 4
            let hi = (values.max() ?? 1) + 4
            let span = max(hi - lo, 1)
            Path { path in
                for (index, value) in values.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(max(values.count - 1, 1))
                    let y = geo.size.height * (1 - CGFloat((value - lo) / span))
                    index == 0 ? path.move(to: CGPoint(x: x, y: y)) : path.addLine(to: CGPoint(x: x, y: y))
                }
            }
            .trim(from: 0, to: drawn)
            .stroke(tone, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
        }
        .onAppear {
            if reduceMotion { drawn = 1 } else { withAnimation(StudioMotion.settleOnce) { drawn = 1 } }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Heart rate from \(Int(values.min() ?? 0)) to \(Int(values.max() ?? 0)) beats per minute")
    }
}
