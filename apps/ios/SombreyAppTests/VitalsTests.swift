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

/// Phase UI1's interaction foundation: the pure pieces every metric
/// instrument relies on to show only real data — range windows, how
/// stored readings become chart points, blood-pressure pairing, range
/// statistics, and the bounded live heart-rate trace.
struct InstrumentFoundationTests {
    private func dto(_ type: String, _ value: Double, at seconds: Double) -> WearableMeasurementDTO {
        WearableMeasurementDTO(metricType: type, value: value, recordedAt: seconds * 1000)
    }

    @Test func liveRangeReadsTheStreamNotStoredHistory() {
        #expect(InstrumentRange.live.sinceMs() == nil)
    }

    @Test func todayStartsAtLocalMidnight() {
        let now = Date()
        let since = InstrumentRange.today.sinceMs(now: now)!
        #expect(since == Calendar.current.startOfDay(for: now).timeIntervalSince1970 * 1000)
        #expect(InstrumentRange.sevenDays.sinceMs(now: now)! < since)
        #expect(InstrumentRange.thirtyDays.sinceMs(now: now)! < InstrumentRange.sevenDays.sinceMs(now: now)!)
    }

    @Test func storedReadingsBecomeChronologicalReadingPoints() {
        let points = InstrumentSeries.stored([dto("heart_rate", 70, at: 200), dto("heart_rate", 64, at: 100)])
        #expect(points.map(\.value) == [64, 70])
        #expect(points.allSatisfy { $0.kind == .reading })
    }

    @Test func bloodPressurePairsOnlyMatchingTimestamps() {
        let high = [dto("blood_pressure_systolic", 118, at: 100), dto("blood_pressure_systolic", 125, at: 200)]
        let low = [dto("blood_pressure_diastolic", 76, at: 100)]
        let points = InstrumentSeries.pairedRange(high: high, low: low)
        #expect(points.count == 1)
        #expect(points.first?.value == 118)
        #expect(points.first?.low == 76)
    }

    @Test func statsDescribeOnlyTheReadingsGiven() {
        let stats = InstrumentStats.of([60, 70, 80])
        #expect(stats == InstrumentStats(count: 3, min: 60, max: 80, mean: 70))
        #expect(InstrumentStats.of([]) == nil)
    }

    @Test func yDomainContainsEveryValueAndTheBaseline() {
        let points = [InstrumentPoint(date: Date(), value: 36.4, kind: .reading)]
        let domain = InstrumentSeries.yDomain(points, baseline: 35.9)
        #expect(domain.contains(36.4))
        #expect(domain.contains(35.9))
    }

    @Test func liveTraceKeepsOnlyTheRecentWindowInOrder() {
        let start = Date()
        func sample(_ offset: TimeInterval, _ bpm: Double) -> WearableMeasurement {
            WearableMeasurement(deviceId: "d", metricType: .heartRate, value: bpm, unit: "bpm", recordedAt: start.addingTimeInterval(offset), sdkSource: LiveHeartRateTrace.sdkSource)
        }
        var trace: [WearableMeasurement] = []
        trace = LiveHeartRateTrace.appending(sample(0, 60), to: trace)
        trace = LiveHeartRateTrace.appending(sample(10, 62), to: trace)
        trace = LiveHeartRateTrace.appending(sample(LiveHeartRateTrace.window + 5, 70), to: trace)
        #expect(trace.map(\.value) == [62, 70])
        let points = InstrumentSeries.live(trace)
        #expect(points.allSatisfy { $0.kind == .live })
    }
}
