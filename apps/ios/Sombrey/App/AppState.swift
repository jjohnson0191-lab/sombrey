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
///
/// FIX (see ConvexClientProvider.swift's `ClerkConvexAuthError` for the
/// other half): `authPhase` now has a distinct `.failed` case instead of
/// conflating "still loading" and "sync failed" into one "not signed in
/// yet" bucket — that conflation is what let the UI get stuck on
/// "Connecting…" forever when the post-sign-in Convex token sync failed
/// or hung, with no error shown and nothing retrying. A 20s timeout
/// guarantees `.loading` can never last indefinitely even if the
/// underlying SDK call itself never returns.
@Observable
@MainActor
final class AppState {
    enum AuthPhase: Equatable {
        case loading
        case signedOut
        case signedIn
        case failed(String)
    }

    var selectedTab: SombreyTab = .home
    /// Which part of the AI tab is showing. Nutrition lives inside AI
    /// (there is no Nutrition tab), so anything that means "go to
    /// nutrition" — Home's nutrition card, a meal notification — sets
    /// `.nutrition` and selects the AI tab.
    var aiSection: AISection = .coach

    enum AISection: String, CaseIterable, Identifiable {
        case coach = "Coach"
        case nutrition = "Nutrition"
        var id: String { rawValue }
    }

    /// Opens Sombrey › Nutrition from anywhere.
    func openNutrition() {
        aiSection = .nutrition
        selectedTab = .sombrey
    }

    /// Opens Sombrey › Coach from anywhere.
    func openCoach() {
        aiSection = .coach
        selectedTab = .sombrey
    }

    /// The Sombrey Coach conversation — kept here (not in the screen, which
    /// is rebuilt on every tab change) so it survives moving between tabs.
    /// Cleared on sign-out.
    let coach = SombreyCoachConversation()
    private(set) var authPhase: AuthPhase = .loading
    private(set) var currentUser: SombreyUser?
    private(set) var userLoadError: String?

    private var authStateCancellable: AnyCancellable?
    private var userSubscriptionCancellable: AnyCancellable?
    private var syncTask: Task<Void, Never>?
    private var currentSyncID: UUID?
    private var didStart = false

    private static let syncTimeoutSeconds = 20

    /// Called once, from the root view's `.task`. Attempts a silent
    /// session restore (Keychain-backed via ClerkKit) without showing any
    /// UI — the native equivalent of the web app's auth-loading gate.
    func start() {
        guard !didStart else { return }
        didStart = true

        // Reacts to state changes the SDK makes on its own AFTER a
        // successful sync (e.g. a background token refresh failing hours
        // later) — deliberately does NOT drive .loading/.failed itself,
        // so it can't fight with syncConvex()'s own Result handling below.
        authStateCancellable = ConvexClientProvider.client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                AuthDiagnostics.log("[5] Convex authState (SDK-internal): \(String(describing: state))")
                if case .unauthenticated = state, self.authPhase == .signedIn {
                    self.userSubscriptionCancellable = nil
                    self.currentUser = nil
                    self.authPhase = .signedOut
                }
            }

        AuthDiagnostics.log("AppState.start(): attempting silent session restore")
        syncConvex()
    }

    /// Call after ClerkKitUI's `AuthView` reports a session appearing
    /// (see `SombreyApp.swift`'s `.onChange(of: clerk.session?.id)`) — a
    /// fresh interactive sign-in doesn't itself route through
    /// `ConvexClientWithAuth`, so this pulls the now-available Clerk
    /// token into Convex's connection without prompting the UI again.
    func syncConvexAuthAfterInteractiveSignIn() {
        AuthDiagnostics.log("[1][2] Clerk session id changed -> re-syncing Convex auth")
        syncConvex()
    }

    /// User-initiated retry from the new failed state's UI.
    func retry() {
        AuthDiagnostics.log("Manual retry requested")
        syncConvex()
    }

    func signOut() async {
        AuthDiagnostics.log("Signing out")
        syncTask?.cancel()
        currentSyncID = nil
        await ConvexClientProvider.client.logout()
        currentUser = nil
        userLoadError = nil
        coach.reset()
        authPhase = .signedOut
    }

    /// The one place that drives loading/signedIn/failed — a direct
    /// `await` on `loginFromCache()`'s own `Result`, not just a passive
    /// subscription, so a real failure reason is always available to
    /// show the user (the passive `authState` publisher discards the
    /// underlying error — see `convex-swift`'s `login(strategy:)`).
    private func syncConvex() {
        syncTask?.cancel()
        authPhase = .loading
        let attemptID = UUID()
        currentSyncID = attemptID

        let task = Task {
            AuthDiagnostics.log("[3][4] loginFromCache(): starting")
            let result = await ConvexClientProvider.client.loginFromCache()
            guard !Task.isCancelled, self.currentSyncID == attemptID else {
                AuthDiagnostics.log("loginFromCache(): result discarded (superseded or cancelled)")
                return
            }
            switch result {
            case .success:
                AuthDiagnostics.log("[4][5] loginFromCache(): succeeded — Convex authenticated")
                self.authPhase = .signedIn
                self.subscribeToCurrentUser()
            case .failure(let error):
                let message = Self.safeDescription(error)
                AuthDiagnostics.error("[4] loginFromCache(): failed — \(message)")
                self.authPhase = .failed(message)
            }
        }
        syncTask = task

        Task {
            try? await Task.sleep(for: .seconds(Self.syncTimeoutSeconds))
            guard self.currentSyncID == attemptID, self.authPhase == .loading else { return }
            AuthDiagnostics.error("loginFromCache(): timed out after \(Self.syncTimeoutSeconds)s")
            task.cancel()
            self.authPhase = .failed("Timed out connecting to Convex. Check your connection and try again.")
        }
    }

    /// Pure mapping of the SDK's own published state — kept only for
    /// `AppStateTests.swift`'s unit coverage of that shape; `syncConvex()`
    /// above is what actually drives `authPhase` now.
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
                AuthDiagnostics.log("[6] users:updateCurrentUser: calling")
                try await ConvexClientProvider.client.mutation("users:updateCurrentUser")
                AuthDiagnostics.log("[6] users:updateCurrentUser: succeeded")
            } catch {
                AuthDiagnostics.error("[6] users:updateCurrentUser: failed — \(Self.safeDescription(error))")
                self.userLoadError = Self.safeDescription(error)
            }
        }

        userSubscriptionCancellable = ConvexClientProvider.client
            .subscribe(to: "users:getCurrentUser", yielding: SombreyUser?.self)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    if case .failure(let error) = completion {
                        let message = Self.safeDescription(error)
                        AuthDiagnostics.error("[7] users:getCurrentUser: failed — \(message)")
                        self?.userLoadError = message
                    }
                },
                receiveValue: { [weak self] user in
                    AuthDiagnostics.log("[7][8] users:getCurrentUser: returned (found: \(user != nil))")
                    self?.currentUser = user
                    self?.userLoadError = nil
                }
            )
    }

    /// `String(describing:)` on Convex/Clerk errors — never includes
    /// request bodies or tokens, just the error's own description.
    private static func safeDescription(_ error: Error) -> String {
        String(describing: error)
    }
}
