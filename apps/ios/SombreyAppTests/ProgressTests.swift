import Testing
import Foundation
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
