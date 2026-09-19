import Foundation
import Observation
import Combine
import ConvexMobile

/// Top-level app state boundary: cross-cutting navigation state, plus the
/// bridge between Clerk's session (truth for "is anyone signed in") and
/// Convex's own auth wiring (truth for "can we actually talk to the
/// backend yet") and the resulting Convex user identity. Feature-specific
/// state stays in each feature module.
///
/// Session lifecycle, using `ConvexClientProvider.client`'s real,
/// verified API (`ConvexClientWithAuth.login/loginFromCache/logout` —
/// see `ConvexClientProvider.swift`), not `ClerkAuthCoordinator` directly:
/// Convex's wrapper is what actually wires a fresh token into the Convex
/// connection and keeps `authState` in sync, so it's the single source of
/// truth for "is Convex ready," not just "is Clerk ready."
@Observable
@MainActor
final class AppState {
    enum AuthPhase: Equatable {
        case loading
        case signedOut
        case signedIn
    }

    var selectedTab: SombreyTab = .home
    private(set) var authPhase: AuthPhase = .loading
    private(set) var currentUser: SombreyUser?
    private(set) var userLoadError: String?

    private var authStateCancellable: AnyCancellable?
    private var userSubscriptionCancellable: AnyCancellable?
    private var didStart = false

    /// Called once, from the root view's `.task`. Attempts a silent
    /// session restore (Keychain-backed via ClerkKit) without showing any
    /// UI — the native equivalent of the web app's auth-loading gate.
    func start() {
        guard !didStart else { return }
        didStart = true

        authStateCancellable = ConvexClientProvider.client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.apply(state)
            }

        Task {
            _ = await ConvexClientProvider.client.loginFromCache()
        }
    }

    /// Call after ClerkKitUI's `AuthView` reports a session appearing
    /// (see `SombreyApp.swift`'s `.onChange(of: clerk.session?.id)`) — a
    /// fresh interactive sign-in doesn't itself route through
    /// `ConvexClientWithAuth`, so this pulls the now-available Clerk
    /// token into Convex's connection without prompting the UI again.
    func syncConvexAuthAfterInteractiveSignIn() {
        Task {
            _ = await ConvexClientProvider.client.loginFromCache()
        }
    }

    func signOut() async {
        await ConvexClientProvider.client.logout()
        currentUser = nil
        userLoadError = nil
    }

    private func apply(_ state: AuthState<String>) {
        authPhase = Self.authPhase(for: state)
        switch state {
        case .authenticated:
            subscribeToCurrentUser()
        case .unauthenticated:
            userSubscriptionCancellable = nil
            currentUser = nil
            userLoadError = nil
        case .loading:
            break
        }
    }

    /// Pure mapping, kept free of the client/Combine so it's directly
    /// unit-testable — see `AppStateTests.swift`.
    static func authPhase(for state: AuthState<String>) -> AuthPhase {
        switch state {
        case .loading: return .loading
        case .unauthenticated: return .signedOut
        case .authenticated: return .signedIn
        }
    }

    private func subscribeToCurrentUser() {
        // Get-or-create: the existing, unmodified Convex mutation every
        // other Sombrey client already uses for first-sign-in
        // provisioning (convex/users.ts). Idempotent — safe to call on
        // every sign-in, not just the first.
        Task {
            do {
                try await ConvexClientProvider.client.mutation("users:updateCurrentUser")
            } catch {
                // Non-fatal: the getCurrentUser subscription below will
                // simply keep yielding nil until this succeeds on a retry.
            }
        }

        userSubscriptionCancellable = ConvexClientProvider.client
            .subscribe(to: "users:getCurrentUser", yielding: SombreyUser?.self)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    if case .failure(let error) = completion {
                        self?.userLoadError = String(describing: error)
                    }
                },
                receiveValue: { [weak self] user in
                    self?.currentUser = user
                    self?.userLoadError = nil
                }
            )
    }
}
