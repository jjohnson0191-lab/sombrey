import SwiftUI

// MARK: - Model

/// Pure geometry and decomposition for the readiness dial, kept apart
/// from the view so the arithmetic can be tested on its own.
enum ReadinessDial {
    /// The dial sweeps 270°, opening at the bottom — a gauge, not a ring.
    static let sweep: Double = 270
    /// Where 0 sits, in SwiftUI's clockwise-from-3-o'clock degrees.
    static let startAngle: Double = 135

    /// Band boundaries, mirrored from `convex/readiness/scoring.ts`
    /// `scoreBand()` (≥85 Highly Ready, ≥70 Ready, ≥55 Moderate, ≥40
    /// Caution). Drawn as longer ticks only — the band NAME always comes
    /// from the server's own `scoreBand`, never from these numbers.
    static let bandThresholds: [Double] = [40, 55, 70, 85]

    /// The same bands, named as `scoreBand()` names them, for the
    /// score-level scale. The CURRENT band's label always comes from the
    /// server's own `scoreBand`; these names label the rest of the scale.
    struct Band: Equatable {
        let name: String
        let lower: Int
        let upper: Int
        func contains(_ score: Int) -> Bool { score >= lower && score <= upper }
    }

    static let bands: [Band] = [
        Band(name: "Low Readiness", lower: 0, upper: 39),
        Band(name: "Caution", lower: 40, upper: 54),
        Band(name: "Moderate", lower: 55, upper: 69),
        Band(name: "Ready", lower: 70, upper: 84),
        Band(name: "Highly Ready", lower: 85, upper: 100),
    ]

    static func band(for score: Int) -> Band? {
        bands.first { $0.contains(min(max(score, 0), 100)) }
    }

    /// Fraction of a full circle (for `trim`) for a 0–100 value.
    static func trim(_ value: Double) -> CGFloat {
        CGFloat(sweep / 360 * min(max(value, 0), 100) / 100)
    }

    static func angle(_ value: Double) -> Double {
        startAngle + sweep * min(max(value, 0), 100) / 100
    }

    struct Segment: Identifiable, Equatable {
        enum Kind: Equatable { case contribution, shortfall }
        let metric: String
        let kind: Kind
        let start: Double
        let end: Double
        var id: String { "\(metric)-\(kind == .contribution ? "c" : "s")" }
    }

    /// The score as the server computes it — each scored signal's
    /// `subScore × weight`, laid end to end from 0 — followed by what each
    /// signal held back. Weights of scored signals sum to 1, so the
    /// segments tile exactly 0…100. Unscored signals have no segment.
    static func segments(_ components: [ReadinessComponent]) -> [Segment] {
        let included = components.filter(\.isIncluded)
        var cursor: Double = 0
        var result: [Segment] = []
        for component in included {
            let end = cursor + component.contribution
            result.append(Segment(metric: component.metric, kind: .contribution, start: cursor, end: end))
            cursor = end
        }
        for component in included where component.shortfall > 0 {
            let end = cursor + component.shortfall
            result.append(Segment(metric: component.metric, kind: .shortfall, start: cursor, end: end))
            cursor = end
        }
        return result
    }

    /// One readiness per calendar day: `getHistory` can return several
    /// recomputations of the same date, newest first — keep the newest.
    static func dailyScores(_ rows: [ReadinessResultDTO]) -> [String: Double?] {
        var byDate: [String: Double?] = [:]
        for row in rows where byDate[row.date] == nil {
            byDate[row.date] = row.score
        }
        return byDate
    }
}

// MARK: - Gauge

/// Readiness as a precision gauge — Home's dominant instrument. At rest
/// the dial settles into the server's score with its band and confidence;
/// opened, the SAME dial separates into what each real signal added and
/// held back, linked to a line per signal, with the last 14 days of real
/// scores beneath. Nothing here computes readiness: every number is the
/// server's (`convex/readiness/scoring.ts`, unchanged).
struct ReadinessGauge: View {
    let result: ReadinessResult?
    var isLoading: Bool = false

    @State private var isExpanded = false
    @State private var settled = false
    @State private var focusedMetric: String?
    @State private var history = ConvexQuery<[ReadinessResultDTO]>()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var score: Int? { result?.score }
    private var components: [ReadinessComponent] { result?.components ?? [] }
    private var includedCount: Int { components.filter(\.isIncluded).count }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Button(action: toggle) {
                HStack(alignment: .center, spacing: 16) {
                    if !isExpanded {
                        summary
                            .transition(.opacity)
                    }
                    Spacer(minLength: 0)
                    dial
                    if isExpanded { Spacer(minLength: 0) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilitySummary)
            .accessibilityHint(isExpanded ? "Closes the readiness detail" : "Shows what contributes to this score")

            if isExpanded {
                detail
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -8)))
            }
        }
        .onAppear(perform: settle)
        .sensoryFeedback(trigger: isExpanded) { _, expanded in
            expanded ? StudioHaptic.expand : StudioHaptic.collapse
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: focusedMetric)
    }

    // MARK: Summary (at rest)

    private var summary: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text("SOMBREY SCORE")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.paper)
                // Says exactly what the number is: the readiness score.
                Text("Readiness · 0–100")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.paperFaint)
            }
            .padding(.bottom, 4)
            if let result, score != nil {
                if let band = result.scoreBand {
                    Text(band.uppercased())
                        .font(StudioFont.body(15, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(StudioColor.paper)
                }
                Text("\(result.confidenceBand) confidence")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperSoft)
                Text(basisText)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperFaint)
            } else {
                Text(isLoading ? "Reading…" : emptyText)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperFaint)
                    .frame(maxWidth: 170, alignment: .leading)
            }
            HStack(spacing: 4) {
                Text("EXAMINE")
                    .font(StudioFont.body(9, weight: .semibold))
                    .tracking(1.2)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
            }
            .foregroundStyle(StudioColor.paperFaint)
            .padding(.top, 4)
        }
    }

    private var emptyText: String {
        result == nil ? "No readiness calculated yet." : "Still collecting data — check back soon."
    }

    /// Names the real signals behind the score, e.g. "Based on sleep".
    private var basisText: String {
        let names = components.filter(\.isIncluded).map { $0.displayName.lowercased() }
        if names.isEmpty { return "" }
        if names.count == 1 { return "Based on \(names[0]) · 1 of \(components.count) signals" }
        return "Based on \(names.count) of \(components.count) signals"
    }

    // MARK: Dial

    private var dialSize: CGFloat { isExpanded ? 232 : 168 }

    private var dial: some View {
        ZStack {
            DialTicks(tone: .paper)
            // Track.
            Circle()
                .trim(from: 0, to: ReadinessDial.trim(100))
                .stroke(StudioColor.paper.opacity(0.12), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(ReadinessDial.startAngle))
                .padding(14)
            if let score {
                if isExpanded {
                    ForEach(ReadinessDial.segments(components)) { segment in
                        segmentArc(segment)
                    }
                } else {
                    Circle()
                        .trim(from: 0, to: settled ? ReadinessDial.trim(Double(score)) : 0)
                        .stroke(StudioColor.paper, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(ReadinessDial.startAngle))
                        .padding(14)
                        .transition(.opacity)
                    // The instrument's indicator: settles at the score.
                    Circle()
                        .fill(StudioColor.accentInkDark)
                        .frame(width: 8, height: 8)
                        .offset(x: (dialSize - 28) / 2)
                        .rotationEffect(.degrees(ReadinessDial.angle(settled ? Double(score) : 0)))
                        .transition(.opacity)
                }
                // Confidence: a quiet inner arc, as before — data
                // sufficiency, not accuracy.
                Circle()
                    .trim(from: 0, to: ReadinessDial.trim((result?.confidence ?? 0) * 100))
                    .stroke(StudioColor.paper.opacity(0.28), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .rotationEffect(.degrees(ReadinessDial.startAngle))
                    .padding(isExpanded ? 34 : 28)
            }
            VStack(spacing: 2) {
                if isExpanded {
                    Text("SOMBREY SCORE")
                        .font(StudioFont.body(8, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(StudioColor.paperSoft)
                }
                if let score {
                    HeroNumberText(text: "\(score)", size: .md, tone: .paper)
                    if let band = result?.scoreBand, isExpanded {
                        Text(band.uppercased())
                            .font(StudioFont.body(10, weight: .semibold))
                            .tracking(1.3)
                            .foregroundStyle(StudioColor.paperSoft)
                    }
                } else {
                    Text("—")
                        .font(StudioFont.hero(44, weight: .bold))
                        .foregroundStyle(StudioColor.paperFaint)
                }
            }
        }
        .frame(width: dialSize, height: dialSize)
    }

    private func segmentArc(_ segment: ReadinessDial.Segment) -> some View {
        // A hair of space between segments so they read as parts.
        let inset: Double = segment.end - segment.start > 2 ? 0.5 : 0
        let from = ReadinessDial.trim(segment.start + inset)
        let to = ReadinessDial.trim(segment.end - inset)
        let isShortfall = segment.kind == .shortfall
        let style = isShortfall
            ? StrokeStyle(lineWidth: 10, lineCap: .butt, dash: [1.5, 3])
            : StrokeStyle(lineWidth: 10, lineCap: .butt)
        return Circle()
            .trim(from: from, to: to)
            .stroke(segmentColor(segment), style: style)
            .rotationEffect(.degrees(ReadinessDial.startAngle))
            .padding(14)
            .transition(.opacity)
    }

    private func segmentColor(_ segment: ReadinessDial.Segment) -> Color {
        let index = Double(ReadinessComponent.order.firstIndex(of: segment.metric) ?? 0)
        if let focusedMetric {
            if focusedMetric != segment.metric { return StudioColor.paper.opacity(0.14) }
            return segment.kind == .contribution ? StudioColor.accentInkDark : StudioColor.accentInkDark.opacity(0.5)
        }
        if segment.kind == .shortfall { return StudioColor.paper.opacity(0.22) }
        return StudioColor.paper.opacity(1 - index * 0.2)
    }

    // MARK: Detail (opened)

    private var detail: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let result {
                if let score = result.score {
                    ReadinessBandScale(score: score, serverBand: result.scoreBand)
                }
                VStack(spacing: 0) {
                    ForEach(components) { component in
                        contributorLine(component)
                        if component.id != components.last?.id {
                            Rectangle()
                                .fill(StudioColor.paper.opacity(0.08))
                                .frame(height: 1)
                        }
                    }
                }
                if let score = result.score {
                    Text("\(score) is the sum of each scored signal × its share. Dashed arcs are what each signal held back.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.paperFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("\(Int((result.confidence * 100).rounded()))% confidence (\(result.confidenceBand)) — how much data the score rests on, not how accurate it is.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.paperFaint)
                    .fixedSize(horizontal: false, vertical: true)
                historyStrip
                Text("\(result.algorithmVersion) · calculated \(result.calculatedAt.formatted(.dateTime.hour().minute())) · not a medical measurement")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.paperFaint)
            } else {
                Text("Readiness is calculated once the band has synced sleep or heart-rate data.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperFaint)
            }
        }
        .task { history.subscribe(to: "readiness:getHistory", with: ["limit": 60.0]) }
    }

    private func contributorLine(_ component: ReadinessComponent) -> some View {
        let isFocused = focusedMetric == component.metric
        return Button {
            guard component.isIncluded else { return }
            focusedMetric = isFocused ? nil : component.metric
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    swatch(component)
                    Text(component.displayName)
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(component.isIncluded ? StudioColor.paper : StudioColor.paperFaint)
                    Spacer(minLength: 8)
                    if let subScore = component.subScore, component.isIncluded {
                        Text("\(Int(subScore.rounded())) × \(Int((component.weight * 100).rounded()))%")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.paperSoft)
                            .monospacedDigit()
                        Text(String(format: "+%.1f", component.contribution))
                            .font(StudioFont.body(13, weight: .semibold))
                            .foregroundStyle(isFocused ? StudioColor.accentInkDark : StudioColor.paper)
                            .monospacedDigit()
                    } else {
                        Text("NOT SCORED")
                            .font(StudioFont.body(9, weight: .semibold))
                            .tracking(1.1)
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                }
                if isFocused || !component.isIncluded {
                    Text(component.description)
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.paperFaint)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 24)
                }
            }
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: focusedMetric)
        .accessibilityElement(children: .combine)
        .accessibilityHint(component.isIncluded ? "Highlights this signal on the dial" : "")
    }

    private func swatch(_ component: ReadinessComponent) -> some View {
        let index = Double(ReadinessComponent.order.firstIndex(of: component.metric) ?? 0)
        return Capsule()
            .strokeBorder(StudioColor.paperFaint, lineWidth: component.isIncluded ? 0 : 1)
            .background(Capsule().fill(component.isIncluded ? StudioColor.paper.opacity(1 - index * 0.2) : .clear))
            .frame(width: 14, height: 4)
    }

    // MARK: History

    /// The last 14 calendar days: a mark at each real score, a hollow
    /// tick for a day without one — never an interpolated line.
    private var historyStrip: some View {
        let scores = ReadinessDial.dailyScores(history.value ?? [])
        let days = Self.lastDays(14)
        return VStack(alignment: .leading, spacing: 6) {
            Text("LAST 14 DAYS")
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(StudioColor.paperSoft)
            HStack(alignment: .bottom, spacing: 0) {
                ForEach(days, id: \.self) { day in
                    let value: Double? = scores[day] ?? nil
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                        if let value {
                            Circle()
                                .fill(day == days.last ? StudioColor.accentInkDark : StudioColor.paper)
                                .frame(width: 5, height: 5)
                                .offset(y: -CGFloat(value / 100) * 34)
                        } else {
                            Capsule()
                                .fill(StudioColor.paper.opacity(0.15))
                                .frame(width: 1, height: 5)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                Rectangle().fill(StudioColor.paper.opacity(0.08)).frame(height: 1)
            }
            if history.value != nil && scores.isEmpty {
                Text("No earlier scores yet.")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.paperFaint)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Readiness history, \(scores.values.compactMap { $0 }.count) scored days in the last 14")
    }

    /// "yyyy-MM-dd" for the last `count` days, oldest first — the same
    /// UTC day key `readiness:computeAndStore` writes (see
    /// `WearableManager.triggerReadinessRecompute`).
    static func lastDays(_ count: Int, now: Date = Date()) -> [String] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return (0..<count).reversed().compactMap { offset in
            calendar.date(byAdding: .day, value: -offset, to: now).map { formatter.string(from: $0) }
        }
    }

    // MARK: Behaviour

    private func settle() {
        guard !settled else { return }
        if let animation = StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion) {
            withAnimation(animation.delay(0.2)) { settled = true }
        } else {
            settled = true
        }
    }

    private func toggle() {
        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) {
            isExpanded.toggle()
            if !isExpanded { focusedMetric = nil }
        }
    }

    private var accessibilitySummary: String {
        guard let result, let score else { return "Sombrey Score, readiness. \(isLoading ? "Loading" : emptyText)" }
        return "Sombrey Score, readiness \(score) out of 100, \(result.scoreBand ?? ""), \(result.confidenceBand) confidence. \(basisText)"
    }
}

/// The gauge's scale: a fine tick every 5 points, longer ticks at the
/// band boundaries and the ends. Static — drawn once.
private struct DialTicks: View {
    enum Tone { case paper, ink }
    let tone: Tone

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let outer = min(size.width, size.height) / 2
            let color = tone == .paper ? StudioColor.paper : StudioColor.ink
            for step in 0...20 {
                let value = Double(step * 5)
                let isMajor = ReadinessDial.bandThresholds.contains(value) || value == 0 || value == 100
                let length: CGFloat = isMajor ? 7 : 3
                let radians = ReadinessDial.angle(value) * .pi / 180
                let direction = CGPoint(x: cos(radians), y: sin(radians))
                var path = Path()
                path.move(to: CGPoint(x: center.x + direction.x * (outer - length), y: center.y + direction.y * (outer - length)))
                path.addLine(to: CGPoint(x: center.x + direction.x * outer, y: center.y + direction.y * outer))
                context.stroke(path, with: .color(color.opacity(isMajor ? 0.45 : 0.2)), lineWidth: 1)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Score level: where the score sits on Sombrey's 0–100 readiness range,
/// read like a ruled instrument scale rather than a progress bar — a
/// tick every 5, the band boundaries as numbered divisions, the five
/// bands as segments (only the score's own band lit), and a marker at
/// the exact score. The band name shown is the server's own.
struct ReadinessBandScale: View {
    let score: Int
    let serverBand: String?

    @State private var placed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var clamped: Int { min(max(score, 0), 100) }
    private var currentBand: ReadinessDial.Band? { ReadinessDial.band(for: score) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("SCORE LEVEL")
                    .font(StudioFont.body(9, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(StudioColor.paperSoft)
                Spacer()
                if let band = currentBand {
                    Text("\((serverBand ?? band.name).uppercased()) · \(band.lower)–\(band.upper)")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.paper)
                }
            }
            GeometryReader { geo in
                let width = geo.size.width
                ZStack(alignment: .topLeading) {
                    ScaleTicks()
                        .frame(width: width, height: 6)
                    ForEach(ReadinessDial.bands, id: \.lower) { band in
                        segment(band, width: width)
                    }
                    marker(width: width)
                    ForEach([0, 40, 55, 70, 85, 100], id: \.self) { value in
                        Text("\(value)")
                            .font(StudioFont.body(8))
                            .foregroundStyle(StudioColor.paperFaint)
                            .monospacedDigit()
                            .fixedSize()
                            .position(x: min(max(x(Double(value), width: width), 6), width - 8), y: 30)
                    }
                }
            }
            .frame(height: 36)
        }
        .onAppear {
            if let animation = StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion) {
                withAnimation(animation.delay(0.15)) { placed = true }
            } else {
                placed = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private func x(_ value: Double, width: CGFloat) -> CGFloat {
        CGFloat(value / 100) * width
    }

    private func segment(_ band: ReadinessDial.Band, width: CGFloat) -> some View {
        let start = x(Double(band.lower), width: width)
        let end = x(Double(band.upper == 100 ? 100 : band.upper + 1), width: width)
        let isCurrent = band == currentBand
        return RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(isCurrent ? StudioColor.paper : StudioColor.paper.opacity(0.16))
            .frame(width: max(end - start - 2, 2), height: isCurrent ? 6 : 4)
            .offset(x: start + 1, y: isCurrent ? 9 : 10)
    }

    private func marker(width: CGFloat) -> some View {
        let position = x(Double(placed ? clamped : 0), width: width)
        return VStack(spacing: 2) {
            Text("\(clamped)")
                .font(StudioFont.body(9, weight: .semibold))
                .foregroundStyle(StudioColor.accentInkDark)
                .monospacedDigit()
                .fixedSize()
            Rectangle()
                .fill(StudioColor.accentInkDark)
                .frame(width: 2, height: 12)
        }
        .position(x: position, y: 4)
    }

    private var accessibilityText: String {
        let bands = ReadinessDial.bands.map { "\($0.name) \($0.lower) to \($0.upper)" }.joined(separator: ", ")
        let current = currentBand.map { " in the \(serverBand ?? $0.name) band, \($0.lower) to \($0.upper)" } ?? ""
        return "Score level: \(clamped) out of 100\(current). Bands: \(bands)."
    }
}

/// Fine ruling for the score-level scale: a tick every 5 points.
private struct ScaleTicks: View {
    var body: some View {
        Canvas { context, size in
            for step in 0...20 {
                let x = size.width * CGFloat(step) / 20
                let isDivision = [0, 8, 11, 14, 17, 20].contains(step)
                var path = Path()
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: isDivision ? 6 : 3))
                context.stroke(path, with: .color(StudioColor.paper.opacity(isDivision ? 0.45 : 0.18)), lineWidth: 1)
            }
        }
        .accessibilityHidden(true)
    }
}
