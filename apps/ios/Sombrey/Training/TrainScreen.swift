import SwiftUI

/// Routes between Overview -> Active -> Complete based on
/// `TrainingSessionManager.phase`. Ported behaviorally from
/// `apps/mobile/src/screens/TrainScreen.tsx` (one screen, three internal
/// phases driven by local state) — not translated 1:1.
struct TrainScreen: View {
    @Environment(AppState.self) private var appState
    @State private var session = TrainingSessionManager()

    var body: some View {
        switch session.phase {
        case .overview:
            TrainOverviewView(session: session)
        case .active:
            ActiveWorkoutView(session: session)
        case .complete:
            TrainCompleteView(session: session)
        }
    }
}
