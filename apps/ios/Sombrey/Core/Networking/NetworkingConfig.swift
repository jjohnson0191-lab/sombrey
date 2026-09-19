import Foundation

/// Reserved for HTTP calls that fall outside Convex's realtime
/// query/mutation/action client — e.g. a future direct upload helper for
/// camera macro photos. Empty in Phase 0; most Sombrey data access goes
/// through `ConvexClientProvider`, not raw networking.
enum NetworkingConfig {}
