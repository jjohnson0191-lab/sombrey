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
/// Clerk's iOS quickstart. Sign-out is verified against the actual
/// resolved package source (clerk-ios @ 1.5.5): it lives on
/// `Clerk.shared.auth` (an `Auth` struct), not directly on `Clerk` — the
/// first Codemagic build caught this exact wrong guess. If
/// `ClerkKitUI`'s `AuthView` prebuilt component (used in `SignInView`)
/// exposes more granular provider-specific methods later, prefer wiring
/// directly to those instead — this coordinator's job is just to be the
/// one place that decision gets made, not to hide it.
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
        try await Clerk.shared.auth.signOut()
    }
}
