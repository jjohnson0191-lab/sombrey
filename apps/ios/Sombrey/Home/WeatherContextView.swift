import SwiftUI

/// Home's environmental context: one compact line — "Colombo · 28°C ·
/// Partly cloudy" — and a small condition glyph that opens TODAY's hourly
/// forecast in place, growing out of the line itself. Context only: it never blocks
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
                    .accessibilityLabel(expanded ? "Hide today's forecast" : "Show today's hourly forecast")
                    .accessibilityIdentifier("home.weather.forecastButton")
                }
            }
            .frame(minHeight: 28, alignment: .leading)
            if expanded, let snapshot = dto?.snapshot {
                WeatherTodayView(snapshot: snapshot, stale: dto?.state == "stale", attribution: dto?.attribution)
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
            self.init(line: line, canExpand: dto.snapshot != nil); return
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

/// Today, hour by hour — opened from the weather glyph. The hours still
/// ahead today (in the device's time zone), NOW marked with the Studio glass
/// key; tap an hour for its detail. Real forecast hours only: a gap in the
/// provider's data stays a gap. The multi-day forecast is not shown here.
struct WeatherTodayView: View {
    let snapshot: EnvironmentDTO.Snapshot
    let stale: Bool
    let attribution: String?
    @State private var selected: Double?

    var body: some View {
        TimelineView(.everyMinute) { context in
            let hours = TodayHours.visible(snapshot.hourly ?? [], now: context.date, timeZone: .current)
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("TODAY")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.8)
                        .foregroundStyle(StudioColor.paper)
                    Spacer()
                    if let detail = EnvironmentLine.detail(EnvironmentDTO(state: "available", snapshot: snapshot, reason: nil, refreshAfterMs: 0, attribution: "")) {
                        Text(detail)
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.paperFaint)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                if hours.isEmpty {
                    Text(snapshot.hourly == nil ? "Hourly forecast arrives with the next weather update." : "No more forecast hours for today.")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.paperFaint)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(hours) { hour in
                                let isNow = TodayHours.isNow(hour, now: context.date)
                                Button { selected = hour.time } label: {
                                    WeatherHourCell(hour: hour, label: TodayHours.label(hour, now: context.date, timeZone: .current), isNow: isNow, isSelected: (selected ?? hours.first?.time) == hour.time)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .primaryNavigationExclusion()
                    .sensoryFeedback(StudioHaptic.scrubStep, trigger: selected)
                    if let hour = hours.first(where: { $0.time == (selected ?? hours.first?.time) }) {
                        Text(TodayHours.detail(hour, now: context.date, timeZone: .current))
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.paperSoft)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("home.weather.hourDetail")
                    }
                }
                HStack {
                    Text((stale ? "Last updated " : "Updated ") + Date(timeIntervalSince1970: snapshot.fetchedAt / 1000).formatted(.relative(presentation: .named)))
                    Spacer()
                    if let attribution { Text(attribution) }
                }
                .font(StudioFont.body(9))
                .foregroundStyle(StudioColor.paperFaint)
            }
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
        .accessibilityIdentifier("home.weather.today")
    }
}

/// One hour: time, condition glyph, temperature, rain chance (or amount).
struct WeatherHourCell: View {
    let hour: EnvironmentDTO.ForecastHour
    let label: String
    let isNow: Bool
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 6) {
            Text(label)
                .font(StudioFont.body(11, weight: isNow ? .semibold : .medium))
                .foregroundStyle(isNow ? StudioColor.paper : StudioColor.paperSoft)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Image(systemName: WeatherSymbol.name(hour.conditionCode, night: hour.isNight ?? false))
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: 16))
                .foregroundStyle(StudioColor.paper.opacity(0.85))
                .frame(height: 20)
                .accessibilityHidden(true)
            Text(EnvironmentLine.temperature(hour.temperatureC))
                .font(StudioFont.hero(16, weight: .semibold))
                .foregroundStyle(StudioColor.paper)
                .monospacedDigit()
            Text(TodayHours.rain(hour) ?? " ")
                .font(StudioFont.body(9, weight: .medium))
                .foregroundStyle(StudioColor.paperFaint)
        }
        .frame(width: 58)
        .padding(.vertical, 10)
        .background {
            if isNow || isSelected {
                // The Studio glass key — NOW always; the chosen hour faintly.
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(StudioColor.paper.opacity(isNow ? 0.14 : 0.07))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(StudioColor.paper.opacity(isNow ? 0.28 : 0.12), lineWidth: 0.5)
                    }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(WeatherSymbol.phrase(hour.conditionCode) ?? "conditions unknown"), \(EnvironmentLine.temperature(hour.temperatureC))\(TodayHours.rain(hour).map { ", rain \($0)" } ?? "")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Pure rules for today's hours — which to show, which is NOW, and how they
/// read, always in the given (device) time zone.
enum TodayHours {
    /// Hours not yet over and on the device's local today, in order.
    static func visible(_ hours: [EnvironmentDTO.ForecastHour], now: Date, timeZone: TimeZone) -> [EnvironmentDTO.ForecastHour] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return hours
            .filter { $0.date.addingTimeInterval(3600) > now && cal.isDate($0.date, inSameDayAs: now) }
            .sorted { $0.time < $1.time }
    }

    static func isNow(_ hour: EnvironmentDTO.ForecastHour, now: Date) -> Bool {
        hour.date <= now && now < hour.date.addingTimeInterval(3600)
    }

    /// "Now", or the local time — with minutes when the provider's hours
    /// don't start on the hour (e.g. 6:30 PM in Colombo, UTC+5:30).
    static func label(_ hour: EnvironmentDTO.ForecastHour, now: Date, timeZone: TimeZone, locale: Locale = .autoupdatingCurrent) -> String {
        if isNow(hour, now: now) { return "Now" }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let minute = cal.component(.minute, from: hour.date)
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        f.setLocalizedDateFormatFromTemplate(minute == 0 ? "j" : "jmm")
        return f.string(from: hour.date)
    }

    static func rain(_ hour: EnvironmentDTO.ForecastHour) -> String? {
        if let p = hour.precipitationProbability { return "\(Int(p.rounded()))%" }
        if let mm = hour.precipitationMm, mm >= 0.1 { return String(format: "%.1f mm", mm) }
        return nil
    }

    /// The selected hour's detail line — only what the provider gave.
    static func detail(_ hour: EnvironmentDTO.ForecastHour, now: Date, timeZone: TimeZone) -> String {
        var parts = [label(hour, now: now, timeZone: timeZone)]
        if let phrase = WeatherSymbol.phrase(hour.conditionCode) { parts.append(phrase) }
        parts.append(EnvironmentLine.temperature(hour.temperatureC))
        if let p = hour.precipitationProbability { parts.append("\(Int(p.rounded()))% chance of rain") }
        else if let mm = hour.precipitationMm { parts.append(mm >= 0.1 ? String(format: "Rain %.1f mm", mm) : "No rain") }
        if let w = hour.windMs { parts.append("Wind \(Int(w.rounded())) m/s") }
        if let h = hour.humidityPct { parts.append("Humidity \(Int(h.rounded()))%") }
        return parts.joined(separator: " · ")
    }
}

/// Sombrey condition code → SF Symbol. The only place weather becomes an icon.
enum WeatherSymbol {
    /// The condition in words (hourly entries carry only the code).
    static func phrase(_ code: String?) -> String? {
        switch code {
        case "clear": return "Clear"
        case "mostly_clear": return "Mostly clear"
        case "partly_cloudy": return "Partly cloudy"
        case "cloudy": return "Cloudy"
        case "fog": return "Fog"
        case "light_rain": return "Light rain"
        case "rain": return "Rain"
        case "heavy_rain": return "Heavy rain"
        case "sleet": return "Sleet"
        case "snow": return "Snow"
        case "thunder": return "Thunderstorms"
        default: return nil
        }
    }

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
