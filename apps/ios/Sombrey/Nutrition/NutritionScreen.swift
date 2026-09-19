import SwiftUI

/// Reached from Home ("Log your first meal", matching
/// `apps/mobile/src/screens/HomeScreen.tsx`'s `/home/nutrition` sub-route)
/// as a full-screen cover, not a nav-tick tab — same IA as the web app
/// (Nutrition isn't one of the five destinations). Real macro progress
/// (`nutritionLogs:getTodayProgress`) and real logged entries
/// (`nutritionLogs:getByDate`), both existing, unmodified Convex
/// queries. Empty state, not fabricated entries, when nothing is logged.
struct NutritionScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @State private var progress = ConvexQuery<NutritionProgress?>()
    @State private var dayLog = ConvexQuery<NutritionDayLog?>()
    @State private var showingAddMeal = false

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .settings, showsNav: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Text("Nutrition")
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    Spacer()
                    Button("Done") { dismiss() }
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .padding(.top, 20)

                macroSection
                entriesSection

                Button("Add meal") { showingAddMeal = true }
                    .buttonStyle(.illuminatedCTA)
            }
            .padding(.bottom, 24)
        }
        .task {
            progress.subscribe(to: "nutritionLogs:getTodayProgress")
            dayLog.subscribe(to: "nutritionLogs:getByDate", with: ["date": NutritionDate.todayUTCMidnightMillis])
        }
        .sheet(isPresented: $showingAddMeal) {
            AddMealView()
        }
    }

    @ViewBuilder
    private var macroSection: some View {
        if progress.isLoading {
            ProgressView().tint(StudioColor.ink)
        } else if let error = progress.errorMessage {
            Text("Couldn't load nutrition data: \(error)")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.danger)
        } else if let today = progress.value ?? nil {
            VStack(alignment: .leading, spacing: 10) {
                MacroBar(label: "Calories", value: today.caloriesConsumed, target: today.caloriesTarget, unit: "kcal")
                MacroBar(label: "Protein", value: today.proteinConsumed, target: today.proteinTarget, unit: "g")
                MacroBar(label: "Carbs", value: today.carbsConsumed, target: today.carbsTarget, unit: "g")
                MacroBar(label: "Fat", value: today.fatsConsumed, target: today.fatsTarget, unit: "g")
            }
        }
    }

    @ViewBuilder
    private var entriesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TODAY'S MEALS")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)

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
}

private struct MacroBar: View {
    let label: String
    let value: Double
    let target: Double
    let unit: String

    private var fraction: Double {
        guard target > 0 else { return 0 }
        return min(1, value / target)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.ink)
                Spacer()
                Text("\(Int(value)) / \(Int(target)) \(unit)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(StudioColor.ink.opacity(0.08))
                    Capsule().fill(StudioColor.accentInk).frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 6)
        }
    }
}
