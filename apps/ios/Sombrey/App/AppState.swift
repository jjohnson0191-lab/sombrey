import Foundation
import Observation

/// Top-level app state boundary. Deliberately thin: auth state lives on
/// `Clerk.shared` (injected via `.environment`), wearable state lives on
/// `WearableManager`, and feature state lives in each feature module —
/// this only tracks cross-cutting navigation state that doesn't belong to
/// any one feature.
@Observable
final class AppState {
    var selectedTab: SombreyTab = .home
}
