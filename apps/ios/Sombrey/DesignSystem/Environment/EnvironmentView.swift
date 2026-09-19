import SwiftUI

/// Full-bleed Studio Instrument backdrop for one screen — the SwiftUI
/// equivalent of `apps/mobile/src/ui/Environment.tsx`. When `scene`
/// changes (navigating between destinations), the backdrop crossfades
/// on `StudioMotion.sceneShift` instead of cutting instantly — the
/// environment's own tonal field shifting, like an instrument's
/// backlight changing state, not a page transition.
struct EnvironmentView<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let scene: StudioScene
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            scene.background
                .ignoresSafeArea()
                .id(scene)
                .transition(.opacity)
                .animation(StudioMotion.resolve(.sceneShift, reduceMotion: reduceMotion), value: scene)
            content
        }
    }
}
