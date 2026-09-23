import SwiftUI
import UIKit

/// Home — the daily Sombrey command center, hierarchy in strict order:
/// Readiness (the dominant hero, the one thing that answers "how ready
/// am I") → live Heart Rate/band connection → Today's Vitals → Sleep →
/// Training → Nutrition → Today's Insight. Ported behaviorally from
/// `apps/mobile/src/screens/HomeScreen.tsx` (not translated 1:1).
///
/// Conceptual separation kept throughout this screen: band data (the
/// wearable's own measurements) versus Sombrey intelligence
/// (interpretation of that data, e.g. readiness, the daily insight). A
/// section only ever renders a value that was actually synced/computed —
/// no field here is ever fabricated or defaulted to zero, and every
/// measurement flowing in has already passed
/// `WearableMetricType.isPhysicallyPlausible` at the source
/// (`QCBandSDKService.emit`), so a sentinel/zero-filled reading (the
/// class of bug that made temperature briefly flash 0.0°C on a real
/// device) can never reach this screen.
///
/// The readiness score comes from `readiness:getLatest` — a real,
/// server-computed `ReadinessResult` (see `convex/readiness/scoring.ts`
/// for the algorithm, unchanged) — never fabricated locally.
/// `ReadinessGauge` renders it as the screen's dominant instrument and
/// handles "not enough data yet" honestly when `score` is nil.
struct HomeScreen: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @Environment(TrainingSessionManager.self) private var trainingSession
    @State private var showingBandPairing = false
    @State private var showingVitals = false
    @State private var showingDiagnostics = false
    @State private var readiness = ConvexQuery<ReadinessResultDTO?>()
    @State private var sleep = ConvexQuery<[SleepSessionSummaryDTO]>()
    @State private var sportSessions = ConvexQuery<[SportSessionSummaryDTO]>()
    @State private var workouts = ConvexQuery<[SombreyWorkoutSummaryDTO]>()
    @State private var nutritionProgress = ConvexQuery<NutritionProgress>()
    @State private var todayHeartRate = ConvexQuery<[WearableMeasurementDTO]>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .home, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.top, 16)
                    .studioReveal(index: 0)

                readinessHero
                    .padding(.top, 22)
                    .studioReveal(index: 1)

                if let error = appState.userLoadError {
                    Text("Couldn't load your account: \(error)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.danger)
                        .padding(.top, 16)
                }

                liveHeartRateCard
                    .padding(.top, 24)
                    .studioReveal(index: 2)

                vitalsCard
                    .padding(.top, 16)
                    .studioReveal(index: 3)

                // Activity sits in the same tier as Today's Vitals — it IS
                // today's band data — as its own day-dial instrument.
                ActivityDialInstrument(
                    steps: stepsToday,
                    activeCalories: activeCaloriesToday,
                    distance: distanceToday,
                    isPaired: wearableManager.pairedDevice != nil
                )
                .padding(.top, 16)
                .studioReveal(index: 4)

                SleepTimelineInstrument(
                    sessions: sleep.value,
                    isPaired: wearableManager.pairedDevice != nil,
                    isLoading: sleep.isLoading
                )
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
        .fullScreenCover(isPresented: $showingBandPairing) {
            BandPairingView { showingBandPairing = false }
        }
        .fullScreenCover(isPresented: $showingVitals) {
            VitalsScreen()
        }
        .task {
            readiness.subscribe(to: "readiness:getLatest")
            sleep.subscribe(to: "wearable:getRecentSleepSessions")
            sportSessions.subscribe(to: "sportPlusSessions:getRecentSessions")
            workouts.subscribe(to: "sombreyWorkouts:listHistory")
            nutritionProgress.subscribe(to: "nutritionLogs:getTodayProgress")
            todayHeartRate.subscribe(to: "wearable:getMeasurementsByRange", with: [
                "metricType": "heart_rate",
                "sinceMs": Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000,
            ])
        }
    }

    /// The masthead: the Sombrey faceplate (wordmark + a mark that is a
    /// miniature of the Sombrey Score gauge, its indicator at today's real
    /// score) and the band's state, above the instrument clock and an
    /// understated greeting. Real device time only (see `HomeClock`).
    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                SombreyWordmark(score: currentScore)
                Spacer()
                WearableStatusBadge(
                    state: wearableManager.displayState,
                    batteryPct: wearableManager.status?.batteryPct
                )
            }
            HomeClock(firstName: firstName)
        }
    }

    private var currentScore: Int? {
        readiness.value.flatMap { $0 }?.score.map { Int($0.rounded()) }
    }

    private var firstName: String? {
        appState.currentUser?.name?.split(separator: " ").first.map(String.init)
    }

    // MARK: - Readiness hero

    /// The central Sombrey instrument — everything below it is
    /// subordinate. A rounded, dark glass bezel (continuous 28pt corners —
    /// deliberate, not a pill) with the same restrained backlight the
    /// gauge always had, now held inside the instrument's own face.
    /// `ReadinessGauge` owns the reading and its opened detail.
    private var readinessHero: some View {
        ReadinessGauge(result: readiness.value.flatMap { $0 }?.toReadinessResult(), isLoading: readiness.isLoading)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(StudioColor.env0.opacity(0.34))
                    RadialGradient(
                        colors: [StudioColor.env2.opacity(0.38), .clear],
                        center: UnitPoint(x: 0.78, y: 0.42), startRadius: 0, endRadius: 240
                    )
                    LinearGradient(
                        colors: [StudioColor.paper.opacity(0.06), .clear],
                        startPoint: .top, endPoint: .center
                    )
                }
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .strokeBorder(
                            LinearGradient(colors: [StudioColor.paper.opacity(0.20), StudioColor.paper.opacity(0.04)], startPoint: .top, endPoint: .bottom),
                            lineWidth: 1
                        )
                }
                .shadow(color: StudioColor.env0.opacity(0.28), radius: 22, y: 12)
                .allowsHitTesting(false)
            }
    }

    // MARK: - Live heart rate / band connection

    private static let liveStaleThreshold: TimeInterval = 45

    /// Heart rate is now its own dominant section immediately beneath
    /// Readiness — not a grid cell it competes with. Also carries the
    /// band connection affordance (tap to pair when nothing's connected,
    /// otherwise hands off to Settings' Wearable/Band section) so Home
    /// still has exactly one place to connect/reconnect, matching the
    /// previous `bandStatusCard`'s behavior, just recomposed here.
    private var liveHeartRateCard: some View {
        Button {
            if wearableManager.displayState == .notPaired {
                showingBandPairing = true
            } else if wearableManager.displayState == .connected {
                showingVitals = true
            } else {
                appState.selectedTab = .settings
            }
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(wearableManager.displayState == .connected ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
                        .frame(width: 6, height: 6)
                    Text(bandStatusText.uppercased())
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.inkSoft)
                    Spacer()
                    if wearableManager.displayState == .connected, let battery = wearableManager.status?.batteryPct {
                        Text("\(Int(battery.rounded()))%")
                            .font(StudioFont.body(11, weight: .medium))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioColor.inkFaint)
                }

                if wearableManager.displayState == .notPaired {
                    Text("Connect your Sombrey Band")
                        .font(StudioFont.body(18, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text("Start collecting real heart rate, sleep, and activity data.")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkFaint)
                } else {
                    heartRateReadout
                }
            }
        }
        .buttonStyle(.plain)
        .studioCard()
        // Developer diagnostics exist only in debug builds — never in a
        // production (TestFlight / App Store) build.
        #if DEBUG
        .onLongPressGesture(minimumDuration: 1.2) {
            showingDiagnostics = true
        }
        .sheet(isPresented: $showingDiagnostics) {
            WearableDiagnosticsView()
        }
        #endif
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

    /// Live BPM alongside today's resting HR — a genuinely different,
    /// historically-derived number (the day's minimum heart-rate
    /// reading), never just a copy of whatever the live value currently
    /// reads. `TimelineView` gives an honest, continuously-updating
    /// freshness readout and lets a live reading fall back to
    /// "Measuring…" on its own once it's actually stale — never a BPM
    /// frozen on screen well after the last real tick.
    @ViewBuilder
    private var heartRateReadout: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let secondsSinceReading = heartRate.map { context.date.timeIntervalSince($0.recordedAt) }
            let isFresh = (secondsSinceReading ?? .infinity) < Self.liveStaleThreshold

            HStack(alignment: .top, spacing: 28) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("HEART RATE")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.inkSoft)
                    if let live = heartRate, isFresh {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(Int(live.value.rounded()))")
                                .font(StudioFont.hero(40, weight: .bold))
                                .foregroundStyle(StudioColor.ink)
                                .monospacedDigit()
                            VStack(alignment: .leading, spacing: 0) {
                                Text("BPM")
                                    .font(StudioFont.body(11, weight: .semibold))
                                    .foregroundStyle(StudioColor.inkSoft)
                                Text("LIVE")
                                    .font(StudioFont.body(10, weight: .semibold))
                                    .foregroundStyle(StudioColor.accentInk)
                            }
                        }
                        Text(Self.freshnessText(secondsSinceReading))
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkFaint)
                    } else if wearableManager.displayState == .connected {
                        Text("Measuring…")
                            .font(StudioFont.body(16, weight: .medium))
                            .foregroundStyle(StudioColor.inkFaint)
                    } else {
                        Text("—")
                            .font(StudioFont.hero(40, weight: .bold))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("RESTING")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.inkSoft)
                    if let resting = todayRestingHeartRate {
                        Text("\(Int(resting.rounded()))")
                            .font(StudioFont.hero(24, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                        Text("BPM today")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkSoft)
                    } else {
                        Text("Building baseline")
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
            }
        }
    }

    private static func freshnessText(_ seconds: TimeInterval?) -> String {
        guard let seconds, seconds.isFinite else { return "" }
        if seconds < 3 { return "Updated just now" }
        return "Updated \(Int(seconds))s ago"
    }

    // MARK: - Today's vitals

    /// Tappable — opens Vitals, where every metric (and its history) can
    /// be inspected in depth. Home only ever shows a concise snapshot.
    /// Heart rate lives in its own section above; this is everything
    /// else that has real current data.
    private var vitalsCard: some View {
        Button {
            showingVitals = true
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("TODAY'S VITALS")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                    Spacer()
                    if let lastSync = wearableManager.lastSyncAt {
                        Text("Synced \(Self.timeOnlyFormatter.string(from: lastSync))")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioColor.inkFaint)
                }

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
                        MetricView(label: "SpO2", value: metricText(.spo2, format: { "\(Int($0.rounded()))" }), unit: spo2 == nil ? nil : "%")
                        MetricView(label: "Temperature", value: metricText(.skinTemperature, format: { String(format: "%.1f", $0) }), unit: temperature == nil ? nil : "°C")
                        MetricView(label: "Blood Pressure", value: bloodPressureText, unit: nil)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .studioCard()
    }

    /// One decimal below 10 kcal so an early-day reading (the band
    /// counts ~0.025 kcal per step) doesn't round a real, positive value
    /// down to a misleading "0".
    static func kilocalorieText(_ kcal: Double) -> String {
        kcal < 10 ? String(format: "%.1f", kcal) : "\(Int(kcal.rounded()))"
    }

    private static let timeOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    private var heartRate: WearableMeasurement? { wearableManager.latestMeasurements[.heartRate] }
    private var spo2: WearableMeasurement? { wearableManager.latestMeasurements[.spo2] }
    private var temperature: WearableMeasurement? { wearableManager.latestMeasurements[.skinTemperature] }
    /// Steps/distance/active calories are the band's cumulative-since-
    /// midnight counters — day-scoped via `latestMeasurementForToday` so
    /// a total from a day the band was never re-synced can't silently
    /// keep displaying as "today's" (see that method's own doc comment).
    private var stepsToday: WearableMeasurement? { wearableManager.latestMeasurementForToday(.steps) }
    private var distanceToday: WearableMeasurement? { wearableManager.latestMeasurementForToday(.distanceMeters) }
    private var activeCaloriesToday: WearableMeasurement? { wearableManager.latestMeasurementForToday(.activeCalories) }

    /// Today's minimum real heart-rate reading — the same legitimate
    /// proxy `convex/readiness.ts`'s cardiovascular component already
    /// uses server-side, never simply "whatever the live BPM shows right
    /// now." `nil` (rendered as "Building baseline") until at least one
    /// real reading has landed today.
    private var todayRestingHeartRate: Double? {
        todayHeartRate.value?.map(\.value).min()
    }

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

    // MARK: - Training

    private var trainingCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("TRAINING")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(StudioColor.training)
                if wearableManager.activeSportSession != nil || trainingSession.phase == .active {
                    Text(trainingSession.isPaused ? "PAUSED" : "IN PROGRESS")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.training)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(StudioColor.training.opacity(0.14), in: Capsule())
                }
            }

            if trainingSession.phase != .overview {
                // A Sombrey workout in progress (or finished but not yet
                // saved) always wins here — one tap back into it.
                Text(trainingSession.workoutName)
                    .font(StudioFont.body(16, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                Text(trainingSessionStatus)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                Button(trainingSession.phase == .complete ? "View workout" : "Return to workout") {
                    appState.selectedTab = .train
                }
                .font(StudioFont.body(13, weight: .semibold))
                .foregroundStyle(StudioColor.accentInk)
                .frame(minHeight: 44)
            } else if let active = wearableManager.activeSportSession {
                Text(sportTypeName(active.sportType))
                    .font(StudioFont.body(16, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                HStack(spacing: 16) {
                    if let update = active.liveUpdate {
                        Text(durationText(seconds: update.durationSeconds))
                        Text("\(update.heartRate) BPM")
                        Text("\(Int(update.calories.rounded())) kcal")
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

    private var trainingSessionStatus: String {
        switch trainingSession.phase {
        case .complete:
            return trainingSession.completionSaved ? "Recorded" : "Finished — still saving"
        default:
            let state = trainingSession.isPaused ? "Paused" : (trainingSession.isResting ? "Resting" : "In progress")
            let exercise = trainingSession.currentExercise.map { " · \($0.name)" } ?? ""
            return "\(state)\(exercise) · \(trainingSession.completedSets.count) set\(trainingSession.completedSets.count == 1 ? "" : "s")"
        }
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

    /// Today's nutrition at a glance — the depth lives in AI › Nutrition,
    /// one tap away (the whole card opens it).
    private var nutritionCard: some View {
        Button {
            appState.openNutrition()
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("NUTRITION")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.nutrition)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioColor.inkFaint)
                }

                if let progress = nutritionProgress.value, progress.caloriesConsumed > 0 || progress.mealsCompleted > 0 {
                    Text("\(Int(progress.caloriesConsumed.rounded())) kcal")
                        .font(StudioFont.hero(22, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                    Text("\(Int(progress.proteinConsumed.rounded()))g protein\(progress.mealsCompleted > 0 ? " · \(progress.mealsCompleted) meal\(progress.mealsCompleted == 1 ? "" : "s") logged" : "")")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                        .monospacedDigit()
                } else {
                    Text("No meals logged yet today.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkFaint)
                    Text("Log a meal")
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.accentInk)
                        .padding(.top, 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .studioCard()
        .accessibilityHint("Opens Nutrition in AI")
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

/// The instrument clock: the device's own local time, large and quiet,
/// with the day period small beside it, and a one-line greeting + date.
/// Re-renders on each minute boundary (no ticking animation) and
/// immediately on a time-zone or significant time change, so travelling
/// or changing the zone is reflected at once.
private struct HomeClock: View {
    let firstName: String?
    @State private var timeChange = 0

    var body: some View {
        TimelineView(.everyMinute) { context in
            let clock = InstrumentClockText(date: context.date)
            let part = DayPart(date: context.date)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(clock.digits)
                        .font(StudioFont.hero(38, weight: .semibold))
                        .tracking(-0.4)
                        .foregroundStyle(StudioColor.paper)
                        .monospacedDigit()
                    if let period = clock.period {
                        Text(period.uppercased())
                            .font(StudioFont.body(12, weight: .semibold))
                            .tracking(1.4)
                            .foregroundStyle(StudioColor.paperSoft)
                    }
                }
                Text("\(part.greeting)\(firstName.map { ", \($0)" } ?? "") · \(context.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
            }
            .id(timeChange)
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange)) { _ in timeChange += 1 }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in timeChange += 1 }
        .accessibilityElement(children: .combine)
    }
}
