import Foundation
import Observation
import Combine
import ConvexMobile

/// Sombrey Commerce — Phase 6D: the server's entitlement answer, live.
///
/// Subscribes to `commerce/access:myEntitlements` (reactive: a purchase,
/// renewal, expiry notification, refund or ownership grant on the server
/// updates it without a relaunch). The answer is held in memory for this
/// session only — never written to UserDefaults or disk — so a reinstall, a
/// new iPhone or another device simply asks the server again. When the
/// connection drops, the last answer from THIS session stays; with none, gated
/// surfaces say they couldn't check (never "allowed").
@Observable
@MainActor
final class EntitlementStore {
    private(set) var state: EntitlementState
    let enforced: Bool

    private var cancellable: AnyCancellable?
    private var reportedLocked: Set<FeatureID> = []

    init(enforced: Bool = EntitlementGateConfig.enabled) {
        self.enforced = enforced
        self.state = enforced ? .checking : .notEnforced
    }

    /// The server's answer for a feature (see `EntitlementResolver`).
    func access(_ feature: FeatureID) -> FeatureAccess {
        EntitlementResolver.access(feature, in: state)
    }

    var entitlements: ServerEntitlements? {
        if case .ready(let e) = state { return e } else { return nil }
    }

    /// Start (or restart) listening — on sign-in, on returning to the app,
    /// and from "Try again".
    func refresh() {
        guard enforced else { return }
        if entitlements == nil { state = .checking }
        cancellable = ConvexClientProvider.client
            .subscribe(to: "commerce/access:myEntitlements", with: nil, yielding: ServerEntitlements.self)
            // Convex delivers on its own thread; this class is main-actor
            // isolated (see NotificationManager.fetchOnce's launch-crash fix).
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, case .failure(let error) = completion else { return }
                    CommerceDiagnostics.error("entitlements unavailable: \(String(describing: type(of: error)))")
                    // Keep this session's last answer; without one, say so.
                    if self.entitlements == nil { self.state = .unavailable }
                },
                receiveValue: { [weak self] value in
                    guard let self else { return }
                    if self.entitlements?.state != value.state { CommerceDiagnostics.log("entitlement state: \(value.state)") }
                    self.state = .ready(value)
                }
            )
    }

    /// Sign-out: forget everything; the next account asks the server afresh.
    func reset() {
        cancellable = nil
        reportedLocked.removeAll()
        state = enforced ? .checking : .notEnforced
    }

    /// A locked surface was shown. Recorded as the client event
    /// `feature_access_denied` (feature id only — no personal data), at most
    /// once per feature per session.
    func noteLocked(_ feature: FeatureID) async {
        guard enforced, case .locked = access(feature), reportedLocked.insert(feature).inserted else { return }
        try? await ConvexClientProvider.client.mutation("commerce/access:recordEvent", with: [
            "name": "feature_access_denied", "platform": "ios", "source": feature.rawValue,
        ])
    }
}
