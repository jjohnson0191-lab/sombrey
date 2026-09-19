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
/// VERIFICATION NOTE (Phase 0, written without a working local Xcode 15+
/// toolchain — see the migration plan's known risk item): `Clerk.configure`,
/// `Clerk.shared`, and `clerk.signOut()` are directly documented and used
/// as written below. `startHostedAuth(mode:)` is the one sign-in entry
/// point I could confirm from Clerk's current iOS quickstart; if
/// `ClerkKitUI`'s `AuthView` prebuilt component (used in `SignInView`)
/// exposes more granular provider-specific methods once this actually
/// compiles on a modern toolchain, prefer wiring directly to those instead
/// — this coordinator's job is just to be the one place that decision
/// gets made, not to hide it.
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

    func signOut() async throws {
        try await Clerk.shared.signOut()
    }
}
