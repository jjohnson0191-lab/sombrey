import SwiftUI
import ConvexMobile

/// Nutrition › Search Foods.
///
/// The Sombrey Food Library first: `foods:search` — a Convex query over the
/// canonical `foods` table (imported approved datasets such as USDA
/// FoodData Central, plus foods created in Sombrey), relevance-ranked and
/// paginated on the server; no provider is called and the phone only ever
/// holds the page it shows. Edamam's live database is a separate, explicit
/// step ("Search Edamam") through `foodSearch:search` — never on its own.
///
/// The user picks a food, sets the portion (grams, a household measure, or
/// servings), sees what it adds, and logs it only when they tap Log food: a
/// library food through `nutritionLogs:logFood` (by grams or servings, with
/// a snapshot so history never changes), an Edamam food through
/// `nutritionLogs:logExternalFood` (never copied into `foods`). Each
/// confirmation carries one entry id, so a retry or double tap logs once.
///
/// Nothing is searched under `FoodSearchLogic.minQueryLength` characters,
/// typing is debounced, and a newer query replaces the pending one.
struct AddMealView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Stage: Equatable { case search, detail(FoodChoice), logged(String, FoodSearchLogic.Nutrition, String) }

    @State private var stage: Stage = .search
    @State private var query = ""
    @FocusState private var fieldFocused: Bool

    // Library search (a live Convex subscription for the settled query).
    @State private var library = ConvexQuery<LibrarySearchPageDTO>()
    @State private var searched: String?
    @State private var limit = FoodSearchLogic.libraryPageSize
    @State private var retryToken = 0

    // Edamam — only when the user asks, for the query shown.
    @State private var edamam: FoodSearchResultDTO?
    @State private var edamamLoading = false
    @State private var edamamFailed = false

    var body: some View {
        EnvironmentView(scene: .aiCoach) {
            VStack(spacing: 0) {
                topBar
                switch stage {
                case .search:
                    searchStage
                case .detail(let choice):
                    FoodPortionView(choice: choice, onBack: { back() }, onLogged: { name, n, meal in
                        withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .logged(name, n, meal) }
                    })
                    .transition(.opacity)
                case .logged(let name, let n, let meal):
                    loggedStage(name, n, meal)
                }
            }
        }
        // One subscription per settled query: SwiftUI cancels the pending
        // task when the query changes, so an obsolete search never starts.
        .task(id: SearchKey(query: FoodSearchLogic.searchable(query), limit: limit, retry: retryToken)) {
            await searchLibrary()
        }
    }

    private struct SearchKey: Equatable { let query: String?; let limit: Int; let retry: Int }

    // MARK: Bar

    private var topBar: some View {
        HStack {
            Button(isLogged ? "Done" : "Cancel") { dismiss() }
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .frame(minHeight: 44)
            Spacer()
            SombreyLogo(size: .header, tone: .onLight)
            Spacer()
            Color.clear.frame(width: 60, height: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var isLogged: Bool { if case .logged = stage { return true } else { return false } }

    // MARK: Search

    private var searchStage: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("NUTRITION")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.8)
                        .foregroundStyle(StudioColor.inkSoft)
                    Text("Search foods")
                        .font(StudioFont.hero(30, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .accessibilityAddTraits(.isHeader)
                }
                searchField
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    libraryContent
                    edamamContent
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear { fieldFocused = true }
    }

    private var libraryState: FoodSearchLogic.LibraryState {
        FoodSearchLogic.libraryState(query: query, searched: searched, failed: library.errorMessage != nil, page: library.value)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(StudioColor.inkSoft)
                .accessibilityHidden(true)
            TextField("Chicken, rice, oats…", text: $query)
                .font(StudioFont.body(16))
                .foregroundStyle(StudioColor.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($fieldFocused)
                .accessibilityLabel("Search foods")
                .accessibilityIdentifier("foodSearch.field")
            if libraryState == .loading {
                ProgressView().controlSize(.small).tint(StudioColor.inkSoft)
            } else if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(StudioColor.inkFaint)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .frame(minHeight: 50)
        .background { SombreyGlassChamber(cornerRadius: 18) }
    }

    @ViewBuilder
    private var libraryContent: some View {
        switch libraryState {
        case .idle:
            notice(.idle)
        case .tooShort:
            notice(.tooShort)
        case .loading:
            HStack(spacing: 10) {
                ProgressView().tint(StudioColor.inkSoft)
                Text("Searching…")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .combine)
        case .failed:
            notice(.libraryFailed)
        case .empty:
            notice(.libraryNoResults)
        case .results:
            if let page = library.value {
                section("SOMBREY FOOD LIBRARY", page.page.map(FoodChoice.library))
                if FoodSearchLogic.canShowMore(page, limit: limit) {
                    Button { limit = min(FoodSearchLogic.libraryMaxResults, limit + FoodSearchLogic.libraryPageSize) } label: {
                        Text("Show more").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.outlineCTA)
                } else if !page.isDone {
                    Text("Showing the \(page.page.count) closest matches — add a word to narrow the search.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if page.page.contains(where: { $0.source?.hasPrefix("usda_fdc") == true }) {
                    Text("Library data includes USDA FoodData Central.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
        }
    }

    /// Edamam's database: offered once the library has answered, searched
    /// only when the user taps — one request, through the backend.
    @ViewBuilder
    private var edamamContent: some View {
        if let q = FoodSearchLogic.searchable(query), libraryState == .results || libraryState == .empty || libraryState == .failed {
            if let r = edamam, r.query == q {
                if let n = FoodSearchLogic.notice(for: r) {
                    notice(n, retry: { searchEdamam(q) })
                } else {
                    section("EDAMAM FOOD DATABASE", r.edamam.map(FoodChoice.edamam))
                    EdamamAttribution()
                }
            } else if edamamLoading {
                HStack(spacing: 10) {
                    ProgressView().tint(StudioColor.inkSoft)
                    Text("Searching Edamam…")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .frame(minHeight: 44)
            } else if edamamFailed {
                notice(.failed, retry: { searchEdamam(q) })
            } else {
                Button { searchEdamam(q) } label: {
                    Text("Search Edamam for “\(q)”").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
                .accessibilityIdentifier("foodSearch.edamam")
            }
        }
    }

    private func section(_ title: String, _ items: [FoodChoice]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(StudioColor.inkSoft)
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                FoodSearchRow(choice: item) { open(item) }
                    .studioReveal(index: min(index, 6))
            }
        }
    }

    private func notice(_ n: FoodSearchLogic.Notice, retry: (() -> Void)? = nil) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(n.title)
                    .font(StudioFont.hero(18, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text(n.message)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            if n.canRetry {
                Button { if let retry { retry() } else { retryToken += 1 } } label: {
                    Text("Try again").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 20) }
        .accessibilityIdentifier("foodSearch.notice")
    }

    // MARK: Logged

    private func loggedStage(_ name: String, _ n: FoodSearchLogic.Nutrition, _ meal: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("LOGGED")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                    .padding(.top, 40)
                Text(name)
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text("\(Int(n.calories)) kcal · \(FoodSearchLogic.number(n.protein))g protein · \(FoodSearchLogic.number(n.carbs))g carbs · \(FoodSearchLogic.number(n.fat))g fat — added to \(meal)'s entries and today's totals.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 10) {
                    Button { dismiss() } label: { Text("Done").frame(maxWidth: .infinity) }
                        .buttonStyle(.illuminatedCTA)
                    Button { back() } label: { Text("Log another food").frame(maxWidth: .infinity) }
                        .buttonStyle(.outlineCTA)
                }
                .padding(.top, 16)
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: Actions

    private func open(_ choice: FoodChoice) {
        fieldFocused = false
        withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .detail(choice) }
    }

    private func back() {
        withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .search }
    }

    /// Debounced: subscribes to the library search for the settled query.
    private func searchLibrary() async {
        guard let q = FoodSearchLogic.searchable(query) else {
            library.stop()
            searched = nil
            limit = FoodSearchLogic.libraryPageSize
            return
        }
        // A new query starts from the first page and a fresh Edamam offer.
        if searched != q {
            if limit != FoodSearchLogic.libraryPageSize { limit = FoodSearchLogic.libraryPageSize; return }
            edamam = nil
            edamamFailed = false
            try? await Task.sleep(nanoseconds: FoodSearchLogic.debounceNanoseconds)
            guard !Task.isCancelled else { return }
            // A fresh subscription: the previous query's page is never shown for this one.
            library = ConvexQuery<LibrarySearchPageDTO>()
        }
        searched = q
        library.subscribe(to: "foods:search", with: [
            "query": q,
            "paginationOpts": PaginationOptsArg(numItems: Double(limit), cursor: nil),
        ])
    }

    /// The user asked for Edamam's results for this query: one request.
    private func searchEdamam(_ q: String) {
        guard !edamamLoading else { return }
        edamamLoading = true
        edamamFailed = false
        Task {
            do {
                let r: FoodSearchResultDTO = try await ConvexClientProvider.client.action("foodSearch:search", with: ["query": q])
                if FoodSearchLogic.searchable(query) == q { edamam = r }
            } catch {
                if FoodSearchLogic.searchable(query) == q { edamamFailed = true }
            }
            edamamLoading = false
        }
    }
}

// MARK: - Result row

/// One result: name, where it's from and its basis, calories on the right.
struct FoodSearchRow: View {
    let choice: FoodChoice
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(choice.name)
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(detail)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                        .lineLimit(1)
                    Text(macros)
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .monospacedDigit()
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(Int(kcal.rounded()))")
                        .font(StudioFont.hero(19, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                    Text("kcal")
                        .font(StudioFont.body(10))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(StudioColor.inkFaint)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .background { SombreyGlassChamber(cornerRadius: 18) }
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(SombreyPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(choice.name), \(detail), \(Int(kcal.rounded())) calories")
        .accessibilityHint("Opens this food to choose a portion")
    }

    private var kcal: Double {
        switch choice {
        case .library(let f): return f.per100g?.calories ?? f.calories
        case .edamam(let f): return f.per100g.calories
        }
    }

    private var detail: String {
        switch choice {
        case .library(let f): return FoodSearchLogic.summary(f)
        case .edamam(let f): return FoodSearchLogic.summary(f)
        }
    }

    private var macros: String {
        let g = { (v: Double?) in v.map { "\(FoodSearchLogic.number(($0 * 10).rounded() / 10))g" } ?? "—" }
        switch choice {
        case .library(let f):
            if let p = f.per100g { return "P \(g(p.protein)) · C \(g(p.carbs)) · F \(g(p.fat))" }
            return "P \(g(f.protein)) · C \(g(f.carbs)) · F \(g(f.fats))"
        case .edamam(let f): return "P \(g(f.per100g.protein)) · C \(g(f.per100g.carbs)) · F \(g(f.per100g.fat))"
        }
    }
}

// MARK: - Portion & confirm

/// One food, up close: the portion (grams or a serving measure for Edamam;
/// servings for a Sombrey food), what it adds, the meal — and nothing is
/// logged until Log food.
struct FoodPortionView: View {
    let choice: FoodChoice
    let onBack: () -> Void
    let onLogged: (String, FoodSearchLogic.Nutrition, String) -> Void

    @State private var unit: FoodSearchLogic.Unit = .grams
    @State private var amount: Double = 100
    @State private var mealType = MacroCalculatorFlow.defaultMealType()
    @State private var logging = false
    @State private var problem: String?
    @State private var loggedTick = 0
    @State private var adjustTick = 0
    /// One idempotency key per confirmation: a retry of the same confirmation
    /// sends the same id and the backend logs it once.
    @State private var entryId = UUID().uuidString
    @State private var configured = false

    var body: some View {
        let n = nutrition
        let valid = FoodSearchLogic.isValid(amount: amount, unit: unit)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Button(action: onBack) {
                    Label("Results", systemImage: "chevron.left")
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 6) {
                    Text(source.uppercased())
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.8)
                        .foregroundStyle(StudioColor.inkSoft)
                    Text(choice.name)
                        .font(StudioFont.hero(26, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .accessibilityAddTraits(.isHeader)
                    if case .edamam(let f) = choice, let brand = f.brand {
                        Text(brand)
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                }

                portion

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        figure("Calories", valid ? "\(Int(n.calories))" : "—", "kcal")
                        figure("Protein", valid ? FoodSearchLogic.number(n.protein) : "—", "g")
                        figure("Carbs", valid ? FoodSearchLogic.number(n.carbs) : "—", "g")
                        figure("Fat", valid ? FoodSearchLogic.number(n.fat) : "—", "g")
                    }
                    .padding(14)
                    .background { SombreyGlassChamber(cornerRadius: 18) }
                    .contentTransition(.numericText())
                    Text(basisNote)
                        .font(StudioFont.body(11))
                        .foregroundStyle(missing.isEmpty ? StudioColor.inkFaint : StudioColor.caution)
                        .fixedSize(horizontal: false, vertical: true)
                    if case .edamam = choice {
                        EdamamAttribution()
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("MEAL")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(StudioColor.inkSoft)
                    StudioModePills(
                        options: MacroCalculatorFlow.mealTypes.map { StudioModeOption(value: $0, label: $0.uppercased(), accessibilityLabel: $0.capitalized) },
                        selection: $mealType
                    )
                }

                if let problem {
                    Text(problem)
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(spacing: 10) {
                    Button { confirm() } label: {
                        Group {
                            if logging { ProgressView().tint(StudioColor.ink) } else { Text("Log food") }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(logging || !valid)
                    .accessibilityIdentifier("foodSearch.log")
                    Text("Nothing is logged until you tap Log food.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .sensoryFeedback(StudioHaptic.mealLogged, trigger: loggedTick)
        .sensoryFeedback(StudioHaptic.estimateAdjusted, trigger: adjustTick)
        .onAppear {
            // Defaults once — never reset what the user already chose.
            guard !configured else { return }
            configured = true
            switch choice {
            case .library(let f): (unit, amount) = FoodSearchLogic.defaultUnit(for: f)
            case .edamam(let f): (unit, amount) = FoodSearchLogic.defaultUnit(for: f)
            }
        }
    }

    // MARK: Portion

    private var portion: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("PORTION")
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(StudioColor.inkSoft)
                Spacer()
                if availableUnits.count > 1 {
                    unitMenu(availableUnits)
                }
            }
            HStack(spacing: 14) {
                stepButton("minus", "Less") { change(by: -FoodSearchLogic.step(for: unit, amount: amount)) }
                Spacer(minLength: 0)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    MacroNumberField(value: $amount, font: StudioFont.hero(40, weight: .bold), accessibility: "Amount in \(unitName)")
                    Text(unitShort)
                        .font(StudioFont.body(14))
                        .foregroundStyle(StudioColor.inkSoft)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                stepButton("plus", "More") { change(by: FoodSearchLogic.step(for: unit, amount: amount)) }
            }
            .padding(14)
            .background { SombreyGlassChamber(cornerRadius: 18) }
            if !FoodSearchLogic.isValid(amount: amount, unit: unit) {
                Text("Enter an amount above 0 (up to \(Int(FoodSearchLogic.maxGrams)) g).")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.caution)
            } else if case .measure = unit, let g = FoodSearchLogic.grams(amount: amount, unit: unit) {
                Text("≈ \(FoodSearchLogic.number(g)) g")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            } else if case .serving = unit, case .library(let f) = choice {
                Text("1 serving = \(f.servingSize == "1" ? f.servingUnit : "\(f.servingSize) \(f.servingUnit)")\(f.servingGrams.map { " (\(FoodSearchLogic.number($0)) g)" } ?? "")")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    /// Grams and the source's household measures for a food with per-100 g
    /// values; servings for one that only has per-serving values.
    private var availableUnits: [FoodSearchLogic.Unit] {
        switch choice {
        case .library(let f): return FoodSearchLogic.units(for: f)
        case .edamam(let f): return [.grams] + f.measures.map { .measure(label: $0.label, grams: $0.grams) }
        }
    }

    private func unitMenu(_ units: [FoodSearchLogic.Unit]) -> some View {
        Menu {
            ForEach(units, id: \.self) { u in
                Button(menuLabel(u)) { setUnit(u) }
            }
        } label: {
            HStack(spacing: 4) {
                Text(unitName)
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Unit: \(unitName)")
    }

    private func menuLabel(_ u: FoodSearchLogic.Unit) -> String {
        switch u {
        case .grams: return "Grams"
        case .measure(let label, let g): return "\(label) (\(FoodSearchLogic.number(g)) g)"
        case .serving: return "Servings"
        }
    }

    private func setUnit(_ new: FoodSearchLogic.Unit) {
        guard new != unit else { return }
        // Keep the same food on the plate where possible: convert via grams.
        let grams = FoodSearchLogic.grams(amount: amount, unit: unit)
        unit = new
        switch new {
        case .grams: amount = grams.map { $0.rounded() } ?? 100
        case .measure(_, let g): amount = grams.map { max(0.5, (($0 / g) * 2).rounded() / 2) } ?? 1
        case .serving: amount = 1
        }
        adjustTick += 1
    }

    private func change(by delta: Double) {
        let next = amount + delta
        guard next > 0 else { return }
        amount = (next * 10).rounded() / 10
        adjustTick += 1
    }

    private func stepButton(_ glyph: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .frame(width: 44, height: 44)
                .background { Circle().fill(Color.white.opacity(0.55)) }
                .overlay { Circle().strokeBorder(Color.white.opacity(0.8), lineWidth: 1) }
        }
        .buttonStyle(SombreyPressStyle())
        .accessibilityLabel("\(label) — portion")
    }

    private func figure(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(StudioFont.hero(17, weight: .semibold)).foregroundStyle(StudioColor.ink).monospacedDigit()
                Text(unit).font(StudioFont.body(10)).foregroundStyle(StudioColor.inkSoft)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: Derived

    private var nutrition: FoodSearchLogic.Nutrition {
        switch choice {
        case .library(let f):
            if case .serving = unit { return FoodSearchLogic.nutrition(f, servings: amount) }
            guard let p = f.per100g, let g = FoodSearchLogic.grams(amount: amount, unit: unit) else { return .zero }
            return FoodSearchLogic.nutrition(p, grams: g)
        case .edamam(let f):
            guard let g = FoodSearchLogic.grams(amount: amount, unit: unit) else { return .zero }
            return FoodSearchLogic.nutrition(f.per100g, grams: g)
        }
    }

    private var missing: [String] {
        if case .edamam(let f) = choice { return FoodSearchLogic.missingMacros(f.per100g) }
        return []
    }

    private var source: String {
        if case .library = choice { return "Sombrey food library" }
        return "Edamam food database"
    }

    private var basisNote: String {
        switch choice {
        case .library(let f):
            let origin = f.source?.hasPrefix("usda_fdc") == true ? "USDA FoodData Central" : "Sombrey's food library"
            if f.per100g != nil, unit != .serving { return "Nutrition from \(origin), calculated from its per-100 g values." }
            return "Nutrition from \(origin) — per serving of \(f.servingSize == "1" ? f.servingUnit : "\(f.servingSize) \(f.servingUnit)")."
        case .edamam:
            let base = "Nutrition from Edamam, scaled from its per-100 g values."
            guard !missing.isEmpty else { return base }
            return "\(base) Edamam has no \(missing.joined(separator: " or ")) value for this food — counted as 0."
        }
    }

    private var unitName: String {
        switch unit {
        case .grams: return "Grams"
        case .measure(let label, _): return label
        case .serving: return "Servings"
        }
    }

    private var unitShort: String {
        switch unit {
        case .grams: return "g"
        case .measure(let label, _): return "× \(label.lowercased())"
        case .serving: return amount == 1 ? "serving" : "servings"
        }
    }

    // MARK: Confirm

    private func confirm() {
        guard !logging, FoodSearchLogic.isValid(amount: amount, unit: unit) else { return }
        logging = true
        problem = nil
        let preview = nutrition
        let meal = mealType
        Task {
            do {
                switch choice {
                case .library(let f):
                    var args: [String: ConvexEncodable?] = [
                        "date": NutritionDate.todayUTCMidnightMillis,
                        "foodId": f.id,
                        "servings": amount,
                        "mealType": meal,
                        "entryId": entryId,
                    ]
                    // By weight: the server takes per-100 g × grams (servings 1).
                    if unit != .serving, let grams = FoodSearchLogic.grams(amount: amount, unit: unit) {
                        args["servings"] = 1.0
                        args["grams"] = grams
                        args["portion"] = FoodSearchLogic.portionLabel(amount: amount, unit: unit)
                    }
                    let _: String = try await ConvexClientProvider.client.mutation("nutritionLogs:logFood", with: args)
                case .edamam(let f):
                    guard let grams = FoodSearchLogic.grams(amount: amount, unit: unit) else { logging = false; return }
                    let _: ExternalLogResult = try await ConvexClientProvider.client.mutation("nutritionLogs:logExternalFood", with: [
                        "date": NutritionDate.todayUTCMidnightMillis,
                        "mealType": meal,
                        "entryId": entryId,
                        "name": f.name,
                        "externalId": f.externalId,
                        "portion": FoodSearchLogic.portionLabel(amount: amount, unit: unit),
                        "grams": grams,
                        "per100g": ExternalPer100gArg(f.per100g),
                    ])
                }
                let todayWeekday = Calendar.current.component(.weekday, from: Date())
                NotificationManager.shared.cancelMissedMealReminders(forDayOfWeek: todayWeekday)
                loggedTick += 1
                logging = false
                onLogged(choice.name, preview, meal)
            } catch {
                logging = false
                problem = "Couldn't log this food. Check your connection and try again."
            }
        }
    }
}

/// `logExternalFood`'s reply — the values the server logged.
struct ExternalLogResult: Decodable {
    let calories: Double
    let protein: Double
    let carbs: Double
    let fats: Double
}

/// Edamam's per-100 g values sent back as they came (a missing macro stays null).
struct ExternalPer100gArg: ConvexEncodable, Encodable {
    let calories: Double
    let protein: Double?
    let carbs: Double?
    let fat: Double?
    init(_ p: ExternalFoodDTO.Per100g) { calories = p.calories; protein = p.protein; carbs = p.carbs; fat = p.fat }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(calories, forKey: .calories)
        // Explicit nulls: the backend's validator expects the key present.
        try c.encode(protein, forKey: .protein)
        try c.encode(carbs, forKey: .carbs)
        try c.encode(fat, forKey: .fat)
    }
    private enum CodingKeys: String, CodingKey { case calories, protein, carbs, fat }
}

// MARK: - Attribution

/// Edamam's own "Powered by Edamam" badge (the official transparent
/// artwork, developer.edamam.com/attribution — required on every plan;
/// mobile apps need the image, not a link). Shown wherever Edamam data is.
struct EdamamAttribution: View {
    var body: some View {
        Image("PoweredByEdamam")
            .resizable()
            .scaledToFit()
            .frame(height: 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 2)
            .accessibilityLabel("Powered by Edamam")
            .accessibilityIdentifier("foodSearch.edamamAttribution")
    }
}
