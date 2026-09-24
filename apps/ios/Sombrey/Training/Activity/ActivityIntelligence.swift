import Foundation

// The Activity Intelligence Framework's engine: one set of rules that turns
// real readings + the user's own history into the experience for WHATEVER
// activity it is. The activity's terms (`ActivityTerms`, generated data)
// decide what matters and what it's called; nothing here is per-sport code.
//
// Honesty rules, enforced here once for every activity:
// - A value exists only if it was recorded; zero is "not recorded".
// - Every indicator carries where it came from.
// - Missing headline metrics are listed once ("not recorded this round:
//   distance"), never drawn as placeholders.
// - Insights are deterministic arithmetic over recorded values, each with
//   its basis; none is an AI inference.

/// Where a shown value came from.
enum MetricSource: Equatable, Sendable {
    /// The band's own post-session record.
    case bandRecord
    /// The band's live push during the session.
    case bandLive
    /// Timed by the Sombrey app (wall clock, pauses excluded).
    case sombreyTimer
    /// Calculated by Sombrey from band values (e.g. pace from distance and
    /// time, heart rate from the band's readings in a window).
    case calculated
    /// An estimate (intensity against the age-predicted max heart rate).
    case estimated

    var label: String {
        switch self {
        case .bandRecord: return "Band record"
        case .bandLive: return "Band · live"
        case .sombreyTimer: return "Timed by Sombrey"
        case .calculated: return "Calculated from band data"
        case .estimated: return "Estimated from your age"
        }
    }
}

/// Everything recorded for one session — nil means not recorded.
struct ActivityReadings: Equatable {
    var durationSeconds: Double?
    var durationSource: MetricSource = .bandRecord
    var averageHeartRate: Double?
    var lowestHeartRate: Double?
    var highestHeartRate: Double?
    var heartRateSource: MetricSource = .bandRecord
    var distanceMeters: Double?
    var averageSpeed: Double?
    var fastestSpeed: Double?
    var steps: Double?
    var cadence: Double?
    var calories: Double?
    var climb: Double?
    var descent: Double?
    var altitude: Double?
    var actions: Double?
    var movementSource: MetricSource = .bandRecord
    var heartRateSeries: [Double] = []
    var sampleRateSeconds: Double?
    var isLive = false

    private static func real(_ value: Double?) -> Double? {
        guard let value, value.isFinite, value > 0 else { return nil }
        return value
    }

    /// A stored band session. Heart-rate statistics only from the band's
    /// full record — a last live reading is never an average.
    static func from(session s: SportSessionHistoryDTO, heartRateSeries: [Double]?) -> ActivityReadings {
        let record = s.summarySource == "band_record"
        var r = ActivityReadings()
        if let band = real(s.durationSeconds) {
            r.durationSeconds = band
        } else if let timed = real(s.appActiveSeconds) {
            r.durationSeconds = timed
            r.durationSource = .sombreyTimer
        }
        if record {
            r.averageHeartRate = real(s.averageHeartRate)
            r.lowestHeartRate = real(s.lowestHeartRate)
            r.highestHeartRate = real(s.highestHeartRate)
            r.heartRateSeries = (heartRateSeries ?? []).filter { $0 > 0 }
            r.sampleRateSeconds = real(s.sampleRateSeconds)
        }
        r.movementSource = record ? .bandRecord : .bandLive
        r.distanceMeters = real(s.distanceMeters)
        r.averageSpeed = real(s.averageSpeedMetersPerSecond)
        r.fastestSpeed = real(s.fastestSpeedMetersPerSecond)
        r.steps = real(s.steps)
        r.cadence = real(s.stepFrequency)
        r.calories = real(s.calories)
        r.climb = real(s.climbMeters)
        r.descent = real(s.descentMeters)
        r.altitude = real(s.averageAltitudeMeters)
        r.actions = real(s.actionCount)
        return r
    }

    /// An activity from `activities:history` (any provenance).
    static func from(record a: ActivityRecordDTO) -> ActivityReadings {
        var r = ActivityReadings()
        r.durationSeconds = real(a.durationSeconds)
        r.durationSource = a.durationSource == "sombrey_timer" ? .sombreyTimer : .bandRecord
        if a.heartRateSource != nil {
            r.averageHeartRate = real(a.averageHeartRate)
            r.lowestHeartRate = real(a.lowestHeartRate)
            r.highestHeartRate = real(a.highestHeartRate)
            r.heartRateSource = a.heartRateSource == "band_samples" ? .calculated : .bandRecord
        }
        r.movementSource = a.movementSource == "band_live" ? .bandLive : .bandRecord
        r.distanceMeters = real(a.distanceMeters)
        r.averageSpeed = real(a.averageSpeedMetersPerSecond)
        r.fastestSpeed = real(a.fastestSpeedMetersPerSecond)
        r.steps = real(a.steps)
        r.cadence = real(a.cadence)
        r.calories = real(a.calories)
        r.climb = real(a.climbMeters)
        r.descent = real(a.descentMeters)
        r.altitude = real(a.averageAltitudeMeters)
        r.actions = real(a.actionCount)
        return r
    }

    /// A session in progress: the band's live push (5 fields) and the app's
    /// own clock. Live heart rate is carried as the "average" slot only for
    /// display on the live screen, labelled live.
    static func live(tally: SportSessionLiveUpdate?, heartRate: Double?, activeSeconds: Int) -> ActivityReadings {
        var r = ActivityReadings(isLive: true)
        r.durationSeconds = activeSeconds > 0 ? Double(activeSeconds) : nil
        r.durationSource = .sombreyTimer
        r.averageHeartRate = real(heartRate)
        r.heartRateSource = .bandLive
        r.movementSource = .bandLive
        if let tally {
            r.distanceMeters = real(Double(tally.distanceMeters))
            r.steps = real(Double(tally.steps))
            r.calories = real(tally.calories)
        }
        return r
    }
}

/// One shown value, with its label in the activity's language and its source.
struct ActivityIndicator: Identifiable, Equatable {
    let metric: ActivityMetric
    let label: String
    let value: String
    let unit: String?
    let source: MetricSource
    var detail: String? = nil

    var id: ActivityMetric { metric }
}

/// A deterministic observation about a session or an activity — never AI.
struct ActivityInsight: Identifiable, Equatable {
    let text: String
    /// What it's based on, in plain words ("Your last 6 rounds").
    let basis: String

    var id: String { text }
}

/// Time spent in each heart-rate zone, from the band's own series.
struct ZoneProfile: Equatable {
    /// Zones 1…5, with 0 = below zone 1. Values are sample counts.
    let samplesByZone: [Int: Int]
    let totalSamples: Int
    let sampleRateSeconds: Double?

    func share(_ zone: Int) -> Double { totalSamples == 0 ? 0 : Double(samplesByZone[zone] ?? 0) / Double(totalSamples) }

    /// Minutes in a zone — only when the band states its sample rate.
    func minutes(_ zone: Int) -> Double? {
        sampleRateSeconds.map { Double(samplesByZone[zone] ?? 0) * $0 / 60 }
    }

    /// The zone holding the most samples.
    var dominantZone: Int? { samplesByZone.max { ($0.value, $0.key) < ($1.value, $1.key) }?.key }
}

/// The experience for one session of one activity.
struct ActivityExperience: Equatable {
    let primary: [ActivityIndicator]
    let secondary: [ActivityIndicator]
    /// Headline metrics the band didn't record this time.
    let notRecorded: [String]
    let insights: [ActivityInsight]
    let zones: ZoneProfile?
}

enum ActivityIntelligence {
    // MARK: Indicators

    static func label(_ metric: ActivityMetric, terms: ActivityTerms, live: Bool) -> String {
        switch metric {
        case .duration: return live ? "Time" : "Duration"
        case .heartRate: return live ? "Heart rate" : "Avg heart rate"
        case .intensity: return "Intensity"
        case .distance: return "Distance"
        case .pace: return "Pace"
        case .speed: return "Avg speed"
        case .fastestSpeed: return "Top speed"
        case .steps: return "Steps"
        case .cadence: return "Cadence"
        case .calories: return "Energy"
        case .climb: return "Climb"
        case .descent: return "Descent"
        case .altitude: return "Avg altitude"
        case .actions: return terms.actionsLabel
        }
    }

    /// The average speed to use for pace/speed: the band's own, else
    /// calculated from the band's distance and the session's time.
    private static func speed(_ r: ActivityReadings) -> (value: Double, source: MetricSource)? {
        if let s = r.averageSpeed { return (s, r.movementSource) }
        guard let d = r.distanceMeters, d >= 50, let t = r.durationSeconds, t > 0 else { return nil }
        return (d / t, .calculated)
    }

    static func indicator(_ metric: ActivityMetric, readings r: ActivityReadings, terms: ActivityTerms, maxHeartRate: Double?) -> ActivityIndicator? {
        let name = label(metric, terms: terms, live: r.isLive)
        func make(_ value: String, _ unit: String?, _ source: MetricSource, detail: String? = nil) -> ActivityIndicator {
            ActivityIndicator(metric: metric, label: name, value: value, unit: unit, source: source, detail: detail)
        }
        switch metric {
        case .duration:
            guard let d = r.durationSeconds else { return nil }
            return make(r.isLive ? TrainingMath.clock(Int(d)) : ActivityFormat.duration(d), nil, r.durationSource)
        case .heartRate:
            guard let hr = r.averageHeartRate else { return nil }
            let range = r.lowestHeartRate.flatMap { low in r.highestHeartRate.map { "\(Int(low))–\(Int($0)) bpm range" } }
            return make("\(Int(hr.rounded()))", "bpm", r.heartRateSource, detail: range)
        case .intensity:
            guard let zone = ActivityIntensity.zone(heartRate: r.averageHeartRate, maxHeartRate: maxHeartRate) else { return nil }
            return make(zone.label, nil, .estimated, detail: "\(zone.percentOfMax)% of est. max")
        case .distance:
            guard let d = r.distanceMeters else { return nil }
            let f = ActivityFormat.distance(d)
            return make(f.value, f.unit, r.movementSource)
        case .pace:
            guard let s = speed(r) else { return nil }
            let text = terms.paceUnit == .per100m ? ActivityFormat.pacePer100m(metersPerSecond: s.value) : ActivityFormat.pace(metersPerSecond: s.value)
            guard let text else { return nil }
            return make(text, terms.paceUnit == .per100m ? "/100 m" : "/km", s.source)
        case .speed:
            guard let s = speed(r) else { return nil }
            return make(ActivityFormat.speed(metersPerSecond: s.value), "km/h", s.source)
        case .fastestSpeed:
            guard let s = r.fastestSpeed else { return nil }
            return make(ActivityFormat.speed(metersPerSecond: s), "km/h", r.movementSource)
        case .steps:
            guard let s = r.steps else { return nil }
            return make(ActivityFormat.count(s), nil, r.movementSource)
        case .cadence:
            guard let c = r.cadence else { return nil }
            return make("\(Int(c.rounded()))", "spm", r.movementSource)
        case .calories:
            guard let c = r.calories else { return nil }
            return make("\(Int(c.rounded()))", "kcal", r.movementSource)
        case .climb:
            guard let c = r.climb else { return nil }
            return make("\(Int(c.rounded()))", "m", r.movementSource)
        case .descent:
            guard let d = r.descent else { return nil }
            return make("\(Int(d.rounded()))", "m", r.movementSource)
        case .altitude:
            guard let a = r.altitude else { return nil }
            return make("\(Int(a.rounded()))", "m", r.movementSource)
        case .actions:
            guard let a = r.actions else { return nil }
            return make(ActivityFormat.count(a), nil, r.movementSource, detail: "as counted by the band")
        }
    }

    // MARK: Zones

    static func zones(series: [Double], sampleRateSeconds: Double?, maxHeartRate: Double?) -> ZoneProfile? {
        let values = series.filter { $0 > 0 }
        guard values.count >= 4, let maxHeartRate else { return nil }
        var counts: [Int: Int] = [:]
        for hr in values {
            counts[ActivityIntensity.zone(heartRate: hr, maxHeartRate: maxHeartRate)?.zone ?? 0, default: 0] += 1
        }
        return ZoneProfile(samplesByZone: counts, totalSamples: values.count, sampleRateSeconds: sampleRateSeconds)
    }

    // MARK: Session experience

    /// `previous`: the user's earlier sessions of this activity (not this one).
    static func experience(for activity: SombreyActivity, readings r: ActivityReadings,
                           previous: [ActivityRecordDTO], maxHeartRate: Double?, now: Date = Date()) -> ActivityExperience {
        let terms = activity.terms
        // The header already carries duration; heart rate gets its own
        // instrument when a range exists — both stay in the list otherwise.
        let primary = terms.primary.compactMap { indicator($0, readings: r, terms: terms, maxHeartRate: maxHeartRate) }
        // Then anything else the band did record that this activity's terms
        // don't list — shown, never silently dropped. (Derived values —
        // intensity, pace, speed — only where the terms ask for them.)
        let listed = Set(terms.primary + terms.secondary)
        let derived: Set<ActivityMetric> = [.duration, .intensity, .pace, .speed]
        let extras = ActivityMetric.allCases.filter { !listed.contains($0) && !derived.contains($0) }
        let secondary = (terms.secondary + extras).compactMap { indicator($0, readings: r, terms: terms, maxHeartRate: maxHeartRate) }
        // Intensity missing because there's no age estimate isn't the band's
        // doing, and a live session is still filling in.
        let notRecorded = r.isLive ? [] : terms.primary
            .filter { $0 != .intensity && indicator($0, readings: r, terms: terms, maxHeartRate: maxHeartRate) == nil }
            .map { label($0, terms: terms, live: false).lowercased() }
        let zones = r.isLive ? nil : zones(series: r.heartRateSeries, sampleRateSeconds: r.sampleRateSeconds, maxHeartRate: maxHeartRate)
        let insights = r.isLive ? [] : sessionInsights(activity: activity, readings: r, previous: previous, zones: zones, now: now)
        return ActivityExperience(primary: primary, secondary: secondary, notRecorded: notRecorded, insights: insights, zones: zones)
    }

    static let minimumComparisons = 2

    private static func average(_ values: [Double]) -> Double? {
        values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }

    static func sessionInsights(activity: SombreyActivity, readings r: ActivityReadings,
                                previous: [ActivityRecordDTO], zones: ZoneProfile?, now: Date) -> [ActivityInsight] {
        let terms = activity.terms
        let noun = terms.sessionNoun
        var insights: [ActivityInsight] = []

        if previous.isEmpty {
            insights.append(ActivityInsight(
                text: "Your first \(activity.name) \(noun) with Sombrey. Every \(noun) from here on is compared with your own.",
                basis: "Your history"))
        }

        // Duration against the user's usual.
        let durations = previous.compactMap(\.durationSeconds).filter { $0 > 0 }
        if let d = r.durationSeconds, durations.count >= minimumComparisons, let usual = average(durations) {
            let delta = Int(((d - usual) / 60).rounded())
            let text = abs(delta) < 3
                ? "A typical \(noun) for you — your usual is \(ActivityFormat.duration(usual))."
                : "\(abs(delta)) min \(delta > 0 ? "longer" : "shorter") than your usual \(activity.name) \(noun) of \(ActivityFormat.duration(usual))."
            insights.append(ActivityInsight(text: text, basis: "Your last \(durations.count) \(noun)s"))
        }

        // Heart-rate response against the user's usual (band records only).
        let heartRates = previous.filter { $0.heartRateSource != nil }.compactMap(\.averageHeartRate).filter { $0 > 0 }
        if let hr = r.averageHeartRate, heartRates.count >= minimumComparisons, let usual = average(heartRates) {
            let delta = Int((hr - usual).rounded())
            let text = abs(delta) < 3
                ? "Your heart worked about as hard as usual — average \(Int(hr.rounded())) bpm."
                : "Your heart worked \(delta > 0 ? "harder" : "less hard") than usual: average \(Int(hr.rounded())) bpm against your typical \(Int(usual.rounded()))."
            insights.append(ActivityInsight(text: text, basis: "Band heart-rate records · last \(heartRates.count) \(noun)s"))
        }

        // How the effort was spread.
        if let zones, let dominant = zones.dominantZone {
            let hardShare = zones.share(4) + zones.share(5)
            let dominantLabel = dominant == 0 ? "very easy" : (ActivityIntensity.bounds.first { $0.zone == dominant }?.label.lowercased() ?? "")
            var text = "Most of this \(noun) was at \(dominantLabel) effort"
            if let hardMinutes = zones.minutes(4).flatMap({ m4 in zones.minutes(5).map { m4 + $0 } }), hardMinutes >= 1 {
                text += "; \(Int(hardMinutes.rounded())) min hard or above."
            } else if hardShare >= 0.05 {
                text += "; \(Int((hardShare * 100).rounded()))% of it hard or above."
            } else {
                text += "."
            }
            insights.append(ActivityInsight(text: text, basis: "Band heart-rate series · zones estimated from your age"))
        }

        // The activity's movement headline against the usual.
        if let metric = terms.primary.first(where: { $0 == .distance || $0 == .steps || $0 == .climb }),
           let insight = movementInsight(metric, activity: activity, readings: r, previous: previous) {
            insights.append(insight)
        }

        // Pace/speed against the usual, where they are headline metrics.
        if terms.primary.contains(.pace) || terms.primary.contains(.speed),
           let speed = r.averageSpeed {
            let speeds = previous.compactMap(\.averageSpeedMetersPerSecond).filter { $0 > 0 }
            if speeds.count >= minimumComparisons, let usual = average(speeds), abs(speed - usual) / usual >= 0.03 {
                let faster = speed > usual
                let shown: (Double) -> String = terms.primary.contains(.pace)
                    ? { (terms.paceUnit == .per100m ? ActivityFormat.pacePer100m(metersPerSecond: $0) : ActivityFormat.pace(metersPerSecond: $0)) ?? "" }
                    : { "\(ActivityFormat.speed(metersPerSecond: $0)) km/h" }
                insights.append(ActivityInsight(
                    text: "\(faster ? "Faster" : "Slower") than your usual \(noun): \(shown(speed)) against \(shown(usual)).",
                    basis: "Band records · last \(speeds.count) \(noun)s"))
            }
        }

        // How often, this week.
        if let frequency = frequencyInsight(activity: activity, previous: previous, includingThisSession: true, now: now) {
            insights.append(frequency)
        }
        return insights
    }

    private static func movementInsight(_ metric: ActivityMetric, activity: SombreyActivity, readings r: ActivityReadings, previous: [ActivityRecordDTO]) -> ActivityInsight? {
        let noun = activity.terms.sessionNoun
        let current: Double?
        let history: [Double]
        let format: (Double) -> String
        switch metric {
        case .distance:
            current = r.distanceMeters
            history = previous.compactMap(\.distanceMeters).filter { $0 > 0 }
            format = { let f = ActivityFormat.distance($0); return "\(f.value) \(f.unit)" }
        case .steps:
            current = r.steps
            history = previous.compactMap(\.steps).filter { $0 > 0 }
            format = { "\(ActivityFormat.count($0)) steps" }
        case .climb:
            current = r.climb
            history = previous.compactMap(\.climbMeters).filter { $0 > 0 }
            format = { "\(Int($0.rounded())) m" }
        default:
            return nil
        }
        guard let current, history.count >= minimumComparisons, let usual = average(history) else { return nil }
        let ratio = current / usual
        let text: String
        if abs(ratio - 1) < 0.1 {
            text = "\(format(current)) — about your usual \(noun)."
        } else {
            text = "\(format(current)) — \(ratio > 1 ? "more" : "less") than your usual \(noun) of \(format(usual))."
        }
        return ActivityInsight(text: text, basis: "Band records · last \(history.count) \(noun)s")
    }

    /// Sessions this week against the user's weekly habit (the 8 weeks
    /// before), once there are at least three weeks of history.
    static func frequencyInsight(activity: SombreyActivity, previous: [ActivityRecordDTO], includingThisSession: Bool, now: Date) -> ActivityInsight? {
        let week: TimeInterval = 7 * 24 * 3600
        let dates = previous.map(\.startDate)
        let thisWeek = dates.filter { now.timeIntervalSince($0) < week }.count + (includingThisSession ? 1 : 0)
        let earlier = dates.filter { now.timeIntervalSince($0) >= week && now.timeIntervalSince($0) < 9 * week }
        guard let oldest = earlier.min(), now.timeIntervalSince(oldest) >= 3 * week else { return nil }
        let weeks = min(8, max(2, Int((now.timeIntervalSince(oldest) - week) / week) + 1))
        let perWeek = Double(earlier.count) / Double(weeks)
        let usual = perWeek < 1 ? "less than once a week" : perWeek < 1.5 ? "about once a week" : "about \(Int(perWeek.rounded())) times a week"
        let times = thisWeek == 1 ? "once" : thisWeek == 2 ? "twice" : "\(thisWeek) times"
        return ActivityInsight(
            text: "\(activity.name) \(times) in the last 7 days — your usual is \(usual).",
            basis: "Your last \(weeks) weeks")
    }

    // MARK: Activity (no session) insights

    /// What Sombrey can say about the user and this activity overall.
    static func activityInsights(activity: SombreyActivity, sessions: [ActivityRecordDTO], now: Date = Date()) -> [ActivityInsight] {
        let noun = activity.terms.sessionNoun
        guard !sessions.isEmpty else { return [] }
        var insights: [ActivityInsight] = []
        let durations = sessions.compactMap(\.durationSeconds).filter { $0 > 0 }
        let heartRates = sessions.filter { $0.heartRateSource != nil }.compactMap(\.averageHeartRate).filter { $0 > 0 }
        if let typical = average(durations) {
            var text = "Your typical \(noun) lasts \(ActivityFormat.duration(typical))"
            if heartRates.count >= minimumComparisons, let hr = average(heartRates) {
                text += " at an average \(Int(hr.rounded())) bpm"
            }
            insights.append(ActivityInsight(text: text + ".", basis: "\(durations.count) \(noun)\(durations.count == 1 ? "" : "s")"))
        }
        // Recent against earlier (needs enough history to mean anything).
        let ordered = sessions.sorted { $0.startedAt > $1.startedAt }.compactMap(\.durationSeconds).filter { $0 > 0 }
        if ordered.count >= 6, let recent = average(Array(ordered.prefix(3))), let earlier = average(Array(ordered.dropFirst(3))) {
            let change = (recent - earlier) / earlier
            if abs(change) >= 0.1 {
                insights.append(ActivityInsight(
                    text: "Your last 3 \(noun)s ran \(change > 0 ? "longer" : "shorter") than before — \(ActivityFormat.duration(recent)) against \(ActivityFormat.duration(earlier)).",
                    basis: "Your last \(ordered.count) \(noun)s"))
            }
        }
        if let frequency = frequencyInsight(activity: activity, previous: sessions, includingThisSession: false, now: now) {
            insights.append(frequency)
        }
        return insights
    }
}
