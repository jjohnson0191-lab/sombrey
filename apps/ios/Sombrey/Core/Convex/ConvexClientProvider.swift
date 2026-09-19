import Foundation
import ConvexMobile
import ClerkKit

/// Wires the existing Convex deployment to ClerkKit's session JWT — the
/// native equivalent of the web app's `ConvexProviderWithClerk` +
/// `useAuth` pairing (`apps/mobile/src/features/auth/AppProviders.tsx`).
///
/// This requires ZERO backend changes: `convex/auth.config.js` already
/// only cares that a valid Clerk JWT using the `"convex"` JWT template
/// arrives on the request — it has no idea whether that token came from
/// `@clerk/clerk-react` in a browser or ClerkKit natively. See the
/// migration plan's Convex audit (section H).
enum ConvexClientProvider {
    /// The existing Sombrey Convex deployment — same URL the web app
    /// reads from `VITE_CONVEX_URL` in `apps/mobile/.env.local`.
    static let deploymentUrl = "https://adamant-chicken-676.convex.cloud"

    /// `@MainActor`: needed for the global `static let` itself under
    /// Swift 6's strict concurrency checking (see the `Sendable`
    /// extension below for why the *type* also needs help).
    @MainActor static let client = ConvexClientWithAuth(deploymentUrl: deploymentUrl, authProvider: ClerkConvexAuthProvider())
}

/// `ConvexClientWithAuth`'s own methods (`login`, `loginFromCache`,
/// `logout`, `mutation`, `subscribe`, ...) are plain nonisolated async
/// instance methods with no actor annotation, so every call from our
/// `@MainActor`-isolated code — even to the single, `@MainActor`-pinned
/// `ConvexClientProvider.client` instance — is flagged as "sending" a
/// non-Sendable value, regardless of the caller's own isolation. This is
/// third-party source (`convex-swift`, not ours to change), and the type
/// has genuine internal mutable state (`private var authBridge`, a
/// Combine subject), so it cannot honestly satisfy checked `Sendable`
/// either. Its own documentation says to "create and use one instance
/// ... for the lifetime of your application process" — this app does
/// exactly that, exclusively from `@MainActor` call sites (see
/// `AppState.swift`, `ClerkAuthCoordinator.swift`), so `@unchecked
/// Sendable` here is the genuinely-required, standard way to wrap a
/// disciplined single-instance use of a non-Sendable external type —
/// not a blanket safety bypass.
extension ConvexClientWithAuth: @unchecked Sendable {}

/// Bridges ClerkKit's session to Convex's `AuthProvider` protocol.
///
/// Verified against the actual resolved package sources (clerk-ios @
/// 1.5.5, convex-swift @ 0.8.1) after the Phase 0.5 Codemagic build
/// surfaced two wrong guesses here: sign-out lives on `Clerk.shared.auth`
/// (an `Auth` struct), not directly on `Clerk`, and `Session.getToken`
/// takes a `Session.GetTokenOptions` value, not a bare `template:` string
/// argument.
final class ClerkConvexAuthProvider: AuthProvider {
    typealias T = String

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        try await Clerk.shared.auth.startHostedAuth(mode: .signIn)
        let token = try await currentToken()
        onIdToken(token)
        return token ?? ""
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        let token = try await currentToken()
        onIdToken(token)
        return token ?? ""
    }

    func logout() async throws {
        try await Clerk.shared.auth.signOut()
    }

    func extractIdToken(from authResult: String) -> String {
        authResult
    }

    private func currentToken() async throws -> String? {
        try await Clerk.shared.session?.getToken(.init(template: "convex"))
    }
}
