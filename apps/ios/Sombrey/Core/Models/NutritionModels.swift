import Foundation

/// Mirrors `convex/nutritionLogs.ts`'s `getTodayProgress` return shape
/// exactly — including its server-side default targets (2500 cal / 180g
/// protein / 250g carbs / 70g fat) used when no AI plan exists yet. Those
/// defaults are the backend's own choice, not fabricated here.
struct NutritionProgress: Decodable {
    let caloriesConsumed: Double
    let proteinConsumed: Double
    let carbsConsumed: Double
    let fatsConsumed: Double
    let caloriesTarget: Double
    let proteinTarget: Double
    let carbsTarget: Double
    let fatsTarget: Double
    let totalMealsToday: Int
    let mealsCompleted: Int
    /// "ai_plan" when the targets above are the user's own (from their
    /// Sombrey plan); "none" when they're only legacy defaults. Optional
    /// for older deployments, where it's treated as "none".
    var targetsSource: String? = nil

    /// Whether the target fields are genuinely this user's targets.
    var hasRealTargets: Bool { targetsSource == "ai_plan" }
}

/// One entry from `getByDate`'s `foodsWithDetails` array — a real logged
/// food, never client-synthesized.
struct NutritionEntry: Decodable, Identifiable {
    let entryId: String
    let foodId: String
    let servings: Double
    let mealType: String
    let foodName: String
    let protein: Double
    let carbs: Double
    let fats: Double
    let calories: Double

    var id: String { entryId }
}

/// `getByDate` returns `null` when nothing has been logged for that date
/// — model that explicitly rather than defaulting to zeros.
struct NutritionDayLog: Decodable {
    let foodsWithDetails: [NutritionEntry]
}

/// A row from the `foods` table (`convex/foods.ts`'s `list` query) —
/// the real, existing food database, used for logging a meal entry.
/// Per-serving macros, matching `logFood`'s multiplication.
struct Food: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fats: Double
    let servingSize: String
    let servingUnit: String
    let category: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, calories, protein, carbs, fats, servingSize, servingUnit, category
    }
}
