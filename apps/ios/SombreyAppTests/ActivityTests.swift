import Testing
import Foundation
@testable import SombreyApp

/// Train › Activity: the catalog, activity profiles, intensity, comparison
/// with the user's own history, live readings and session recovery.
struct ActivityCatalogTests {
    @Test func catalogMatchesTheServerTaxonomy() {
        let tennis = ActivityCatalog.byKey["tennis"]
        #expect(tennis?.name == "Tennis")
        #expect(tennis?.vendorSportType == 29)
        #expect(tennis?.sportType?.rawValue == 29)
        // Every activity can actually be started on the band.
        #expect(ActivityCatalog.all.allSatisfy { $0.sportType != nil })
        #expect(Set(ActivityCatalog.all.map(\.key)).count == ActivityCatalog.all.count)
        // Every group has something in it, and every activity sits in a group.
        let groupIds = Set(ActivityCatalog.groups.map(\.id))
        #expect(ActivityCatalog.all.allSatisfy { groupIds.contains($0.group) })
        #expect(ActivityCatalog.groups.allSatisfy { !ActivityCatalog.activities(in: $0).isEmpty })
    }

    @Test func storedSessionsResolveToSombreyNames() {
        // Several band modes are one activity; the vendor's own labels never show.
        #expect(ActivityCatalog.resolve(activityKey: nil, vendorSportType: 7)?.name == "Running")
        #expect(ActivityCatalog.resolve(activityKey: nil, vendorSportType: 175)?.name == "Pickleball")
        #expect(ActivityCatalog.resolve(activityKey: "surf", vendorSportType: nil)?.name == "Surfing")
        #expect(ActivityCatalog.resolve(activityKey: nil, vendorSportType: 999) == nil)
    }

    @Test func searchFindsByNameWithPrefixMatchesFirst() {
        let results = ActivityCatalog.search("ten")
        #expect(results.first?.key == "tennis")
        #expect(results.contains { $0.key == "pingpong" }) // Table Tennis
        #expect(ActivityCatalog.search("   ").isEmpty)
    }

    @Test func popularActivitiesAllExist() {
        #expect(ActivityCatalog.popularKeys.allSatisfy { ActivityCatalog.byKey[$0] != nil })
    }
}

struct ActivityFrameworkTests {
    @Test func everyActivityResolvesConsistentTerms() {
        for activity in ActivityCatalog.all {
            let terms = activity.terms
            #expect(!terms.primary.isEmpty, "\(activity.key)")
            #expect(Set(terms.primary).isDisjoint(with: terms.secondary), "\(activity.key)")
            #expect(!terms.sessionNoun.isEmpty && !terms.performanceTitle.isEmpty)
        }
    }

    @Test func termsAdaptToTheActivity() {
        let golf = ActivityCatalog.byKey["golf"]!.terms
        #expect(golf.sessionNoun == "round")
        #expect(Array(golf.primary.prefix(3)) == [.duration, .steps, .distance])
        let run = ActivityCatalog.byKey["run"]!.terms
        #expect(run.primary.first == .distance)
        #expect(ActivityCatalog.byKey["swim"]!.terms.paceUnit == .per100m)
        #expect(ActivityCatalog.byKey["surf"]!.terms.notMeasured?.contains("Waves") == true)
        #expect(ActivityCatalog.byKey["tennis"]!.terms.character == .court)
        #expect(ActivityCatalog.byKey["rope_skipping"]!.terms.actionsLabel == "Skips")
        #expect(ActivityCatalog.byKey["free_training"]?.isAmbiguous == true)
        #expect(ActivityCatalog.byKey["tennis"]?.isAmbiguous == false)
    }
}

struct ActivityEngineTests {
    private let tennis = ActivityCatalog.byKey["tennis"]!
    private let golf = ActivityCatalog.byKey["golf"]!
    private let run = ActivityCatalog.byKey["run"]!

    private func record(_ id: String, daysAgo: Double, minutes: Double?, hr: Double? = nil, distance: Double? = nil,
                        steps: Double? = nil, speed: Double? = nil) -> ActivityRecordDTO {
        var r = ActivityRecordDTO(id: id, provenance: "band_sport_plus", activityKey: "tennis", activityCategory: "racquet",
                                  displayName: "Tennis", vendorSportType: 29,
                                  startedAt: (Date().timeIntervalSince1970 - daysAgo * 86400) * 1000,
                                  durationSeconds: minutes.map { $0 * 60 }, averageHeartRate: hr, lowestHeartRate: nil,
                                  highestHeartRate: nil, heartRateSource: hr == nil ? nil : "band_record",
                                  calories: nil, caloriesSource: nil, distanceMeters: distance, steps: steps, timestampSuspect: nil)
        r.averageSpeedMetersPerSecond = speed
        return r
    }

    @Test func nothingUnrecordedIsShownAndMissingHeadlinesAreListedOnce() {
        let readings = ActivityReadings(durationSeconds: 3480, averageHeartRate: 142)
        let experience = ActivityIntelligence.experience(for: golf, readings: readings, previous: [], maxHeartRate: nil)
        // Golf's headline is duration, steps, distance — only duration was recorded.
        #expect(experience.primary.map(\.metric) == [.duration])
        #expect(experience.notRecorded == ["steps", "distance"])
        // Heart rate is secondary for golf, and shown because it was recorded.
        #expect(experience.secondary.map(\.metric) == [.heartRate])
        #expect(experience.secondary.allSatisfy { $0.value != "0" })
    }

    @Test func zeroIsNeverAReading() {
        let tally = SportSessionLiveUpdate(sportType: 29, state: 1, durationSeconds: 600, heartRate: 0, steps: 0, distanceMeters: 0, calories: 0)
        let readings = ActivityReadings.live(tally: tally, heartRate: nil, activeSeconds: 600)
        let experience = ActivityIntelligence.experience(for: tennis, readings: readings, previous: [], maxHeartRate: 180)
        #expect(experience.primary.map(\.metric) == [.duration])
        #expect(experience.secondary.isEmpty)
        #expect(experience.notRecorded.isEmpty) // live: still filling in
        #expect(experience.insights.isEmpty)
    }

    @Test func paceComesFromTheBandsSpeedOrIsLabelledCalculated() {
        var readings = ActivityReadings(durationSeconds: 600, distanceMeters: 2400, averageSpeed: 4)
        let fromBand = ActivityIntelligence.indicator(.pace, readings: readings, terms: run.terms, maxHeartRate: nil)
        #expect(fromBand?.value == "4:10")
        #expect(fromBand?.source == .bandRecord)
        readings.averageSpeed = nil
        let derived = ActivityIntelligence.indicator(.pace, readings: readings, terms: run.terms, maxHeartRate: nil)
        #expect(derived?.value == "4:10")
        #expect(derived?.source == .calculated)
        let swim = ActivityCatalog.byKey["swim"]!
        let swimPace = ActivityIntelligence.indicator(.pace, readings: ActivityReadings(averageSpeed: 1), terms: swim.terms, maxHeartRate: nil)
        #expect(swimPace?.value == "1:40")
        #expect(swimPace?.unit == "/100 m")
    }

    @Test func intensityIsAnEstimateAndNeedsAnAge() {
        let readings = ActivityReadings(averageHeartRate: 142)
        #expect(ActivityIntelligence.indicator(.intensity, readings: readings, terms: tennis.terms, maxHeartRate: nil) == nil)
        let zone = ActivityIntelligence.indicator(.intensity, readings: readings, terms: tennis.terms, maxHeartRate: 180)
        #expect(zone?.value == "Moderate")
        #expect(zone?.source == .estimated)
    }

    @Test func insightsCompareOnlyWithRecordedHistory() {
        let previous = [
            record("a", daysAgo: 10, minutes: 50, hr: 138),
            record("b", daysAgo: 20, minutes: 52, hr: 140),
            record("c", daysAgo: 30, minutes: nil, hr: nil),
        ]
        let readings = ActivityReadings(durationSeconds: 58 * 60, averageHeartRate: 142)
        let insights = ActivityIntelligence.sessionInsights(activity: tennis, readings: readings, previous: previous, zones: nil, now: Date())
        #expect(insights.contains { $0.text.hasPrefix("7 min longer than your usual Tennis session") })
        #expect(insights.contains { $0.text.contains("average 142 bpm against your typical 139") })
        #expect(insights.allSatisfy { !$0.basis.isEmpty })
    }

    @Test func aFirstSessionSaysSoInsteadOfComparing() {
        let insights = ActivityIntelligence.sessionInsights(activity: golf, readings: ActivityReadings(durationSeconds: 3600), previous: [], zones: nil, now: Date())
        #expect(insights.count == 1)
        #expect(insights[0].text.contains("first Golf round"))
    }

    @Test func movementInsightUsesTheActivitysOwnHeadline() {
        let previous = [record("a", daysAgo: 5, minutes: 240, steps: 10000), record("b", daysAgo: 12, minutes: 250, steps: 10400)]
        let insights = ActivityIntelligence.sessionInsights(activity: golf, readings: ActivityReadings(durationSeconds: 14400, steps: 13000), previous: previous, zones: nil, now: Date())
        #expect(insights.contains { $0.text.contains("steps — more than your usual round of") })
    }

    @Test func zoneProfileNeedsASeriesAndAnEstimate() {
        #expect(ActivityIntelligence.zones(series: [140, 150], sampleRateSeconds: 60, maxHeartRate: 180) == nil)
        #expect(ActivityIntelligence.zones(series: [140, 150, 160, 170], sampleRateSeconds: 60, maxHeartRate: nil) == nil)
        let zones = ActivityIntelligence.zones(series: [80, 140, 150, 160, 170, 175], sampleRateSeconds: 60, maxHeartRate: 180)
        #expect(zones?.totalSamples == 6)
        #expect(zones?.minutes(4) == 2) // 150 (83%), 160 (89%)
        #expect(zones?.samplesByZone[0] == 1) // 80 (44%) is below zone 1
    }
}

struct ActivityIntensityTests {
    @Test func zonesMatchTheServer() {
        // Mirrors tests/activity/intelligence.test.ts.
        #expect(ActivityIntensity.zone(heartRate: 142, maxHeartRate: 180) == .init(zone: 3, label: "Moderate", percentOfMax: 79))
        #expect(ActivityIntensity.zone(heartRate: 150, maxHeartRate: 180)?.label == "Hard")
        #expect(ActivityIntensity.zone(heartRate: 80, maxHeartRate: 180) == nil)
        #expect(ActivityIntensity.zone(heartRate: 142, maxHeartRate: nil) == nil)
        #expect(ActivityIntensity.zone(heartRate: 0, maxHeartRate: 180) == nil)
    }
}

struct ActivityRankingTests {
    @Test func recentMergesServerAndPhoneWithoutDuplicates() {
        let usage = [
            ActivityUsageDTO(activityKey: "golf", count: 1, lastStartedAt: 100),
            ActivityUsageDTO(activityKey: "tennis", count: 5, lastStartedAt: 300),
        ]
        #expect(ActivityRanking.recent(usage: usage, local: ["surf", "tennis"]).map(\.key) == ["tennis", "golf", "surf"])
        #expect(ActivityRanking.frequent(usage: usage).map(\.key) == ["tennis"]) // done at least twice
    }
}

@MainActor
struct ActivitySessionRecoveryTests {
    @Test func aLiveActivitySurvivesAnAppKill() throws {
        let defaults = try #require(UserDefaults(suiteName: "activity-recovery-\(UUID().uuidString)"))
        let snapshot: [String: Any] = [
            "activityKey": "tennis",
            "startedAt": Date(timeIntervalSinceNow: -1800).timeIntervalSinceReferenceDate,
            "pausedSeconds": 120.0,
            "sessionId": "session-1",
            "vendorSportType": 29,
        ]
        defaults.set(try JSONSerialization.data(withJSONObject: snapshot), forKey: "sombreyActivity.activeSession.v1")

        let manager = ActivitySessionManager(defaults: defaults)
        manager.restoreIfNeeded()
        #expect(manager.phase == .active)
        #expect(manager.activity?.key == "tennis")
        #expect(manager.sessionId == "session-1")
        // The band kept recording: the clock runs on, minus the paused time.
        #expect(abs(manager.activeSeconds() - (1800 - 120)) <= 2)

        manager.reset()
        #expect(manager.phase == .idle)
        let fresh = ActivitySessionManager(defaults: defaults)
        fresh.restoreIfNeeded()
        #expect(fresh.phase == .idle)
    }

    @Test func anUnknownActivityIsNotRestored() throws {
        let defaults = try #require(UserDefaults(suiteName: "activity-recovery-\(UUID().uuidString)"))
        let snapshot: [String: Any] = [
            "activityKey": "not_an_activity", "startedAt": 0.0, "pausedSeconds": 0.0, "sessionId": "x", "vendorSportType": 1,
        ]
        defaults.set(try JSONSerialization.data(withJSONObject: snapshot), forKey: "sombreyActivity.activeSession.v1")
        let manager = ActivitySessionManager(defaults: defaults)
        manager.restoreIfNeeded()
        #expect(manager.phase == .idle)
    }
}
