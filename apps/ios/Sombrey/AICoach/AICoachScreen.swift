import SwiftUI
import ConvexMobile

/// Sombrey — the fourth primary tab. Sombrey Coach is its heart: the hero,
/// then a glass chamber the conversation lives inside (the screen doesn't
/// scroll; only the conversation does). Nutrition stays a first-class part
/// of this tab, one tick over.
///
/// Every reply is the existing `ai/sombreyCoach:chat` action's real answer
/// (see `SombreyCoachConversation`); nothing is mocked or pre-answered.
struct SombreyScreen: View {
    @Environment(AppState.self) private var appState
    /// While the keyboard is up the tab bar is hidden behind it, so the
    /// room the container keeps for the bar is given back to the chamber.
    @State private var keyboardShown = false

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .aiCoach, scrolls: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 0) {
                SombreyCoachHero()
                    .padding(.top, 16)
                    .studioReveal(index: 0)

                SombreySectionControl(selection: $appState.aiSection)
                    .padding(.top, 8)
                    .studioReveal(index: 1)

                switch appState.aiSection {
                case .coach:
                    SombreyConversationSurface(conversation: appState.coach)
                        .frame(maxHeight: .infinity)
                        .padding(.top, 6)
                        .padding(.bottom, keyboardShown ? 8 - NavTicks.reservedHeight : 12)
                        .studioReveal(index: 2)
                case .nutrition:
                    NutritionPanel()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardShown = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardShown = false }
    }
}

/// Sombrey's sections in the navigation-tick grammar — a lit mark over the
/// active one. Nutrition is a first-class part of Sombrey, never a chat
/// command.
private struct SombreySectionControl: View {
    @Binding var selection: AppState.AISection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var markSpace

    var body: some View {
        HStack(spacing: 24) {
            ForEach(AppState.AISection.allCases) { section in
                let isActive = section == selection
                Button {
                    withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
                        selection = section
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(section.rawValue.uppercased())
                            .font(StudioFont.body(11, weight: isActive ? .semibold : .medium))
                            .tracking(1.3)
                            .foregroundStyle(isActive ? StudioColor.ink : StudioColor.inkSoft)
                        ZStack(alignment: .leading) {
                            Capsule().fill(StudioColor.ink.opacity(0.12)).frame(width: 12, height: 3)
                            if isActive {
                                Capsule()
                                    .fill(StudioColor.accentInk)
                                    .frame(width: 22, height: 3)
                                    .matchedGeometryEffect(id: "aiSection", in: markSpace)
                            }
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isActive ? .isSelected : [])
                .accessibilityLabel(Self.accessibilityName(section))
            }
            Spacer()
        }
        .sensoryFeedback(StudioHaptic.rangeChange, trigger: selection)
    }

    private static func accessibilityName(_ section: AppState.AISection) -> String {
        section == .coach ? "Sombrey Coach" : "Nutrition"
    }
}
