import SwiftUI

/// Routes between Overview -> Active -> Complete based on
/// `TrainingSessionManager.phase`. Ported behaviorally from
/// `apps/mobile/src/screens/TrainScreen.tsx` (one screen, three internal
/// phases driven by local state) — not translated 1:1.
///
/// Motion: each phase crossfades in on `StudioMotion.settleOnce` — a
/// state change in the session, not a navigation push. Matches
/// `trainOverview`/`trainActive`/`trainComplete`'s own scene shift in
/// `ScreenContainer`.
struct TrainScreen: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// App-level (see `SombreyApp`) — never owned here, since this screen
    /// is rebuilt every time the Train tab is selected.
    @Environment(TrainingSessionManager.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .overview:
                TrainOverviewView(session: session)
            case .active:
                ActiveWorkoutView(session: session)
            case .complete:
                TrainCompleteView(session: session)
            }
        }
        .id(session.phase)
        .transition(.opacity)
        .animation(StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion), value: session.phase)
        .sensoryFeedback(trigger: session.phase) { _, phase in
            switch phase {
            case .active: return StudioHaptic.workoutStart
            case .complete: return StudioHaptic.workoutFinish
            case .overview: return nil
            }
        }
    }
}
