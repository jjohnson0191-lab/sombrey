import Testing
import Foundation
import UIKit
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

/// UI3: the pure rules behind the readiness gauge, activity day dial and
/// sleep timeline — each instrument may only draw what real data supports.
struct UI3InstrumentTests {
    // MARK: Readiness

    private static let readinessJSON = """
    {"userId":"u","date":"2026-09-23","algorithmVersion":"v1","score":87.0,"confidence":0.4,
     "scoreBand":"Highly Ready","confidenceBand":"Improving",
     "components":[
       {"metric":"physiological","weight":0.0,"confidence":0.0,"description":"Not enough SpO2/temperature history yet"},
       {"metric":"sleep","subScore":87.3,"weight":1.0,"confidence":0.4,"description":"Sleep met your need"},
       {"metric":"cardiovascular","weight":0.0,"confidence":0.0,"description":"Building heart-rate baseline"},
       {"metric":"trainingLoad","weight":0.0,"confidence":0.0,"description":"No recent training sessions logged"}
     ],
     "missingInputs":[],"calculatedAt":1000.0}
    """.data(using: .utf8)!

    @Test func readinessKeepsEveryComponentInServerOrder() throws {
        let result = try JSONDecoder().decode(ReadinessResultDTO.self, from: Self.readinessJSON).toReadinessResult()
        #expect(result.components.map(\.metric) == ["sleep", "cardiovascular", "trainingLoad", "physiological"])
        #expect(result.components.filter(\.isIncluded).map(\.metric) == ["sleep"])
    }

    @Test func dialSegmentsTileExactlyZeroToHundred() throws {
        let result = try JSONDecoder().decode(ReadinessResultDTO.self, from: Self.readinessJSON).toReadinessResult()
        let segments = ReadinessDial.segments(result.components)
        #expect(segments.count == 2)
        #expect(segments.first?.kind == .contribution)
        #expect(abs((segments.first?.end ?? 0) - 87.3) < 0.0001)
        #expect(abs((segments.last?.end ?? 0) - 100) < 0.0001)
    }

    @Test func contributionsSumToTheUnroundedScoreAcrossSignals() {
        let components = [
            ReadinessComponent(metric: "sleep", subScore: 90, weight: 0.5, confidence: 1, description: ""),
            ReadinessComponent(metric: "cardiovascular", subScore: 60, weight: 0.5, confidence: 1, description: ""),
            ReadinessComponent(metric: "trainingLoad", subScore: nil, weight: 0, confidence: 0, description: ""),
        ]
        let segments = ReadinessDial.segments(components)
        let filled = segments.filter { $0.kind == .contribution }
        #expect(abs((filled.last?.end ?? 0) - 75) < 0.0001)
        #expect(segments.allSatisfy { $0.metric != "trainingLoad" })
    }

    @Test func historyKeepsTheNewestRowPerDate() throws {
        let rows = try JSONDecoder().decode([ReadinessResultDTO].self, from: """
        [{"userId":"u","date":"2026-09-23","algorithmVersion":"v1","score":87,"confidence":0.4,"scoreBand":null,"confidenceBand":"x","components":[],"missingInputs":[],"calculatedAt":2},
         {"userId":"u","date":"2026-09-23","algorithmVersion":"v1","score":80,"confidence":0.4,"scoreBand":null,"confidenceBand":"x","components":[],"missingInputs":[],"calculatedAt":1},
         {"userId":"u","date":"2026-09-22","algorithmVersion":"v1","score":null,"confidence":0,"scoreBand":null,"confidenceBand":"x","components":[],"missingInputs":[],"calculatedAt":0}]
        """.data(using: .utf8)!)
        let daily = ReadinessDial.dailyScores(rows)
        let newest: Double? = daily["2026-09-23"] ?? nil
        #expect(newest == 87)
        #expect(daily.keys.contains("2026-09-22"))
        let unscored: Double? = daily["2026-09-22"] ?? nil
        #expect(unscored == nil)
        #expect(ReadinessGauge.lastDays(14).count == 14)
    }

    // MARK: Activity

    private let midnight = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_790_100_000))

    private func snap(_ minutesAfterMidnight: Double, _ steps: Double) -> ActivityDay.Snapshot {
        ActivityDay.Snapshot(date: midnight.addingTimeInterval(minutesAfterMidnight * 60), steps: steps)
    }

    @Test func firstSpanRunsFromMidnightAndDifferencesAreExact() {
        let spans = ActivityDay.spans([snap(460, 288), snap(506, 1126)], dayStart: midnight)
        #expect(spans.count == 2)
        #expect(spans[0].start == midnight)
        #expect(spans[0].steps == 288)
        #expect(spans[1].steps == 838)
    }

    @Test func closeSnapshotsCoalesceWithoutLosingSteps() {
        let spans = ActivityDay.spans([snap(460, 100), snap(461, 140), snap(462, 190), snap(470, 300)], dayStart: midnight)
        #expect(spans.reduce(0) { $0 + $1.steps } == 300)
        #expect(spans.allSatisfy { $0.end.timeIntervalSince($0.start) >= ActivityDay.minimumSpan || $0.start == midnight })
    }

    @Test func counterResetIsNeverANegativeSpan() {
        let spans = ActivityDay.spans([snap(600, 7528), snap(640, 4360), snap(700, 4648)], dayStart: midnight)
        #expect(spans.allSatisfy { $0.steps > 0 })
        #expect(spans.last?.steps == 288)
    }

    @Test func dailyTotalsOmitDaysWithoutData() {
        let yesterday = midnight.addingTimeInterval(-86_400)
        let totals = ActivityDay.dailyTotals([
            ActivityDay.Snapshot(date: yesterday.addingTimeInterval(3600), steps: 2070),
            snap(506, 1126),
        ])
        #expect(totals[yesterday] == 2070)
        #expect(totals[midnight] == 1126)
        #expect(totals.count == 2)
    }

    // MARK: Sleep

    @Test func stagesAreOnlyPlacedAtRecordedTimes() {
        let dto = SleepSessionSummaryDTO(
            totalSleepMinutes: 380,
            stages: [
                SleepStageDTO(stage: "light", durationMinutes: 13, startedAt: 1_000_000),
                SleepStageDTO(stage: "deep", durationMinutes: 35, startedAt: nil),
                SleepStageDTO(stage: "rem", durationMinutes: 18, startedAt: 1_000_000 + 13 * 60_000),
            ],
            startedAt: 1_000_000,
            endedAt: 1_000_000 + 380 * 60_000
        )
        let session = SleepTimelineModel.session(dto)
        #expect(session.blocks.map(\.stage) == [.light, .rem])
        #expect(SleepTimelineModel.minutesByStage(session.blocks)[.deep] == nil)
    }

    @Test func averageNeedsThreeEarlierNights() {
        func night(_ start: Double, _ minutes: Int) -> SleepTimelineModel.Session {
            SleepTimelineModel.Session(start: Date(timeIntervalSince1970: start), end: Date(timeIntervalSince1970: start + 1), totalSleepMinutes: minutes, blocks: [])
        }
        let latest = night(10, 380)
        #expect(SleepTimelineModel.recentAverage(excluding: latest, in: [latest, night(1, 141)]) == nil)
        #expect(SleepTimelineModel.recentAverage(excluding: latest, in: [latest, night(1, 300), night(2, 360), night(3, 420)]) == 360)
    }

    @Test func eveningClockPutsSixPMAtZero() {
        var components = DateComponents()
        components.year = 2026; components.month = 9; components.day = 23; components.hour = 18
        let sixPM = Calendar.current.date(from: components)!
        #expect(SleepTimelineModel.eveningClock(sixPM) == 0)
        #expect(SleepTimelineModel.eveningClock(sixPM.addingTimeInterval(7 * 3600)) == 7)
    }
}

/// UI2: Home's time-of-day and score-level rules.
struct HomeIdentityTests {
    @Test func greetingBoundariesAreFixed() {
        #expect(DayPart(hour: 4) == .evening)
        #expect(DayPart(hour: 5) == .morning)
        #expect(DayPart(hour: 11) == .morning)
        #expect(DayPart(hour: 12) == .afternoon)
        #expect(DayPart(hour: 16) == .afternoon)
        #expect(DayPart(hour: 17) == .evening)
        #expect(DayPart(hour: 0) == .evening)
        #expect(DayPart.morning.greeting == "Good morning")
    }

    @Test func greetingFollowsTheTimeZoneNotAFixedClock() {
        let instant = Date(timeIntervalSince1970: 1_790_188_920) // 18:42 UTC
        var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(identifier: "UTC")!
        var losAngeles = Calendar(identifier: .gregorian); losAngeles.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        #expect(DayPart(date: instant, calendar: utc) == .evening)
        #expect(DayPart(date: instant, calendar: losAngeles) == .morning)
    }

    @Test func clockHonoursTwelveAndTwentyFourHourLocales() {
        let instant = Date(timeIntervalSince1970: 1_790_188_920)
        let utc = TimeZone(identifier: "UTC")!
        let us = InstrumentClockText(date: instant, locale: Locale(identifier: "en_US"), timeZone: utc)
        #expect(us.digits == "6:42")
        #expect(us.period == "PM")
        let uk = InstrumentClockText(date: instant, locale: Locale(identifier: "en_GB"), timeZone: utc)
        #expect(uk.digits == "18:42")
        #expect(uk.period == nil)
        // French has a literal "h" in its pattern but is a 24-hour clock.
        #expect(InstrumentClockText(date: instant, locale: Locale(identifier: "fr_FR"), timeZone: utc).period == nil)
        let kolkata = InstrumentClockText(date: instant, locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "Asia/Kolkata")!)
        #expect(kolkata.digits == "12:12")
        #expect(kolkata.period == "AM")
    }

    @Test func scoreBandsMirrorTheServerThresholdsAndCoverTheRange() {
        #expect(ReadinessDial.bands.dropFirst().map { Double($0.lower) } == ReadinessDial.bandThresholds)
        #expect(ReadinessDial.band(for: 87)?.name == "Highly Ready")
        #expect(ReadinessDial.band(for: 85)?.name == "Highly Ready")
        #expect(ReadinessDial.band(for: 84)?.name == "Ready")
        #expect(ReadinessDial.band(for: 39)?.name == "Low Readiness")
        #expect((0...100).allSatisfy { score in ReadinessDial.bands.filter { $0.contains(score) }.count == 1 })
    }
}

/// Typography: every face the system names must be a real, registered
/// font — a typo would silently fall back to the system face.
struct TypographyTests {
    @Test func everyStudioFontNameResolves() {
        let names = [
            StudioFont.Instrument.regular, StudioFont.Instrument.medium, StudioFont.Instrument.mediumItalic,
            StudioFont.Instrument.semibold, StudioFont.Instrument.bold,
            StudioFont.Hero.semibold, StudioFont.Hero.bold,
        ]
        for name in names {
            #expect(UIFont(name: name, size: 17) != nil, "\(name) is not a registered font")
        }
    }
}
