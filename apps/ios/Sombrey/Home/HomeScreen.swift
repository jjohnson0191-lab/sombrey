import SwiftUI

/// Home — the daily Sombrey experience. Readiness is the dominant visual
/// moment (top-right, cool zone); today's training recommendation,
/// activity, and nutrition sit lower as plain text rows, not cards.
/// Ported behaviorally from `apps/mobile/src/screens/HomeScreen.tsx`
/// (not translated 1:1).
///
/// The readiness score comes from `readiness:getLatest` — a real,
/// server-computed `ReadinessResult` (see `convex/readiness/scoring.ts`
/// for the algorithm) — never fabricated locally. `ReadinessIndicatorView`
/// itself already handles "not enough data yet" honestly when `score` is
/// nil, so no separate loading/empty state is needed here.
struct HomeScreen: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @State private var showingNutrition = false
    @State private var readiness = ConvexQuery<ReadinessResultDTO?>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .home, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.top, 20)
                    .studioReveal(index: 0)

                ReadinessIndicatorView(result: readiness.value.flatMap { $0 }?.toReadinessResult(), tone: .paper)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, 24)
                    .studioReveal(index: 1)

                if let error = appState.userLoadError {
                    Text("Couldn't load your account: \(error)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.danger)
                        .padding(.top, 16)
                }

                todaySection
                    .padding(.top, 40)
                    .studioReveal(index: 2)

                Divider()
                    .overlay(StudioColor.ink.opacity(0.10))
                    .padding(.top, 24)

                activityRow
                    .padding(.top, 16)
                    .studioReveal(index: 3)

                Button("Log your first meal") { showingNutrition = true }
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .underline()
                    .padding(.top, 8)

                ctaRow
                    .padding(.top, 32)
                    .studioReveal(index: 4)
            }
        }
        .fullScreenCover(isPresented: $showingNutrition) {
            NutritionScreen()
        }
        .task {
            readiness.subscribe(to: "readiness:getLatest")
        }
        .onChange(of: appState.pendingNutritionDeepLink) { _, pending in
            guard pending else { return }
            showingNutrition = true
            appState.pendingNutritionDeepLink = false
        }
        .onAppear {
            // `.onChange` above only fires on a value transition, but
            // this view is recreated (`.id(appState.selectedTab)`) after
            // the flag is already set to true by the deep-link handler,
            // so the initial-appear case needs its own check too.
            if appState.pendingNutritionDeepLink {
                showingNutrition = true
                appState.pendingNutritionDeepLink = false
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            Text(greeting)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.paperSoft)
            Spacer()
            WearableStatusBadge(
                state: wearableManager.displayState,
                batteryPct: wearableManager.status?.batteryPct
            )
        }
    }

    private var greeting: String {
        if let firstName = appState.currentUser?.name?.split(separator: " ").first {
            return "Good morning, \(firstName)"
        }
        return "Good morning"
    }

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("TODAY")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            Text("No workout scheduled")
                .font(StudioFont.body(16, weight: .medium))
                .foregroundStyle(StudioColor.ink)
        }
    }

    private var activityRow: some View {
        HStack(spacing: 20) {
            Text(steps.map { "\(Int($0.value)) steps" } ?? "— steps")
            Text(activeCalories.map { "\(Int($0.value)) active cal" } ?? "— active cal")
            Text(heartRate.map { "HR \(Int($0.value))" } ?? "HR —")
        }
        .font(StudioFont.body(12))
        .foregroundStyle(StudioColor.inkSoft)
        .monospacedDigit()
    }

    // Real readings once a band is connected and has synced at least
    // once — `nil` (rendered as the existing "—" placeholder) is the
    // honest state for "not connected" or "no data yet," never a guess.
    private var steps: WearableMeasurement? { wearableManager.latestMeasurements[.steps] }
    private var activeCalories: WearableMeasurement? { wearableManager.latestMeasurements[.activeCalories] }
    private var heartRate: WearableMeasurement? { wearableManager.latestMeasurements[.heartRate] }

    private var ctaRow: some View {
        HStack(spacing: 12) {
            Button("Start workout") { appState.selectedTab = .train }
                .buttonStyle(.illuminatedCTA)
            Button("Ask Sombrey") { appState.selectedTab = .aiCoach }
                .buttonStyle(.outlineCTA)
        }
    }
}
