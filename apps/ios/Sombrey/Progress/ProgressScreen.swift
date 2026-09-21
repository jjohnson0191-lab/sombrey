import SwiftUI
import Charts
import ConvexMobile

/// Real data only: `measurements:list` and `progressPhotos:list` are the
/// same existing, unmodified Convex queries `apps/mobile`'s
/// ProgressScreen already uses.
///
/// Phase 3 readiness expansion: adds the Recovery surface the training-
/// architecture spec asks for — sleep, recent vitals, training load/
/// history, and a readiness trend — reusing this screen's own existing
/// section pattern and chart treatment (the weight `Chart`/`LineMark`
/// above) rather than introducing new visual language. Blood pressure/
/// SpO2/temperature are shown as plain informational readings, never
/// framed as medical or diagnostic.
struct ProgressScreen: View {
    @Environment(AppState.self) private var appState
    @State private var measurements = ConvexQuery<[MeasurementEntry]>()
    @State private var photos = ConvexQuery<[ProgressPhotoEntry]>()
    @State private var recentVitals = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var recentSleep = ConvexQuery<[SleepSessionSummaryDTO]>()
    @State private var recentSportSessions = ConvexQuery<[SportSessionSummaryDTO]>()
    @State private var recentWorkouts = ConvexQuery<[SombreyWorkoutSummaryDTO]>()
    @State private var readinessHistory = ConvexQuery<[ReadinessResultDTO]>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .progress, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 28) {
                Text("Progress")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                weightSection
                photosSection
                readinessTrendSection
                sleepSection
                vitalsSection
                trainingHistorySection
            }
            .padding(.bottom, 24)
        }
        .task {
            measurements.subscribe(to: "measurements:list")
            photos.subscribe(to: "progressPhotos:list")
            recentVitals.subscribe(to: "wearable:getRecentMeasurements")
            recentSleep.subscribe(to: "wearable:getRecentSleepSessions")
            recentSportSessions.subscribe(to: "sportPlusSessions:getRecentSessions")
            recentWorkouts.subscribe(to: "sombreyWorkouts:listHistory")
            readinessHistory.subscribe(to: "readiness:getHistory")
        }
    }

    @ViewBuilder
    private var weightSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WEIGHT")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)

            if measurements.isLoading {
                ProgressView().tint(StudioColor.ink)
            } else if let error = measurements.errorMessage {
                Text("Couldn't load measurements: \(error)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.danger)
            } else {
                let entries = (measurements.value ?? []).filter { $0.weight != nil }
                if let latest = entries.last, let weight = latest.weight {
                    HeroNumberText(text: String(format: "%.1f", weight), size: .md, tone: .ink)
                    Text("kg · most recent entry")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                if entries.count > 1 {
                    Chart(entries) { entry in
                        LineMark(
                            x: .value("Date", Date(timeIntervalSince1970: entry.date / 1000)),
                            y: .value("Weight", entry.weight ?? 0)
                        )
                        .foregroundStyle(StudioColor.accentInk)
                        .interpolationMethod(.monotone)
                    }
                    .chartYAxis { AxisMarks(position: .trailing) }
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                    .frame(height: 140)
                    .padding(.top, 4)
                } else if entries.isEmpty {
                    Text("No weight entries logged yet.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
        }
    }

    @ViewBuilder
    private var photosSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("PROGRESS PHOTOS")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            let count = photos.value?.count ?? 0
            Text(count > 0 ? "\(count) photo(s) logged" : "No progress photos yet.")
                .font(StudioFont.body(13))
                .foregroundStyle(count > 0 ? StudioColor.ink : StudioColor.inkFaint)
        }
    }

    @ViewBuilder
    private var readinessTrendSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("READINESS TREND")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            let scored = (readinessHistory.value ?? []).filter { $0.score != nil }.reversed()
            if scored.count > 1 {
                Chart(Array(scored.enumerated()), id: \.offset) { _, entry in
                    LineMark(
                        x: .value("Date", entry.date),
                        y: .value("Readiness", Double(entry.score!))
                    )
                    .foregroundStyle(StudioColor.accentInk)
                    .interpolationMethod(.monotone)
                }
                .chartYScale(domain: 0...100)
                .chartYAxis { AxisMarks(position: .trailing) }
                .chartXAxis(.hidden)
                .frame(height: 100)
            } else {
                Text("Not enough readiness history yet — check back after a few more days of wearable data.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    @ViewBuilder
    private var sleepSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("SLEEP")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            if let latest = recentSleep.value?.first {
                let hours = latest.totalSleepMinutes / 60
                let minutes = latest.totalSleepMinutes % 60
                Text("\(hours)h \(minutes)m most recent night")
                    .font(StudioFont.body(15, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                if let stages = latest.stages, !stages.isEmpty {
                    let byStage = Dictionary(grouping: stages, by: \.stage).mapValues { $0.reduce(0) { $0 + $1.durationMinutes } }
                    Text(["light", "deep", "rem"].compactMap { stage in
                        byStage[stage].map { "\(stage.capitalized) \($0)m" }
                    }.joined(separator: " · "))
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            } else {
                Text("No sleep data synced yet.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    @ViewBuilder
    private var vitalsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("RECENT VITALS")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            let readings = recentVitals.value ?? []
            if readings.isEmpty {
                Text("No wearable vitals synced yet.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    if let hr = latestValue(readings, metric: "heart_rate") {
                        Text("Heart rate: \(Int(hr)) bpm")
                    }
                    if let spo2 = latestValue(readings, metric: "spo2") {
                        Text("SpO2: \(Int(spo2))%")
                    }
                    if let temp = latestValue(readings, metric: "skin_temperature") {
                        Text(String(format: "Skin temperature: %.1f°C", temp))
                    }
                    if let sys = latestValue(readings, metric: "blood_pressure_systolic"),
                       let dia = latestValue(readings, metric: "blood_pressure_diastolic") {
                        Text("Blood pressure: \(Int(sys))/\(Int(dia))")
                    }
                }
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.ink)
                Text("From your Sombrey Band — training readiness signals, not a medical measurement.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .padding(.top, 2)
            }
        }
    }

    private func latestValue(_ readings: [WearableMeasurementDTO], metric: String) -> Double? {
        readings.filter { $0.metricType == metric }.max(by: { $0.recordedAt < $1.recordedAt })?.value
    }

    @ViewBuilder
    private var trainingHistorySection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("TRAINING LOAD")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            let workouts = recentWorkouts.value ?? []
            let sportSessions = recentSportSessions.value ?? []
            if workouts.isEmpty && sportSessions.isEmpty {
                Text("No training sessions logged yet.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                let weekAgo = Date().timeIntervalSince1970 * 1000 - 7 * 24 * 60 * 60 * 1000
                let sessionsThisWeek = sportSessions.filter { $0.startedAt >= weekAgo }.count
                let workoutsThisWeek = workouts.filter { $0.startedAt >= weekAgo }.count
                Text("\(workoutsThisWeek) training session(s) and \(sessionsThisWeek) wearable-tracked activity session(s) this week")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.ink)
                Text("\(workouts.count) session(s) in your full history")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }
}

// MARK: - Convex wire DTOs (only the fields this screen needs)

struct WearableMeasurementDTO: Decodable {
    let metricType: String
    let value: Double
    let recordedAt: Double
}

struct SleepStageDTO: Decodable {
    let stage: String
    let durationMinutes: Int
}

struct SleepSessionSummaryDTO: Decodable {
    let totalSleepMinutes: Int
    let stages: [SleepStageDTO]?
    // Added for VitalsScreen's sleep timing/trend — same query already
    // returns these (`wearableSleepSessions`' own required fields), this
    // screen just didn't decode them before.
    let startedAt: Double
    let endedAt: Double
}

struct SportSessionSummaryDTO: Decodable {
    let startedAt: Double
    let durationSeconds: Double?
    // Added for HomeScreen's Training card — same query
    // (`sportPlusSessions:getRecentSessions`) already returns these; this
    // screen just didn't need them before.
    let sportType: Int?
    let calories: Double?
    let averageHeartRate: Double?
    let distanceMeters: Double?
}

struct SombreyWorkoutSummaryDTO: Decodable {
    let name: String
    let startedAt: Double
}
