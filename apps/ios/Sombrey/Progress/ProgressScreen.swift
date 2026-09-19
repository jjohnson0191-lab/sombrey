import SwiftUI

/// Placeholder — real measurements/photos/analytics wiring lands in a
/// later migration phase (see Progress/README.md). Wired into nav now
/// so the tab isn't a dead end.
struct ProgressScreen: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .progress, selection: $appState.selectedTab) {
            ComingSoonView(
                title: "Progress",
                note: "Measurements, photos, and analytics are coming in a later phase — the existing api.measurements.list / api.progressPhotos.list Convex queries are already real and reusable when that phase starts."
            )
        }
    }
}
