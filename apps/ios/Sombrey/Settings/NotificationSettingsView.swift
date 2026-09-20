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
    @State private var showingMealSchedule = false
    @State private var showingWorkoutSchedule = false

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
                    subRow(title: "Manage meal schedule") { showingMealSchedule = true }
                    row(title: "Missed meal reminders", isOn: prefs.missedMealReminders) { setPreference(\.missedMealReminders, $0) }

                    Divider().overlay(StudioColor.ink.opacity(0.08)).padding(.vertical, 8)

                    row(title: "Workout reminders", isOn: prefs.workoutReminders) { setPreference(\.workoutReminders, $0) }
                    subRow(title: "Configure reminder behavior") { showingWorkoutSchedule = true }
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
        .sheet(isPresented: $showingMealSchedule) { MealScheduleView() }
        .sheet(isPresented: $showingWorkoutSchedule) { WorkoutScheduleView() }
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

    private func subRow(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            .frame(minHeight: 32)
        }
        .buttonStyle(.plain)
        .padding(.leading, 8)
    }

    // No local optimistic update needed — `preferences` is a live Convex
    // subscription (`ConvexQuery`), so it re-renders with the new value
    // automatically once the mutation below commits, the same way every
    // other reactive query in this app already works.
    private func setPreference(_ keyPath: WritableKeyPath<NotificationPreferencesDTO, Bool>, _ newValue: Bool) {
        Task {
            if newValue {
                let granted = await NotificationManager.shared.requestAuthorizationIfNeeded()
                authorizationDenied = !granted && (await NotificationManager.shared.authorizationStatus()) == .denied
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
