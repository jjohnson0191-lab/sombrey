import Testing
import ConvexMobile
@testable import SombreyApp

/// `AppState.authPhase(for:)` is kept as a pure static function
/// specifically so the Convex `AuthState` -> app `AuthPhase` mapping is
/// testable without a live `ConvexClient`/network/FFI — see AppState.swift.
struct AppStateTests {
    @Test func loadingMapsToLoading() {
        #expect(AppState.authPhase(for: .loading) == .loading)
    }

    @Test func unauthenticatedMapsToSignedOut() {
        #expect(AppState.authPhase(for: .unauthenticated) == .signedOut)
    }

    @Test func authenticatedMapsToSignedIn() {
        #expect(AppState.authPhase(for: .authenticated("some-token")) == .signedIn)
    }
}
