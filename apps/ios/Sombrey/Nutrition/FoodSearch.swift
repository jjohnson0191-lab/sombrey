import Foundation
import ConvexMobile

/// Per-100 g nutrition. A macro the source doesn't give is `nil`, not 0.
struct FoodPer100g: Decodable, Equatable, Hashable {
    let calories: Double
    let protein: Double?
    let carbs: Double?
    let fat: Double?
}

/// A household measure with its gram weight ("1 cup", "Serving").
struct FoodMeasure: Decodable, Equatable, Hashable {
    let label: String
    let grams: Double
}

/// A food from the Sombrey Food Library (`foods:search`): imported from an
/// approved dataset (`source`, e.g. USDA FoodData Central) or created in
/// Sombrey (`source` nil). Per-serving values always; per-100 g values and
/// household portions when the food has them (then grams can be entered).
struct LibraryFoodDTO: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let name: String
    var category: String? = nil
    var brand: String? = nil
    var preparationState: String? = nil
    let calories: Double
    let protein: Double
    let carbs: Double
    let fats: Double
    let servingSize: String
    let servingUnit: String
    var servingGrams: Double? = nil
    var per100g: FoodPer100g? = nil
    var portions: [FoodMeasure] = []
    var source: String? = nil
    /// A licensed image (never shown without one; see FoodThumbnail).
    var image: FoodImageRef? = nil

    private enum CodingKeys: String, CodingKey {
        case id, name, category, brand, preparationState, calories, protein, carbs, fats, servingSize, servingUnit, servingGrams, per100g, portions, source, image
    }

    init(id: String, name: String, category: String? = nil, brand: String? = nil, preparationState: String? = nil,
         calories: Double, protein: Double, carbs: Double, fats: Double, servingSize: String, servingUnit: String,
         servingGrams: Double? = nil, per100g: FoodPer100g? = nil, portions: [FoodMeasure] = [], source: String? = nil) {
        self.id = id; self.name = name; self.category = category; self.brand = brand; self.preparationState = preparationState
        self.calories = calories; self.protein = protein; self.carbs = carbs; self.fats = fats
        self.servingSize = servingSize; self.servingUnit = servingUnit; self.servingGrams = servingGrams
        self.per100g = per100g; self.portions = portions; self.source = source
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        brand = try c.decodeIfPresent(String.self, forKey: .brand)
        preparationState = try c.decodeIfPresent(String.self, forKey: .preparationState)
        calories = try c.decode(Double.self, forKey: .calories)
        protein = try c.decode(Double.self, forKey: .protein)
        carbs = try c.decode(Double.self, forKey: .carbs)
        fats = try c.decode(Double.self, forKey: .fats)
        servingSize = try c.decode(String.self, forKey: .servingSize)
        servingUnit = try c.decode(String.self, forKey: .servingUnit)
        servingGrams = try c.decodeIfPresent(Double.self, forKey: .servingGrams)
        per100g = try c.decodeIfPresent(FoodPer100g.self, forKey: .per100g)
        portions = try c.decodeIfPresent([FoodMeasure].self, forKey: .portions) ?? []
        source = try c.decodeIfPresent(String.self, forKey: .source)
        image = try c.decodeIfPresent(FoodImageRef.self, forKey: .image)
    }
}

/// A food image reference from the library: always with its licence.
struct FoodImageRef: Decodable, Equatable, Hashable {
    let url: String
    let license: String
    var attribution: String? = nil
}

/// One page of `foods:search` (Convex pagination).
struct LibrarySearchPageDTO: Decodable, Equatable {
    let page: [LibraryFoodDTO]
    let isDone: Bool
    let continueCursor: String
    var tooShort: Bool = false

    private enum CodingKeys: String, CodingKey { case page, isDone, continueCursor, tooShort }
    init(page: [LibraryFoodDTO], isDone: Bool, continueCursor: String, tooShort: Bool = false) {
        self.page = page; self.isDone = isDone; self.continueCursor = continueCursor; self.tooShort = tooShort
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        page = try c.decode([LibraryFoodDTO].self, forKey: .page)
        isDone = try c.decode(Bool.self, forKey: .isDone)
        continueCursor = try c.decode(String.self, forKey: .continueCursor)
        tooShort = try c.decodeIfPresent(Bool.self, forKey: .tooShort) ?? false
    }
}

/// Convex's `paginationOpts` argument (a null cursor = the first page).
struct PaginationOptsArg: ConvexEncodable, Encodable {
    let numItems: Double
    let cursor: String?
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(numItems, forKey: .numItems)
        try c.encode(cursor, forKey: .cursor) // explicit null
    }
    private enum CodingKeys: String, CodingKey { case numItems, cursor }
}

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

/// A Sombrey food as `foodSearch:search` (the optional Edamam search) lists
/// it — used there only to leave out Edamam duplicates of library foods.
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
    typealias Per100g = FoodPer100g
    typealias Measure = FoodMeasure
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
    case library(LibraryFoodDTO)
    case edamam(ExternalFoodDTO)

    var id: String {
        switch self {
        case .library(let f): return "l:\(f.id)"
        case .edamam(let f): return "e:\(f.externalId)"
        }
    }
    var name: String {
        switch self {
        case .library(let f): return f.name
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
    /// Library results per page, and the most shown before asking the user
    /// to refine (Convex paginates the search; the phone never holds more).
    static let libraryPageSize = 20
    static let libraryMaxResults = 50

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
    /// macro the source doesn't give adds 0 — the preview says so.
    static func nutrition(_ p: FoodPer100g, grams: Double) -> Nutrition {
        guard grams.isFinite, grams > 0 else { return .zero }
        let f = grams / 100
        func part(_ v: Double?) -> Double {
            guard let v, v.isFinite, v >= 0 else { return 0 }
            return v * f
        }
        return Nutrition(calories: part(p.calories).rounded(), protein: r1(part(p.protein)), carbs: r1(part(p.carbs)), fat: r1(part(p.fat)))
    }

    /// A library food by serving: per serving × servings (as `logFood` stores it).
    static func nutrition(_ food: LibraryFoodDTO, servings: Double) -> Nutrition {
        guard servings.isFinite, servings > 0 else { return .zero }
        return Nutrition(calories: (food.calories * servings).rounded(), protein: r1(food.protein * servings), carbs: r1(food.carbs * servings), fat: r1(food.fats * servings))
    }

    /// Macros the source didn't give for this food (said before logging).
    static func missingMacros(_ p: FoodPer100g) -> [String] {
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

    /// A library food's first unit: its own serving (the dataset's household
    /// measure) when it has per-100 g values, else grams; a food with only
    /// per-serving values (created in Sombrey) is counted in servings.
    static func defaultUnit(for food: LibraryFoodDTO) -> (Unit, Double) {
        guard food.per100g != nil else { return (.serving, 1) }
        if let g = food.servingGrams, g > 0, food.servingUnit != "100 g" {
            return (.measure(label: food.servingUnit, grams: g), 1)
        }
        return (.grams, 100)
    }

    /// The units offered for a library food.
    static func units(for food: LibraryFoodDTO) -> [Unit] {
        guard food.per100g != nil else { return [.serving] }
        var out: [Unit] = [.grams]
        for m in food.portions where m.grams > 0 { out.append(.measure(label: m.label, grams: m.grams)) }
        if let g = food.servingGrams, g > 0, !food.portions.contains(where: { $0.label == food.servingUnit }), food.servingUnit != "100 g" {
            out.append(.measure(label: food.servingUnit, grams: g))
        }
        return out
    }

    /// The credit line the library's sources require, for the sources shown.
    static func libraryCredit(_ sources: [String?]) -> String? {
        var parts: [String] = []
        if sources.contains(where: { $0?.hasPrefix("usda_fdc") == true }) { parts.append("USDA FoodData Central") }
        if sources.contains(where: { $0 == "uk_cofid" }) { parts.append("McCance and Widdowson's CoFID (contains public sector information licensed under the Open Government Licence v3.0)") }
        guard !parts.isEmpty else { return nil }
        return "Library data: " + parts.joined(separator: "; ") + "."
    }

    /// The fallback picture's glyph: the kind of food, from its dataset
    /// category or name. A generic fork-and-knife when nothing fits.
    static func fallbackGlyph(name: String, category: String?) -> String {
        let text = "\(category ?? "") \(name)".lowercased()
        // SF Symbols available on iOS 17 (the app's minimum).
        let table: [(keys: [String], glyph: String)] = [
            (["fish", "salmon", "tuna", "shellfish", "prawn", "shrimp", "crab"], "fish"),
            (["beverage", "juice", "milk", "tea", "coffee", "drink", "water"], "cup.and.saucer"),
            (["vegetable", "salad", "spinach", "broccoli", "cabbage", "okra", "aubergine", "carrot", "potato"], "carrot"),
            (["fruit", "apple", "banana", "berries", "mango", "orange", "grape"], "leaf"),
            (["egg"], "frying.pan"),
            (["sweet", "cake", "biscuit", "dessert", "chocolate", "candies", "ice cream"], "birthday.cake"),
            (["meat", "beef", "pork", "lamb", "chicken", "poultry", "sausage", "turkey"], "flame"),
            (["cereal", "grain", "rice", "pasta", "bread", "flour", "oat", "noodle", "legume", "bean", "lentil", "dahl", "dal", "chickpea"], "basket"),
        ]
        for row in table where row.keys.contains(where: { text.contains($0) }) { return row.glyph }
        return "fork.knife"
    }

    /// Where a library food comes from, in a word.
    static func sourceLabel(_ source: String?) -> String {
        guard let source else { return "Sombrey" }
        if source.hasPrefix("usda_fdc") { return "USDA" }
        if source == "uk_cofid" { return "UK" }
        return "Library"
    }

    /// The library row's second line: source · basis · preparation.
    static func summary(_ food: LibraryFoodDTO) -> String {
        var parts = [sourceLabel(food.source)]
        if food.per100g != nil { parts.append("per 100 g") } else {
            parts.append("per \(food.servingSize == "1" ? food.servingUnit : "\(food.servingSize) \(food.servingUnit)")")
        }
        if let brand = food.brand { parts.insert(brand, at: 1) }
        if let prep = food.preparationState, prep != "unknown" { parts.append(prep) }
        return parts.joined(separator: " · ")
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
        case idle, tooShort, noResults, rateLimited, unavailable, failed, signedOut, libraryNoResults, libraryFailed

        var title: String {
            switch self {
            case .idle: return "Search foods"
            case .tooShort: return "Keep typing"
            case .noResults: return "No foods found"
            case .rateLimited: return "Search is busy"
            case .unavailable: return "Food search unavailable"
            case .failed: return "Couldn't search"
            case .signedOut: return "Sign in to search"
            case .libraryNoResults: return "Not in the Sombrey library"
            case .libraryFailed: return "Couldn't search"
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
            case .libraryNoResults: return "Try a simpler name — “chicken breast” rather than a whole dish — or search additional foods below."
            case .libraryFailed: return "Check your connection and try again."
            }
        }
        /// Worth a manual retry (never automatic).
        var canRetry: Bool { self == .rateLimited || self == .failed || self == .libraryFailed }
    }

    /// The notice for a finished Edamam search, if any (nil: show its
    /// results). Library foods are shown separately and don't count here.
    static func notice(for r: FoodSearchResultDTO) -> Notice? {
        switch r.status {
        case "unauthenticated": return .signedOut
        case "too_short": return .tooShort
        default: break
        }
        switch r.edamamStatus {
        case "rate_limited": return .rateLimited
        case "unavailable": return .unavailable
        case "error": return .failed
        default: return r.edamam.isEmpty ? .noResults : nil
        }
    }

    /// The library search's state for the list.
    enum LibraryState: Equatable {
        case idle, tooShort, loading, failed, empty, results
    }

    static func libraryState(query: String, searched: String?, failed: Bool, page: LibrarySearchPageDTO?) -> LibraryState {
        guard let q = searchable(query) else {
            return query.trimmingCharacters(in: .whitespaces).isEmpty ? .idle : .tooShort
        }
        if searched != q { return .loading }
        if failed { return .failed }
        // "Show more" keeps the page on screen while the longer one loads.
        guard let page else { return .loading }
        if page.tooShort { return .tooShort }
        return page.page.isEmpty ? .empty : .results
    }

    /// Whether "Show more" can fetch more library results.
    static func canShowMore(_ page: LibrarySearchPageDTO?, limit: Int) -> Bool {
        guard let page, !page.isDone else { return false }
        return limit < libraryMaxResults
    }
}
