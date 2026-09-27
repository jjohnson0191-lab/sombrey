import Foundation

/// `foodSearch:search`'s result (convex/foodSearch.ts): Sombrey-owned foods
/// first, then live Edamam results. Nothing here is invented — a macro
/// Edamam doesn't give is `nil`, not 0.
struct FoodSearchResultDTO: Decodable, Equatable {
    /// "ok" | "too_short" | "unauthenticated"
    let status: String
    let query: String
    let sombrey: [SombreyFoodDTO]
    let edamam: [ExternalFoodDTO]
    /// "ok" | "rate_limited" | "unavailable" | "error" | "skipped"
    let edamamStatus: String
}

/// A food from Sombrey's own library — per-serving values (`logFood`).
struct SombreyFoodDTO: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let name: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fats: Double
    let servingSize: String
    let servingUnit: String
}

/// An Edamam food: per-100 g nutrition plus its serving measures (each with
/// a gram weight), exactly as the backend passed them on.
struct ExternalFoodDTO: Decodable, Equatable, Hashable, Identifiable {
    struct Per100g: Decodable, Equatable, Hashable {
        let calories: Double
        let protein: Double?
        let carbs: Double?
        let fat: Double?
    }
    struct Measure: Decodable, Equatable, Hashable {
        let label: String
        let grams: Double
    }
    let externalId: String
    let name: String
    let brand: String?
    let category: String?
    let per100g: Per100g
    let measures: [Measure]
    var id: String { externalId }
}

/// A search result as the list shows it.
enum FoodChoice: Hashable, Identifiable {
    case sombrey(SombreyFoodDTO)
    case edamam(ExternalFoodDTO)

    var id: String {
        switch self {
        case .sombrey(let f): return "s:\(f.id)"
        case .edamam(let f): return "e:\(f.externalId)"
        }
    }
    var name: String {
        switch self {
        case .sombrey(let f): return f.name
        case .edamam(let f): return f.name
        }
    }
}

/// The pure rules of Search Foods — what's searched, how a portion becomes
/// nutrition, what can be logged. Plain (not actor-isolated) so tests call them directly;
/// the scaling mirrors the server's (convex/nutrition/logEntry.ts), which
/// recomputes the logged values itself.
enum FoodSearchLogic {
    static let minQueryLength = 2
    static let maxQueryLength = 80
    /// Typing pause before a search is sent.
    static let debounceNanoseconds: UInt64 = 400_000_000
    static let maxGrams: Double = 5_000
    static let maxCount: Double = 50

    /// The query to search, or nil when it's too short (nothing is sent).
    static func searchable(_ raw: String) -> String? {
        let q = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard q.count >= minQueryLength else { return nil }
        return String(q.prefix(maxQueryLength))
    }

    /// How the user counts the portion. Edamam gives every measure's gram
    /// weight, so a measure is just grams in a friendlier unit — the per-100 g
    /// values are the only nutrition used either way (the most reliable
    /// representation Edamam returns: it's what every measure is derived from).
    enum Unit: Hashable {
        case grams
        case measure(label: String, grams: Double)
        /// A Sombrey food's own serving (per-serving values).
        case serving
    }

    struct Nutrition: Equatable {
        var calories: Double
        var protein: Double
        var carbs: Double
        var fat: Double
        static let zero = Nutrition(calories: 0, protein: 0, carbs: 0, fat: 0)
    }

    /// Whether this amount can be logged: finite, positive, not absurd.
    static func isValid(amount: Double, unit: Unit) -> Bool {
        guard amount.isFinite, amount > 0 else { return false }
        switch unit {
        case .grams: return amount <= maxGrams
        case .measure(_, let g): return amount <= maxCount && g > 0 && amount * g <= maxGrams
        case .serving: return amount <= maxCount
        }
    }

    /// Total grams of an Edamam portion (nil when it isn't a valid amount).
    static func grams(amount: Double, unit: Unit) -> Double? {
        guard isValid(amount: amount, unit: unit) else { return nil }
        switch unit {
        case .grams: return amount
        case .measure(_, let g): return amount * g
        case .serving: return nil
        }
    }

    /// Per-100 g × grams, rounded as logged (kcal whole, macros to 0.1). A
    /// macro Edamam doesn't give adds 0 — the preview says so.
    static func nutrition(_ p: ExternalFoodDTO.Per100g, grams: Double) -> Nutrition {
        guard grams.isFinite, grams > 0 else { return .zero }
        let f = grams / 100
        func part(_ v: Double?) -> Double {
            guard let v, v.isFinite, v >= 0 else { return 0 }
            return v * f
        }
        return Nutrition(calories: part(p.calories).rounded(), protein: r1(part(p.protein)), carbs: r1(part(p.carbs)), fat: r1(part(p.fat)))
    }

    /// A Sombrey food: per serving × servings (as `logFood` stores it).
    static func nutrition(_ food: SombreyFoodDTO, servings: Double) -> Nutrition {
        guard servings.isFinite, servings > 0 else { return .zero }
        return Nutrition(calories: (food.calories * servings).rounded(), protein: r1(food.protein * servings), carbs: r1(food.carbs * servings), fat: r1(food.fats * servings))
    }

    /// Macros Edamam didn't give for this food (said before logging).
    static func missingMacros(_ p: ExternalFoodDTO.Per100g) -> [String] {
        var out: [String] = []
        if p.protein == nil { out.append("protein") }
        if p.carbs == nil { out.append("carbs") }
        if p.fat == nil { out.append("fat") }
        return out
    }

    /// The portion as the log shows it: "150 g", "2 × Serving (170 g)".
    static func portionLabel(amount: Double, unit: Unit) -> String {
        switch unit {
        case .grams: return "\(number(amount)) g"
        case .measure(let label, let g): return "\(number(amount)) × \(label) (\(number(amount * g)) g)"
        case .serving: return "\(number(amount)) serving\(amount == 1 ? "" : "s")"
        }
    }

    /// The first unit offered: Edamam's "Serving" when it has one, else grams.
    static func defaultUnit(for food: ExternalFoodDTO) -> (Unit, Double) {
        if let serving = food.measures.first(where: { $0.label.lowercased() == "serving" }) {
            return (.measure(label: serving.label, grams: serving.grams), 1)
        }
        return (.grams, 100)
    }

    /// −/+ step for the amount in this unit.
    static func step(for unit: Unit, amount: Double) -> Double {
        switch unit {
        case .grams: return amount < 50 ? 5 : (amount < 250 ? 10 : 25)
        case .measure, .serving: return 0.5
        }
    }

    /// The user's question in plain terms, for the result list's right column.
    static func summary(_ food: ExternalFoodDTO) -> String {
        var parts: [String] = []
        if let brand = food.brand { parts.append(brand) }
        parts.append("per 100 g")
        if let serving = food.measures.first(where: { $0.label.lowercased() == "serving" }) {
            parts.append("serving \(number(serving.grams)) g")
        }
        return parts.joined(separator: " · ")
    }

    static func number(_ v: Double) -> String {
        if v.rounded() == v { return String(Int(v)) }
        return String(format: "%.1f", v)
    }

    private static func r1(_ v: Double) -> Double { (v * 10).rounded() / 10 }

    /// What the screen says for a search that didn't give results.
    enum Notice: Equatable {
        case idle, tooShort, noResults, rateLimited, unavailable, failed, signedOut

        var title: String {
            switch self {
            case .idle: return "Search foods"
            case .tooShort: return "Keep typing"
            case .noResults: return "No foods found"
            case .rateLimited: return "Search is busy"
            case .unavailable: return "Food search unavailable"
            case .failed: return "Couldn't search"
            case .signedOut: return "Sign in to search"
            }
        }
        var message: String {
            switch self {
            case .idle: return "Find foods, meals, and products by name."
            case .tooShort: return "Type at least \(FoodSearchLogic.minQueryLength) letters."
            case .noResults: return "Try a simpler name — “chicken breast” rather than a whole dish."
            case .rateLimited: return "A lot of searches are happening right now. Try again in a minute."
            case .unavailable: return "The food database can't be reached right now. Your Sombrey foods still appear."
            case .failed: return "Check your connection and try again."
            case .signedOut: return "Your session has ended. Sign in again to search and log foods."
            }
        }
        /// Worth a manual retry (never automatic).
        var canRetry: Bool { self == .rateLimited || self == .failed }
    }

    /// The notice for a finished search, if any (nil: show the results).
    static func notice(for r: FoodSearchResultDTO) -> Notice? {
        switch r.status {
        case "unauthenticated": return .signedOut
        case "too_short": return .tooShort
        default: break
        }
        let hasResults = !r.sombrey.isEmpty || !r.edamam.isEmpty
        switch r.edamamStatus {
        case "rate_limited": return hasResults ? nil : .rateLimited
        case "unavailable": return hasResults ? nil : .unavailable
        case "error": return hasResults ? nil : .failed
        default: return hasResults ? nil : .noResults
        }
    }

    /// A partial result (Sombrey foods shown, Edamam missing) still says why.
    static func edamamNote(for r: FoodSearchResultDTO) -> Notice? {
        guard r.status == "ok", !r.sombrey.isEmpty || !r.edamam.isEmpty else { return nil }
        switch r.edamamStatus {
        case "rate_limited": return .rateLimited
        case "unavailable": return .unavailable
        case "error": return .failed
        default: return nil
        }
    }
}
