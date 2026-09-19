import SwiftUI

/// Completion summary — real duration (an actual elapsed-time timer) and
/// real set/rep counts from what the user just did, nothing estimated.
///
/// Not yet persisted to Convex: `workoutLogs` is shaped around
/// human-coach program assignment (see the migration plan's Convex
/// audit) and isn't a fit for a Sombrey-native session; a real
/// persistence path is a later phase, once that schema question is
/// settled — showing a summary here without silently claiming it was
/// "saved" is the honest interim state, not a bug.
struct TrainCompleteView: View {
    @Environment(AppState.self) private var appState
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

                Text("Not yet saved to your training history — that's coming in a later phase.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkFaint)

                Button("Return to Home") {
                    session.reset()
                    appState.selectedTab = .home
                }
                .buttonStyle(.illuminatedCTA)
                .padding(.top, 16)
            }
            .padding(.bottom, 24)
        }
    }

    private var formattedDuration: String {
        let seconds = session.elapsedSeconds
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
