import SwiftUI
import ClerkKit

@main
struct SombreyApp: App {
    @State private var appState = AppState()
    // Real QCBandSDK integration (Phase 3) — `MockQCBandService` remains
    // available for SwiftUI Previews and tests only, see its own header.
    @State private var wearableManager = WearableManager(service: QCBandSDKService())
    @Environment(\.scenePhase) private var scenePhase

    init() {
        ClerkAuthCoordinator.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(Clerk.shared)
                .environment(appState)
                .environment(wearableManager)
                .onChange(of: scenePhase) { _, newPhase in
                    wearableManager.handleScenePhaseChange(isActive: newPhase == .active)
                }
                .onChange(of: appState.authPhase) { _, newPhase in
                    if case .signedOut = newPhase {
                        wearableManager.handleSignOut()
                    }
                }
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
///
/// FIX: `authPhase` now has a distinct `.failed` case (see
/// `AppState.swift`) rendered here as `RootErrorView` with a real retry
/// button — previously every non-`.signedIn` phase rendered the same
/// "Connecting…" spinner forever, which is what produced the reported
/// indefinite stuck state when the post-sign-in Convex sync failed.
private struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AppState.self) private var appState

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Shown once, before the user's first sign-in — persisted so it
    /// never reappears after the user has made a choice (pair or skip).
    /// `@AppStorage` rather than a one-shot in-memory flag so a killed-
    /// and-relaunched app before sign-in doesn't show it again.
    @AppStorage("sombreyOnboarding.pairingIntroShown") private var hasShownPairingIntro = false

    private enum Stage: Hashable {
        case loading, pairingIntro, signIn, connecting, failed, home
    }

    private var stage: Stage {
        if !clerk.isLoaded { return .loading }
        if clerk.session == nil {
            return hasShownPairingIntro ? .signIn : .pairingIntro
        }
        switch appState.authPhase {
        case .signedIn: return .home
        case .failed: return .failed
        case .loading, .signedOut: return .connecting
        }
    }

    var body: some View {
        Group {
            switch stage {
            case .loading:
                RootLoadingView(label: "Loading…")
            case .pairingIntro:
                BandPairingView { hasShownPairingIntro = true }
            case .signIn:
                SignInView()
            case .home:
                AuthenticatedRootView()
            case .failed:
                if case .failed(let message) = appState.authPhase {
                    RootErrorView(message: message) { appState.retry() }
                }
            case .connecting:
                RootLoadingView(label: "Connecting…")
            }
        }
        .id(stage)
        .transition(.opacity)
        // Sombrey powering on: sign-in -> connecting -> Home is a single
        // deliberate settle, not three independent page transitions.
        .animation(StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion), value: stage)
        .task { appState.start() }
        .onChange(of: clerk.session?.id) { _, newSessionId in
            AuthDiagnostics.log("[1][2] Clerk session id changed: exists=\(newSessionId != nil)")
            if newSessionId != nil {
                appState.syncConvexAuthAfterInteractiveSignIn()
            }
        }
    }
}

/// Plain full-bleed loading state shared by every root-level loading
/// moment (cold launch, Clerk restoring its session, Convex syncing the
/// token) — deliberately quiet, matching the design system's restraint
/// rather than a spinner-heavy generic loading screen. Uses the same
/// dark `.auth` environment as `SignInView` so the whole pre-Home
/// sequence (Loading -> Sign In -> Connecting) reads as one continuous
/// "powering on" moment rather than jumping between unrelated scenes.
struct RootLoadingView: View {
    let label: String

    var body: some View {
        EnvironmentView(scene: .auth) {
            VStack(spacing: 12) {
                ProgressView()
                    .tint(StudioColor.paper)
                Text(label)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
            }
        }
    }
}

/// Shown when Convex authentication genuinely fails (or times out after
/// 20s) — a real, diagnosable state instead of an indefinite spinner.
struct RootErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        EnvironmentView(scene: .auth) {
            VStack(spacing: 16) {
                Text("Couldn't connect")
                    .font(StudioFont.hero(24, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                Text(message)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button("Try again", action: onRetry)
                    .buttonStyle(.illuminatedCTA)
            }
        }
    }
}
