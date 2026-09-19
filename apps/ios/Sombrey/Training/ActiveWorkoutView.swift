import SwiftUI

/// Active workout — current exercise, current set, a real running rest
/// timer, and set-completion logging. No nav ticks while a session is
/// active (matches the web app's `nav={false}` convention for this
/// exact moment). Reps/weight are whatever the user actually enters —
/// nothing pre-filled or estimated.
///
/// Motion: the live rep number does NOT replay its entrance on every
/// stepper tap (`animatesEntrance: false` — a live reading updating in
/// place, not re-powering-on each time). Completing a set gives one
/// tactile pulse before the view crossfades into the rest state
/// (`StudioMotion.release`) — set completion should feel like a real
/// action landed, not just a state flag flipping.
struct ActiveWorkoutView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var session: TrainingSessionManager
    @State private var reps = 10
    @State private var weightKg: Double = 20
    @State private var setPulse = false

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

                    Group {
                        if session.isResting {
                            restView
                        } else {
                            activeSetView
                        }
                    }
                    .id(session.isResting)
                    .transition(.opacity)
                    .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: session.isResting)

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

    private var activeSetView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HeroNumberText(text: "\(reps)", size: .md, tone: .ink, animatesEntrance: false)
                .scaleEffect(setPulse ? 1.06 : 1)
            Text("reps")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)

            Stepper("Reps: \(reps)", value: $reps, in: 1...50)
            Stepper("Weight: \(Int(weightKg)) kg", value: $weightKg, in: 0...400, step: 2.5)

            Button("Complete set") {
                completeSet()
            }
            .buttonStyle(.illuminatedCTA)
            .padding(.top, 8)
        }
    }

    private func completeSet() {
        let pulse = StudioMotion.resolve(StudioMotion.press, reduceMotion: reduceMotion)
        if let pulse {
            withAnimation(pulse) { setPulse = true }
        }
        // Brief, deliberate: register the tap, then hand off to the rest
        // transition — not a decorative bounce independent of state.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            setPulse = false
            session.completeSet(reps: reps, weightKg: weightKg)
        }
    }

    private var restView: some View {
        VStack(spacing: 12) {
            HeroNumberText(text: "\(session.restSecondsRemaining)", size: .md, tone: .ink, animatesEntrance: false)
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
