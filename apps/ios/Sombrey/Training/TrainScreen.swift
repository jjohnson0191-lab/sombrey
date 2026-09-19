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
    @State private var session = TrainingSessionManager()

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
    }
}
