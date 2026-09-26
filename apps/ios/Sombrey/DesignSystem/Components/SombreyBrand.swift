import SwiftUI

// MARK: - Time of day

/// The part of the day for a greeting, from the device's own local clock.
/// Boundaries are fixed and shared everywhere: morning 05:00–11:59,
/// afternoon 12:00–16:59, evening 17:00–04:59 (late night reads as
/// evening — "good night" is a farewell, not a greeting).
enum DayPart: Equatable {
    case morning, afternoon, evening

    init(hour: Int) {
        switch hour {
        case 5..<12: self = .morning
        case 12..<17: self = .afternoon
        default: self = .evening
        }
    }

    /// Always resolved in the device's CURRENT time zone, so travelling
    /// or a manual time-zone change is reflected on the next render.
    init(date: Date, calendar: Calendar = .autoupdatingCurrent) {
        self.init(hour: calendar.component(.hour, from: date))
    }

    var greeting: String {
        switch self {
        case .morning: return "Good morning"
        case .afternoon: return "Good afternoon"
        case .evening: return "Good evening"
        }
    }
}

/// The instrument clock's text, split so the digits can carry the weight
/// and the day period (AM/PM) can sit small beside them. Honors the
/// user's 12/24-hour setting and locale; `period` is nil on a 24-hour
/// clock.
struct InstrumentClockText: Equatable {
    let digits: String
    let period: String?

    init(date: Date, locale: Locale = .autoupdatingCurrent, timeZone: TimeZone = .autoupdatingCurrent) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        calendar.timeZone = timeZone
        let hour = calendar.component(.hour, from: date)
        let minute = calendar.component(.minute, from: date)
        if Self.usesTwelveHourClock(locale) {
            let hour12 = hour % 12 == 0 ? 12 : hour % 12
            digits = String(format: "%d:%02d", hour12, minute)
            period = hour < 12 ? calendar.amSymbol : calendar.pmSymbol
        } else {
            digits = String(format: "%02d:%02d", hour, minute)
            period = nil
        }
    }

    /// Whether the locale's own short time pattern has an AM/PM field
    /// (quoted literals removed first — e.g. French "HH 'h' mm" is a
    /// 24-hour clock despite the literal "h"). Also reflects the user's
    /// 12/24-hour override, which iOS folds into the current locale.
    static func usesTwelveHourClock(_ locale: Locale) -> Bool {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        let pattern = formatter.dateFormat ?? ""
        let unquoted = pattern.replacingOccurrences(of: "'[^']*'", with: "", options: .regularExpression)
        return unquoted.contains("a")
    }
}

// MARK: - Mark

/// The Sombrey mark: a miniature of the Sombrey Score gauge — the same
/// 270° opening dial — so the brand and the product's central instrument
/// are one shape. When a real score exists, the mark's indicator sits at
/// that score; without one, the indicator is hollow at the dial's origin.
/// Never animated on its own.
struct SombreyMark: View {
    /// The current Sombrey Score (the readiness score), if there is one.
    var score: Int?
    var color: Color = StudioColor.paper
    var size: CGFloat = 18

    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0, to: 0.75)
                .stroke(color.opacity(0.55), style: StrokeStyle(lineWidth: size * 0.09, lineCap: .round))
                .rotationEffect(.degrees(135))
            let angle = 135 + 270 * Double(min(max(score ?? 0, 0), 100)) / 100
            Group {
                if score != nil {
                    Circle().fill(StudioColor.accentInkDark)
                } else {
                    Circle().strokeBorder(color.opacity(0.55), lineWidth: 1)
                }
            }
            .frame(width: size * 0.3, height: size * 0.3)
            .offset(x: size / 2)
            .rotationEffect(.degrees(angle))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The Sombrey logo — the mark (a miniature of the Sombrey Score dial) and
/// the wordmark in the brand face, Bricolage Grotesque Bold (`StudioFont.hero`),
/// the same face as Sign In and Band Pairing. There is no separate logo asset;
/// this IS the logo, rendered from the bundled font.
///
/// It sits in each primary screen's own header (scrolling away with it where
/// the header does), lit like a physical object:
///   base      the logo in paper (on dark) or ink (on light), lit from above;
///   edge      a hairline highlight on the upper edges (depth, not extrusion);
///   light     a narrow conic band of white, MASKED to the letterforms and the
///             dial, turning a full 360° around the logo's centre every 14 s;
///   bloom     the same light, softly blurred at low opacity.
/// The angle is computed from absolute time, not animation state, so the loop
/// is seamless (360° ≡ 0°, no restart point), identical on every tab, and
/// never restarts when screens change. It only renders frames while the logo
/// is on screen and the app is active; Reduce Motion holds the light still at
/// the top-left (same layers, no layout change).
struct SombreyLogo: View {
    enum Size { case home, header }
    enum Tone { case onDark, onLight }

    /// The Sombrey Score for the mark's indicator (Home only); nil = hollow.
    var score: Int? = nil
    var size: Size = .header
    var tone: Tone = .onLight

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var onScreen = false

    /// One full revolution of the light, in seconds.
    static let period: TimeInterval = 14
    /// The light's resting angle under Reduce Motion (upper-left).
    static let restingAngle: Double = 225

    /// The light's angle at an instant — continuous in time, periodic in 360°.
    static func angle(at date: Date) -> Double {
        let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period)
        return t / period * 360
    }

    private var animating: Bool { onScreen && scenePhase == .active && !reduceMotion }

    var body: some View {
        glyph(color: baseColor)
            .overlay { edge }
            .overlay { light }
            .background { bloom }
            .onAppear { onScreen = true }
            .onDisappear { onScreen = false }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Sombrey")
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("sombrey.logo")
    }

    // MARK: Layers

    private var metrics: (text: CGFloat, mark: CGFloat, spacing: CGFloat) {
        switch size {
        case .home: return (21, 18, 9)
        case .header: return (15, 13, 7)
        }
    }

    private var baseColor: Color { tone == .onDark ? StudioColor.paper.opacity(0.86) : StudioColor.ink.opacity(0.88) }
    private var lightPeak: Double { tone == .onDark ? 0.95 : 0.7 }

    private func glyph(color: Color) -> some View {
        HStack(spacing: metrics.spacing) {
            SombreyMark(score: score, color: color, size: metrics.mark)
            Text("Sombrey")
                .font(StudioFont.hero(metrics.text, weight: .bold))
                .foregroundStyle(color)
                .fixedSize()
        }
    }

    /// The logo itself as an alpha mask.
    private var mask: some View { glyph(color: .black) }

    /// Static top-edge highlight — the logo catching the room's light.
    private var edge: some View {
        LinearGradient(colors: [Color.white.opacity(tone == .onDark ? 0.45 : 0.28), .clear], startPoint: .top, endPoint: .center)
            .mask(mask.offset(y: -0.6))
            .mask(mask)
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private var light: some View {
        if animating {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animating)) { context in
                band(angle: Self.angle(at: context.date)).mask(mask)
            }
            .allowsHitTesting(false)
        } else {
            band(angle: reduceMotion ? Self.restingAngle : Self.angle(at: Date())).mask(mask).allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private var bloom: some View {
        if animating {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animating)) { context in
                band(angle: Self.angle(at: context.date)).mask(mask).blur(radius: 5).opacity(0.35)
            }
            .allowsHitTesting(false)
        } else {
            band(angle: reduceMotion ? Self.restingAngle : Self.angle(at: Date())).mask(mask).blur(radius: 5).opacity(0.35).allowsHitTesting(false)
        }
    }

    /// A narrow wedge of light turning around the logo's centre.
    private func band(angle: Double) -> some View {
        AngularGradient(
            gradient: Gradient(stops: [
                .init(color: .white.opacity(0), location: 0),
                .init(color: .white.opacity(0), location: 0.42),
                .init(color: .white.opacity(lightPeak), location: 0.5),
                .init(color: .white.opacity(0), location: 0.58),
                .init(color: .white.opacity(0), location: 1),
            ]),
            center: .center,
            angle: .degrees(angle)
        )
    }
}
