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
    /// e.g. "Ready" — a pure presentation label computed server-side by
    /// `convex/readiness/scoring.ts`'s own `scoreBand()`, never a new
    /// threshold invented on the client. nil alongside a nil `score`.
    let scoreBand: String?
    /// e.g. "High" — same idea, from `scoring.ts`'s `confidenceBand()`.
    let confidenceBand: String
    let contributingFactors: [ContributingFactor]
    let missingInputs: [String]
    let calculatedAt: Date
}

// MARK: - Convex wire decoding
//
// Phase 3 readiness expansion: `readiness:getLatest`/`getHistory` return
// the row shape below — decoded here, then mapped into `ReadinessResult`
// above so the UI-facing type (and `ReadinessIndicatorView`, which
// already expects it) stays exactly as it was designed, never coupled to
// Convex's own wire format.

private struct ReadinessComponentDTO: Decodable {
    let metric: String
    let subScore: Double?
    let weight: Double
    let confidence: Double
    let description: String
}

struct ReadinessResultDTO: Decodable {
    let userId: String
    let date: String
    let algorithmVersion: String
    let score: Double?
    let confidence: Double
    let scoreBand: String?
    let confidenceBand: String
    private let components: [ReadinessComponentDTO]
    let missingInputs: [String]
    let calculatedAt: Double

    func toReadinessResult() -> ReadinessResult {
        // Only components that actually produced a reading become
        // user-facing factors — a component with no sub-score was
        // excluded, not silently worth zero.
        let factors = components
            .filter { $0.subScore != nil }
            .sorted { $0.weight > $1.weight }
            .map { ContributingFactor(metric: $0.metric, description: $0.description, weight: $0.weight) }
        return ReadinessResult(
            userId: userId,
            date: date,
            algorithmVersion: algorithmVersion,
            score: score.map { Int($0.rounded()) },
            confidence: confidence,
            scoreBand: scoreBand,
            confidenceBand: confidenceBand,
            contributingFactors: factors,
            missingInputs: missingInputs,
            calculatedAt: Date(timeIntervalSince1970: calculatedAt / 1000)
        )
    }
}
