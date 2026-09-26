import Testing
import Foundation
import UIKit
@testable import SombreyApp

/// Progress on the phone: the server's shapes decode, values format in
/// their own units, and absent data stays absent.
struct ProgressModelTests {
    @Test func strainWithoutAFormulaCarriesNoScore() throws {
        let json = #"{"date":"2026-09-26","load":{"date":"2026-09-26","sessionCount":2,"activeMinutes":94,"workoutMinutes":48,"activityMinutes":46,"bandRecordedMinutes":48},"score":{"state":"no_formula"},"engine":{"id":"none","version":"0","validated":false},"baselineDays":6,"context":["Not enough data to establish your baseline."],"week":[]}"#
        let day = try JSONDecoder().decode(StrainDayDTO.self, from: Data(json.utf8))
        #expect(day.score.state == "no_formula")
        #expect(day.score.value == nil)
        #expect(day.usualActiveMinutes == nil)
        #expect(day.engine.validated == false)
    }

    @Test func performanceValuesFormatInTheirOwnUnits() {
        #expect(ProgressFormat.value(5.6, unit: "min/km") == "5:36")
        #expect(ProgressFormat.unitLabel("min/km") == "/km")
        #expect(ProgressFormat.value(5.984, unit: "km") == "5.98")
        #expect(ProgressFormat.value(102.5, unit: "kg") == "102.5")
        #expect(ProgressFormat.value(110, unit: "kg") == "110")
        #expect(ProgressFormat.rangeLabel("90d") == "90D")
    }

    @Test func bodyWithoutEntriesHasNoValues() throws {
        let json = #"{"entries":[]}"#
        let body = try JSONDecoder().decode(BodySummaryDTO.self, from: Data(json.utf8))
        #expect(body.latest == nil)
        #expect(body.changeKg == nil)
    }

    @Test func provenanceReadsInPlainWords() {
        #expect(ProgressProvenance.label("band_record") == "Band record")
        #expect(ProgressProvenance.label("manual") == "Entered by you")
        #expect(ProgressProvenance.label("scanner") == "Body scan")
        #expect(ProgressProvenance.label(nil) == nil)
    }
}

/// Sombrey intelligence on the phone: the pipeline's state decodes, no
/// strain number is carried before approval, and weather states read
/// honestly.
struct IntelligenceModelTests {
    @Test func pipelineStateDecodesWithoutAValue() throws {
        let json = #"{"date":"2026-09-26","load":{"date":"2026-09-26","sessionCount":1,"activeMinutes":40,"workoutMinutes":0,"activityMinutes":40,"bandRecordedMinutes":40},"score":{"state":"no_formula"},"engine":{"id":"sombrey-intelligence","version":"proposal-1","validated":false},"intelligence":{"state":"BUILDING_BASELINE","confidence":"LOW_CONFIDENCE","baseline":{"status":"building","historyDays":5,"activeDays":3,"qualitySessions":1,"required":{"historyDays":14,"activeDays":6,"qualitySessions":4}},"sessions":[{"id":"a","basis":"activity","resistance":false,"confidence":"LOW_CONFIDENCE","trimmed":false}],"duplicatesRemoved":0},"baselineDays":5,"context":[],"week":[]}"#
        let day = try JSONDecoder().decode(StrainDayDTO.self, from: Data(json.utf8))
        #expect(day.score.value == nil)
        #expect(day.intelligence?.state == "BUILDING_BASELINE")
        #expect(day.intelligence?.baseline.required.activeDays == 6)
        #expect(StrainIntelligenceDTO.confidenceLabel("LOW_CONFIDENCE") == "Low")
        #expect(day.intelligence.map { StrainIntelligenceDTO.basisLabel($0.sessions[0]) } == "Activity type")
    }

    @Test func olderServerWithoutIntelligenceStillDecodes() throws {
        let json = #"{"date":"2026-09-26","load":{"date":"2026-09-26","sessionCount":0,"activeMinutes":0,"workoutMinutes":0,"activityMinutes":0,"bandRecordedMinutes":0},"score":{"state":"no_formula"},"engine":{"id":"none","version":"0","validated":false},"baselineDays":0,"context":[],"week":[]}"#
        let day = try JSONDecoder().decode(StrainDayDTO.self, from: Data(json.utf8))
        #expect(day.intelligence == nil)
    }

    @Test @MainActor func weatherLineStates() throws {
        let json = #"{"state":"available","snapshot":{"observedAt":0,"fetchedAt":0,"timeZone":"Asia/Colombo","locality":"Colombo","temperatureC":28.4,"feelsLikeC":33.1,"humidityPct":78,"condition":"Partly cloudy"},"refreshAfterMs":1800000,"attribution":"Weather data: MET Norway (CC BY 4.0)"}"#
        let env = try JSONDecoder().decode(EnvironmentDTO.self, from: Data(json.utf8))
        let line = EnvironmentLine.text(env, access: .allowed)
        #expect(line?.hasPrefix("Colombo · ") == true)
        #expect(line?.hasSuffix("Partly cloudy") == true)
        #expect(EnvironmentLine.detail(env)?.contains("Humidity 78%") == true)
        #expect(EnvironmentLine.text(env, access: .denied)?.hasSuffix("Weather unavailable") == true)
        let unavailable = try JSONDecoder().decode(EnvironmentDTO.self, from: Data(#"{"state":"unavailable","reason":"not_fetched","refreshAfterMs":1800000,"attribution":"x"}"#.utf8))
        #expect(EnvironmentLine.text(unavailable, access: .allowed) == nil)
    }
}

/// Readiness v1 on the phone: new domain names, states and legacy rows.
struct ReadinessV1ModelTests {
    @Test func readinessV1RowDecodesWithStateAndRecentLoad() throws {
        let json = #"{"userId":"u","date":"2026-09-26","algorithmVersion":"readiness-1.0","score":78,"confidence":0.62,"scoreBand":"Ready","confidenceBand":"Moderate","components":[{"metric":"sleep","subScore":90,"weight":0.5,"confidence":0.8,"description":"Sleep met your usual need"},{"metric":"recentLoad","subScore":80,"weight":0.25,"confidence":0.7,"description":"Recent load is above your typical days","detail":"{}"}],"missingInputs":[],"calculatedAt":0,"state":"READY","confidenceLevel":"MODERATE"}"#
        let result = try JSONDecoder().decode(ReadinessResultDTO.self, from: Data(json.utf8)).toReadinessResult()
        #expect(result.state == "READY")
        #expect(result.components.map(\.displayName) == ["Sleep", "Recent load"])
        #expect(ReadinessGauge.stateNote("BUILDING_BASELINE") == "building your baseline")
        #expect(ReadinessGauge.stateNote("READY") == nil)
    }

    @Test func legacyRowStillDecodes() throws {
        let json = #"{"userId":"u","date":"2026-09-01","algorithmVersion":"v1","score":70,"confidence":0.5,"scoreBand":"Ready","confidenceBand":"Improving","components":[{"metric":"trainingLoad","subScore":90,"weight":0.25,"confidence":0.5,"description":"x"}],"missingInputs":[],"calculatedAt":0}"#
        let result = try JSONDecoder().decode(ReadinessResultDTO.self, from: Data(json.utf8)).toReadinessResult()
        #expect(result.state == nil)
        #expect(result.components.first?.displayName == "Training load")
    }

    @Test func recentLoadLineSaysUnknownDaysAreUnknown() throws {
        let json = #"{"yesterdayStatus":"no_data","knownDays7":4,"activeDays7":3,"highLoadDays7":1,"unknownDays7":3,"consecutiveHighLoadDays":0}"#
        let recent = try JSONDecoder().decode(StrainIntelligenceDTO.Recent.self, from: Data(json.utf8))
        #expect(recent.unknownDays7 == 3)
    }
}

/// Cross-product upgrade: Strain on Home, weather, RPE, profile, navigation.
struct ProductUpgradeTests {
    private func strain(_ json: String) throws -> TodayStrainDTO {
        try JSONDecoder().decode(TodayStrainDTO.self, from: Data(json.utf8))
    }
    private let baseline = #""baseline":{"status":"building","historyDays":5,"activeDays":3,"qualitySessions":1,"required":{"historyDays":14,"activeDays":6,"qualitySessions":4}}"#

    @Test func strainShowsTheServerValueOnlyWhenItExists() throws {
        let ready = try strain(#"{"date":"2026-09-26","state":"READY","confidence":"MODERATE_CONFIDENCE","version":"strain-1.0","validated":false,"value":64,"band":"High","relativeLabel":"Above your usual day","sessions":2,"activeMinutes":80,"# + baseline + "}")
        #expect(StrainPresentation(ready, isLoading: false) == .value(64, band: "High", note: "Above your usual day"))
        let building = try strain(#"{"date":"2026-09-26","state":"BUILDING_BASELINE","confidence":"LOW_CONFIDENCE","version":"strain-1.0","validated":false,"sessions":1,"activeMinutes":30,"# + baseline + "}")
        #expect(StrainPresentation(building, isLoading: false) == .message(title: "Building your baseline", detail: "3 of 6 active days · 5 of 14 days of history"))
        let low = try strain(#"{"date":"2026-09-26","state":"LOW_CONFIDENCE","confidence":"LOW_CONFIDENCE","version":"strain-1.0","validated":false,"value":41,"band":"Moderate","sessions":1,"activeMinutes":30,"# + baseline + "}")
        #expect(StrainPresentation(low, isLoading: false) == .value(41, band: "Moderate", note: "Limited data today"))
        #expect(StrainPresentation(nil, isLoading: true) == .loading)
        #expect(StrainPresentation(nil, isLoading: false) == .unavailable)
    }

    @Test func notEnoughDataNeverShowsANumber() throws {
        let none = try strain(#"{"date":"2026-09-26","state":"NOT_ENOUGH_DATA","confidence":"INSUFFICIENT_DATA","version":"strain-1.0","validated":false,"sessions":1,"activeMinutes":10,"# + baseline + "}")
        if case .value = StrainPresentation(none, isLoading: false) { Issue.record("a number was shown for NOT_ENOUGH_DATA") }
    }

    @Test @MainActor func weatherWithForecastDecodesAndReadsHonestly() throws {
        let json = #"{"state":"available","snapshot":{"observedAt":0,"fetchedAt":0,"timeZone":"Asia/Colombo","locality":"Colombo","temperatureC":28,"condition":"Partly cloudy","conditionCode":"partly_cloudy","isNight":false,"forecast":[{"date":"2026-09-26","highC":30,"lowC":27,"conditionCode":"rain","precipitationMm":1.2,"partial":true},{"date":"2026-09-27","highC":31,"lowC":25,"conditionCode":"thunder","precipitationProbability":70}]},"refreshAfterMs":1800000,"attribution":"Weather data: MET Norway (CC BY 4.0)"}"#
        let env = try JSONDecoder().decode(EnvironmentDTO.self, from: Data(json.utf8))
        #expect(env.snapshot?.forecast?.count == 2)
        #expect(env.snapshot?.forecast?.first?.partial == true)
        #expect(WeatherSymbol.name("partly_cloudy", night: false) == "cloud.sun")
        #expect(WeatherSymbol.name("thunder", night: false) == "cloud.bolt.rain")
        #expect(WeatherSymbol.name(nil, night: true) == "cloud")
        let state = WeatherContextState(dto: env, access: .allowed, isLoading: false, error: nil)
        #expect(state.canExpand)
        #expect(state.line.hasPrefix("Colombo · "))
        let denied = WeatherContextState(dto: env, access: .denied, isLoading: false, error: nil)
        #expect(!denied.canExpand)
        #expect(denied.line.hasSuffix("Weather unavailable (location off)"))
        let failed = WeatherContextState(dto: nil, access: .allowed, isLoading: false, error: "offline")
        #expect(failed.line.hasSuffix("Weather unavailable right now"))
    }

    @Test func rpeDecodesAndLabelsInWords() throws {
        let pending = try JSONDecoder().decode([PendingRPEDTO].self, from: Data(#"[{"kind":"band_activity","sessionId":"s1","name":"Tennis","endedAt":0,"minutes":45}]"#.utf8))
        #expect(pending.first?.kind == "band_activity")
        let saved = try JSONDecoder().decode(RPESaveResult.self, from: Data(#"{"ratedOn":"workout","sessionId":"w1","rpe":7}"#.utf8))
        #expect(saved.ratedOn == "workout")
        #expect(RPESelector.label(1) == "Very easy")
        #expect(RPESelector.label(7) == "Hard")
        #expect(RPESelector.label(10) == "Max effort")
        #expect(RPESelector.label(11) == nil)
    }

    @Test func profileUserDecodesWithAndWithoutPhoto() throws {
        let with = try JSONDecoder().decode(SombreyUser.self, from: Data(#"{"_id":"u","name":"Ada","email":"a@x","coachingMode":null,"avatarUrl":"https://example.com/a.jpg"}"#.utf8))
        #expect(with.avatarUrl == "https://example.com/a.jpg")
        let without = try JSONDecoder().decode(SombreyUser.self, from: Data(#"{"_id":"u","name":"Ada"}"#.utf8))
        #expect(without.avatarUrl == nil)
    }

    @Test @MainActor func profilePhotoIsResizedToAtMost512() throws {
        let big = UIGraphicsImageRenderer(size: CGSize(width: 2000, height: 1200)).image { ctx in
            UIColor.gray.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 2000, height: 1200))
        }
        let data = try #require(ProfilePhotoUpload.prepared(big))
        let out = try #require(UIImage(data: data))
        #expect(out.size.width <= 512 && out.size.height <= 512)
        #expect(out.size.width == out.size.height)
    }

    @Test func pagingDecisionsRespectDirectionAndExclusions() {
        #expect(PrimaryPager.decide(translation: CGSize(width: -40, height: 5), startsInExcludedRegion: false) == .paging)
        #expect(PrimaryPager.decide(translation: CGSize(width: -40, height: 5), startsInExcludedRegion: true) == .ignored)
        #expect(PrimaryPager.decide(translation: CGSize(width: 10, height: 40), startsInExcludedRegion: false) == .ignored)
        #expect(PrimaryPager.decide(translation: CGSize(width: 30, height: 25), startsInExcludedRegion: false) == .ignored) // ambiguous
        #expect(PrimaryPager.decide(translation: CGSize(width: 6, height: 2), startsInExcludedRegion: false) == .undecided)
        #expect(PrimaryPager.neighbour(of: .home, dragWidth: -10) == .train)
        #expect(PrimaryPager.neighbour(of: .home, dragWidth: 10) == nil)
        #expect(PrimaryPager.neighbour(of: .settings, dragWidth: -10) == nil)
        #expect(PrimaryPager.neighbour(of: .progress, dragWidth: 10) == .train)
        #expect(PrimaryPager.commits(dragWidth: -150, predictedWidth: -160, width: 390, hasNeighbour: true))
        #expect(!PrimaryPager.commits(dragWidth: -60, predictedWidth: -80, width: 390, hasNeighbour: true))
        #expect(PrimaryPager.commits(dragWidth: -60, predictedWidth: -300, width: 390, hasNeighbour: true)) // flick
        #expect(!PrimaryPager.commits(dragWidth: -200, predictedWidth: -200, width: 390, hasNeighbour: false))
        #expect(PrimaryPager.displayed(dragWidth: 100, hasNeighbour: false) < 30) // resisted at the ends
    }

}

/// Logo light and today's hourly weather.
struct LogoAndHourlyWeatherTests {
    @Test @MainActor func logoLightIsContinuousAndSeamless() {
        let t0 = Date(timeIntervalSinceReferenceDate: 1_000_000)
        let a0 = SombreyLogo.angle(at: t0)
        // Continuous: a thirtieth of a second moves it a fraction of a degree.
        let step = SombreyLogo.angle(at: t0.addingTimeInterval(1.0 / 30)) - a0
        #expect(step > 0 && step < 1)
        // Seamless: one full period later it is exactly where it started.
        let wrapped = SombreyLogo.angle(at: t0.addingTimeInterval(SombreyLogo.period))
        #expect(abs(wrapped - a0) < 1e-6 || abs(abs(wrapped - a0) - 360) < 1e-6)
        // Always within one revolution.
        for i in 0..<100 {
            let a = SombreyLogo.angle(at: t0.addingTimeInterval(Double(i) * 0.37))
            #expect(a >= 0 && a < 360)
        }
    }

    private func hour(_ t: Date, _ temp: Double = 28, code: String? = "partly_cloudy", prob: Double? = nil, mm: Double? = nil) -> EnvironmentDTO.ForecastHour {
        EnvironmentDTO.ForecastHour(time: t.timeIntervalSince1970 * 1000, temperatureC: temp, conditionCode: code, isNight: false, precipitationMm: mm, precipitationProbability: prob, windMs: 3, humidityPct: 80)
    }

    @Test func hourlyShowsOnlyTodaysRemainingHoursInOrder() {
        let colombo = TimeZone(identifier: "Asia/Colombo")!
        var cal = Calendar(identifier: .gregorian); cal.timeZone = colombo
        let now = cal.date(from: DateComponents(year: 2026, month: 9, day: 26, hour: 18, minute: 38))!
        let starts = [17, 18, 19, 23].map { cal.date(from: DateComponents(year: 2026, month: 9, day: 26, hour: $0, minute: 30))! }
        let tomorrow = cal.date(from: DateComponents(year: 2026, month: 9, day: 27, hour: 0, minute: 30))!
        let hours = [hour(starts[3]), hour(tomorrow), hour(starts[1]), hour(starts[0]), hour(starts[2])]
        let visible = TodayHours.visible(hours, now: now, timeZone: colombo)
        // 17:30 is over, 00:30 is tomorrow, the feed's 20:30–22:30 gap stays a gap.
        #expect(visible.map(\.time) == [starts[1], starts[2], starts[3]].map { $0.timeIntervalSince1970 * 1000 })
        #expect(TodayHours.isNow(visible[0], now: now))
        #expect(!TodayHours.isNow(visible[1], now: now))
        #expect(TodayHours.label(visible[0], now: now, timeZone: colombo) == "Now")
        let later = TodayHours.label(visible[1], now: now, timeZone: colombo, locale: Locale(identifier: "en_US"))
        #expect(later.contains("7:30"))  // local time with the :30 offset, not UTC
    }

    @Test func hourlyLabelsFollowTheDeviceTimeZone() {
        let t = Date(timeIntervalSince1970: 1_790_420_400) // 2026-09-26 11:00 UTC
        let h = hour(t)
        let far = Date(timeIntervalSince1970: 0)
        let london = TodayHours.label(h, now: far, timeZone: TimeZone(identifier: "Europe/London")!, locale: Locale(identifier: "en_GB"))
        let newYork = TodayHours.label(h, now: far, timeZone: TimeZone(identifier: "America/New_York")!, locale: Locale(identifier: "en_GB"))
        #expect(london == "12")    // 12:00 BST (24-hour locale, on the hour)
        #expect(newYork == "07")   // 07:00 EDT
    }

    @Test func rainShowsChanceWhenPublishedElseAmount() {
        let t = Date()
        #expect(TodayHours.rain(hour(t, prob: 40, mm: 0.2)) == "40%")
        #expect(TodayHours.rain(hour(t, mm: 0.4)) == "0.4 mm")
        #expect(TodayHours.rain(hour(t, mm: 0)) == nil)
        #expect(WeatherSymbol.phrase("light_rain") == "Light rain")
        #expect(WeatherSymbol.phrase(nil) == nil)
    }

    @Test func hourlyDecodes() throws {
        let json = #"{"state":"available","snapshot":{"observedAt":0,"fetchedAt":0,"timeZone":"Asia/Colombo","temperatureC":28,"hourly":[{"time":1790418600000,"temperatureC":28.4,"conditionCode":"rain","isNight":false,"precipitationMm":0.4,"windMs":3.1,"humidityPct":82}]},"refreshAfterMs":1800000,"attribution":"x"}"#
        let env = try JSONDecoder().decode(EnvironmentDTO.self, from: Data(json.utf8))
        #expect(env.snapshot?.hourly?.first?.conditionCode == "rain")
        #expect(env.snapshot?.hourly?.first?.precipitationProbability == nil)
    }
}


/// Sombrey tab and Sombrey Coach surface.
struct SombreyCoachSurfaceTests {
    @Test func theFivePrimaryTabsAreExactlyThese() {
        #expect(SombreyTab.allCases.map(\.label) == ["Home", "Train", "Progress", "Sombrey", "Settings"])
        #expect(!SombreyTab.allCases.map(\.label).contains("AI"))
    }

    @Test @MainActor func startersAskTheRealCoachRatherThanNavigating() {
        #expect(SombreyConversationStarters.starters.map(\.label) == ["Today's training", "Recovery", "Nutrition", "My progress"])
        #expect(SombreyConversationStarters.starters.allSatisfy { $0.question.hasSuffix("?") })
    }

    @Test @MainActor func composerSendsOnlyRealTextAndResetClearsTheConversation() {
        let conversation = SombreyCoachConversation()
        #expect(!conversation.canSend)
        conversation.draft = "   \n "
        #expect(!conversation.canSend)
        conversation.draft = "What should I do today?"
        #expect(conversation.canSend)
        conversation.reset()
        #expect(conversation.draft.isEmpty && conversation.messages.isEmpty && conversation.failure == nil && !conversation.isResponding)
    }

    @Test func scrollingTheConversationNeverBecomesATabSwipe() {
        // A vertical scroll through history: never paging.
        #expect(PrimaryPager.decide(translation: CGSize(width: 6, height: 80), startsInExcludedRegion: false) == .ignored)
        // A diagonal drag: ambiguous, so nothing.
        #expect(PrimaryPager.decide(translation: CGSize(width: 40, height: 35), startsInExcludedRegion: false) == .ignored)
        // Text editing in the composer is excluded outright.
        #expect(PrimaryPager.decide(translation: CGSize(width: -60, height: 2), startsInExcludedRegion: true) == .ignored)
        // Only a clearly horizontal drag elsewhere pages.
        #expect(PrimaryPager.decide(translation: CGSize(width: -60, height: 4), startsInExcludedRegion: false) == .paging)
    }
}
