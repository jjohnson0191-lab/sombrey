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

/// Root branching: Clerk's own `session` is the truth for "is anyone
/// signed in" (drives Sign In vs. authenticated UI); `AppState.authPhase`
/// (derived from Convex's own `authState`, see `AppState.swift`) is the
/// truth for "is the Convex connection actually usable yet" — a session
/// can exist in Clerk a moment before Convex has finished syncing the
/// token, which is a real, distinct loading state, not an error.
private struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if !clerk.isLoaded {
                RootLoadingView(label: "Loading…")
            } else if clerk.session == nil {
                SignInView()
            } else if appState.authPhase != .signedIn {
                RootLoadingView(label: "Connecting…")
            } else {
                AuthenticatedRootView()
            }
        }
        .task { appState.start() }
        .onChange(of: clerk.session?.id) { _, newSessionId in
            if newSessionId != nil {
                appState.syncConvexAuthAfterInteractiveSignIn()
            }
        }
    }
}

/// Plain full-bleed loading state shared by the two root-level loading
/// moments (Clerk restoring its session, Convex syncing the token) —
/// deliberately quiet, matching the design system's restraint rather
/// than a spinner-heavy generic loading screen.
struct RootLoadingView: View {
    let label: String

    var body: some View {
        EnvironmentView(scene: .settings) {
            VStack(spacing: 12) {
                ProgressView()
                    .tint(StudioColor.ink)
                Text(label)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }
}
