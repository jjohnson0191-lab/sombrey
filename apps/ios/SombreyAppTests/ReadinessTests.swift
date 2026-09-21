import Testing
import Foundation
@testable import SombreyApp

/// `ReadinessResultDTO` decodes the exact wire shape
/// `convex/readiness.ts`'s `getLatest`/`getHistory` return (verified
/// against that file directly) and maps it into the UI-facing
/// `ReadinessResult` `ReadinessIndicatorView` already expects — the
/// algorithm itself lives server-side and is covered by
/// `tests/readiness/scoring.test.ts`; this only guards the decode/map
/// boundary.
struct ReadinessDecodingTests {
    private static let sampleJSON = """
    {
        "_id": "abc123",
        "_creationTime": 1234567890,
        "userId": "user1",
        "date": "2026-01-15",
        "algorithmVersion": "v1",
        "score": 78.0,
        "confidence": 0.62,
        "scoreBand": "Ready",
        "confidenceBand": "Improving",
        "components": [
            {"metric": "sleep", "subScore": 88.0, "weight": 0.5, "confidence": 0.7, "description": "Sleep duration is strong"},
            {"metric": "cardiovascular", "subScore": 70.0, "weight": 0.5, "confidence": 0.5, "description": "Recovery trend is stable"},
            {"metric": "trainingLoad", "weight": 0.0, "confidence": 0.0, "description": "No recent training sessions logged"}
        ],
        "missingInputs": ["No recent training sessions logged"],
        "calculatedAt": 1768521600000.0
    }
    """.data(using: .utf8)!

    @Test func decodesTheRealConvexWireShape() throws {
        let dto = try JSONDecoder().decode(ReadinessResultDTO.self, from: Self.sampleJSON)
        #expect(dto.date == "2026-01-15")
        #expect(dto.algorithmVersion == "v1")
        #expect(dto.score == 78.0)
        #expect(dto.scoreBand == "Ready")
        #expect(dto.confidenceBand == "Improving")
    }

    @Test func mapsToRoundedIntScoreAndDropsExcludedComponentsFromFactors() throws {
        let dto = try JSONDecoder().decode(ReadinessResultDTO.self, from: Self.sampleJSON)
        let result = dto.toReadinessResult()
        #expect(result.score == 78)
        // Only the 2 components with a real sub-score become factors —
        // the excluded trainingLoad component must not appear.
        #expect(result.contributingFactors.count == 2)
        #expect(result.contributingFactors.allSatisfy { $0.metric != "trainingLoad" })
        #expect(result.missingInputs == ["No recent training sessions logged"])
    }

    @Test func nullScoreDecodesToNilNotZero() throws {
        let json = """
        {"userId":"u","date":"2026-01-01","algorithmVersion":"v1","score":null,"confidence":0,"scoreBand":null,"confidenceBand":"Building baseline","components":[],"missingInputs":["No data"],"calculatedAt":1000.0}
        """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(ReadinessResultDTO.self, from: json)
        let result = dto.toReadinessResult()
        #expect(result.score == nil)
        #expect(result.scoreBand == nil)
    }
}

/// `WearableManager.displayState` — the layer that turns raw SDK
/// connection state into what the UI actually shows (adds "not paired"/
/// "searching," which the SDK-driven state stream itself doesn't
/// represent). Only the state safely testable without touching Convex —
/// matching `WearableManagerTests`' own established discipline.
@MainActor
struct WearableDisplayStateTests {
    @Test func freshManagerIsNotPaired() {
        let manager = WearableManager(service: MockQCBandService())
        #expect(manager.displayState == .notPaired)
    }
}
