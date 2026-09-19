import XCTest

final class SombreyAppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunches() throws {
        let app = XCUIApplication()
        app.launch()
        // Phase 0 smoke test only: the app must launch without crashing
        // and land on either the sign-in screen or the foundation shell.
        // Real UI test coverage starts once Phase 2+ ships real screens.
        XCTAssertTrue(app.state == .runningForeground)
    }
}
