import SwiftUI

/// Root container for a full screen — a Studio Instrument environment
/// crop, safe-area aware, scrollable body. Navigation lives INSIDE the
/// screen's own environment. The floating tab bar itself is drawn once
/// by `AuthenticatedRootView`; `showsNav` here only reserves room for it
/// at the bottom so content never sits underneath. Pass `showsNav: false`
/// for screens that intentionally aren't a tab destination (Train's
/// active-set and completion moments, Sign In, full-screen covers).
/// Ported from `apps/mobile/src/ui/Screen.tsx`.
struct ScreenContainer<Content: View>: View {
    let scene: StudioScene
    var showsNav: Bool = true
    var scrolls: Bool = true
    @Binding var selection: SombreyTab
    @ViewBuilder var content: Content

    var body: some View {
        EnvironmentView(scene: scene) {
            VStack(spacing: 0) {
                Group {
                    if scrolls {
                        ScrollView {
                            content
                                .padding(.horizontal, 24)
                                // Content scrolls clear of the floating bar.
                                .padding(.bottom, showsNav ? NavTicks.reservedHeight : 0)
                        }
                    } else {
                        content
                            .padding(.horizontal, 24)
                            .padding(.bottom, showsNav ? NavTicks.reservedHeight : 0)
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
    }
}
