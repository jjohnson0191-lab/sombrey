import Testing
import Foundation
@testable import SombreyApp

/// Covers the parts of the notification system that are safely testable
/// without a real `UNUserNotificationCenter` grant or a live Convex
/// connection — `NotificationManager.nextOccurrence` (the pure
/// scheduling-math core every reminder is built on) and the wire-decode
/// boundary for the schedule/preference DTOs, matching the discipline
/// `ReadinessTests.swift`/`WearableManagerTests.swift` already establish
/// for this codebase. Per-category toggling, reconcile add/remove, and
/// actual delivery require a granted `UNUserNotificationCenter`, which
/// isn't available in a unit-test host — those are physical-device QA
/// items (see the task's final report).
struct NotificationSchedulingTests {
    @Test func nextOccurrenceLandsOnTheRequestedWeekdayHourAndMinute() throws {
        let date = try #require(NotificationManager.nextOccurrence(dayOfWeek: 3, hour: 8, minute: 30))
        let comps = Calendar.current.dateComponents([.weekday, .hour, .minute], from: date)
        #expect(comps.weekday == 3)
        #expect(comps.hour == 8)
        #expect(comps.minute == 30)
    }

    @Test func nextOccurrenceIsAlwaysInTheFuture() throws {
        // Regardless of which weekday/time is requested relative to
        // "now," the computed fire date must never be in the past —
        // otherwise a just-missed slot would silently never fire again
        // until wrapping a full week later than expected.
        for weekday in 1...7 {
            let date = try #require(NotificationManager.nextOccurrence(dayOfWeek: weekday, hour: 9, minute: 0))
            #expect(date > Date())
        }
    }

    @Test func mondayAndTuesdayScheduleAreIndependent() throws {
        // The core "Monday != Tuesday" requirement: two different
        // weekdays at the same hour/minute must resolve to two distinct
        // calendar dates, never collapse to a single shared schedule.
        let monday = try #require(NotificationManager.nextOccurrence(dayOfWeek: 2, hour: 7, minute: 0))
        let tuesday = try #require(NotificationManager.nextOccurrence(dayOfWeek: 3, hour: 7, minute: 0))
        let mondayDay = Calendar.current.component(.weekday, from: monday)
        let tuesdayDay = Calendar.current.component(.weekday, from: tuesday)
        #expect(mondayDay != tuesdayDay)
        #expect(monday != tuesday)
    }

    @Test func offsetMinutesShiftsTheFireDateByExactlyThatMuch() throws {
        let base = try #require(NotificationManager.nextOccurrence(dayOfWeek: 4, hour: 12, minute: 0))
        let offset = try #require(NotificationManager.nextOccurrence(dayOfWeek: 4, hour: 12, minute: 0, offsetMinutes: 90))
        #expect(offset.timeIntervalSince(base) == 90 * 60)
    }

    @Test func usesTheDeviceCalendarNeverAHardcodedTimeZone() {
        // Correctness proxy for "no hardcoded Sri Lanka time": the
        // function must go through `Calendar.current`/device-local
        // components, which this test pins by asserting the returned
        // date decodes back to the exact requested hour in the CURRENT
        // calendar — a hardcoded fixed-offset implementation would drift
        // from this whenever the test host's time zone isn't that fixed
        // offset.
        let date = NotificationManager.nextOccurrence(dayOfWeek: 5, hour: 21, minute: 15)
        let hour = date.map { Calendar.current.component(.hour, from: $0) }
        #expect(hour == 21)
    }
}

struct NotificationDecodingTests {
    @Test func mealScheduleSlotDecodesPerDayIndependently() throws {
        let json = """
        {"_id":"slot1","dayOfWeek":2,"slotOrder":0,"name":"Breakfast","hour":7,"minute":30,"enabled":true,"reminderEnabled":true,"missedReminderEnabled":false}
        """.data(using: .utf8)!
        let slot = try JSONDecoder().decode(MealScheduleSlot.self, from: json)
        #expect(slot.dayOfWeek == 2)
        #expect(slot.hour == 7)
        #expect(slot.minute == 30)
        #expect(slot.id == "slot1")
    }

    @Test func workoutScheduleSlotOptionalNameDecodesWhenAbsent() throws {
        let json = """
        {"_id":"w1","dayOfWeek":5,"hour":18,"minute":0,"enabled":true,"reminderEnabled":true,"missedReminderEnabled":true}
        """.data(using: .utf8)!
        let slot = try JSONDecoder().decode(WorkoutScheduleSlot.self, from: json)
        #expect(slot.name == nil)
        #expect(slot.missedReminderEnabled == true)
    }

    @Test func notificationPreferencesDecodesAllEightIndependentCategories() throws {
        let json = """
        {"mealReminders":true,"missedMealReminders":false,"workoutReminders":true,"missedWorkoutReminders":false,"morningReadiness":true,"poorSleep":true,"goodSleep":false,"wearableStatus":true}
        """.data(using: .utf8)!
        let prefs = try JSONDecoder().decode(NotificationPreferencesDTO.self, from: json)
        #expect(prefs.mealReminders == true)
        #expect(prefs.missedMealReminders == false)
        #expect(prefs.goodSleep == false)
        // Toggling one category must not be coupled to any other —
        // spot-check a mismatched true/false pair among related toggles.
        #expect(prefs.poorSleep != prefs.goodSleep)
    }

    @Test func deepLinkTargetsRoundTripThroughTheirRawValue() {
        // The `userInfo["route"]` payload a notification tap decodes —
        // every case the app can route to must survive a raw-value
        // round trip, or a tap on that category would silently fail to
        // navigate anywhere.
        let targets: [SombreyDeepLinkTarget] = [.home, .nutrition, .training, .readiness, .sleep]
        for target in targets {
            #expect(SombreyDeepLinkTarget(rawValue: target.rawValue) == target)
        }
    }
}
