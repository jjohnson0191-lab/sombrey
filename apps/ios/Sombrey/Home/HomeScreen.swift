import SwiftUI

/// Home — the daily Sombrey command center. Readiness remains the top
/// visual moment, but Home no longer stops there: band connection state,
/// today's real wearable metrics, sleep, training, and nutrition all get
/// their own honest summary, with a short data-derived insight closing
/// the screen. Ported behaviorally from
/// `apps/mobile/src/screens/HomeScreen.tsx` (not translated 1:1).
///
/// Conceptual separation kept throughout this screen: band data (the
/// wearable's own measurements) versus Sombrey intelligence
/// (interpretation of that data, e.g. readiness, the daily insight). A
/// section only ever renders a value that was actually synced/computed —
/// no field here is ever fabricated or defaulted to zero.
///
/// The readiness score comes from `readiness:getLatest` — a real,
/// server-computed `ReadinessResult` (see `convex/readiness/scoring.ts`
/// for the algorithm) — never fabricated locally. `ReadinessIndicatorView`
/// itself already handles "not enough data yet" honestly when `score` is
/// nil, so no separate loading/empty state is needed here, and this
/// screen does not modify that component or the algorithm it reflects.
struct HomeScreen: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @State private var showingNutrition = false
    @State private var showingBandPairing = false
    @State private var readiness = ConvexQuery<ReadinessResultDTO?>()
    @State private var sleep = ConvexQuery<[SleepSessionSummaryDTO]>()
    @State private var sportSessions = ConvexQuery<[SportSessionSummaryDTO]>()
    @State private var workouts = ConvexQuery<[SombreyWorkoutSummaryDTO]>()
    @State private var nutritionProgress = ConvexQuery<NutritionProgress>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .home, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.top, 20)
                    .studioReveal(index: 0)

                ReadinessIndicatorView(result: readiness.value.flatMap { $0 }?.toReadinessResult(), tone: .paper)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, 24)
                    .studioReveal(index: 1)

                if let error = appState.userLoadError {
                    Text("Couldn't load your account: \(error)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.danger)
                        .padding(.top, 16)
                }

                bandStatusCard
                    .padding(.top, 28)
                    .studioReveal(index: 2)

                metricsCard
                    .padding(.top, 16)
                    .studioReveal(index: 3)

                sleepCard
                    .padding(.top, 16)
                    .studioReveal(index: 4)

                trainingCard
                    .padding(.top, 16)
                    .studioReveal(index: 5)

                nutritionCard
                    .padding(.top, 16)
                    .studioReveal(index: 6)

                insightCard
                    .padding(.top, 16)
                    .studioReveal(index: 6)

                ctaRow
                    .padding(.top, 28)
                    .padding(.bottom, 8)
                    .studioReveal(index: 6)
            }
        }
        .fullScreenCover(isPresented: $showingNutrition) {
            NutritionScreen()
        }
        .fullScreenCover(isPresented: $showingBandPairing) {
            BandPairingView { showingBandPairing = false }
        }
        .task {
            readiness.subscribe(to: "readiness:getLatest")
            sleep.subscribe(to: "wearable:getRecentSleepSessions")
            sportSessions.subscribe(to: "sportPlusSessions:getRecentSessions")
            workouts.subscribe(to: "sombreyWorkouts:listHistory")
            nutritionProgress.subscribe(to: "nutritionLogs:getTodayProgress")
        }
        .onChange(of: appState.pendingNutritionDeepLink) { _, pending in
            guard pending else { return }
            showingNutrition = true
            appState.pendingNutritionDeepLink = false
        }
        .onAppear {
            // `.onChange` above only fires on a value transition, but
            // this view is recreated (`.id(appState.selectedTab)`) after
            // the flag is already set to true by the deep-link handler,
            // so the initial-appear case needs its own check too.
            if appState.pendingNutritionDeepLink {
                showingNutrition = true
                appState.pendingNutritionDeepLink = false
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            Text(greeting)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.paperSoft)
            Spacer()
            WearableStatusBadge(
                state: wearableManager.displayState,
                batteryPct: wearableManager.status?.batteryPct
            )
        }
    }

    private var greeting: String {
        if let firstName = appState.currentUser?.name?.split(separator: " ").first {
            return "Good morning, \(firstName)"
        }
        return "Good morning"
    }

    // MARK: - Sombrey Band status

    /// Prominent, tappable — distinct from the small header badge above,
    /// which stays as an ambient glance indicator. Tapping when nothing
    /// is paired opens the same real pairing flow Settings uses; tapping
    /// once paired hands off to Settings' own Wearable/Band section,
    /// rather than a second Bluetooth implementation living here.
    private var bandStatusCard: some View {
        Button {
            if wearableManager.displayState == .notPaired {
                showingBandPairing = true
            } else {
                appState.selectedTab = .settings
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("SOMBREY BAND")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                    HStack(spacing: 8) {
                        Circle()
                            .fill(wearableManager.displayState == .connected ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
                            .frame(width: 8, height: 8)
                        Text(bandStatusText)
                            .font(StudioFont.body(16, weight: .medium))
                            .foregroundStyle(StudioColor.ink)
                    }
                    if wearableManager.displayState == .notPaired {
                        Text("Connect your Sombrey Band to start collecting real data.")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                Spacer()
                if wearableManager.displayState == .connected, let battery = wearableManager.status?.batteryPct {
                    Text("\(Int(battery.rounded()))%")
                        .font(StudioFont.body(20, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                } else if wearableManager.displayState == .notPaired {
                    Text("Connect Band")
                        .font(StudioFont.body(12, weight: .medium))
                        .foregroundStyle(StudioColor.accentInk)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
        }
        .buttonStyle(.plain)
        .studioCard()
    }

    private var bandStatusText: String {
        switch wearableManager.displayState {
        case .connected: return "Connected"
        case .syncing: return "Syncing"
        case .connecting: return "Pairing…"
        case .searching: return "Searching…"
        case .reconnecting: return "Reconnecting…"
        case .notPaired: return "Not connected"
        case .disconnected: return "Disconnected"
        case .error: return "Connection error"
        case .unavailable: return "Bluetooth unavailable"
        }
    }

    // MARK: - Today's metrics

    private var metricsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("TODAY'S METRICS")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)

            if wearableManager.pairedDevice == nil {
                Text("Put on your Sombrey Band to begin collecting data.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else if wearableManager.latestMeasurements.isEmpty {
                Text("Waiting for your first sync…")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                let columns = [GridItem(.flexible(), spacing: 20), GridItem(.flexible(), spacing: 20)]
                LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                    MetricView(label: "Heart Rate", value: metricText(.heartRate, format: { "\(Int($0.rounded()))" }), unit: heartRate == nil ? nil : "BPM")
                    MetricView(label: "SpO2", value: metricText(.spo2, format: { "\(Int($0.rounded()))" }), unit: spo2 == nil ? nil : "%")
                    MetricView(label: "Temperature", value: metricText(.skinTemperature, format: { String(format: "%.1f", $0) }), unit: temperature == nil ? nil : "°C")
                    MetricView(label: "Blood Pressure", value: bloodPressureText, unit: nil)
                    MetricView(label: "Steps", value: metricText(.steps, format: { "\(Int($0.rounded()))" }), unit: nil)
                    MetricView(label: "Distance", value: metricText(.distanceMeters, format: { String(format: "%.1f", $0 / 1000) }), unit: distance == nil ? nil : "km")
                    MetricView(label: "Calories", value: metricText(.activeCalories, format: { "\(Int($0.rounded()))" }), unit: activeCalories == nil ? nil : "kcal")
                }
            }
        }
        .studioCard()
    }

    private var heartRate: WearableMeasurement? { wearableManager.latestMeasurements[.heartRate] }
    private var spo2: WearableMeasurement? { wearableManager.latestMeasurements[.spo2] }
    private var temperature: WearableMeasurement? { wearableManager.latestMeasurements[.skinTemperature] }
    private var distance: WearableMeasurement? { wearableManager.latestMeasurements[.distanceMeters] }
    private var activeCalories: WearableMeasurement? { wearableManager.latestMeasurements[.activeCalories] }

    private func metricText(_ type: WearableMetricType, format: (Double) -> String) -> String {
        wearableManager.latestMeasurements[type].map { format($0.value) } ?? "—"
    }

    private var bloodPressureText: String {
        guard let systolic = wearableManager.latestMeasurements[.bloodPressureSystolic],
              let diastolic = wearableManager.latestMeasurements[.bloodPressureDiastolic] else {
            return "—"
        }
        return "\(Int(systolic.value.rounded()))/\(Int(diastolic.value.rounded()))"
    }

    // MARK: - Sleep

    private var sleepCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SLEEP")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)

            if let latest = sleep.value?.first {
                let hours = latest.totalSleepMinutes / 60
                let minutes = latest.totalSleepMinutes % 60
                Text("\(hours)h \(minutes)m")
                    .font(StudioFont.body(20, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                if let stages = latest.stages, !stages.isEmpty {
                    let byStage = Dictionary(grouping: stages, by: \.stage).mapValues { $0.reduce(0) { $0 + $1.durationMinutes } }
                    Text(["light", "deep", "rem"].compactMap { stage in
                        byStage[stage].map { "\(stage.capitalized) \($0)m" }
                    }.joined(separator: " · "))
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            } else if wearableManager.pairedDevice == nil {
                Text("Put on your Sombrey Band to begin collecting sleep data.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                Text("No sleep synced yet.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
        .studioCard()
    }

    // MARK: - Training

    private var trainingCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("TRAINING")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(StudioColor.training)
                if wearableManager.activeSportSession != nil {
                    Text("IN PROGRESS")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.training)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(StudioColor.training.opacity(0.14), in: Capsule())
                }
            }

            if let active = wearableManager.activeSportSession {
                Text(sportTypeName(active.sportType))
                    .font(StudioFont.body(16, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                HStack(spacing: 16) {
                    if let update = active.liveUpdate {
                        Text(durationText(seconds: update.durationSeconds))
                        Text("\(update.heartRate) BPM")
                        Text("\(update.calories) kcal")
                    } else {
                        Text(durationText(seconds: Int(Date().timeIntervalSince(active.startedAt))))
                    }
                }
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .monospacedDigit()
            } else if let session = todaysSportSession {
                Text(sportTypeName(session.sportType ?? 0))
                    .font(StudioFont.body(16, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                HStack(spacing: 16) {
                    if let duration = session.durationSeconds { Text(durationText(seconds: Int(duration))) }
                    if let hr = session.averageHeartRate { Text("\(Int(hr.rounded())) BPM avg") }
                    if let calories = session.calories { Text("\(Int(calories.rounded())) kcal") }
                    if let distance = session.distanceMeters { Text(String(format: "%.1f km", distance / 1000)) }
                }
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .monospacedDigit()
            } else if let workout = todaysWorkout {
                Text(workout.name)
                    .font(StudioFont.body(16, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                Text("Logged today")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            } else {
                Text("No workout yet today")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
                Button("Start Training") { appState.selectedTab = .train }
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.accentInk)
                    .padding(.top, 2)
            }
        }
        .studioCard()
    }

    private var todaysSportSession: SportSessionSummaryDTO? {
        (sportSessions.value ?? []).first { Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.startedAt / 1000)) }
    }

    private var todaysWorkout: SombreyWorkoutSummaryDTO? {
        (workouts.value ?? []).first { Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.startedAt / 1000)) }
    }

    private func sportTypeName(_ rawValue: Int) -> String {
        SombreySportType.all.first { $0.rawValue == rawValue }?.displayName ?? "Activity"
    }

    private func durationText(seconds: Int) -> String {
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }

    // MARK: - Nutrition

    private var nutritionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("NUTRITION")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.nutrition)

            if let progress = nutritionProgress.value, progress.mealsCompleted > 0 {
                Text("\(Int(progress.caloriesConsumed.rounded())) kcal")
                    .font(StudioFont.body(20, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("\(Int(progress.proteinConsumed.rounded()))g protein · \(progress.mealsCompleted) meal\(progress.mealsCompleted == 1 ? "" : "s") logged")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .monospacedDigit()
            } else {
                Text("No meals logged yet today.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
                Button("Log your first meal") { showingNutrition = true }
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.accentInk)
                    .padding(.top, 2)
            }
        }
        .studioCard()
    }

    // MARK: - Daily insight

    /// A single, honest, data-derived sentence — the highest-weighted
    /// real contributing factor the readiness algorithm already
    /// produced (see `convex/readiness/scoring.ts`'s `ComponentResult.
    /// description`), never a new claim invented on this screen. No
    /// medical language, no reaction to a single isolated reading (the
    /// algorithm's own descriptions already reflect a personal baseline,
    /// not one data point), and no action/recommendation is appended
    /// here regardless of coaching mode — this card only ever states
    /// what the data shows, which is compatible with every coaching mode
    /// including tracking_only.
    private var insightCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TODAY'S INSIGHT")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            Text(insightText)
                .font(StudioFont.body(14))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .studioCard()
    }

    private var insightText: String {
        guard let result = readiness.value.flatMap({ $0 })?.toReadinessResult() else {
            return "Building your baseline — check back after a few more days of data."
        }
        guard let topFactor = result.contributingFactors.first else {
            return result.missingInputs.isEmpty
                ? "Not enough data yet to surface an insight."
                : "Still collecting data — check back soon."
        }
        return topFactor.description
    }

    // MARK: - CTAs

    private var ctaRow: some View {
        HStack(spacing: 12) {
            Button("Start workout") { appState.selectedTab = .train }
                .buttonStyle(.illuminatedCTA)
            Button("Ask Sombrey") { appState.selectedTab = .aiCoach }
                .buttonStyle(.outlineCTA)
        }
    }
}

/// The one card surface Home's new sections share — restrained glass,
/// matching the existing `.ultraThinMaterial` + soft ink border treatment
/// already used elsewhere (`BandPairingView`'s device rows,
/// `MealScheduleView`'s slot rows), not a new visual language.
private struct StudioCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1)
            }
    }
}

private extension View {
    func studioCard() -> some View {
        modifier(StudioCardModifier())
    }
}
