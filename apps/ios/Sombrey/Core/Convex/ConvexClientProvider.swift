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

    static let client = ConvexClientWithAuth(deploymentUrl: deploymentUrl, authProvider: ClerkConvexAuthProvider())
}

/// Bridges ClerkKit's session to Convex's `AuthProvider` protocol.
///
/// VERIFICATION NOTE (Phase 0, no working local Xcode 15+ toolchain — see
/// the migration plan's known risk item): `AuthProvider`'s shape is
/// confirmed directly from `convex-swift`'s source. `session.getToken`
/// mirrors Clerk's `getToken({ template })` pattern used consistently
/// across every other Clerk SDK (JS, Android) — verify the exact Swift
/// method name/signature against ClerkKit once this compiles on a
/// capable toolchain, and adjust only this type if it differs; nothing
/// else in the app should need to change.
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
        try await Clerk.shared.signOut()
    }

    func extractIdToken(from authResult: String) -> String {
        authResult
    }

    private func currentToken() async throws -> String? {
        try await Clerk.shared.session?.getToken(template: "convex")
    }
}
