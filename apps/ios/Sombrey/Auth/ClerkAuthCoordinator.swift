import Foundation
import ClerkKit

/// The Sombrey authentication boundary — the native equivalent of
/// `apps/mobile/src/features/auth/useSombreyAuth.ts` and
/// `AppProviders.tsx`. Everything else in the app reads auth state through
/// this coordinator (or directly through `Clerk.shared` injected via
/// `.environment`), never by re-implementing sign-in/out logic elsewhere.
///
/// Native OAuth (Google) and Sign in with Apple both flow through
/// ClerkKit's own `ASWebAuthenticationSession`-backed hosted-auth flow —
/// there is no browser, no WKWebView, no custom `appUrlOpen`/`getLaunchUrl`
/// bridge, and no `com.sombrey.app://localhost` involved anywhere in this
/// file. The callback scheme (`com.sombrey.app://callback`) is registered
/// once, in the Xcode target's URL Types and via ClerkKit's default
/// `RedirectConfig` — see `SombreyApp.swift` and the project's Info.plist.
///
/// `Clerk.configure` and `Clerk.shared` are directly documented.
/// `startHostedAuth(mode:)` is the confirmed sign-in entry point from
/// Clerk's iOS quickstart, kept here as a fallback trigger; `SignInView`
/// itself now uses `ClerkKitUI`'s `AuthView` directly, per Phase 1.
///
/// `signOut()` routes through `ConvexClientProvider.client.logout()`
/// rather than calling `Clerk.shared.auth.signOut()` directly:
/// `ConvexClientWithAuth.logout()` is what actually clears Convex's
/// cached auth callback/token in addition to ending the Clerk session
/// (verified in `convex-swift`'s source) — calling Clerk's sign-out
/// alone would leave Convex holding a stale, now-invalid auth bridge.
@MainActor
final class ClerkAuthCoordinator {
    static func configure() {
        guard let publishableKey = Bundle.main.object(forInfoDictionaryKey: "ClerkPublishableKey") as? String,
              !publishableKey.isEmpty else {
            assertionFailure("ClerkPublishableKey is missing from Info.plist — see Secrets.xcconfig.example.")
            return
        }
        Clerk.configure(publishableKey: publishableKey)
    }

    /// True once a Clerk session exists — mirrors `useSombreyAuth`'s
    /// `isSignedIn`.
    var isSignedIn: Bool {
        Clerk.shared.session != nil
    }

    func signIn() async throws {
        try await Clerk.shared.auth.startHostedAuth(mode: .signIn)
    }

    func signUp() async throws {
        try await Clerk.shared.auth.startHostedAuth(mode: .signUp)
    }

    func signOut() async {
        await ConvexClientProvider.client.logout()
    }
}
