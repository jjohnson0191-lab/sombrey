import SwiftUI

/// The dedicated destination for every wearable measurement Sombrey
/// collects — Home stays a concise daily snapshot; this is where the
/// user inspects each metric in depth with real historical trends.
/// Reached from Home (tapping the Today's Metrics card) and from
/// Settings, as a full-screen cover — same non-tab pattern as
/// `NutritionScreen`/`NotificationSettingsView`, not a new nav tick.
///
/// Every number here comes from `WearableManager`'s live state or a real
/// Convex query (`wearable:getMeasurementsByRange`,
/// `wearable:getRecentSleepSessions`, `sportPlusSessions:getRecentSessions`,
/// `sombreyWorkouts:listHistory`) — nothing is fabricated, and every
/// section has an honest empty/cold-start state instead of a zero.
struct VitalsScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @State private var todayHeartRate = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var recentTemperature = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var recentSleep = ConvexQuery<[SleepSessionSummaryDTO]>()
    @State private var recentSportSessions = ConvexQuery<[SportSessionSummaryDTO]>()
    @State private var recentWorkouts = ConvexQuery<[SombreyWorkoutSummaryDTO]>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .progress, showsNav: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("Vitals")
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    Spacer()
                    Button("Done") { dismiss() }
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.inkSoft)
                        .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
                }
                .padding(.top, 20)

                heartRateSection
                bloodOxygenSection
                temperatureSection
                bloodPressureSection
                activitySection
                sleepSection
                trainingSection
            }
            .padding(.bottom, 32)
        }
        .task {
            todayHeartRate.subscribe(to: "wearable:getMeasurementsByRange", with: ["metricType": "heart_rate", "sinceMs": startOfTodayMs])
            recentTemperature.subscribe(to: "wearable:getMeasurementsByRange", with: ["metricType": "skin_temperature", "sinceMs": thirtyDaysAgoMs])
            recentSleep.subscribe(to: "wearable:getRecentSleepSessions", with: ["limit": 30])
            recentSportSessions.subscribe(to: "sportPlusSessions:getRecentSessions", with: ["limit": 30])
            recentWorkouts.subscribe(to: "sombreyWorkouts:listHistory")
        }
    }

    private var startOfTodayMs: Double { Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000 }
    private var thirtyDaysAgoMs: Double { Date().addingTimeInterval(-30 * 24 * 3600).timeIntervalSince1970 * 1000 }

    // MARK: - Heart Rate

    private var restingHeartRateToday: Double? {
        todayHeartRate.value?.map(\.value).min()
    }

    private var todayHeartRateRange: (min: Double, max: Double)? {
        guard let values = todayHeartRate.value?.map(\.value), !values.isEmpty else { return nil }
        return (values.min()!, values.max()!)
    }

    private var liveHeartRate: WearableMeasurement? { wearableManager.latestMeasurements[.heartRate] }

    private var heartRateSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("HEART RATE")

            HStack(alignment: .top, spacing: 32) {
                VStack(alignment: .leading, spacing: 2) {
                    if let live = liveHeartRate {
                        Text("\(Int(live.value.rounded()))")
                            .font(StudioFont.hero(48, weight: .bold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                        Text("BPM · LIVE")
                            .font(StudioFont.body(11, weight: .semibold))
                            .tracking(1.1)
                            .foregroundStyle(StudioColor.accentInk)
                    } else if wearableManager.displayState == .connected {
                        Text("Measuring…")
                            .font(StudioFont.body(16, weight: .medium))
                            .foregroundStyle(StudioColor.inkFaint)
                    } else {
                        Text("—")
                            .font(StudioFont.hero(48, weight: .bold))
                            .foregroundStyle(StudioColor.inkFaint)
                        Text("Not connected")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("RESTING")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.inkSoft)
                    if let resting = restingHeartRateToday {
                        Text("\(Int(resting.rounded())) BPM")
                            .font(StudioFont.body(18, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                        Text("Today")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkSoft)
                    } else {
                        Text("—")
                            .font(StudioFont.body(18, weight: .semibold))
                            .foregroundStyle(StudioColor.inkFaint)
                        Text("Building baseline")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }

                if let range = todayHeartRateRange {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("TODAY")
                            .font(StudioFont.body(10, weight: .semibold))
                            .tracking(1.1)
                            .foregroundStyle(StudioColor.inkSoft)
                        Text("Min \(Int(range.min.rounded()))")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.ink)
                        Text("Max \(Int(range.max.rounded()))")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.ink)
                    }
                }
            }

            MetricHistoryChart(metricType: .heartRate, unit: "BPM", valueFormatter: { "\(Int($0.rounded()))" })
        }
        .studioCard()
    }

    // MARK: - Blood Oxygen

    private var bloodOxygenSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("BLOOD OXYGEN")
            if let spo2 = wearableManager.latestMeasurements[.spo2] {
                Text("\(Int(spo2.value.rounded()))%")
                    .font(StudioFont.hero(40, weight: .bold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("Training readiness signal, not a diagnostic measurement.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                Text("No recent measurement.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            MetricHistoryChart(metricType: .spo2, unit: "%", valueFormatter: { "\(Int($0.rounded()))" })
        }
        .studioCard()
    }

    // MARK: - Temperature

    private var temperatureBaseline: Double? {
        guard let values = recentTemperature.value?.map(\.value), values.count >= 5 else { return nil }
        let sorted = values.sorted()
        return sorted[sorted.count / 2]
    }

    private var temperatureSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("TEMPERATURE")
            if let latest = wearableManager.latestMeasurements[.skinTemperature] {
                if let baseline = temperatureBaseline {
                    let delta = latest.value - baseline
                    Text(String(format: "%+.1f°", delta))
                        .font(StudioFont.hero(40, weight: .bold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                    Text("vs. your recent baseline")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                } else {
                    Text(String(format: "%.1f°C", latest.value))
                        .font(StudioFont.hero(40, weight: .bold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                    Text("Building your baseline")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                Text("Skin temperature, not core body temperature.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                Text("No recent measurement.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            MetricHistoryChart(metricType: .skinTemperature, unit: "°C", valueFormatter: { String(format: "%.1f", $0) })
        }
        .studioCard()
    }

    // MARK: - Blood Pressure

    private var bloodPressureSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("BLOOD PRESSURE")
            if let systolic = wearableManager.latestMeasurements[.bloodPressureSystolic],
               let diastolic = wearableManager.latestMeasurements[.bloodPressureDiastolic] {
                Text("\(Int(systolic.value.rounded()))/\(Int(diastolic.value.rounded()))")
                    .font(StudioFont.hero(40, weight: .bold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("\(Self.dateTimeString(systolic.recordedAt)) · wearable-estimated, not a diagnostic reading")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                Text("No recent measurement.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Systolic").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkSoft)
                MetricHistoryChart(metricType: .bloodPressureSystolic, unit: "mmHg", valueFormatter: { "\(Int($0.rounded()))" })
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Diastolic").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkSoft)
                MetricHistoryChart(metricType: .bloodPressureDiastolic, unit: "mmHg", valueFormatter: { "\(Int($0.rounded()))" })
            }
        }
        .studioCard()
    }

    // MARK: - Activity

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("ACTIVITY")
            HStack(spacing: 24) {
                MetricView(label: "Steps", value: activityText(.steps, format: { "\(Int($0.rounded()))" }), unit: nil)
                MetricView(label: "Distance", value: activityText(.distanceMeters, format: { String(format: "%.1f", $0 / 1000) }), unit: wearableManager.latestMeasurements[.distanceMeters] == nil ? nil : "km")
                MetricView(label: "Active Calories", value: activityText(.activeCalories, format: { "\(Int($0.rounded()))" }), unit: wearableManager.latestMeasurements[.activeCalories] == nil ? nil : "kcal")
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Steps").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkSoft)
                MetricHistoryChart(metricType: .steps, unit: "steps", valueFormatter: { "\(Int($0.rounded()))" })
            }
        }
        .studioCard()
    }

    private func activityText(_ type: WearableMetricType, format: (Double) -> String) -> String {
        wearableManager.latestMeasurements[type].map { format($0.value) } ?? "—"
    }

    // MARK: - Sleep

    private var sleepSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("SLEEP")
            if let latest = recentSleep.value?.first {
                let hours = latest.totalSleepMinutes / 60
                let minutes = latest.totalSleepMinutes % 60
                Text("\(hours)h \(minutes)m")
                    .font(StudioFont.hero(40, weight: .bold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("\(Self.timeOnlyString(latest.startedAt)) – \(Self.timeOnlyString(latest.endedAt))")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                if let stages = latest.stages, !stages.isEmpty {
                    let byStage = Dictionary(grouping: stages, by: \.stage).mapValues { $0.reduce(0) { $0 + $1.durationMinutes } }
                    HStack(spacing: 16) {
                        ForEach(["light", "deep", "rem"], id: \.self) { stage in
                            if let minutes = byStage[stage] {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(stage.capitalized).font(StudioFont.body(11)).foregroundStyle(StudioColor.inkSoft)
                                    Text("\(minutes / 60)h \(minutes % 60)m").font(StudioFont.body(13, weight: .medium)).foregroundStyle(StudioColor.ink)
                                }
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            } else if wearableManager.pairedDevice == nil {
                Text("Wear the band overnight to begin collecting sleep data.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                Text("No sleep synced yet.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            DurationHistoryChart(points: (recentSleep.value ?? []).map {
                .init(date: Date(timeIntervalSince1970: $0.endedAt / 1000), minutes: Double($0.totalSleepMinutes))
            })
        }
        .studioCard()
    }

    // MARK: - Training

    private var trainingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("TRAINING")
            let sessions = recentSportSessions.value ?? []
            let workouts = recentWorkouts.value ?? []
            if let latest = sessions.first {
                Text(SombreySportType.all.first { $0.rawValue == latest.sportType }?.displayName ?? "Activity")
                    .font(StudioFont.body(16, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                HStack(spacing: 16) {
                    if let duration = latest.durationSeconds { Text("\(Int(duration) / 60) min") }
                    if let hr = latest.averageHeartRate { Text("\(Int(hr.rounded())) BPM avg") }
                    if let calories = latest.calories { Text("\(Int(calories.rounded())) kcal") }
                }
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .monospacedDigit()
            } else if workouts.isEmpty {
                Text("No training sessions yet.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            Text("\(workouts.count) training session(s) in your history")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
            DurationHistoryChart(points: sessions.compactMap { session in
                guard let duration = session.durationSeconds else { return nil }
                return .init(date: Date(timeIntervalSince1970: session.startedAt / 1000), minutes: duration / 60)
            }, accentColor: StudioColor.training)
        }
        .studioCard()
    }

    // MARK: - Shared

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(StudioFont.body(11, weight: .semibold))
            .tracking(1.3)
            .foregroundStyle(StudioColor.inkSoft)
    }

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter
    }()

    private static func dateTimeString(_ recordedAtMs: Double) -> String {
        dateTimeFormatter.string(from: Date(timeIntervalSince1970: recordedAtMs / 1000))
    }

    private static let timeOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    private static func timeOnlyString(_ epochMs: Double) -> String {
        timeOnlyFormatter.string(from: Date(timeIntervalSince1970: epochMs / 1000))
    }
}
