import Foundation
import Observation
import Combine
// @preconcurrency: UserNotifications predates Swift concurrency
// auditing — same rationale as QCBandSDKService's CoreBluetooth import.
// Every completion-handler API here is wrapped in a continuation
// explicitly (never an assumed async overload) since guessing at
// Apple's own async-overload signatures has cost real build cycles
// elsewhere in this project; the completion-handler forms used below
// are the long-stable, unambiguous ones.
@preconcurrency import UserNotifications
import ConvexMobile

/// Sombrey's centralized local-notification engine. Every category the
/// product spec calls for (meal/missed-meal, workout/missed-workout,
/// morning readiness, good/poor sleep, band connection) goes through
/// this one place — no ad-hoc `UNUserNotificationCenter` calls
/// elsewhere. Scheduling is entirely on-device
/// (`UNCalendarNotificationTrigger`, device-local time zone, handles
/// DST/travel automatically); Convex (`mealSchedules`/
/// `workoutSchedules`/`notificationPreferences`) is only the source of
/// truth this reconciles local requests against.
///
/// `@MainActor` + `@Observable`: this is both the delegate target for
/// `UNUserNotificationCenter` AND an environment-injected object
/// `RootView`/`HomeScreen` read `pendingDeepLink` from — same dual role
/// pattern as `WearableManager`. Delegate methods are `nonisolated`
/// (matching `QCBandSDKService`'s CoreBluetooth delegate — the ObjC
/// protocol carries no actor annotation of its own) and hop back via
/// `Task { @MainActor in }`.
@MainActor
@Observable
final class NotificationManager: NSObject {
    static let shared = NotificationManager()

    /// Set when a notification is tapped; `RootView`/`HomeScreen` observe
    /// this and navigate, then clear it.
    private(set) var pendingDeepLink: SombreyDeepLinkTarget?

    private let center = UNUserNotificationCenter.current()
    private static let lastMorningSummaryDateKey = "sombreyNotifications.lastMorningSummaryDate"
    private static let missedMealOffsetMinutes = 90
    private static let missedWorkoutOffsetMinutes = 60

    private override init() {
        super.init()
        center.delegate = self
    }

    func consumeDeepLink() -> SombreyDeepLinkTarget? {
        defer { pendingDeepLink = nil }
        return pendingDeepLink
    }

    // MARK: - Permission

    func authorizationStatus() async -> UNAuthorizationStatus {
        await withCheckedContinuation { continuation in
            center.getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
    }

    /// Contextual only — call this when the user actually enables a
    /// notification category in Settings, never at first launch before
    /// they understand why notifications are useful. Never re-prompts
    /// once the user has answered (`.notDetermined` is the only status
    /// this actually calls `requestAuthorization` for).
    @discardableResult
    func requestAuthorizationIfNeeded() async -> Bool {
        let status = await authorizationStatus()
        switch status {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    continuation.resume(returning: granted)
                }
            }
        @unknown default:
            return false
        }
    }

    // MARK: - Reconciliation (call on launch/foreground and after schedule edits)

    /// Fetches the current schedules/preferences from Convex and
    /// reconciles local notification requests against them. Safe to call
    /// often — every request uses a stable, deterministic identifier, so
    /// re-adding an unchanged slot just replaces it with itself.
    func reconcileAll() async {
        let status = await authorizationStatus()
        guard status == .authorized || status == .provisional else { return }
        async let preferencesTask = fetchOnce("notificationPreferences:get", as: NotificationPreferencesDTO.self)
        async let mealSlotsTask = fetchOnce("mealSchedules:list", as: [MealScheduleSlot].self)
        async let workoutSlotsTask = fetchOnce("workoutSchedules:list", as: [WorkoutScheduleSlot].self)
        let (preferences, mealSlots, workoutSlots) = await (preferencesTask, mealSlotsTask, workoutSlotsTask)
        guard let preferences else { return }
        await reconcileMealSchedule(mealSlots ?? [], preferences: preferences)
        await reconcileWorkoutSchedule(workoutSlots ?? [], preferences: preferences)
    }

    /// Single-read helper for callers (e.g. `WearableManager`'s morning-
    /// summary path) that need the current preferences without running a
    /// full reconcile pass.
    func currentPreferences() async -> NotificationPreferencesDTO? {
        await fetchOnce("notificationPreferences:get", as: NotificationPreferencesDTO.self)
    }

    func reconcileMealSchedule(_ slots: [MealScheduleSlot], preferences: NotificationPreferencesDTO) async {
        var idsToRemove: [String] = []
        var requestsToAdd: [UNNotificationRequest] = []

        for slot in slots {
            let reminderId = "meal-reminder-\(slot.dayOfWeek)-\(slot.slotOrder)"
            let missedId = "missed-meal-\(slot.dayOfWeek)-\(slot.slotOrder)"

            if slot.enabled, slot.reminderEnabled, preferences.mealReminders {
                requestsToAdd.append(Self.weeklyRequest(
                    identifier: reminderId,
                    title: "Sombrey",
                    body: "Time to log \(slot.name.lowercased())",
                    dayOfWeek: slot.dayOfWeek, hour: slot.hour, minute: slot.minute,
                    route: .nutrition
                ))
            } else {
                idsToRemove.append(reminderId)
            }

            // One-shot, not repeating — cancelled independently by
            // AddMealView when the meal is actually logged, and
            // re-computed fresh for next week on the next reconcile
            // pass. A repeating trigger can't be "skipped just this
            // week" without also killing every future week.
            if slot.enabled, slot.missedReminderEnabled, preferences.missedMealReminders,
               let fireDate = Self.nextOccurrence(dayOfWeek: slot.dayOfWeek, hour: slot.hour, minute: slot.minute, offsetMinutes: Self.missedMealOffsetMinutes) {
                requestsToAdd.append(Self.oneShotRequest(
                    identifier: missedId,
                    title: "Sombrey",
                    body: "Haven't logged \(slot.name.lowercased()) yet — add it when you get a chance.",
                    fireDate: fireDate,
                    route: .nutrition
                ))
            } else {
                idsToRemove.append(missedId)
            }
        }

        center.removePendingNotificationRequests(withIdentifiers: idsToRemove)
        for request in requestsToAdd {
            await add(request)
        }
    }

    func reconcileWorkoutSchedule(_ slots: [WorkoutScheduleSlot], preferences: NotificationPreferencesDTO) async {
        var idsToRemove: [String] = []
        var requestsToAdd: [UNNotificationRequest] = []

        for slot in slots {
            let reminderId = "workout-reminder-\(slot.dayOfWeek)"
            let missedId = "missed-workout-\(slot.dayOfWeek)"
            let label = slot.name?.isEmpty == false ? slot.name! : "session"

            if slot.enabled, slot.reminderEnabled, preferences.workoutReminders {
                requestsToAdd.append(Self.weeklyRequest(
                    identifier: reminderId,
                    title: "Sombrey",
                    body: "\(label.capitalized) is scheduled for today.",
                    dayOfWeek: slot.dayOfWeek, hour: slot.hour, minute: slot.minute,
                    route: .training
                ))
            } else {
                idsToRemove.append(reminderId)
            }

            if slot.enabled, slot.missedReminderEnabled, preferences.missedWorkoutReminders,
               let fireDate = Self.nextOccurrence(dayOfWeek: slot.dayOfWeek, hour: slot.hour, minute: slot.minute, offsetMinutes: Self.missedWorkoutOffsetMinutes) {
                requestsToAdd.append(Self.oneShotRequest(
                    identifier: missedId,
                    title: "Sombrey",
                    body: "Today's \(label.lowercased()) hasn't been logged yet.",
                    fireDate: fireDate,
                    route: .training
                ))
            } else {
                idsToRemove.append(missedId)
            }
        }

        center.removePendingNotificationRequests(withIdentifiers: idsToRemove)
        for request in requestsToAdd {
            await add(request)
        }
    }

    /// Cancels today's/next's pending missed-meal reminder for the meal
    /// slot closest to `mealType` at logging time — called by
    /// `AddMealView` right after a successful log, so the reminder is
    /// genuinely conditional on not having logged, not a blind timer.
    func cancelMissedMealReminders(forDayOfWeek dayOfWeek: Int) {
        center.getPendingNotificationRequests { [weak self] requests in
            let ids = requests
                .filter { $0.identifier.hasPrefix("missed-meal-\(dayOfWeek)-") }
                .map(\.identifier)
            guard !ids.isEmpty else { return }
            Task { @MainActor in
                self?.center.removePendingNotificationRequests(withIdentifiers: ids)
            }
        }
    }

    func cancelMissedWorkoutReminder(forDayOfWeek dayOfWeek: Int) {
        center.removePendingNotificationRequests(withIdentifiers: ["missed-workout-\(dayOfWeek)"])
    }

    // MARK: - Wearable-driven notifications (morning summary, sleep, band)

    /// One combined notification, not two/three separate ones — per the
    /// product spec's explicit deduplication requirement. Fired
    /// immediately (not a scheduled future trigger) right after a real
    /// wake-and-sync event: a new sleep session was found AND the
    /// readiness score was just recomputed. Deduplicated to once per
    /// calendar day via a UserDefaults date stamp.
    func postMorningSummaryIfNeeded(score: Int?, sleepSignal: String, preferences: NotificationPreferencesDTO) async {
        let today = Self.localDateFormatter.string(from: Date())
        guard UserDefaults.standard.string(forKey: Self.lastMorningSummaryDateKey) != today else { return }
        guard await authorizationStatus() == .authorized else { return }

        var parts: [String] = []
        if preferences.morningReadiness, let score {
            parts.append("Your Sombrey Readiness is \(score).")
        }
        if preferences.goodSleep, sleepSignal == "good" {
            parts.append("Sleep was above your recent baseline.")
        } else if preferences.poorSleep, sleepSignal == "poor" {
            parts.append("Sleep was below your recent baseline — check today's recovery.")
        }
        guard !parts.isEmpty else { return }

        let content = UNMutableNotificationContent()
        content.title = "Good morning"
        content.body = parts.joined(separator: " ")
        content.sound = .default
        content.userInfo = ["route": SombreyDeepLinkTarget.readiness.rawValue]
        let request = UNNotificationRequest(identifier: "morning-summary-\(today)", content: content, trigger: nil)
        await add(request)
        UserDefaults.standard.set(today, forKey: Self.lastMorningSummaryDateKey)
    }

    func postWearableConnectionNotification(connected: Bool, deviceName: String, preferences: NotificationPreferencesDTO) async {
        guard preferences.wearableStatus, await authorizationStatus() == .authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = "Sombrey Band"
        content.body = connected ? "\(deviceName) reconnected." : "\(deviceName) disconnected."
        content.sound = nil
        content.userInfo = ["route": SombreyDeepLinkTarget.home.rawValue]
        let request = UNNotificationRequest(identifier: "wearable-status-\(Date().timeIntervalSince1970)", content: content, trigger: nil)
        await add(request)
    }

    // MARK: - Helpers

    private func add(_ request: UNNotificationRequest) async {
        await withCheckedContinuation { continuation in
            center.add(request) { _ in continuation.resume() }
        }
    }

    private static func weeklyRequest(identifier: String, title: String, body: String, dayOfWeek: Int, hour: Int, minute: Int, route: SombreyDeepLinkTarget) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["route": route.rawValue]
        var comps = DateComponents()
        comps.weekday = dayOfWeek
        comps.hour = hour
        comps.minute = minute
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
        return UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    }

    private static func oneShotRequest(identifier: String, title: String, body: String, fireDate: Date, route: SombreyDeepLinkTarget) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["route": route.rawValue]
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        return UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    }

    /// The next date/time matching `dayOfWeek`/`hour`/`minute` (plus an
    /// offset, e.g. 90 minutes after a meal time for a "missed" check),
    /// always in the future relative to now — device-local calendar,
    /// so DST/time-zone travel are handled by `Calendar` itself, never
    /// hardcoded.
    static func nextOccurrence(dayOfWeek: Int, hour: Int, minute: Int, offsetMinutes: Int = 0) -> Date? {
        var comps = DateComponents()
        comps.weekday = dayOfWeek
        comps.hour = hour
        comps.minute = minute
        guard let base = Calendar.current.nextDate(after: Date(), matching: comps, matchingPolicy: .nextTime) else {
            return nil
        }
        return Calendar.current.date(byAdding: .minute, value: offsetMinutes, to: base)
    }

    private static let localDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar.current
        formatter.timeZone = .current
        return formatter
    }()

    /// One-shot Convex query fetch — takes the first emitted value then
    /// cancels the underlying subscription, since `ConvexClientWithAuth`
    /// only exposes reactive `subscribe`, not a dedicated one-shot read.
    private func fetchOnce<T: Decodable>(_ queryName: String, as type: T.Type) async -> T? {
        await withCheckedContinuation { continuation in
            var cancellable: AnyCancellable?
            var didResume = false
            cancellable = ConvexClientProvider.client
                .subscribe(to: queryName, yielding: T.self)
                .first()
                .sink(
                    receiveCompletion: { _ in
                        if !didResume {
                            didResume = true
                            continuation.resume(returning: nil)
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { value in
                        if !didResume {
                            didResume = true
                            continuation.resume(returning: value)
                        }
                        cancellable?.cancel()
                    }
                )
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let routeString = response.notification.request.content.userInfo["route"] as? String
        Task { @MainActor in
            if let routeString, let route = SombreyDeepLinkTarget(rawValue: routeString) {
                NotificationManager.shared.pendingDeepLink = route
            }
        }
        completionHandler()
    }
}
