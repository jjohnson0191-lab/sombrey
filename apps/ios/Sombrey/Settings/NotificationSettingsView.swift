import SwiftUI

/// Settings → Notifications. Per-category toggles (never one bundled
/// on/off switch), using the same row/typography language as the rest
/// of Settings — no generic iOS Form/List styling. Preferences persist
/// to Convex (`notificationPreferences`); actual scheduling happens
/// on-device via `NotificationManager`, reconciled right after every
/// change.
struct NotificationSettingsView: View {
    @State private var preferences = ConvexQuery<NotificationPreferencesDTO>()
    @State private var authorizationDenied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text("Notifications")
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)
                    .padding(.bottom, 16)

                if authorizationDenied {
                    deniedNotice
                }

                if let prefs = preferences.value {
                    row(title: "Meal reminders", isOn: prefs.mealReminders) { setPreference(\.mealReminders, $0) }
                    caption("Meal times are set in AI › Nutrition.")
                    row(title: "Missed meal reminders", isOn: prefs.missedMealReminders) { setPreference(\.missedMealReminders, $0) }

                    Divider().overlay(StudioColor.ink.opacity(0.08)).padding(.vertical, 8)

                    row(title: "Workout reminders", isOn: prefs.workoutReminders) { setPreference(\.workoutReminders, $0) }
                    caption("Workout days are set in Train.")
                    row(title: "Missed workout", isOn: prefs.missedWorkoutReminders) { setPreference(\.missedWorkoutReminders, $0) }

                    Divider().overlay(StudioColor.ink.opacity(0.08)).padding(.vertical, 8)

                    row(title: "Morning readiness", isOn: prefs.morningReadiness) { setPreference(\.morningReadiness, $0) }
                    row(title: "Poor sleep", isOn: prefs.poorSleep) { setPreference(\.poorSleep, $0) }
                    row(title: "Good sleep", isOn: prefs.goodSleep) { setPreference(\.goodSleep, $0) }
                    row(title: "Band connection", isOn: prefs.wearableStatus) { setPreference(\.wearableStatus, $0) }
                } else if preferences.isLoading {
                    ProgressView().tint(StudioColor.ink).padding(.top, 24)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .background(StudioColor.env4.ignoresSafeArea())
        .task {
            preferences.subscribe(to: "notificationPreferences:get")
            authorizationDenied = await NotificationManager.shared.authorizationStatus() == .denied
        }
    }

    private var deniedNotice: some View {
        Text("Notifications are turned off for Sombrey at the iOS level. Enable them in iPhone Settings → Sombrey → Notifications to receive any of the reminders below.")
            .font(StudioFont.body(12))
            .foregroundStyle(StudioColor.inkFaint)
            .padding(.bottom, 12)
    }

    private func row(title: String, isOn: Bool, onChange: @escaping (Bool) -> Void) -> some View {
        HStack {
            Text(title)
                .font(StudioFont.body(14, weight: .medium))
                .foregroundStyle(StudioColor.ink)
            Spacer()
            Toggle("", isOn: Binding(get: { isOn }, set: onChange))
                .labelsHidden()
                .tint(StudioColor.accentInk)
        }
        .frame(minHeight: 44)
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(StudioFont.body(11))
            .foregroundStyle(StudioColor.inkFaint)
            .padding(.leading, 8)
            .padding(.bottom, 4)
    }

    // No local optimistic update needed — `preferences` is a live Convex
    // subscription (`ConvexQuery`), so it re-renders with the new value
    // automatically once the mutation below commits, the same way every
    // other reactive query in this app already works.
    private func setPreference(_ keyPath: WritableKeyPath<NotificationPreferencesDTO, Bool>, _ newValue: Bool) {
        Task {
            if newValue {
                let granted = await NotificationManager.shared.requestAuthorizationIfNeeded()
                if !granted {
                    let status = await NotificationManager.shared.authorizationStatus()
                    authorizationDenied = status == .denied
                } else {
                    authorizationDenied = false
                }
            }
            try? await ConvexClientProvider.client.mutation("notificationPreferences:set", with: [keyName(keyPath): newValue])
            await NotificationManager.shared.reconcileAll()
        }
    }

    private func keyName(_ keyPath: WritableKeyPath<NotificationPreferencesDTO, Bool>) -> String {
        if keyPath == \NotificationPreferencesDTO.mealReminders { return "mealReminders" }
        if keyPath == \NotificationPreferencesDTO.missedMealReminders { return "missedMealReminders" }
        if keyPath == \NotificationPreferencesDTO.workoutReminders { return "workoutReminders" }
        if keyPath == \NotificationPreferencesDTO.missedWorkoutReminders { return "missedWorkoutReminders" }
        if keyPath == \NotificationPreferencesDTO.morningReadiness { return "morningReadiness" }
        if keyPath == \NotificationPreferencesDTO.poorSleep { return "poorSleep" }
        if keyPath == \NotificationPreferencesDTO.goodSleep { return "goodSleep" }
        if keyPath == \NotificationPreferencesDTO.wearableStatus { return "wearableStatus" }
        return ""
    }
}
