import Foundation

/// Sombrey day-of-week convention — matches `DateComponents.weekday`/
/// `Calendar` exactly (1 = Sunday ... 7 = Saturday) and the Convex
/// `mealSchedules`/`workoutSchedules` tables' own `dayOfWeek` field, so
/// no translation layer is needed anywhere this value crosses a
/// boundary.
enum Weekday: Int, CaseIterable, Identifiable {
    case sunday = 1, monday, tuesday, wednesday, thursday, friday, saturday

    var id: Int { rawValue }

    var name: String {
        switch self {
        case .sunday: return "Sunday"
        case .monday: return "Monday"
        case .tuesday: return "Tuesday"
        case .wednesday: return "Wednesday"
        case .thursday: return "Thursday"
        case .friday: return "Friday"
        case .saturday: return "Saturday"
        }
    }
}

/// Where a notification tap should take the user — never just the app's
/// root screen for every category.
enum SombreyDeepLinkTarget: String {
    case home, nutrition, training, readiness, sleep
}

struct MealScheduleSlot: Identifiable, Decodable, Hashable {
    let id: String
    let dayOfWeek: Int
    let slotOrder: Int
    let name: String
    let hour: Int
    let minute: Int
    let enabled: Bool
    let reminderEnabled: Bool
    let missedReminderEnabled: Bool

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case dayOfWeek, slotOrder, name, hour, minute, enabled, reminderEnabled, missedReminderEnabled
    }
}

struct WorkoutScheduleSlot: Identifiable, Decodable, Hashable {
    let id: String
    let dayOfWeek: Int
    let name: String?
    let hour: Int
    let minute: Int
    let enabled: Bool
    let reminderEnabled: Bool
    let missedReminderEnabled: Bool

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case dayOfWeek, name, hour, minute, enabled, reminderEnabled, missedReminderEnabled
    }
}

struct NotificationPreferencesDTO: Decodable, Equatable {
    var mealReminders: Bool
    var missedMealReminders: Bool
    var workoutReminders: Bool
    var missedWorkoutReminders: Bool
    var morningReadiness: Bool
    var poorSleep: Bool
    var goodSleep: Bool
    var wearableStatus: Bool
}
