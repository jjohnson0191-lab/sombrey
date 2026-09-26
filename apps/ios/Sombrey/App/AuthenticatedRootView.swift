import SwiftUI

/// Switches between the five nav-tick destinations. Each destination owns
/// its own `ScreenContainer`/scene (matching the web app's convention of
/// nav ticks living inside each screen's own environment gradient, not a
/// separate system tab bar) — this view decides which one is on screen.
///
/// Two ways to move, same five destinations:
/// - the tab bar (`NavTicks`): content crossfades on
///   `StudioMotion.contentShift`, timed to settle just after
///   `EnvironmentView`'s slower `sceneShift` — backdrop leads, content follows;
/// - an interactive horizontal swipe (`PrimaryPager`): the screen follows
///   the finger and the neighbour slides in; release commits or springs back.
///   Controls with their own horizontal interaction win (see
///   `primaryNavigationExclusion()`); the swipe is off during a live
///   workout/activity, exactly when the bar is hidden.
struct AuthenticatedRootView: View {
    @Environment(AppState.self) private var appState
    @Environment(NotificationManager.self) private var notificationManager
    @Environment(TrainingSessionManager.self) private var trainingSession
    @Environment(ActivitySessionManager.self) private var activitySession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var exclusions = PrimaryNavigationExclusions()
    @State private var dragWidth: CGFloat = 0
    @State private var neighbour: SombreyTab?
    @State private var decision: PrimaryPager.Decision = .undecided
    @State private var willCommit = false

    /// The bar hides only during a workout's or an activity's live and
    /// completion moments — exactly where those screens hide navigation.
    private var showsNav: Bool {
        !(appState.selectedTab == .train && (trainingSession.phase != .overview || activitySession.phase != .idle))
    }

    var body: some View {
        @Bindable var appState = appState
        GeometryReader { geo in
            let width = geo.size.width
            ZStack {
                ForEach(visibleTabs, id: \.self) { tab in
                    let offset = panelOffset(for: tab, width: width)
                    screen(for: tab)
                        .offset(x: offset)
                        .transition(.opacity)
                        .accessibilityHidden(tab != appState.selectedTab)
                        .allowsHitTesting(tab == appState.selectedTab)
                }
            }
            .animation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion), value: appState.selectedTab)
            .simultaneousGesture(pagingGesture(width: width), including: showsNav ? .all : .subviews)
            .sensoryFeedback(trigger: willCommit) { _, commits in commits ? StudioHaptic.tabChange : nil }
        }
        .environment(\.primaryNavigationExclusions, exclusions)
        // Outside the paged screens, so the bar persists across
        // destinations. Ignores the keyboard so it stays put (hidden
        // behind it) while typing, rather than riding up over the input.
        .overlay(alignment: .bottom) {
            if showsNav {
                NavTicks(selection: $appState.selectedTab)
                    // Only the bar ignores the keyboard (screens still
                    // lift their own inputs, e.g. Sombrey Coach's composer).
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
                appState.openNutrition()
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

    // MARK: - Screens

    private var visibleTabs: [SombreyTab] {
        [appState.selectedTab] + (neighbour.map { [$0] } ?? [])
    }

    private func panelOffset(for tab: SombreyTab, width: CGFloat) -> CGFloat {
        let shown = PrimaryPager.displayed(dragWidth: dragWidth, hasNeighbour: neighbour != nil)
        guard tab != appState.selectedTab else { return shown }
        let tabs = SombreyTab.allCases
        let after = (tabs.firstIndex(of: tab) ?? 0) > (tabs.firstIndex(of: appState.selectedTab) ?? 0)
        return shown + (after ? width : -width)
    }

    @ViewBuilder
    private func screen(for tab: SombreyTab) -> some View {
        switch tab {
        case .home: HomeScreen()
        case .train: TrainScreen()
        case .progress: ProgressScreen()
        case .sombrey: SombreyScreen()
        case .settings: SettingsScreen()
        }
    }

    // MARK: - Interactive paging

    private func pagingGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .onChanged { value in
                if decision == .undecided {
                    decision = PrimaryPager.decide(translation: value.translation, startsInExcludedRegion: exclusions.contains(value.startLocation))
                }
                guard decision == .paging else { return }
                // The neighbour follows the drag's direction (and switches
                // if the finger crosses back over the start).
                let next = PrimaryPager.neighbour(of: appState.selectedTab, dragWidth: value.translation.width)
                if next != neighbour { setNeighbour(next) }
                dragWidth = value.translation.width
                willCommit = PrimaryPager.commits(dragWidth: value.translation.width, predictedWidth: value.translation.width, width: width, hasNeighbour: next != nil)
            }
            .onEnded { value in
                let paging = decision == .paging
                decision = .undecided
                willCommit = false
                guard paging else { return }
                settle(dragWidth: value.translation.width, predictedWidth: value.predictedEndTranslation.width, width: width)
            }
    }

    private func settle(dragWidth drag: CGFloat, predictedWidth: CGFloat, width: CGFloat) {
        guard PrimaryPager.commits(dragWidth: drag, predictedWidth: predictedWidth, width: width, hasNeighbour: neighbour != nil),
              let target = neighbour else {
            withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) { dragWidth = 0 }
            Task { @MainActor in
                if !reduceMotion { try? await Task.sleep(for: .milliseconds(360)) }
                if dragWidth == 0 { setNeighbour(nil) }
            }
            return
        }
        if reduceMotion {
            commit(to: target)
        } else {
            withAnimation(StudioMotion.release) { dragWidth = drag < 0 ? -width : width }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(340))
                commit(to: target)
            }
        }
    }

    /// The neighbour becomes current in place — same identity, no
    /// crossfade, no reload.
    private func commit(to target: SombreyTab) {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            appState.selectedTab = target
            neighbour = nil
            dragWidth = 0
        }
    }

    private func setNeighbour(_ tab: SombreyTab?) {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { neighbour = tab }
    }
}
