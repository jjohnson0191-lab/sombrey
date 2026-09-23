import SwiftUI

/// Switches between the five nav-tick destinations. Each destination owns
/// its own `ScreenContainer`/scene (matching the web app's convention of
/// nav ticks living inside each screen's own environment gradient, not a
/// separate system tab bar) — this view just decides which one is on
/// screen.
///
/// Motion: content crossfades on `StudioMotion.contentShift`, timed to
/// settle just after `EnvironmentView`'s slower `sceneShift` starts — the
/// backdrop leads, content follows, matching a physical instrument's
/// backlight shifting before its readout updates. No push/slide — that
/// reads as a system tab bar, not five instrument ticks.
struct AuthenticatedRootView: View {
    @Environment(AppState.self) private var appState
    @Environment(NotificationManager.self) private var notificationManager
    @Environment(TrainingSessionManager.self) private var trainingSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The bar hides only during a workout's active and completion
    /// moments — exactly where those screens already hid navigation.
    private var showsNav: Bool {
        !(appState.selectedTab == .train && trainingSession.phase != .overview)
    }

    var body: some View {
        @Bindable var appState = appState
        Group {
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
        .id(appState.selectedTab)
        .transition(.opacity)
        .animation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion), value: appState.selectedTab)
        // Outside the per-tab `.id` above, so the bar persists across
        // destinations. Ignores the keyboard so it stays put (hidden
        // behind it) while typing, rather than riding up over the input.
        .overlay(alignment: .bottom) {
            if showsNav {
                NavTicks(selection: $appState.selectedTab)
                    // Only the bar ignores the keyboard (screens still
                    // lift their own inputs, e.g. AI Coach's composer).
                    .ignoresSafeArea(.keyboard, edges: .bottom)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 24)))
            }
        }
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: showsNav)
        .onChange(of: notificationManager.pendingDeepLink) { _, target in
            guard let target else { return }
            switch target {
            case .home, .readiness:
                appState.selectedTab = .home
            case .nutrition:
                appState.selectedTab = .home
                appState.pendingNutritionDeepLink = true
            case .training:
                appState.selectedTab = .train
            case .sleep:
                appState.selectedTab = .progress
            }
            // Reset back to nil so re-tapping the same category later
            // still triggers this `.onChange` (nil -> value -> nil).
            _ = notificationManager.consumeDeepLink()
        }
    }
}
