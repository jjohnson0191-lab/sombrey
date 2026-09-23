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

/// "SOMBREY" as an engraved faceplate legend — widely tracked Instrument
/// Sans, not a display logo — beside the mark.
struct SombreyWordmark: View {
    var score: Int?
    var color: Color = StudioColor.paper

    var body: some View {
        HStack(spacing: 9) {
            SombreyMark(score: score, color: color, size: 17)
            Text("SOMBREY")
                .font(StudioFont.body(12, weight: .semibold))
                .tracking(4.2)
                .foregroundStyle(color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sombrey")
        .accessibilityAddTraits(.isHeader)
    }
}
