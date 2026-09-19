import SwiftUI

/// Home — the daily Sombrey experience. Readiness is the dominant visual
/// moment (top-right, cool zone); today's training recommendation,
/// activity, and nutrition sit lower as plain text rows, not cards.
/// Ported behaviorally from `apps/mobile/src/screens/HomeScreen.tsx`
/// (not translated 1:1): same honest-placeholder philosophy — no
/// readiness score exists yet, so none is fabricated; no workout is
/// scheduled yet (Train's real backend lands in a later phase), so that
/// says so plainly instead of showing mock data.
struct HomeScreen: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @State private var showingNutrition = false

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .home, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 0) {
                header
                    .padding(.top, 20)

                ReadinessIndicatorView(result: nil, tone: .paper)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, 24)

                if let error = appState.userLoadError {
                    Text("Couldn't load your account: \(error)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.danger)
                        .padding(.top, 16)
                }

                todaySection
                    .padding(.top, 40)

                Divider()
                    .overlay(StudioColor.ink.opacity(0.10))
                    .padding(.top, 24)

                activityRow
                    .padding(.top, 16)

                Button("Log your first meal") { showingNutrition = true }
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .underline()
                    .padding(.top, 8)

                ctaRow
                    .padding(.top, 32)
            }
        }
        .fullScreenCover(isPresented: $showingNutrition) {
            NutritionScreen()
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            Text(greeting)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.paperSoft)
            Spacer()
            WearableStatusBadge(
                state: wearableManager.status?.connectionState ?? .disconnected,
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
            Text("— steps")
            Text("— active cal")
            Text("HR —")
        }
        .font(StudioFont.body(12))
        .foregroundStyle(StudioColor.inkSoft)
        .monospacedDigit()
    }

    private var ctaRow: some View {
        HStack(spacing: 12) {
            Button("Start workout") { appState.selectedTab = .train }
                .buttonStyle(.illuminatedCTA)
            Button("Ask Sombrey") { appState.selectedTab = .aiCoach }
                .buttonStyle(.outlineCTA)
        }
    }
}
