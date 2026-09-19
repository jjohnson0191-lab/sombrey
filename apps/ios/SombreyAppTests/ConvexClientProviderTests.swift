import Testing
@testable import SombreyApp

/// `ClerkConvexAuthProvider` bridges ClerkKit to Convex's `AuthProvider`
/// protocol (see ConvexClientProvider.swift). Only `extractIdToken` is
/// pure/testable without a live Clerk session or network — `login`/
/// `loginFromCache`/`logout` all call into ClerkKit's real auth flow.
struct ConvexClientProviderTests {
    @Test func extractIdTokenReturnsTheTokenUnchanged() {
        let provider = ClerkConvexAuthProvider()
        #expect(provider.extractIdToken(from: "abc123") == "abc123")
    }
}
