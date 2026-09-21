import Testing
import Foundation
@testable import SombreyApp

/// `MetricHistoryChart.TimeRange` is the one piece of genuinely new,
/// pure logic this pass introduced that's safely testable without a
/// live band or a Convex connection — every Vitals graph's 1D/7D/30D
/// range picker depends on this producing the correct window. Actual
/// data rendering/interaction (chart selection, live HR ticks) needs a
/// real device or simulator run, matching this codebase's established
/// discipline (see `ReadinessTests.swift`/`WearableManagerTests.swift`'s
/// own scoping comments).
struct MetricHistoryChartTimeRangeTests {
    @Test func oneDayIsRoughlyTwentyFourHoursAgo() {
        let since = Date(timeIntervalSince1970: MetricHistoryChart.TimeRange.oneDay.sinceMs / 1000)
        let expected = Date().addingTimeInterval(-24 * 3600)
        #expect(abs(since.timeIntervalSince(expected)) < 5)
    }

    @Test func sevenDaysIsFurtherInThePastThanOneDay() {
        let oneDay = MetricHistoryChart.TimeRange.oneDay.sinceMs
        let sevenDays = MetricHistoryChart.TimeRange.sevenDays.sinceMs
        #expect(sevenDays < oneDay)
    }

    @Test func thirtyDaysIsFurtherInThePastThanSevenDays() {
        let sevenDays = MetricHistoryChart.TimeRange.sevenDays.sinceMs
        let thirtyDays = MetricHistoryChart.TimeRange.thirtyDays.sinceMs
        #expect(thirtyDays < sevenDays)
    }

    @Test func everyRangeIsInThePastRelativeToNow() {
        let nowMs = Date().timeIntervalSince1970 * 1000
        for range in [MetricHistoryChart.TimeRange.oneDay, .sevenDays, .thirtyDays] {
            #expect(range.sinceMs < nowMs)
        }
    }
}
