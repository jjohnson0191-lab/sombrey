import Testing
import Foundation
@testable import SombreyApp

/// Nutrition › Search Foods on the phone: what's searched, how a portion
/// becomes nutrition, what can be logged, and that the server's shapes decode.
struct NutritionSearchTests {
    private let chicken = ExternalFoodDTO(
        externalId: "food_chicken_breast", name: "Chicken Breast", brand: nil, category: "Generic foods",
        per100g: .init(calories: 120, protein: 22.5, carbs: 0, fat: 2.62),
        measures: [.init(label: "Serving", grams: 85), .init(label: "Whole", grams: 174)]
    )

    // MARK: Query

    @Test func emptyAndShortQueriesAreNotSearched() {
        #expect(FoodSearchLogic.searchable("") == nil)
        #expect(FoodSearchLogic.searchable("   ") == nil)
        #expect(FoodSearchLogic.searchable("r") == nil)
        #expect(FoodSearchLogic.searchable(" r ") == nil)
    }

    @Test func realQueriesAreNormalised() {
        #expect(FoodSearchLogic.searchable("  chicken   breast ") == "chicken breast")
        #expect(FoodSearchLogic.searchable("ok") == "ok")
        #expect(FoodSearchLogic.searchable(String(repeating: "x", count: 300))?.count == 80)
        #expect(FoodSearchLogic.debounceNanoseconds >= 300_000_000 && FoodSearchLogic.debounceNanoseconds <= 500_000_000)
    }

    // MARK: Quantity → nutrition

    @Test func gramsScalePer100gValues() {
        let n = FoodSearchLogic.nutrition(chicken.per100g, grams: 150)
        #expect(n == .init(calories: 180, protein: 33.8, carbs: 0, fat: 3.9))
    }

    @Test func aServingIsItsGramWeightTimesCount() {
        let unit = FoodSearchLogic.Unit.measure(label: "Serving", grams: 85)
        let grams = FoodSearchLogic.grams(amount: 2, unit: unit)
        #expect(grams == 170)
        #expect(FoodSearchLogic.nutrition(chicken.per100g, grams: grams!).calories == 204)
        #expect(FoodSearchLogic.portionLabel(amount: 2, unit: unit) == "2 × Serving (170 g)")
        #expect(FoodSearchLogic.portionLabel(amount: 150, unit: .grams) == "150 g")
    }

    @Test func libraryFoodsByServingArePerServingTimesServings() {
        let shake = LibraryFoodDTO(id: "f1", name: "Coach's shake", calories: 200, protein: 4, carbs: 44, fats: 0.5, servingSize: "1", servingUnit: "shake")
        #expect(FoodSearchLogic.nutrition(shake, servings: 1.5) == .init(calories: 300, protein: 6, carbs: 66, fat: 0.8))
        // Only per-serving values → counted in servings, nothing else offered.
        #expect(FoodSearchLogic.defaultUnit(for: shake).0 == .serving)
        #expect(FoodSearchLogic.units(for: shake) == [.serving])
    }

    private let usdaRice = LibraryFoodDTO(
        id: "r1", name: "Rice, white, long-grain, regular, enriched, cooked", category: "Cereal Grains and Pasta", preparationState: "cooked",
        calories: 205, protein: 4.3, carbs: 44.6, fats: 0.4, servingSize: "1", servingUnit: "1 cup", servingGrams: 158,
        per100g: .init(calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3), portions: [.init(label: "1 cup", grams: 158)], source: "usda_fdc_sr_legacy"
    )

    @Test func libraryFoodsWithPer100gTakeGramsAndTheirHouseholdMeasures() {
        #expect(FoodSearchLogic.defaultUnit(for: usdaRice).0 == .measure(label: "1 cup", grams: 158))
        #expect(FoodSearchLogic.units(for: usdaRice) == [.grams, .measure(label: "1 cup", grams: 158)])
        // 250 g of cooked rice from its per-100 g values.
        #expect(FoodSearchLogic.nutrition(usdaRice.per100g!, grams: 250) == .init(calories: 325, protein: 6.8, carbs: 70.5, fat: 0.8))
        // 2 cups = 316 g.
        let cups = FoodSearchLogic.grams(amount: 2, unit: .measure(label: "1 cup", grams: 158))
        #expect(cups == 316)
        #expect(FoodSearchLogic.nutrition(usdaRice.per100g!, grams: cups!).calories == 411)
        #expect(FoodSearchLogic.summary(usdaRice) == "USDA · per 100 g · cooked")
        #expect(FoodSearchLogic.sourceLabel(nil) == "Sombrey")
        #expect(FoodSearchLogic.sourceLabel("uk_cofid") == "UK")
    }

    @Test func fallbackPicturesAndCreditsNeverNeedAnImage() {
        #expect(FoodSearchLogic.fallbackGlyph(name: "Fish, salmon, raw", category: "Finfish and Shellfish Products") == "fish")
        #expect(FoodSearchLogic.fallbackGlyph(name: "Lentils, boiled", category: nil) == "basket")
        #expect(FoodSearchLogic.fallbackGlyph(name: "Something unusual", category: nil) == "fork.knife")
        #expect(FoodSearchLogic.libraryCredit([nil]) == nil)
        #expect(FoodSearchLogic.libraryCredit(["usda_fdc_sr_legacy"]) == "Library data: USDA FoodData Central.")
        #expect(FoodSearchLogic.libraryCredit(["uk_cofid"])?.contains("Open Government Licence v3.0") == true)
        let json = #"{"id":"x","name":"Rice","calories":1,"protein":0,"carbs":0,"fats":0,"servingSize":"1","servingUnit":"g","image":{"url":"https://img.example/r.webp","license":"CC BY 4.0","attribution":"A. Photographer"}}"#
        let food = try? JSONDecoder().decode(LibraryFoodDTO.self, from: Data(json.utf8))
        #expect(food?.image?.license == "CC BY 4.0")
    }

    @Test func libraryPagesDecodeAndPaginationSendsAnExplicitNullCursor() throws {
        let json = #"{"page":[{"id":"r1","name":"Rice, white, cooked","category":"Cereal Grains and Pasta","calories":205,"protein":4.3,"carbs":44.6,"fats":0.4,"servingSize":"1","servingUnit":"1 cup","servingGrams":158,"per100g":{"calories":130,"protein":2.7,"carbs":28.2,"fat":0.3},"portions":[{"label":"1 cup","grams":158}],"source":"usda_fdc_sr_legacy"},{"id":"m1","name":"Coach's shake","calories":300,"protein":30,"carbs":20,"fats":10,"servingSize":"1","servingUnit":"shake","portions":[]}],"isDone":false,"continueCursor":"abc","tooShort":false,"minLength":2}"#
        let page = try JSONDecoder().decode(LibrarySearchPageDTO.self, from: Data(json.utf8))
        #expect(page.page.count == 2)
        #expect(page.page[0].per100g?.calories == 130)
        #expect(page.page[1].per100g == nil)
        #expect(page.page[1].source == nil)
        #expect(!page.isDone)
        let arg = String(decoding: try JSONEncoder().encode(PaginationOptsArg(numItems: 20, cursor: nil)), as: UTF8.self)
        #expect(arg.contains("\"cursor\":null"))
    }

    @Test func librarySearchStates() {
        let empty = LibrarySearchPageDTO(page: [], isDone: true, continueCursor: "")
        let some = LibrarySearchPageDTO(page: [usdaRice], isDone: false, continueCursor: "c")
        #expect(FoodSearchLogic.libraryState(query: "", searched: nil, failed: false, page: nil) == .idle)
        #expect(FoodSearchLogic.libraryState(query: "r", searched: nil, failed: false, page: nil) == .tooShort)
        #expect(FoodSearchLogic.libraryState(query: "rice", searched: nil, failed: false, page: nil) == .loading)
        #expect(FoodSearchLogic.libraryState(query: "rice", searched: "rice", failed: false, page: nil) == .loading)
        #expect(FoodSearchLogic.libraryState(query: "rice", searched: "rice", failed: true, page: nil) == .failed)
        #expect(FoodSearchLogic.libraryState(query: "zzqx", searched: "zzqx", failed: false, page: empty) == .empty)
        #expect(FoodSearchLogic.libraryState(query: "rice", searched: "rice", failed: false, page: some) == .results)
        // Typed on: the old page isn't this query's.
        #expect(FoodSearchLogic.libraryState(query: "rice b", searched: "rice", failed: false, page: some) == .loading)
        #expect(FoodSearchLogic.canShowMore(some, limit: 20))
        #expect(!FoodSearchLogic.canShowMore(some, limit: FoodSearchLogic.libraryMaxResults))
        #expect(!FoodSearchLogic.canShowMore(empty, limit: 20))
    }

    @Test func invalidQuantitiesCannotBeLoggedOrProduceNaN() {
        for bad in [0, -1, Double.nan, Double.infinity, 5_001] {
            #expect(!FoodSearchLogic.isValid(amount: bad, unit: .grams))
            #expect(FoodSearchLogic.grams(amount: bad, unit: .grams) == nil)
        }
        #expect(!FoodSearchLogic.isValid(amount: 51, unit: .measure(label: "Cup", grams: 50)))
        #expect(!FoodSearchLogic.isValid(amount: 1, unit: .measure(label: "Odd", grams: 0)))
        #expect(!FoodSearchLogic.isValid(amount: 0, unit: .serving))
        #expect(FoodSearchLogic.nutrition(chicken.per100g, grams: .nan) == .zero)
        #expect(FoodSearchLogic.nutrition(chicken.per100g, grams: -10) == .zero)
    }

    @Test func missingMacrosCountAsZeroAndAreNamed() {
        let p = ExternalFoodDTO.Per100g(calories: 150, protein: 20, carbs: nil, fat: nil)
        let n = FoodSearchLogic.nutrition(p, grams: 100)
        #expect(n == .init(calories: 150, protein: 20, carbs: 0, fat: 0))
        #expect(FoodSearchLogic.missingMacros(p) == ["carbs", "fat"])
        #expect(FoodSearchLogic.missingMacros(chicken.per100g).isEmpty)
    }

    @Test func servingIsOfferedFirstWhenEdamamHasOne() {
        let (unit, amount) = FoodSearchLogic.defaultUnit(for: chicken)
        #expect(unit == .measure(label: "Serving", grams: 85))
        #expect(amount == 1)
        let bare = ExternalFoodDTO(externalId: "x", name: "X", brand: nil, category: nil, per100g: chicken.per100g, measures: [])
        #expect(FoodSearchLogic.defaultUnit(for: bare).0 == .grams)
    }

    // MARK: Server shapes and states

    @Test func searchResultDecodesWithNullMacrosAndBothSources() throws {
        let json = #"{"status":"ok","query":"chicken","sombrey":[{"id":"k1","name":"Chicken curry","calories":320,"protein":28,"carbs":12,"fats":18,"servingSize":"1","servingUnit":"bowl"}],"edamam":[{"externalId":"food_bar","name":"Chicken Bar","brand":"Acme","category":"Packaged foods","per100g":{"calories":150,"protein":20,"carbs":null,"fat":5},"measures":[{"label":"Serving","grams":100}]}],"edamamStatus":"ok"}"#
        let r = try JSONDecoder().decode(FoodSearchResultDTO.self, from: Data(json.utf8))
        #expect(r.sombrey.count == 1)
        #expect(r.edamam.first?.per100g.carbs == nil)
        #expect(r.edamam.first?.brand == "Acme")
        #expect(FoodSearchLogic.notice(for: r) == nil)
    }

    @Test func everySearchOutcomeHasItsOwnState() {
        func result(_ status: String = "ok", edamam: String, sombrey: [SombreyFoodDTO] = [], foods: [ExternalFoodDTO] = []) -> FoodSearchResultDTO {
            FoodSearchResultDTO(status: status, query: "rice", sombrey: sombrey, edamam: foods, edamamStatus: edamam)
        }
        #expect(FoodSearchLogic.notice(for: result(edamam: "ok")) == .noResults)
        #expect(FoodSearchLogic.notice(for: result(edamam: "rate_limited")) == .rateLimited)
        #expect(FoodSearchLogic.notice(for: result(edamam: "unavailable")) == .unavailable)
        #expect(FoodSearchLogic.notice(for: result(edamam: "error")) == .failed)
        #expect(FoodSearchLogic.notice(for: result("unauthenticated", edamam: "skipped")) == .signedOut)
        #expect(FoodSearchLogic.notice(for: result("too_short", edamam: "skipped")) == .tooShort)
        // Edamam's own state, whatever the library found.
        let own = SombreyFoodDTO(id: "f", name: "Rice", calories: 1, protein: 0, carbs: 0, fats: 0, servingSize: "1", servingUnit: "cup")
        #expect(FoodSearchLogic.notice(for: result(edamam: "rate_limited", sombrey: [own])) == .rateLimited)
        #expect(FoodSearchLogic.Notice.libraryFailed.canRetry)
        // Retry is offered only where it can help — and it's always the user's tap.
        #expect(FoodSearchLogic.Notice.rateLimited.canRetry)
        #expect(FoodSearchLogic.Notice.failed.canRetry)
        #expect(!FoodSearchLogic.Notice.noResults.canRetry)
        #expect(FoodSearchLogic.Notice.idle.title == "Search foods")
        #expect(FoodSearchLogic.Notice.idle.message == "Find foods, meals, and products by name.")
    }

    @Test func loggedEdamamEntriesDecodeWithoutAFoodId() throws {
        let json = #"{"foodsWithDetails":[{"entryId":"e1","foodId":"f1","servings":2,"mealType":"lunch","foodName":"Rice","protein":4,"carbs":44,"fats":0.5,"calories":200},{"entryId":"e2","servings":1,"mealType":"lunch","source":"edamam","portion":"150 g","foodName":"Chicken Breast","protein":33.8,"carbs":0,"fats":3.9,"calories":180}]}"#
        let log = try JSONDecoder().decode(NutritionDayLog.self, from: Data(json.utf8))
        #expect(log.foodsWithDetails[0].foodId == "f1")
        #expect(log.foodsWithDetails[1].foodId == nil)
        #expect(log.foodsWithDetails[1].source == "edamam")
        #expect(log.foodsWithDetails[1].portion == "150 g")
    }

    @Test func missingMacrosAreSentAsExplicitNulls() throws {
        let arg = ExternalPer100gArg(.init(calories: 150, protein: 20, carbs: nil, fat: nil))
        let json = String(decoding: try JSONEncoder().encode(arg), as: UTF8.self)
        #expect(json.contains("\"carbs\":null"))
        #expect(json.contains("\"fat\":null"))
    }
}
