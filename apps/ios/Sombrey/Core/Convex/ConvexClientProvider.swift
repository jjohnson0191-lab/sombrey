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

    /// `@MainActor`: `ConvexClientWithAuth` isn't `Sendable` (confirmed in
    /// `convex-swift`'s source — it has internal mutable state), so a
    /// global `static let` needs actor isolation under Swift 6's strict
    /// concurrency checking. This is the compiler's own first-suggested
    /// fix (over the unsafe `nonisolated(unsafe)` alternative it also
    /// offers) — the app is entirely SwiftUI-driven, so MainActor
    /// isolation costs nothing in practice.
    @MainActor static let client = ConvexClientWithAuth(deploymentUrl: deploymentUrl, authProvider: ClerkConvexAuthProvider())
}

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
