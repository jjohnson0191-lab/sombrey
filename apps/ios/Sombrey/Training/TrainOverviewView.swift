import SwiftUI

/// Overview: picks from the real, existing `exercises` Convex table (no
/// fabricated "today's plan" — see `TrainingSessionManager`'s header) to
/// build a session, then starts it. Empty state when the exercise
/// library itself has nothing to show (a real, honest possibility, not
/// a loading glitch).
struct TrainOverviewView: View {
    @Environment(AppState.self) private var appState
    @Bindable var session: TrainingSessionManager
    @State private var exercises = ConvexQuery<[Exercise]>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainOverview, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Train")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                Text("Choose exercises to build today's session.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)

                content

                if !session.selectedExercises.isEmpty {
                    Button("Start Workout (\(session.selectedExercises.count) exercises)") {
                        session.startWorkout()
                    }
                    .buttonStyle(.illuminatedCTA)
                    .padding(.top, 8)
                }
            }
            .padding(.bottom, 24)
        }
        .task {
            exercises.subscribe(to: "exercises:list")
        }
    }

    @ViewBuilder
    private var content: some View {
        if exercises.isLoading {
            ProgressView().tint(StudioColor.ink).padding(.top, 24)
        } else if let error = exercises.errorMessage {
            Text("Couldn't load exercises: \(error)")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.danger)
        } else if let list = exercises.value, !list.isEmpty {
            VStack(spacing: 0) {
                ForEach(list) { exercise in
                    ExerciseRow(exercise: exercise, isSelected: session.selectedExercises.contains(exercise)) {
                        session.toggle(exercise)
                    }
                    Divider().overlay(StudioColor.ink.opacity(0.08))
                }
            }
        } else {
            Text("No exercises available yet.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkFaint)
                .padding(.top, 24)
        }
    }
}

private struct ExerciseRow: View {
    let exercise: Exercise
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(exercise.name)
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text(exercise.muscleGroup.capitalized)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(exercise.name)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
