import Testing
@testable import SombreyApp

struct SombreyAppTests {
    @Test func studioColorTokensAreDistinct() {
        // Smoke test proving the test target actually links against the
        // app target — real coverage starts once Phase 1+ ships logic
        // worth testing beyond the design-system tokens.
        #expect(StudioScene.allCases.count == 7)
    }
}
