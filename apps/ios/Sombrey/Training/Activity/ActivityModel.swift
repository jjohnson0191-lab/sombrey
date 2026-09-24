import SwiftUI

// MARK: - Catalog

/// One physical activity as Sombrey presents it — Tennis, Golf, Surfing —
/// generated from the server's activity model (`convex/activityTaxonomy.ts`
/// + `convex/activityFamilies.ts`, see `ActivityCatalog.generated.swift`).
/// `vendorSportType` is the band mode used to record it; it is never shown.
struct SombreyActivity: Identifiable, Hashable, Sendable {
    let key: String
    let name: String
    let category: String
    let group: String
    let vendorSportType: Int
    /// The band mode is too generic to say what was done ("free training");
    /// a band record in it prompts the user rather than being trusted.
    let isAmbiguous: Bool

    var id: String { key }

    /// The band's mode for this activity.
    var sportType: SombreySportType? { SombreySportType.byRawValue[vendorSportType] }

    /// How Sombrey talks about and reads this activity — its family's terms
    /// with its own overrides (the Activity Intelligence Framework's data).
    var terms: ActivityTerms {
        ActivityCatalog.activityTerms[key] ?? ActivityCatalog.familyTerms[category] ?? ActivityCatalog.familyTerms["other"]!
    }

    var glyph: String { ActivityGlyphs.glyph(for: self) }

    /// The category in everyday words ("Racquet", "Water sport").
    var categoryName: String { ActivityCatalog.categoryNames[category] ?? category.replacingOccurrences(of: "_", with: " ").capitalized }
}

struct ActivityGroup: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

enum ActivityCatalog {
    static let byKey: [String: SombreyActivity] = Dictionary(all.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })

    /// Shown to someone with no history yet — the activities most people
    /// record, not a claim about this user.
    static let popularKeys = [
        "tennis", "run", "golf", "walk", "bike", "swim",
        "hiking", "football", "basketball", "surf", "strength_training", "yoga",
    ]

    static let categoryNames: [String: String] = [
        "running": "Running", "walking": "Walking", "hiking": "Hiking", "cycling": "Cycling", "swimming": "Swimming",
        "racquet": "Racquet sport", "golf": "Golf", "team_sport": "Team sport", "water_sport": "Water sport",
        "winter_sport": "Winter sport", "strength": "Strength", "cardio": "Cardio", "mobility": "Mind & body",
        "dance": "Dance", "combat": "Combat sport", "outdoor_adventure": "Outdoor", "leisure": "Leisure",
        "motorsport": "Motorsport", "games": "Game", "other": "Activity",
    ]

    static func activities(in group: ActivityGroup) -> [SombreyActivity] {
        all.filter { $0.group == group.id }
    }

    static func search(_ term: String) -> [SombreyActivity] {
        let needle = term.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return [] }
        return all
            .filter { $0.name.lowercased().contains(needle) || $0.key.replacingOccurrences(of: "_", with: " ").contains(needle) }
            .sorted { lhs, rhs in
                let l = lhs.name.lowercased().hasPrefix(needle), r = rhs.name.lowercased().hasPrefix(needle)
                return l == r ? lhs.name < rhs.name : l
            }
    }

    /// The activity for a stored session: its Sombrey key when present,
    /// else the band mode's activity.
    static func resolve(activityKey: String?, vendorSportType: Int?) -> SombreyActivity? {
        if let activityKey, let activity = byKey[activityKey] { return activity }
        if let vendorSportType, let key = keyByVendorSportType[vendorSportType] { return byKey[key] }
        return nil
    }
}

// MARK: - Framework terms

/// Everything an activity experience can show. Each has one meaning, and
/// each is only ever shown from a real recorded value (see
/// `ActivityReadings`). Raw values match `convex/activityFamilies.ts`.
enum ActivityMetric: String, CaseIterable, Hashable, Sendable {
    case duration, heartRate = "heart_rate", intensity, distance, pace, speed
    case fastestSpeed = "fastest_speed", steps, cadence, calories, climb, descent, altitude, actions
}

enum ActivityPaceUnit: Sendable { case perKm, per100m }

/// An activity's language and emphasis — generated data, never hand-built
/// per screen. See `convex/activityFamilies.ts` for the meaning of each.
struct ActivityTerms: Equatable, Sendable {
    let sessionNoun: String
    let verbPast: String
    let performanceTitle: String
    let movementTitle: String
    let effortTitle: String
    let primary: [ActivityMetric]
    let secondary: [ActivityMetric]
    let notMeasured: String?
    let focus: String
    let recoveryNote: String
    let actionsLabel: String
    let paceUnit: ActivityPaceUnit
    let character: ActivityCharacter
}

/// The quiet backlight an activity's hero takes on — the same Studio bezel
/// everywhere, tinted toward where the activity happens.
enum ActivityCharacter: Equatable, Sendable {
    case court, road, trail, water, studio

    var tint: Color {
        switch self {
        case .court: return StudioColor.activityCourt
        case .road: return StudioColor.activityRoad
        case .trail: return StudioColor.activityTrail
        case .water: return StudioColor.activityWater
        case .studio: return StudioColor.env2
        }
    }
}

/// SF Symbols' workout set (iOS 16+) — only names that exist. The one part
/// of an activity's identity that is platform-specific, so it lives here
/// rather than in the shared model.
enum ActivityGlyphs {
    static func glyph(for activity: SombreyActivity) -> String {
        byKey[activity.key] ?? byCategory[activity.category] ?? "figure.mixed.cardio"
    }

    private static let byKey: [String: String] = [
        "tennis": "figure.tennis", "badminton": "figure.badminton", "pingpong": "figure.table.tennis",
        "squash": "figure.squash", "racquetball": "figure.racquetball", "pickleball": "figure.pickleball",
        "golf": "figure.golf", "run": "figure.run", "treadmill": "figure.run", "trail_running": "figure.run",
        "marathon": "figure.run", "walk": "figure.walk", "indoor_walking": "figure.walk", "hiking": "figure.hiking",
        "bike": "figure.outdoor.cycle", "outdoor_cycling": "figure.outdoor.cycle", "mountain_biking": "figure.outdoor.cycle",
        "indoor_cycling": "figure.indoor.cycle", "spinning": "figure.indoor.cycle", "hand_crank": "figure.hand.cycling",
        "swim": "figure.pool.swim", "pool_swim": "figure.pool.swim", "open_water_swim": "figure.open.water.swim",
        "surf": "figure.surfing", "indoor_surfing": "figure.surfing", "sailing": "figure.sailing",
        "water_polo": "figure.waterpolo", "football": "figure.soccer", "indoor_football": "figure.soccer",
        "beach_football": "figure.soccer", "basketball": "figure.basketball", "volleyball": "figure.volleyball",
        "beach_volleyball": "figure.volleyball", "baseball": "figure.baseball", "softball": "figure.softball",
        "cricket": "figure.cricket", "rugby": "figure.rugby", "australian_rules_football": "figure.australian.football",
        "handball": "figure.handball", "field_hockey": "figure.hockey", "ice_hockey": "figure.hockey",
        "skiing": "figure.skiing.downhill", "alpine_skiing": "figure.skiing.downhill",
        "cross_country_skiing": "figure.skiing.crosscountry", "snowboard": "figure.snowboarding",
        "outdoor_skating": "figure.skating", "indoor_skating": "figure.skating", "roller_skating": "figure.skating",
        "curling": "figure.curling", "yoga": "figure.yoga", "yin_yoga": "figure.yoga", "anusara": "figure.yoga",
        "pregnancy_yoga": "figure.yoga", "pilates": "figure.pilates", "tai_chi": "figure.taichi",
        "stretch": "figure.flexibility", "flexibility_training": "figure.flexibility",
        "strength_training": "figure.strengthtraining.traditional", "core_training": "figure.core.training",
        "cross_training": "figure.cross.training", "gap_training": "figure.highintensity.intervaltraining",
        "rope_skipping": "figure.jumprope", "elliptical_machine": "figure.elliptical", "rowing_machine": "figure.rower",
        "stair_climber": "figure.stair.stepper", "stair_stepper": "figure.stair.stepper", "step_training": "figure.step.training",
        "gymnastics": "figure.gymnastics", "boxing": "figure.boxing", "kickboxing": "figure.kickboxing",
        "martial_arts": "figure.martial.arts", "wrestling": "figure.wrestling", "fencing": "figure.fencing",
        "rock_climbing": "figure.climbing", "archery": "figure.archery", "fishing": "figure.fishing",
        "hunt": "figure.hunting", "bowling": "figure.bowling", "frisbee": "figure.disc.sports", "dance": "figure.dance",
        "polo": "figure.equestrian.sports",
    ]

    private static let byCategory: [String: String] = [
        "running": "figure.run", "walking": "figure.walk", "hiking": "figure.hiking", "cycling": "figure.outdoor.cycle",
        "swimming": "figure.pool.swim", "racquet": "figure.tennis", "golf": "figure.golf", "team_sport": "figure.soccer",
        "water_sport": "figure.water.fitness", "winter_sport": "figure.skiing.downhill", "strength": "figure.strengthtraining.functional",
        "cardio": "figure.mixed.cardio", "mobility": "figure.mind.and.body", "dance": "figure.dance",
        "combat": "figure.martial.arts", "outdoor_adventure": "figure.hiking", "leisure": "figure.play",
        "motorsport": "steeringwheel", "games": "puzzlepiece",
    ]
}

// MARK: - Intensity

/// Mirrors `convex/activityIntensity.ts`: the five-zone scale over percent
/// of the age-predicted maximum heart rate. An estimate — every place that
/// shows it says so — and absent without a real reading or an estimate.
enum ActivityIntensity {
    struct Zone: Equatable {
        let zone: Int
        let label: String
        let percentOfMax: Int
    }

    static let bounds: [(zone: Int, label: String, minPercent: Int)] = [
        (1, "Very light", 50), (2, "Light", 60), (3, "Moderate", 70), (4, "Hard", 80), (5, "Maximum", 90),
    ]

    static func zone(heartRate: Double?, maxHeartRate: Double?) -> Zone? {
        guard let heartRate, let maxHeartRate, heartRate > 0, maxHeartRate > 0 else { return nil }
        let percent = Int((heartRate / maxHeartRate * 100).rounded())
        return bounds.last { percent >= $0.minPercent }.map { Zone(zone: $0.zone, label: $0.label, percentOfMax: percent) }
    }
}

// MARK: - Measurement formatting (real values only)

enum ActivityFormat {
    /// "58 min", "1 h 12 min".
    static func duration(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
    }

    static func distance(_ meters: Double) -> (value: String, unit: String) {
        meters >= 1000 ? (String(format: "%.2f", meters / 1000), "km") : ("\(Int(meters.rounded()))", "m")
    }

    /// Pace per km from an average speed in m/s.
    static func pace(metersPerSecond: Double) -> String? {
        guard metersPerSecond > 0.3 else { return nil }
        let secondsPerKm = Int((1000 / metersPerSecond).rounded())
        return String(format: "%d:%02d", secondsPerKm / 60, secondsPerKm % 60)
    }

    /// Swim pace per 100 m from an average speed in m/s.
    static func pacePer100m(metersPerSecond: Double) -> String? {
        guard metersPerSecond > 0.1 else { return nil }
        let seconds = Int((100 / metersPerSecond).rounded())
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    static func speed(metersPerSecond: Double) -> String {
        String(format: "%.1f", metersPerSecond * 3.6)
    }

    static func count(_ value: Double) -> String {
        Int(value.rounded()).formatted(.number)
    }
}

// MARK: - Wire shapes

/// One activity from `activities:history` / `activities:listRecent`.
struct ActivityRecordDTO: Decodable, Identifiable, Equatable {
    let id: String
    let provenance: String
    let activityKey: String
    let activityCategory: String
    let displayName: String
    let vendorSportType: Int?
    let startedAt: Double
    let durationSeconds: Double?
    /// "band", or "sombrey_timer" when only the app's own timing exists.
    var durationSource: String? = nil
    let averageHeartRate: Double?
    let lowestHeartRate: Double?
    let highestHeartRate: Double?
    let heartRateSource: String?
    let calories: Double?
    let caloriesSource: String?
    let distanceMeters: Double?
    let steps: Double?
    let timestampSuspect: Bool?
    // Added with the Activity Intelligence Framework; optional so every
    // earlier shape still decodes.
    var classificationSource: String? = nil
    var needsClassification: Bool? = nil
    var averageSpeedMetersPerSecond: Double? = nil
    var fastestSpeedMetersPerSecond: Double? = nil
    var cadence: Double? = nil
    var actionCount: Double? = nil
    var climbMeters: Double? = nil
    var descentMeters: Double? = nil
    var averageAltitudeMeters: Double? = nil
    var movementSource: String? = nil

    var startDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }
    var activity: SombreyActivity? { ActivityCatalog.resolve(activityKey: activityKey, vendorSportType: vendorSportType) }

    /// Where this activity's figures came from, in the user's terms.
    var sourceLine: String {
        switch provenance {
        case "band_sport_plus": return "Recorded on your Sombrey Band"
        case "app_sport_plus": return "Started in Sombrey · recorded by your band"
        case "user_labelled": return "Noticed by Sombrey · named by you"
        case "manual": return "Logged by you"
        default: return "Recorded in Sombrey"
        }
    }
}

struct AveragedDTO: Decodable, Equatable {
    let value: Double
    let sessions: Double
}

struct ActivityProfileSummaryDTO: Decodable, Equatable {
    let sessionCount: Double
    let lastStartedAt: Double?
    let averageDurationSeconds: AveragedDTO?
    let averageHeartRate: AveragedDTO?
    let averagePeakHeartRate: AveragedDTO?
    let averageCalories: AveragedDTO?
    let averageSteps: AveragedDTO?
    let averageDistanceMeters: AveragedDTO?
    let sessionsLast30Days: Double
    let sessionsPrevious30Days: Double
}

struct ActivityHistoryDTO: Decodable, Equatable {
    let sessions: [ActivityRecordDTO]
    let profile: ActivityProfileSummaryDTO
}

struct ActivityUsageDTO: Decodable, Equatable {
    let activityKey: String
    let count: Double
    let lastStartedAt: Double
}

struct IntensityContextDTO: Decodable, Equatable {
    let estimatedMaxHeartRate: Double?
    let restingHeartRate: Double?
}

struct DetectedActivityDTO: Decodable, Equatable, Identifiable {
    let startedAt: Double
    let endedAt: Double
    let sampleCount: Double
    let averageHeartRate: Double
    let highestHeartRate: Double

    var id: Double { startedAt }
    var minutes: Int { Int(((endedAt - startedAt) / 60_000).rounded()) }
    var startDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }
}

/// `sportPlusSessions:getSessionDetail`.
struct SportSessionDetailDTO: Decodable, Equatable {
    let session: SportSessionHistoryDTO
    let detail: Detail?

    struct Detail: Decodable, Equatable {
        let heartRates: [Double]?
        let seriesSource: String?
    }
}

/// Everyday vocabulary for the ordering of recent/frequent activities.
enum ActivityRanking {
    /// Recent first (server history, then this phone's picks), de-duplicated.
    static func recent(usage: [ActivityUsageDTO], local: [String]) -> [SombreyActivity] {
        var seen = Set<String>()
        let keys = usage.sorted { $0.lastStartedAt > $1.lastStartedAt }.map(\.activityKey) + local
        return keys.compactMap { key in
            guard seen.insert(key).inserted else { return nil }
            return ActivityCatalog.byKey[key]
        }
    }

    /// Done at least twice, most often first.
    static func frequent(usage: [ActivityUsageDTO]) -> [SombreyActivity] {
        usage.filter { $0.count >= 2 }
            .sorted { $0.count == $1.count ? $0.lastStartedAt > $1.lastStartedAt : $0.count > $1.count }
            .compactMap { ActivityCatalog.byKey[$0.activityKey] }
    }
}
