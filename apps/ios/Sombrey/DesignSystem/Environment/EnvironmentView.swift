import SwiftUI

/// Full-bleed Studio Instrument backdrop for one screen — the SwiftUI
/// equivalent of `apps/mobile/src/ui/Environment.tsx`.
struct EnvironmentView<Content: View>: View {
    let scene: StudioScene
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            scene.background
                .ignoresSafeArea()
            content
        }
    }
}
