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
