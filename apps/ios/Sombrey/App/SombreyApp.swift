import SwiftUI
import ClerkKit

@main
struct SombreyApp: App {
    @State private var appState = AppState()
    @State private var wearableManager = WearableManager(service: MockQCBandService())

    init() {
        ClerkAuthCoordinator.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(Clerk.shared)
                .environment(appState)
                .environment(wearableManager)
                .onOpenURL { url in
                    // Native OAuth/session callback handling. No custom
                    // scheme parsing, no `appUrlOpen`/`getLaunchUrl`
                    // bridge, no `com.sombrey.app://localhost` — ClerkKit
                    // owns the entire callback lifecycle for
                    // `com.sombrey.app://callback` via
                    // `ASWebAuthenticationSession`. This replaces
                    // `apps/mobile/src/features/auth/nativeOAuthReturn.ts`
                    // entirely; that file has no native equivalent because
                    // this problem no longer exists the way it did in the
                    // Capacitor/WKWebView architecture.
                    Task { try? await Clerk.shared.handle(url) }
                }
        }
    }
}

/// Phase 0 root: signed-out -> `SignInView`; signed-in -> a minimal
/// placeholder shell proving the design-system primitives render for
/// real. Real screens (Home, Train, etc.) start in Phase 4+.
private struct RootView: View {
    @Environment(Clerk.self) private var clerk

    var body: some View {
        if clerk.session != nil {
            FoundationShellView()
        } else {
            SignInView()
        }
    }
}

/// A minimal authenticated shell — NOT the real Home screen (that's
/// Phase 4). Exists only so Phase 0 can prove the design-system
/// primitives (`ScreenContainer`, `NavTicks`, `HeroNumberText`,
/// `ReadinessIndicatorView`, `WearableStatusBadge`) compose correctly
/// against a real signed-in session, without building product UI early.
private struct FoundationShellView: View {
    @Environment(AppState.self) private var appState
    @Environment(Clerk.self) private var clerk

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .home, selection: $appState.selectedTab) {
            VStack(alignment: .trailing, spacing: 16) {
                HStack {
                    Text("Sombrey")
                        .font(StudioFont.hero(24, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    Spacer()
                    WearableStatusBadge(state: .disconnected)
                }
                ReadinessIndicatorView(result: nil)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                Spacer(minLength: 40)
                Button("Sign out") {
                    Task { try? await ClerkAuthCoordinator().signOut() }
                }
                .buttonStyle(.outlineCTA)
            }
            .padding(.top, 24)
        }
    }
}
