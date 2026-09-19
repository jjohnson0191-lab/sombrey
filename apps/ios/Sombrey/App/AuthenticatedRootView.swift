import SwiftUI

/// Switches between the five nav-tick destinations. Each destination owns
/// its own `ScreenContainer`/scene (matching the web app's convention of
/// nav ticks living inside each screen's own environment gradient, not a
/// separate system tab bar) — this view just decides which one is on
/// screen.
struct AuthenticatedRootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        switch appState.selectedTab {
        case .home:
            HomeScreen()
        case .train:
            TrainScreen()
        case .progress:
            ProgressScreen()
        case .aiCoach:
            AICoachScreen()
        case .settings:
            SettingsScreen()
        }
    }
}
