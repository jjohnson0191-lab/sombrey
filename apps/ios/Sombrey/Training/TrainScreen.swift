import SwiftUI

/// Routes between Overview -> Active -> Complete for both of Train's
/// modes: structured training (`TrainingSessionManager.phase`) and a
/// physical activity (`ActivitySessionManager.phase`). Ported behaviorally from
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
    /// A physical activity (Tennis, a run) — its own state machine,
    /// separate from structured training.
    @Environment(ActivitySessionManager.self) private var activitySession

    private enum Stage: Hashable {
        case overview, trainingActive, trainingComplete, activityActive, activityComplete
    }

    @MainActor private var stage: Stage {
        switch session.phase {
        case .active: return .trainingActive
        case .complete: return .trainingComplete
        case .overview:
            switch activitySession.phase {
            case .active: return .activityActive
            case .complete: return .activityComplete
            case .idle: return .overview
            }
        }
    }

    var body: some View {
        Group {
            switch stage {
            case .overview:
                TrainOverviewView(session: session)
            case .trainingActive:
                ActiveWorkoutView(session: session)
            case .trainingComplete:
                TrainCompleteView(session: session)
            case .activityActive:
                ActiveActivityView()
            case .activityComplete:
                ActivitySummaryView()
            }
        }
        .id(stage)
        .transition(.opacity)
        .animation(StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion), value: stage)
        .sensoryFeedback(trigger: stage) { _, stage in
            switch stage {
            case .trainingActive, .activityActive: return StudioHaptic.workoutStart
            case .trainingComplete, .activityComplete: return StudioHaptic.workoutFinish
            case .overview: return nil
            }
        }
    }
}
