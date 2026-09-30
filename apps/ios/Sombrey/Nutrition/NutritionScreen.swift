import SwiftUI
import ConvexMobile

/// Nutrition — Sombrey's second mode (COACH | NUTRITION). Nutrition is never
/// buried in a chat: it's its own instrument, one key over from the Coach.
///
/// Everything is real: today's intake (`nutritionLogs:getTodayProgress`,
/// `nutritionLogs:getByDate`), meals the user logs through Search Foods
/// (`AddMealView` → `foodSearch:search`: Sombrey's own foods plus live
/// Edamam results via the backend), meal times (`mealSchedules`) and the
/// meal-reminder preference. Targets are shown only when they're genuinely
/// the user's (`hasRealTargets`) — the backend's legacy default targets
/// are never presented as theirs.
struct NutritionPanel: View {
    @State private var progress = ConvexQuery<NutritionProgress?>()
    @State private var dayLog = ConvexQuery<NutritionDayLog?>()
    @State private var preferences = ConvexQuery<NotificationPreferencesDTO>()
    @State private var showingAddMeal = false
    @State private var showingMealSchedule = false
    @State private var showingMacroCalculator = false
    @State private var showingAccess = false
    @Environment(EntitlementStore.self) private var entitlements

    private var macroCalculatorAccess: FeatureAccess { entitlements.access(.aiMealAnalysis) }
    private var macroCalculatorEyebrow: String {
        if case .locked(let unlock) = macroCalculatorAccess { return AccessCopy.requirementLabel(unlock) }
        return "AI MACRO CALCULATOR"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                todaySection
                // Commerce 6D: the AI Macro Calculator is membership
                // intelligence; food search and logging below stay free.
                SombreyFeatureEntry(
                    eyebrow: macroCalculatorEyebrow,
                    title: "Photograph a meal",
                    detail: "Sombrey estimates what's on the plate — you check it before it's logged.",
                    status: macroCalculatorAccess == .allowed ? nil : "Tap to see what Membership includes",
                    glyph: "camera",
                    action: {
                        if macroCalculatorAccess == .allowed { showingMacroCalculator = true } else { showingAccess = true }
                    }
                )
                .accessibilityIdentifier("nutrition.macroCalculatorEntry")
                .task { await entitlements.noteLocked(.aiMealAnalysis) }
                Button {
                    showingAddMeal = true
                } label: {
                    Text("Search foods").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
                entriesSection
                targetsSection
                scheduleSection
            }
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .task {
            progress.subscribe(to: "nutritionLogs:getTodayProgress")
            dayLog.subscribe(to: "nutritionLogs:getByDate", with: ["date": NutritionDate.todayUTCMidnightMillis])
            preferences.subscribe(to: "notificationPreferences:get")
        }
        .sheet(isPresented: $showingAddMeal) { AddMealView() }
        .fullScreenCover(isPresented: $showingMacroCalculator) { MacroCalculatorFlow() }
        .sheet(isPresented: $showingAccess) { SombreyAccessSheet() }
        .sheet(isPresented: $showingMealSchedule) { MealScheduleView() }
    }

    // MARK: Today

    @ViewBuilder
    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("TODAY'S INTAKE")
            if progress.isLoading {
                ProgressView().tint(StudioColor.ink)
            } else if let error = progress.errorMessage {
                Text("Couldn't load nutrition data: \(error)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.danger)
            } else if let today = progress.value ?? nil {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(Int(today.caloriesConsumed.rounded()))")
                        .font(StudioFont.hero(44, weight: .bold))
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
                                .font(StudioFont.body(14, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                            Text("\(entry.mealType.capitalized) · \(entry.portion ?? FoodSearchLogic.portionLabel(amount: entry.servings, unit: .serving))")
                                .font(StudioFont.body(11))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        Spacer()
                        Text("\(Int((entry.calories * entry.servings).rounded())) kcal")
                            .font(StudioFont.hero(15, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
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

    // MARK: Targets

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
            Text("Targets come from your Sombrey plan — until you have one, none are invented for you.")
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
                    .font(StudioFont.hero(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
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
