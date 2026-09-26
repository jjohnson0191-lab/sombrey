import Foundation
import Observation
import ConvexMobile
// @preconcurrency: CLLocationManager predates Swift concurrency auditing
// (same rationale as GPSTracker).
@preconcurrency import CoreLocation

/// `environment:latest` — current weather context, or an honest reason
/// it's unavailable (convex/environment.ts).
struct EnvironmentDTO: Decodable, Equatable {
    struct Snapshot: Decodable, Equatable {
        let observedAt: Double
        let fetchedAt: Double
        let timeZone: String
        let locality: String?
        let temperatureC: Double?
        let feelsLikeC: Double?
        let humidityPct: Double?
        let windMs: Double?
        let uvIndex: Double?
        let precipitationMm: Double?
        let condition: String?
        /// Sombrey's neutral condition code (never a provider symbol).
        let conditionCode: String?
        let isNight: Bool?
        let forecast: [ForecastDay]?
    }
    struct ForecastDay: Decodable, Equatable, Identifiable {
        let date: String
        let highC: Double
        let lowC: Double
        let condition: String?
        let conditionCode: String?
        let precipitationMm: Double?
        /// Only where the provider publishes it.
        let precipitationProbability: Double?
        /// Today: high/low cover only the hours still ahead.
        let partial: Bool?
        var id: String { date }
    }
    let state: String           // "available" | "stale" | "unavailable"
    let snapshot: Snapshot?
    let reason: String?
    let refreshAfterMs: Double
    let attribution: String
}

private struct EnvironmentRefreshResult: Decodable {
    let ok: Bool
    let reason: String?
}

/// Weather context for Home and for the sessions the user records.
///
/// Privacy: location is asked for "when in use" at REDUCED accuracy (a
/// ~km area, never a precise fix), one reading at a time, at most every
/// 30 minutes while Sombrey is open. The reading goes only to Sombrey's
/// server, which rounds it to ~1 km, asks the weather provider, and
/// discards it — no coordinates are stored anywhere, on the phone or the
/// server. The place name comes from the phone's own reverse geocoding.
///
/// Also reports the phone's IANA time zone: Sombrey owns the time zone,
/// the band never decides it.
@Observable
@MainActor
final class EnvironmentService {
    static let shared = EnvironmentService()

    enum Access: Equatable { case notDetermined, denied, allowed }

    private(set) var access: Access = .notDetermined
    private(set) var lastError: String?
    let latest = ConvexQuery<EnvironmentDTO>()

    private let manager = CLLocationManager()
    private let delegate = LocationDelegate()
    private var lastRefresh: Date?
    private var refreshing = false
    private var subscribed = false
    private static let refreshInterval: TimeInterval = 30 * 60

    private init() {
        delegate.onAuthorization = { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                self.access = Self.access(for: status)
                self.refreshIfDue()
            }
        }
        delegate.onLocation = { [weak self] location in
            Task { @MainActor in await self?.send(location) }
        }
        delegate.onFailure = { [weak self] message in
            Task { @MainActor in
                self?.lastError = message
                self?.refreshing = false
            }
        }
        manager.delegate = delegate
        manager.desiredAccuracy = kCLLocationAccuracyReduced
        access = Self.access(for: manager.authorizationStatus)
    }

    /// Home calls this when it appears and when the app returns to the
    /// foreground.
    func start() {
        reportTimeZone()
        if !subscribed {
            subscribed = true
            latest.subscribe(to: "environment:latest")
        }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        default:
            access = Self.access(for: manager.authorizationStatus)
            refreshIfDue()
        }
    }

    func refreshIfDue(force: Bool = false) {
        guard access == .allowed, !refreshing else { return }
        if !force, let last = lastRefresh, Date().timeIntervalSince(last) < Self.refreshInterval { return }
        refreshing = true
        manager.requestLocation()
    }

    /// Keeps the conditions a finished session happened in (a copy of the
    /// current snapshot, when recent). Context only — never a load input.
    func captureForSession(kind: String, id: String) {
        Task {
            let _: CaptureResult? = try? await ConvexClientProvider.client.mutation("environment:captureForSession", with: ["sessionKind": kind, "sessionId": id])
        }
    }

    /// The device's zone city, for the time-zone fallback line
    /// ("Asia/Colombo" → "Colombo").
    nonisolated static var timeZoneCity: String {
        let id = TimeZone.current.identifier
        return (id.split(separator: "/").last.map(String.init) ?? id).replacingOccurrences(of: "_", with: " ")
    }

    private func reportTimeZone() {
        let zone = TimeZone.current.identifier
        Task {
            let _: String? = try? await ConvexClientProvider.client.mutation("userTimeZone:setTimeZone", with: ["timeZone": zone])
        }
    }

    private func send(_ location: CLLocation) async {
        let locality = try? await CLGeocoder().reverseGeocodeLocation(location).first?.locality
        do {
            let result: EnvironmentRefreshResult = try await ConvexClientProvider.client.action("environment:refresh", with: [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "timeZone": TimeZone.current.identifier,
                "locality": locality,
            ])
            lastError = result.ok ? nil : result.reason
            lastRefresh = Date()
        } catch {
            lastError = String(describing: error)
        }
        refreshing = false
    }

    private static func access(for status: CLAuthorizationStatus) -> Access {
        switch status {
        case .authorizedWhenInUse, .authorizedAlways: return .allowed
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    private struct CaptureResult: Decodable { let captured: Bool }
}

/// Forwards CoreLocation callbacks (delivered on the thread the manager
/// was created on — the main thread) to EnvironmentService.
private final class LocationDelegate: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    var onAuthorization: (@Sendable (CLAuthorizationStatus) -> Void)?
    var onLocation: (@Sendable (CLLocation) -> Void)?
    var onFailure: (@Sendable (String) -> Void)?

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        onAuthorization?(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        onLocation?(location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        onFailure?(String(describing: error))
    }
}

/// The Home ambient line: "Colombo · 28°C · Partly cloudy". Honest when
/// there's nothing to show: the device's time-zone city and why.
enum EnvironmentLine {
    static func text(_ env: EnvironmentDTO?, access: EnvironmentService.Access) -> String? {
        if access == .denied { return "\(EnvironmentService.timeZoneCity) · Weather unavailable" }
        guard let env, let s = env.snapshot, env.state != "unavailable" else { return nil }
        var parts = [s.locality ?? EnvironmentService.timeZoneCity]
        if let t = s.temperatureC { parts.append(temperature(t)) }
        if let c = s.condition { parts.append(c) }
        if env.state == "stale" { parts.append("earlier") }
        return parts.joined(separator: " · ")
    }

    static func temperature(_ celsius: Double) -> String {
        let m = Measurement(value: celsius, unit: UnitTemperature.celsius)
        return m.formatted(.measurement(width: .narrow, usage: .weather, numberFormatStyle: .number.precision(.fractionLength(0))))
    }

    /// The detail row on tap: feels-like (calculated), humidity, wind, UV
    /// (clear-sky), precipitation next hour — only what the provider gave.
    static func detail(_ env: EnvironmentDTO?) -> String? {
        guard let s = env?.snapshot else { return nil }
        var parts: [String] = []
        if let f = s.feelsLikeC { parts.append("Feels like \(temperature(f))") }
        if let h = s.humidityPct { parts.append("Humidity \(Int(h.rounded()))%") }
        if let w = s.windMs { parts.append("Wind \(Int(w.rounded())) m/s") }
        if let u = s.uvIndex { parts.append("UV \(Int(u.rounded()))") }
        if let p = s.precipitationMm { parts.append(p > 0 ? String(format: "Rain %.1f mm", p) : "No rain next hour") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
