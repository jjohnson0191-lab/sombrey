import SwiftUI

/// Placeholder — the real chat UI against the already-functional
/// `api.ai.sombreyCoach.chat` Convex action lands in a later migration
/// phase (see AICoach/README.md). Wired into nav now so the tab isn't a
/// dead end.
struct AICoachScreen: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .aiCoach, selection: $appState.selectedTab) {
            ComingSoonView(
                title: "Sombrey Coach",
                note: "AI chat is coming in a later phase — the backend (api.ai.sombreyCoach.chat) is already real and working."
            )
        }
    }
}
