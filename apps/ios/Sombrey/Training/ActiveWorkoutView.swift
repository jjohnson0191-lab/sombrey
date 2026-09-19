import SwiftUI

/// Active workout — current exercise, current set, a real running rest
/// timer, and set-completion logging. No nav ticks while a session is
/// active (matches the web app's `nav={false}` convention for this
/// exact moment). Reps/weight are whatever the user actually enters —
/// nothing pre-filled or estimated.
struct ActiveWorkoutView: View {
    @Environment(AppState.self) private var appState
    @Bindable var session: TrainingSessionManager
    @State private var reps = 10
    @State private var weightKg: Double = 20

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainActive, showsNav: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("Set \(session.completedSets.count + 1)")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                    Spacer()
                    Button("End") { session.reset() }
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .padding(.top, 20)

                if let exercise = session.currentExercise {
                    Text(exercise.name)
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)

                    if session.isResting {
                        restView
                    } else {
                        HeroNumberText(text: "\(reps)", size: .md, tone: .ink)
                        Text("reps")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.inkSoft)

                        Stepper("Reps: \(reps)", value: $reps, in: 1...50)
                        Stepper("Weight: \(Int(weightKg)) kg", value: $weightKg, in: 0...400, step: 2.5)

                        Button("Complete set") {
                            session.completeSet(reps: reps, weightKg: weightKg)
                        }
                        .buttonStyle(.illuminatedCTA)
                        .padding(.top, 8)
                    }

                    if let next = session.nextExercise {
                        Text("Next: \(next.name)")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                } else {
                    Text("No exercise selected.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
            .padding(.bottom, 24)
        }
    }

    private var restView: some View {
        VStack(spacing: 12) {
            HeroNumberText(text: "\(session.restSecondsRemaining)", size: .md, tone: .ink)
            Text("Resting")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
            Button("Skip rest") {
                session.skipRest()
            }
            .buttonStyle(.outlineCTA)
            Button(session.nextExercise == nil ? "Finish workout" : "Next exercise") {
                session.nextExerciseOrFinish()
            }
            .buttonStyle(.illuminatedCTA)
        }
    }
}
