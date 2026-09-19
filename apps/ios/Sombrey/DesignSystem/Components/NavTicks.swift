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

/// Sombrey's primary navigation — five instrument ticks, not a generic
/// icon tab bar. Each tick's visible mark is small (20x3pt lit / 12x3pt
/// dim) but its tap target is a real 44x44pt hit area — restraint doesn't
/// cost accessibility. Lives INSIDE each screen's own environment gradient
/// (see `ScreenContainer`), not a separate fixed bar with its own
/// background — ported from `apps/mobile/src/ui/NavTicks.tsx`.
///
/// Motion: the active mark's width/color/label weight settle on
/// `StudioMotion.release` — a tick engaging, not a tab bar re-rendering.
struct NavTicks: View {
    @Binding var selection: SombreyTab
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack {
            ForEach(SombreyTab.allCases) { tab in
                let isActive = tab == selection
                Button {
                    selection = tab
                } label: {
                    VStack(spacing: 6) {
                        Capsule()
                            .fill(isActive ? StudioColor.accentInk : StudioColor.ink.opacity(0.30))
                            .frame(width: isActive ? 20 : 12, height: 3)
                        Text(tab.label)
                            .font(StudioFont.body(9, weight: isActive ? .semibold : .regular))
                            .foregroundStyle(isActive ? StudioColor.ink : StudioColor.ink.opacity(0.42))
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .animation(StudioMotion.resolve(.release, reduceMotion: reduceMotion), value: isActive)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
                if tab != SombreyTab.allCases.last {
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .safeAreaPadding(.bottom)
    }
}
