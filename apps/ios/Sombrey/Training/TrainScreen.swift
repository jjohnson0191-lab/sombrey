import SwiftUI

/// Placeholder — full workout session UI lands in a later migration
/// phase (see Training/README.md). Wired into nav now so the tab isn't
/// a dead end.
struct TrainScreen: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainOverview, selection: $appState.selectedTab) {
            ComingSoonView(
                title: "Train",
                note: "Workout sessions are coming in a later phase — see apps/mobile's TrainScreen for the reference behavior."
            )
        }
    }
}
