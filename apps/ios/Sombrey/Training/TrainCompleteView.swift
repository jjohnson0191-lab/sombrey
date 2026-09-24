import SwiftUI

/// Completion — the workout landing as a recorded event, not an analytics
/// report. Everything here is real: duration is active time (pauses
/// excluded), counts come from the sets actually logged, volume only
/// from sets that have a weight, heart rate from the band's stored
/// readings during the workout, and band activity only from THIS
/// workout's own Sport+ session. It says plainly whether the server has
/// the workout yet, and offers a retry if it doesn't.
struct TrainCompleteView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var session: TrainingSessionManager
    @State private var heartRate = ConvexQuery<[WearableMeasurementDTO]>()
    @State private var isRetrying = false

    private var sets: [CompletedSet] { session.completedSets }
    private var trained: [Exercise] { TrainingMath.trainedExercises(sets) }

    /// Band heart-rate readings stored during the workout window only.
    private var workoutHeartRate: InstrumentStats? {
        guard let startedAt = session.startedAt, let finishedAt = session.finishedAt else { return nil }
        let startMs = startedAt.timeIntervalSince1970 * 1000
        let endMs = finishedAt.timeIntervalSince1970 * 1000
        let values = (heartRate.value ?? []).filter { $0.recordedAt >= startMs && $0.recordedAt <= endMs }.map(\.value)
        guard values.count >= 2 else { return nil }
        return InstrumentStats.of(values)
    }

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainComplete, showsNav: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 22) {
                recordedState
                    .padding(.top, 36)

                VStack(alignment: .leading, spacing: 2) {
                    HeroNumberText(text: TrainingMath.clock(session.elapsedSeconds), size: .lg, tone: .ink)
                    Text("ACTIVE TIME")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                }

                HStack(spacing: 24) {
                    MetricView(label: "Exercises", value: "\(trained.count)")
                    MetricView(label: "Sets", value: "\(sets.count)")
                    MetricView(label: "Reps", value: "\(sets.reduce(0) { $0 + $1.reps })")
                    if TrainingMath.hasWeightedSets(sets) {
                        MetricView(label: "Volume", value: "\(Int(TrainingMath.volumeKg(sets).rounded()))", unit: "kg")
                    }
                }
                .studioReveal(index: 1)

                if !trained.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(trained) { exercise in
                            exerciseLine(exercise)
                        }
                    }
                    .studioReveal(index: 2)
                }

                if workoutHeartRate != nil || session.sportSummary != nil {
                    bandSection
                        .studioReveal(index: 3)
                }

                Button {
                    // Only clear the workout once the server has it; an
                    // unsaved workout stays on this phone and keeps
                    // retrying (next launch, or from this screen).
                    if session.completionSaved { session.reset() }
                    appState.selectedTab = .home
                } label: {
                    Text(session.completionSaved ? "Done" : "Done — keep saving in the background").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                .padding(.top, 8)
                .studioReveal(index: 4)
            }
            .padding(.bottom, 24)
        }
        .task {
            guard let startedAt = session.startedAt else { return }
            heartRate.subscribe(to: "wearable:getMeasurementsByRange", with: [
                "metricType": "heart_rate",
                "sinceMs": startedAt.timeIntervalSince1970 * 1000,
            ])
        }
    }

    // MARK: - Recorded state

    @ViewBuilder
    private var recordedState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session.completionSaved ? "WORKOUT RECORDED" : "SAVING WORKOUT")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(session.completionSaved ? StudioColor.accentInk : StudioColor.inkSoft)
            Text(session.workoutName)
                .font(StudioFont.hero(30, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            if !session.completionSaved, let error = session.persistError {
                HStack(spacing: 12) {
                    Text(session.pendingUploadCount > 0
                         ? "Kept on this phone — \(session.pendingUploadCount) set\(session.pendingUploadCount == 1 ? "" : "s") still to upload."
                         : "Not saved yet: \(error)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                    Button(isRetrying ? "Retrying…" : "Retry") {
                        isRetrying = true
                        Task {
                            await session.persistCompletion()
                            isRetrying = false
                        }
                    }
                    .font(StudioFont.body(12, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .frame(minHeight: 44)
                    .disabled(isRetrying)
                }
            }
        }
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: session.completionSaved)
    }

    // MARK: - Per exercise

    private func exerciseLine(_ exercise: Exercise) -> some View {
        let exerciseSets = sets.filter { $0.exercise == exercise }
        let best = TrainingMath.bestSet(exerciseSets)
        return HStack(alignment: .firstTextBaseline) {
            Text(exercise.name)
                .font(StudioFont.body(14, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text("\(exerciseSets.count) set\(exerciseSets.count == 1 ? "" : "s")")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
            if let best {
                Text(best.weightKg.map { "best \(best.reps) × \(TrainingMath.weightText($0)) kg" } ?? "best \(best.reps) reps")
                    .font(StudioFont.body(12, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Band

    private var bandSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("FROM YOUR BAND")
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(spacing: 24) {
                if let hr = workoutHeartRate {
                    MetricView(label: "Avg heart rate", value: "\(Int(hr.mean.rounded()))", unit: "bpm")
                    MetricView(label: "Max heart rate", value: "\(Int(hr.max.rounded()))", unit: "bpm")
                }
                if let sport = session.sportSummary, sport.calories > 0 {
                    MetricView(label: "Active calories", value: "\(Int(sport.calories.rounded()))", unit: "kcal")
                }
            }
            if let sport = session.sportSummary {
                let name = ActivityCatalog.resolve(activityKey: nil, vendorSportType: sport.sportType)?.name ?? "Activity"
                Text("\(name) recorded by the band\(sport.distanceMeters > 0 ? " · \(sport.distanceMeters) m" : "")\(sport.steps > 0 ? " · \(sport.steps) steps" : "")")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }
}
