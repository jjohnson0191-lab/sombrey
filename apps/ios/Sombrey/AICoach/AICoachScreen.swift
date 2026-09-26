import SwiftUI
import ConvexMobile

/// Sombrey — the fourth primary tab: Sombrey's intelligence, in two modes
/// switched by the same glass keys as Train (`StudioModePills`):
///   COACH      Sombrey Coach — the glass conversation chamber (only the
///              conversation scrolls) and Sombrey's tools (Body Scan);
///   NUTRITION  today's intake, the AI Macro Calculator, meals, targets.
/// Both modes stay alive underneath (only one is visible and interactive),
/// so switching never loses the conversation, its scroll position, or
/// Nutrition's state. Camera flows are focused covers that return here.
///
/// Every Coach reply is the existing `ai/sombreyCoach:chat` action's real
/// answer (`SombreyCoachConversation`); nothing is mocked.
struct SombreyScreen: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// While the keyboard is up the tab bar is hidden behind it, so the
    /// room the container keeps for the bar is given back to the chamber.
    @State private var keyboardShown = false
    @State private var photos = ConvexQuery<[ProgressPhotoDTO]>()
    @State private var showingBodyScan = false
    @State private var bodyScanResults = false

    private var mode: AppState.AISection { appState.aiSection }

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .aiCoach, scrolls: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 0) {
                SombreyHero(mode: mode)
                    .padding(.top, 16)
                    .studioReveal(index: 0)

                StudioModePills(
                    options: [
                        StudioModeOption(value: AppState.AISection.coach, label: "COACH", accessibilityLabel: "Sombrey Coach"),
                        StudioModeOption(value: AppState.AISection.nutrition, label: "NUTRITION", accessibilityLabel: "Nutrition"),
                    ],
                    selection: $appState.aiSection
                )
                .padding(.top, 14)
                .studioReveal(index: 1)

                ZStack(alignment: .top) {
                    coach
                        .opacity(mode == .coach ? 1 : 0)
                        .offset(x: mode == .coach || reduceMotion ? 0 : -12)
                        .allowsHitTesting(mode == .coach)
                        .accessibilityHidden(mode != .coach)
                    NutritionPanel()
                        .opacity(mode == .nutrition ? 1 : 0)
                        .offset(x: mode == .nutrition || reduceMotion ? 0 : 12)
                        .allowsHitTesting(mode == .nutrition)
                        .accessibilityHidden(mode != .nutrition)
                }
                .animation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion), value: mode)
                .padding(.top, 12)
                .padding(.bottom, keyboardShown ? 8 - NavTicks.reservedHeight : 0)
                .studioReveal(index: 2)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardShown = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardShown = false }
        .task { photos.subscribe(to: "progressPhotos:list") }
        .fullScreenCover(isPresented: $showingBodyScan) {
            BodyScanFlow(startWithResults: bodyScanResults)
        }
    }

    private var coach: some View {
        let scans = BodyScan.group(photos.value ?? [])
        return VStack(spacing: 12) {
            SombreyConversationSurface(conversation: appState.coach)
                .frame(maxHeight: .infinity)
            if !keyboardShown {
                BodyScanEntry(scans: scans) {
                    bodyScanResults = !scans.isEmpty
                    showingBodyScan = true
                }
                .transition(.opacity)
            }
        }
        .padding(.bottom, 12)
    }
}

/// The Sombrey hero — the logo, then the mode's title in the display face
/// and one restrained line. Titles cross-fade with the mode.
struct SombreyHero: View {
    let mode: AppState.AISection

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SombreyLogo(size: .header, tone: .onLight)
            VStack(alignment: .leading, spacing: 4) {
                Text(mode == .coach ? "Sombrey Coach" : "Nutrition")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .contentTransition(.opacity)
                    .accessibilityAddTraits(.isHeader)
                Text(mode == .coach ? "Your training, recovery and nutrition — together." : "What you've eaten today, and what's next.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .contentTransition(.opacity)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

