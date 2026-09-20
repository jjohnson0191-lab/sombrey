import SwiftUI

/// Completion summary — real duration (an actual elapsed-time timer) and
/// real set/rep counts from what the user just did, nothing estimated.
///
/// Phase 3 training-architecture expansion: now genuinely persisted (via
/// `TrainingSessionManager.finish()`, already called before this phase is
/// reached) to `sombreyWorkouts`/`sombreyWorkoutSets` — deliberately not
/// `workoutLogs`, which is coach-assignment-shaped. Shows the band's own
/// live tally (`WearableManager.lastCompletedSportSession`) when a Sport+
/// session was paired, real data only — hidden entirely otherwise.
struct TrainCompleteView: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @Bindable var session: TrainingSessionManager

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainComplete, showsNav: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Workout complete")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 40)

                HeroNumberText(text: formattedDuration, size: .lg, tone: .ink)
                Text("DURATION")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(StudioColor.inkSoft)

                HStack(spacing: 24) {
                    MetricView(label: "Sets", value: "\(session.completedSets.count)")
                    MetricView(label: "Exercises", value: "\(session.selectedExercises.count)")
                }
                .padding(.top, 8)
                .studioReveal(index: 1)

                if let sportSummary = wearableManager.lastCompletedSportSession {
                    HStack(spacing: 24) {
                        if sportSummary.heartRate > 0 {
                            MetricView(label: "Heart rate", value: "\(sportSummary.heartRate) bpm")
                        }
                        if sportSummary.calories > 0 {
                            MetricView(label: "Calories", value: "\(sportSummary.calories) kcal")
                        }
                        if sportSummary.distanceMeters > 0 {
                            MetricView(label: "Distance", value: "\(sportSummary.distanceMeters) m")
                        }
                    }
                    .padding(.top, 4)
                    .studioReveal(index: 2)
                }

                if let error = session.persistError {
                    Text("Couldn't save this workout: \(error)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.danger)
                        .studioReveal(index: 2)
                }

                Button("Return to Home") {
                    session.reset()
                    appState.selectedTab = .home
                }
                .buttonStyle(.illuminatedCTA)
                .padding(.top, 16)
                .studioReveal(index: 3)
            }
            .padding(.bottom, 24)
        }
    }

    private var formattedDuration: String {
        let seconds = session.elapsedSeconds
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
