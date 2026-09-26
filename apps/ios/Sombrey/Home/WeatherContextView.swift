import SwiftUI

/// Home's environmental context: one compact line — "Colombo · 28°C ·
/// Partly cloudy" — and a small condition glyph that opens the forecast in
/// place, growing out of the line itself. Context only: it never blocks
/// Home and never changes load or Strain. Every state is said plainly:
/// asking, denied (time-zone city), unavailable, failed, stale.
struct WeatherContextView: View {
    private var environment: EnvironmentService { EnvironmentService.shared }
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let dto = environment.latest.value
        let state = WeatherContextState(dto: dto, access: environment.access, isLoading: environment.latest.isLoading, error: environment.lastError)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 8) {
                Text(state.line)
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.paperFaint)
                    .lineLimit(2)
                    .accessibilityIdentifier("home.weather.line")
                if state.canExpand {
                    Button(action: toggle) {
                        Image(systemName: WeatherSymbol.name(dto?.snapshot?.conditionCode, night: dto?.snapshot?.isNight ?? false))
                            .symbolRenderingMode(.hierarchical)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(StudioColor.paper.opacity(expanded ? 0.95 : 0.7))
                            .frame(width: 44, height: 44)
                            .background {
                                Circle()
                                    .fill(StudioColor.paper.opacity(expanded ? 0.14 : 0.06))
                                    .frame(width: 30, height: 30)
                            }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(expanded ? "Hide forecast" : "Show forecast")
                    .accessibilityIdentifier("home.weather.forecastButton")
                }
            }
            .frame(minHeight: 28, alignment: .leading)
            if expanded, let snapshot = dto?.snapshot {
                WeatherForecastView(snapshot: snapshot, stale: dto?.state == "stale", attribution: dto?.attribution)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96, anchor: .topTrailing)))
            }
        }
        .sensoryFeedback(trigger: expanded) { _, open in open ? StudioHaptic.expand : StudioHaptic.collapse }
    }

    private func toggle() {
        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) { expanded.toggle() }
    }
}

/// What the context line says — from real data or an honest reason.
struct WeatherContextState: Equatable {
    let line: String
    let canExpand: Bool

    init(dto: EnvironmentDTO?, access: EnvironmentService.Access, isLoading: Bool, error: String?) {
        let city = EnvironmentService.timeZoneCity
        if access == .denied {
            self.init(line: "\(city) · Weather unavailable (location off)", canExpand: false); return
        }
        if let dto, let line = EnvironmentLine.text(dto, access: access) {
            self.init(line: line, canExpand: dto.snapshot?.forecast?.isEmpty == false || dto.snapshot != nil); return
        }
        if access == .notDetermined || (isLoading && dto == nil) {
            self.init(line: "\(city) · Weather…", canExpand: false); return
        }
        self.init(line: "\(city) · Weather unavailable\(error != nil ? " right now" : "")", canExpand: false)
    }

    private init(line: String, canExpand: Bool) {
        self.line = line
        self.canExpand = canExpand
    }
}

/// The forecast, opened from the context line: now (feels like, humidity,
/// wind, UV, rain) and the coming days — high/low, condition, precipitation
/// (chance where the provider publishes it, otherwise amount). Real data
/// only; today's high/low is marked when it covers just the hours ahead.
struct WeatherForecastView: View {
    let snapshot: EnvironmentDTO.Snapshot
    let stale: Bool
    let attribution: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let detail = EnvironmentLine.detail(EnvironmentDTO(state: "available", snapshot: snapshot, reason: nil, refreshAfterMs: 0, attribution: "")) {
                Text(detail)
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.paperSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let days = snapshot.forecast ?? []
            if days.isEmpty {
                Text("No forecast available right now.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperFaint)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
                        WeatherForecastRow(day: day, isFirst: index == 0)
                        if index < days.count - 1 {
                            Rectangle().fill(StudioColor.paper.opacity(0.08)).frame(height: 1)
                        }
                    }
                }
            }
            HStack {
                Text(updatedText)
                Spacer()
                if let attribution { Text(attribution) }
            }
            .font(StudioFont.body(9))
            .foregroundStyle(StudioColor.paperFaint)
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(StudioColor.env0.opacity(0.26))
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(StudioColor.paper.opacity(0.12), lineWidth: 1)
                }
        }
        .accessibilityIdentifier("home.weather.forecast")
    }

    private var updatedText: String {
        let fetched = Date(timeIntervalSince1970: snapshot.fetchedAt / 1000)
        return (stale ? "Last updated " : "Updated ") + fetched.formatted(.relative(presentation: .named))
    }
}

struct WeatherForecastRow: View {
    let day: EnvironmentDTO.ForecastDay
    let isFirst: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(StudioFont.body(13, weight: isFirst ? .semibold : .medium))
                .foregroundStyle(StudioColor.paper)
                .frame(width: 92, alignment: .leading)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Image(systemName: WeatherSymbol.name(day.conditionCode, night: false))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(StudioColor.paper.opacity(0.8))
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(precipitation ?? " ")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.paperFaint)
                .frame(minWidth: 44, alignment: .leading)
            Spacer(minLength: 4)
            Text("\(EnvironmentLine.temperature(day.lowC))")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.paperFaint)
                .monospacedDigit()
            Text("\(EnvironmentLine.temperature(day.highC))")
                .font(StudioFont.body(13, weight: .semibold))
                .foregroundStyle(StudioColor.paper)
                .monospacedDigit()
        }
        .frame(minHeight: 40)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(day.condition ?? "conditions unknown"), high \(EnvironmentLine.temperature(day.highC)), low \(EnvironmentLine.temperature(day.lowC))\(precipitation.map { ", \($0) rain" } ?? "")")
    }

    private var label: String {
        if day.partial == true { return "Rest of today" }
        return WeatherForecastRow.dayName(day.date)
    }

    private var precipitation: String? {
        if let p = day.precipitationProbability { return "\(Int(p))%" }
        if let mm = day.precipitationMm, mm >= 0.1 { return String(format: "%.1f mm", mm) }
        return nil
    }

    /// "Tomorrow" or the weekday, for a local day key (calendar maths only).
    static func dayName(_ key: String, now: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: key) else { return key }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInTomorrow(d) { return "Tomorrow" }
        return d.formatted(.dateTime.weekday(.wide))
    }
}

/// Sombrey condition code → SF Symbol. The only place weather becomes an icon.
enum WeatherSymbol {
    static func name(_ code: String?, night: Bool) -> String {
        switch code {
        case "clear": return night ? "moon.stars" : "sun.max"
        case "mostly_clear": return night ? "moon" : "sun.min"
        case "partly_cloudy": return night ? "cloud.moon" : "cloud.sun"
        case "cloudy": return "cloud"
        case "fog": return "cloud.fog"
        case "light_rain": return "cloud.drizzle"
        case "rain": return "cloud.rain"
        case "heavy_rain": return "cloud.heavyrain"
        case "sleet": return "cloud.sleet"
        case "snow": return "cloud.snow"
        case "thunder": return "cloud.bolt.rain"
        default: return "cloud"
        }
    }
}
