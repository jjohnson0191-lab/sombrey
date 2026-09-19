import SwiftUI

/// Account + sign-out — the minimal real slice of
/// `apps/mobile/src/screens/SettingsScreen.tsx` needed for Phase 1's
/// completion criteria ("sign-out returns cleanly to unauthenticated
/// state"). The fuller settings surface (subscription, notifications,
/// delete account) lands in a later phase — see Settings/README.md.
struct SettingsScreen: View {
    @Environment(AppState.self) private var appState
    @State private var isSigningOut = false

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .settings, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                VStack(alignment: .leading, spacing: 4) {
                    Text(appState.currentUser?.name ?? "—")
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text(appState.currentUser?.email ?? "—")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }

                Spacer()

                Button {
                    isSigningOut = true
                    Task {
                        await appState.signOut()
                        isSigningOut = false
                    }
                } label: {
                    if isSigningOut {
                        ProgressView().tint(StudioColor.ink)
                    } else {
                        Text("Sign out")
                    }
                }
                .buttonStyle(.outlineCTA)
                .disabled(isSigningOut)
            }
        }
    }
}
