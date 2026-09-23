import SwiftUI

/// The five primary destinations, in the approved order. Supersedes the
/// earlier five-tab set (Home/Train/Nutrition/Progress/Profile) — Nutrition
/// is reached from Home, not its own tab; AI is a full peer tab. Matches
/// `apps/mobile/src/ui/NavTicks.tsx`'s `TICKS` list exactly.
enum SombreyTab: String, CaseIterable, Identifiable {
    case home = "Home"
    case train = "Train"
    case progress = "Progress"
    case aiCoach = "AI"
    case settings = "Settings"

    var id: String { rawValue }
    var label: String { rawValue }
}

/// Sombrey's primary navigation — five instrument ticks on a floating
/// glass control. One persistent instance lives at the root
/// (`AuthenticatedRootView`), above the screens rather than inside each
/// one: screens are rebuilt on every tab change, so a bar inside them
/// could only jump, never move. Here the lit key glides to its new
/// position (`StudioMotion.release`; instant under Reduce Motion) and a
/// selection haptic confirms the change.
///
/// Glass: a real material behind a warm ivory tint and a light top edge,
/// with a soft shadow separating it from the scene — enough body to stay
/// legible over any environment crop, never a see-through template.
/// Each key is a full 44pt+ hit area even though its visible mark is a
/// 3pt tick. It sits on screen at a fixed position; screens reserve
/// `reservedHeight` at their bottom so content scrolls clear of it.
struct NavTicks: View {
    @Binding var selection: SombreyTab
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var keySpace

    /// Space a screen keeps free at its bottom for the floating bar.
    static let reservedHeight: CGFloat = 92

    var body: some View {
        HStack(spacing: 2) {
            ForEach(SombreyTab.allCases) { tab in
                let isActive = tab == selection
                Button {
                    guard tab != selection else { return }
                    withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
                        selection = tab
                    }
                } label: {
                    VStack(spacing: 6) {
                        ZStack {
                            Capsule()
                                .fill(StudioColor.ink.opacity(0.22))
                                .frame(width: 12, height: 3)
                            if isActive {
                                Capsule()
                                    .fill(StudioColor.accentInk)
                                    .frame(width: 22, height: 3)
                                    .matchedGeometryEffect(id: "tick", in: keySpace)
                            }
                        }
                        Text(tab.label)
                            .font(StudioFont.body(10, weight: isActive ? .semibold : .medium))
                            .foregroundStyle(isActive ? StudioColor.ink : StudioColor.ink.opacity(0.5))
                    }
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .background {
                        if isActive {
                            // The lit key: a faint raised pad under the
                            // active position, travelling with the tick.
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(Color.white.opacity(0.42))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .strokeBorder(Color.white.opacity(0.55), lineWidth: 0.5)
                                }
                                .matchedGeometryEffect(id: "key", in: keySpace)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(isActive ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(6)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .light)
                .overlay {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(StudioColor.env5.opacity(0.34))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(
                            LinearGradient(colors: [Color.white.opacity(0.7), Color.white.opacity(0.12)], startPoint: .top, endPoint: .bottom),
                            lineWidth: 1
                        )
                }
                .shadow(color: StudioColor.env0.opacity(0.22), radius: 18, y: 8)
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 6)
        .sensoryFeedback(StudioHaptic.tabChange, trigger: selection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sombrey navigation")
    }
}
