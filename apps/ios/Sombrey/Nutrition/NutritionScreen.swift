import SwiftUI
import ConvexMobile

/// Nutrition, inside AI — Sombrey's intelligence hub owns "what should I
/// eat", but nutrition is never buried in a chat: this panel is one tap
/// from the AI tab's header (`AICoachScreen`'s section control).
///
/// Everything is real: today's intake (`nutritionLogs:getTodayProgress`,
/// `nutritionLogs:getByDate`), meals the user logs through Sombrey's own
/// food search (`AddMealView` → `foods:list`), meal times
/// (`mealSchedules`) and the meal-reminder preference. Targets are shown
/// only when they're genuinely the user's (`hasRealTargets`) — the
/// backend's legacy default targets are never presented as theirs.
/// External food data (e.g. a food database provider) stays behind
/// Sombrey's own `foods` model and never appears as a destination.
struct NutritionPanel: View {
    @State private var progress = ConvexQuery<NutritionProgress?>()
    @State private var dayLog = ConvexQuery<NutritionDayLog?>()
    @State private var preferences = ConvexQuery<NotificationPreferencesDTO>()
    @State private var showingAddMeal = false
    @State private var showingMealSchedule = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                todaySection
                Button {
                    showingAddMeal = true
                } label: {
                    Text("Log a meal").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                entriesSection
                targetsSection
                scheduleSection
            }
            .padding(.top, 18)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .task {
            progress.subscribe(to: "nutritionLogs:getTodayProgress")
            dayLog.subscribe(to: "nutritionLogs:getByDate", with: ["date": NutritionDate.todayUTCMidnightMillis])
            preferences.subscribe(to: "notificationPreferences:get")
        }
        .sheet(isPresented: $showingAddMeal) { AddMealView() }
        .sheet(isPresented: $showingMealSchedule) { MealScheduleView() }
    }

    // MARK: Today

    @ViewBuilder
    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("TODAY")
            if progress.isLoading {
                ProgressView().tint(StudioColor.ink)
            } else if let error = progress.errorMessage {
                Text("Couldn't load nutrition data: \(error)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.danger)
            } else if let today = progress.value ?? nil {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(Int(today.caloriesConsumed.rounded()))")
                        .font(StudioFont.hero(40, weight: .bold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                    Text(today.hasRealTargets ? "of \(Int(today.caloriesTarget)) kcal" : "kcal eaten")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                VStack(alignment: .leading, spacing: 10) {
                    MacroLine(label: "Protein", value: today.proteinConsumed, target: today.hasRealTargets ? today.proteinTarget : nil)
                    MacroLine(label: "Carbs", value: today.carbsConsumed, target: today.hasRealTargets ? today.carbsTarget : nil)
                    MacroLine(label: "Fat", value: today.fatsConsumed, target: today.hasRealTargets ? today.fatsTarget : nil)
                }
            }
        }
    }

    @ViewBuilder
    private var entriesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("TODAY'S MEALS")
            if dayLog.isLoading {
                ProgressView().tint(StudioColor.ink)
            } else if let entries = (dayLog.value ?? nil)?.foodsWithDetails, !entries.isEmpty {
                ForEach(entries) { entry in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.foodName)
                                .font(StudioFont.body(14, weight: .medium))
                                .foregroundStyle(StudioColor.ink)
                            Text("\(entry.mealType.capitalized) · \(Int(entry.servings)) serving(s)")
                                .font(StudioFont.body(11))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        Spacer()
                        Text("\(Int(entry.calories)) kcal")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.inkSoft)
                            .monospacedDigit()
                    }
                    .frame(minHeight: 44)
                }
            } else {
                Text("Nothing logged yet today.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    // MARK: Targets (AI Macro Calculator's home)

    @ViewBuilder
    private var targetsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("TARGETS")
            if let today = progress.value ?? nil, today.hasRealTargets {
                Text("From your Sombrey plan: \(Int(today.caloriesTarget)) kcal · \(Int(today.proteinTarget))g protein · \(Int(today.carbsTarget))g carbs · \(Int(today.fatsTarget))g fat.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.ink)
            } else {
                Text("No targets set yet.")
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
            }
            HStack(spacing: 8) {
                Text("AI MACRO CALCULATOR")
                    .font(StudioFont.body(9, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(StudioColor.inkSoft)
                Text("NOT AVAILABLE YET")
                    .font(StudioFont.body(8, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(StudioColor.inkFaint)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(StudioColor.ink.opacity(0.06), in: Capsule())
            }
            .padding(.top, 4)
            Text("Will set your targets from your profile, goal and training. Until then, no targets are invented for you.")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkFaint)
        }
    }

    // MARK: Schedule & reminders

    private var scheduleSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionLabel("MEAL SCHEDULE")
            Button {
                showingMealSchedule = true
            } label: {
                HStack {
                    Text("Meal times")
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let prefs = preferences.value {
                Toggle(isOn: Binding(get: { prefs.mealReminders }, set: { setMealReminders($0) })) {
                    Text("Meal reminders")
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                }
                .tint(StudioColor.accentInk)
                .frame(minHeight: 44)
            }
        }
    }

    private func setMealReminders(_ isOn: Bool) {
        Task {
            if isOn { _ = await NotificationManager.shared.requestAuthorizationIfNeeded() }
            try? await ConvexClientProvider.client.mutation("notificationPreferences:set", with: ["mealReminders": isOn])
            await NotificationManager.shared.reconcileAll()
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(StudioFont.body(11, weight: .semibold))
            .tracking(1.3)
            .foregroundStyle(StudioColor.inkSoft)
    }
}

/// One macro: what's been eaten, and — only when the user has a real
/// target — how far along it is.
private struct MacroLine: View {
    let label: String
    let value: Double
    let target: Double?

    private var fraction: Double {
        guard let target, target > 0 else { return 0 }
        return min(1, value / target)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.ink)
                Spacer()
                Text(target.map { "\(Int(value)) / \(Int($0)) g" } ?? "\(Int(value)) g")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .monospacedDigit()
            }
            if target != nil {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(StudioColor.ink.opacity(0.08))
                        Capsule().fill(StudioColor.nutrition).frame(width: geo.size.width * fraction)
                    }
                }
                .frame(height: 5)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
