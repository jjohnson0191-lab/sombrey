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

struct ActivityProfileTests {
    @Test func profilesNeverPromiseSportSpecificSensors() {
        for activity in ActivityCatalog.all {
            let profile = activity.profile
            // Heart rate is always expected; nothing is both expected and optional.
            #expect(profile.expected.contains(.heartRate))
            #expect(Set(profile.expected).isDisjoint(with: profile.optional))
        }
        let tennis = ActivityCatalog.byKey["tennis"]!.profile
        #expect(tennis.character == .court)
        #expect(tennis.notMeasured?.contains("Shots") == true)
        #expect(!tennis.expected.contains(.pace))
        let swim = ActivityCatalog.byKey["swim"]!.profile
        #expect(swim.notMeasured?.contains("SWOLF") == true)
        #expect(!swim.expected.contains(.distance)) // only when the band reports it
        let run = ActivityCatalog.byKey["run"]!.profile
        #expect(run.expected.contains(.pace))
        #expect(run.expected.contains(.distance))
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

struct ActivityLiveValueTests {
    private func tally(steps: Int = 0, distance: Int = 0, calories: Double = 0) -> SportSessionLiveUpdate {
        SportSessionLiveUpdate(sportType: 29, state: 1, durationSeconds: 600, heartRate: 130, steps: steps, distanceMeters: distance, calories: calories)
    }

    @Test func zerosAreNeverShownAsReadings() {
        let empty = tally()
        for metric in ActivityMetric.allCases {
            #expect(ActiveActivityView.liveValue(metric, tally: empty, activeSeconds: 600) == nil)
        }
        #expect(ActiveActivityView.liveValue(.steps, tally: nil, activeSeconds: 600) == nil)
    }

    @Test func realReadingsAreFormatted() {
        let t = tally(steps: 1240, distance: 2400, calories: 88.4)
        #expect(ActiveActivityView.liveValue(.distance, tally: t, activeSeconds: 600)?.value == "2.40")
        #expect(ActiveActivityView.liveValue(.distance, tally: t, activeSeconds: 600)?.unit == "km")
        #expect(ActiveActivityView.liveValue(.calories, tally: t, activeSeconds: 600)?.value == "88")
        // 2.4 km in 10 min → 4:10 /km average.
        #expect(ActiveActivityView.liveValue(.pace, tally: t, activeSeconds: 600)?.value == "4:10")
        // Climb and cadence aren't in the live update at all.
        #expect(ActiveActivityView.liveValue(.climb, tally: t, activeSeconds: 600) == nil)
    }
}

struct ActivityComparisonTests {
    private func record(_ id: String, minutes: Double?, hr: Double? = nil, hrSource: String? = nil) -> ActivityRecordDTO {
        ActivityRecordDTO(id: id, provenance: "band_sport_plus", activityKey: "tennis", activityCategory: "racquet",
                          displayName: "Tennis", vendorSportType: 29, startedAt: 0, durationSeconds: minutes.map { $0 * 60 },
                          averageHeartRate: hr, lowestHeartRate: nil, highestHeartRate: nil, heartRateSource: hrSource,
                          calories: nil, caloriesSource: nil, distanceMeters: nil, steps: nil, timestampSuspect: nil)
    }

    @Test func needsAtLeastTwoPreviousSessions() {
        #expect(ActivityComparison.lines(durationSeconds: 3480, averageHeartRate: 142, previous: [record("a", minutes: 50, hr: 140, hrSource: "band_record")]).isEmpty)
    }

    @Test func comparesOnlyWithMeasuredValues() {
        let previous = [
            record("a", minutes: 50, hr: 138, hrSource: "band_record"),
            record("b", minutes: 52, hr: 140, hrSource: "band_record"),
            record("c", minutes: nil, hr: 180, hrSource: nil), // no band heart-rate record — ignored
        ]
        let lines = ActivityComparison.lines(durationSeconds: 58 * 60, averageHeartRate: 142, previous: previous)
        #expect(lines.count == 2)
        #expect(lines[0].hasPrefix("7 min longer"))
        #expect(lines[1] == "Average heart rate 3 bpm above your usual 139 bpm.")
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
