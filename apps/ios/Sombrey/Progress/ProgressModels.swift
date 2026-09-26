import Foundation

// Wire shapes for `progress:overview` and `progress:performance` — every
// value derived on the server from the user's recorded history
// (convex/progress/*). Optional = not enough data / not recorded.

/// Where a figure came from (convex/progress/model.ts `Provenance`).
enum ProgressProvenance {
    static func label(_ source: String?) -> String? {
        switch source {
        case "band_record": return "Band record"
        case "band_live": return "Band · live"
        case "band_samples": return "From band readings"
        case "sombrey": return "Timed by Sombrey"
        case "manual": return "Entered by you"
        case "scanner": return "Body scan"
        case "calculated": return "Calculated"
        case "estimated": return "Estimated"
        default: return nil
        }
    }
}

struct DailyLoadDTO: Decodable, Equatable {
    let date: String
    let sessionCount: Double
    let activeMinutes: Double
    let workoutMinutes: Double
    let activityMinutes: Double
    let bandRecordedMinutes: Double
}

struct StrainScoreDTO: Decodable, Equatable {
    let state: String          // "no_formula" | "insufficient_data" | "scored"
    let value: Double?
    let scaleMax: Double?
    let reason: String?
}

struct StrainDayDTO: Decodable, Equatable {
    struct Engine: Decodable, Equatable { let id: String; let version: String; let validated: Bool }
    let date: String
    let load: DailyLoadDTO
    let score: StrainScoreDTO
    let engine: Engine
    let usualActiveMinutes: Double?
    let baselineDays: Double
    let context: [String]
    let week: [DailyLoadDTO]
}

struct StrainSignalsDTO: Decodable, Equatable {
    let available: [String]
    let missing: [String]
    let currentFormula: String
    let proposedInputs: [String]
    let limitations: [String]
}

struct TodaySessionDTO: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let name: String
    let startedAt: Double
    let minutes: Double?
    let durationSource: String?
    let averageHeartRate: Double?
    let calories: Double?
}

struct WeightEntryDTO: Decodable, Equatable, Identifiable {
    let id: String
    let date: Double
    let weightKg: Double
    let source: String

    var dateValue: Date { Date(timeIntervalSince1970: date / 1000) }
}

struct BodySummaryDTO: Decodable, Equatable {
    struct Baseline: Decodable, Equatable { let mode: String; let entry: WeightEntryDTO }
    let latest: WeightEntryDTO?
    let baseline: Baseline?
    let changeKg: Double?
    let entries: [WeightEntryDTO]
}

struct WeekDayDTO: Decodable, Equatable {
    let date: String
    let trained: Bool
    let active: Bool
    let minutes: Double
    let isFuture: Bool
}

struct WeekSummaryDTO: Decodable, Equatable {
    let weekStart: Double
    let trainingDays: Double
    let activeDays: Double
    let minutes: Double
    let plannedCompleted: Double
    let sessions: Double
}

struct ThisWeekDTO: Decodable, Equatable {
    let weekStart: Double
    let trainingDays: Double
    let activeDays: Double
    let minutes: Double
    let plannedCompleted: Double
    let sessions: Double
    let days: [WeekDayDTO]
    let restDays: Double
    let plannedScheduled: Double?
}

struct ConsistencyDTO: Decodable, Equatable {
    let thisWeek: ThisWeekDTO
    let previousWeeks: [WeekSummaryDTO]
    let usualTrainingDays: Double?
    let usualActiveMinutes: Double?
}

struct PersonalRecordDTO: Decodable, Equatable, Identifiable {
    struct Previous: Decodable, Equatable { let display: String; let date: Double }
    let id: String
    let subject: String
    let metric: String
    let value: Double
    let display: String
    let date: Double
    let source: String
    let previous: Previous?
    let isNew: Bool
}

struct MilestoneDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let detail: String
    let achievedAt: Double
}

struct InsightDTO: Decodable, Equatable, Identifiable {
    let id: String
    let text: String
    let basis: String
}

struct LoadRecoveryDayDTO: Decodable, Equatable {
    let date: String
    let activeMinutes: Double
    let sessions: Double
    let readiness: Double?
    let nextMorningReadiness: Double?
}

struct LoadRecoveryDTO: Decodable, Equatable {
    struct Relationship: Decodable, Equatable { let correlation: Double; let statement: String }
    let days: [LoadRecoveryDayDTO]
    let pairedDays: Double
    let relationship: Relationship?
}

struct ProgressOverviewDTO: Decodable, Equatable {
    let strain: StrainDayDTO
    let strainSignals: StrainSignalsDTO
    let todaySessions: [TodaySessionDTO]
    let body: BodySummaryDTO
    let consistency: ConsistencyDTO
    let records: [PersonalRecordDTO]
    let milestones: [MilestoneDTO]
    let insights: [InsightDTO]
    let loadRecovery: LoadRecoveryDTO
    let loadRecovery28: [LoadRecoveryDayDTO]
    let hasHistory: Bool
}

struct PerformanceDTO: Decodable, Equatable {
    struct Subject: Decodable, Equatable, Identifiable { let id: String; let label: String; let count: Double }
    struct Metric: Decodable, Equatable, Identifiable {
        let key: String
        let label: String
        let unit: String
        let higherIsBetter: Bool
        let estimated: Bool?
        var id: String { key }
    }
    struct Point: Decodable, Equatable, Identifiable {
        let t: Double
        let value: Double
        let source: String
        let label: String?
        var id: Double { t }
        var date: Date { Date(timeIntervalSince1970: t / 1000) }
    }
    struct Stats: Decodable, Equatable { let current: Double; let low: Double; let average: Double; let high: Double; let count: Double }
    struct Comparison: Decodable, Equatable { let current: Double; let reference: Double; let change: Double }

    let subjects: [Subject]
    let subject: String?
    let metrics: [Metric]
    let metric: Metric?
    let ranges: [String]
    let range: String?
    let points: [Point]
    let stats: Stats?
    let comparison: Comparison?
    let baseline: Double?
}

/// Formatting shared by Progress, from the metric's unit.
enum ProgressFormat {
    static func value(_ v: Double, unit: String) -> String {
        switch unit {
        case "min/km":
            let seconds = Int((v * 60).rounded())
            return String(format: "%d:%02d", seconds / 60, seconds % 60)
        case "km": return String(format: "%.2f", v)
        case "km/h": return String(format: "%.1f", v)
        case "kg": return v >= 1000 ? Int(v.rounded()).formatted(.number) : (v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : String(format: "%.1f", v))
        default: return Int(v.rounded()).formatted(.number)
        }
    }

    static func unitLabel(_ unit: String) -> String {
        unit == "min/km" ? "/km" : unit
    }

    static func rangeLabel(_ id: String) -> String {
        switch id {
        case "7d": return "7D"
        case "30d": return "30D"
        case "90d": return "90D"
        default: return "1Y"
        }
    }

    static func shortDay(_ key: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        guard let d = f.date(from: key) else { return key }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "EEE"
        return out.string(from: d)
    }
}
