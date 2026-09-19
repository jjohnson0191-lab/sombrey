import Foundation

/// Readiness/recovery domain types — ported from `packages/readiness/src/types.ts`.
/// Foundational shapes only; there is no scoring engine yet on either
/// client. `score` is explicitly optional: the engine, once built, must be
/// able to say "not enough data yet" rather than fabricate a number.
/// Product copy must stay conservative until an algorithm version is
/// actually validated — see the readiness package's own README.
struct ContributingFactor: Identifiable, Hashable {
    var id: String { metric }
    let metric: String
    let description: String
    /// Reserved for once a validated algorithm defines actual weighting.
    let weight: Double?
}

struct ReadinessResult {
    let userId: String
    let date: String
    let algorithmVersion: String
    /// nil when there isn't yet a validated score to show for this date/version.
    let score: Int?
    /// 0–1, reflects data sufficiency, not scientific confidence.
    let confidence: Double
    let contributingFactors: [ContributingFactor]
    let missingInputs: [String]
    let calculatedAt: Date
}
