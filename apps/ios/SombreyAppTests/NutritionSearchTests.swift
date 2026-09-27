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

    @Test func sombreyFoodsArePerServingTimesServings() {
        let rice = SombreyFoodDTO(id: "f1", name: "Rice", calories: 200, protein: 4, carbs: 44, fats: 0.5, servingSize: "1", servingUnit: "cup")
        #expect(FoodSearchLogic.nutrition(rice, servings: 1.5) == .init(calories: 300, protein: 6, carbs: 66, fat: 0.8))
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
        #expect(FoodSearchLogic.edamamNote(for: r) == nil)
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
        // Sombrey foods still shown when Edamam is busy — with a note why the rest is missing.
        let own = SombreyFoodDTO(id: "f", name: "Rice", calories: 1, protein: 0, carbs: 0, fats: 0, servingSize: "1", servingUnit: "cup")
        let partial = result(edamam: "rate_limited", sombrey: [own])
        #expect(FoodSearchLogic.notice(for: partial) == nil)
        #expect(FoodSearchLogic.edamamNote(for: partial) == .rateLimited)
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
