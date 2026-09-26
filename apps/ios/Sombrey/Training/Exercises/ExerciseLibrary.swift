import SwiftUI
import Observation
import ConvexMobile

// MARK: - Wire shapes (Sombrey exercise library — `convex/exerciseLibrary.ts`)

/// An exercise in the Sombrey Exercise Library, as the server presents it:
/// Sombrey's own fields only. `id` is the stable Sombrey exercise id that
/// workouts and plans reference.
struct LibraryExercise: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let muscleGroup: String
    let primaryMuscles: [String]
    let equipment: [String]
    let difficulty: String?
    let category: String?
    let hasMedia: Bool
    /// The demonstration visual, in Sombrey storage — when one may be shown.
    let mediaUrl: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, description, muscleGroup, primaryMuscles, equipment, difficulty, category, hasMedia, mediaUrl
    }

    /// The session/plan model's exercise value.
    var asExercise: Exercise {
        Exercise(id: id, name: name, description: description, muscleGroup: muscleGroup,
                 primaryMuscles: primaryMuscles, equipment: equipment, difficulty: difficulty)
    }

    /// "Glutes · Barbell" — a compact second line.
    var summaryLine: String {
        ([primaryMuscles.first ?? ExerciseVocabulary.muscleGroup(muscleGroup)] + equipment.prefix(1)).joined(separator: " · ")
    }

    /// The card's classification line: primary muscle, then type.
    var classification: String {
        ([primaryMuscles.first ?? ExerciseVocabulary.muscleGroup(muscleGroup)] + [category.map(ExerciseVocabulary.category)].compactMap { $0 })
            .joined(separator: " · ")
    }
}

struct LibrarySearchResult: Decodable, Equatable {
    let items: [LibraryExercise]
    let hasMore: Bool
}

struct LibraryFacets: Decodable, Equatable {
    struct Equipment: Decodable, Hashable { let key: String; let label: String }
    let total: Double
    let muscleGroups: [String]
    let equipment: [Equipment]
    let difficulties: [String]
    let categories: [String]
}

struct LibraryExerciseDetail: Decodable, Equatable {
    let id: String
    let name: String
    let description: String
    let muscleGroup: String
    let primaryMuscles: [String]
    let secondaryMuscles: [String]
    let equipment: [String]
    let instructions: [String]
    let difficulty: String?
    let category: String?
    let bodyRegion: String?
    let mechanic: String?
    let force: String?
    let isUnilateral: Bool?
    let mediaUrl: String?
    let mediaState: String
    let alternatives: [LibraryExercise]
    let similar: [LibraryExercise]
    let relatedState: String

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, description, muscleGroup, primaryMuscles, secondaryMuscles, equipment, instructions
        case difficulty, category, bodyRegion, mechanic, force, isUnilateral, mediaUrl, mediaState
        case alternatives, similar, relatedState
    }

    var asExercise: Exercise {
        Exercise(id: id, name: name, description: description, muscleGroup: muscleGroup,
                 primaryMuscles: primaryMuscles, equipment: equipment, difficulty: difficulty)
    }
}

struct LibraryPrepareResult: Decodable {
    let done: Bool
}

struct LibraryRefreshResult: Decodable {
    let status: String
    let added: Double
}

// MARK: - Sombrey vocabulary

/// How the library's values read in Sombrey.
enum ExerciseVocabulary {
    static func muscleGroup(_ group: String) -> String {
        switch group {
        case "core": return "Core"
        case "cardio": return "Cardio"
        case "other": return "Other"
        default: return group.capitalized
        }
    }

    static func difficulty(_ value: String) -> String { value.capitalized }

    static func category(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }

    /// Every library card's mark, from the exercise's normalized data: its
    /// type when that says more than the muscle (cardio, balance,
    /// flexibility, plyometric), otherwise its muscle group. One system for
    /// every card — demonstrations appear on the exercise's own page.
    static func glyph(category: String?, muscleGroup: String) -> String {
        switch category {
        case "cardio": return "figure.mixed.cardio"
        case "balance": return "figure.mind.and.body"
        case "flexibility", "stretching": return "figure.flexibility"
        case "plyometric", "plyometrics": return "figure.jumprope"
        default: return glyph(forMuscleGroup: muscleGroup)
        }
    }

    static func glyph(forMuscleGroup group: String) -> String {
        switch group {
        case "chest": return "figure.strengthtraining.traditional"
        case "back": return "figure.rower"
        case "shoulders": return "figure.arms.open"
        case "arms": return "dumbbell"
        case "legs": return "figure.step.training"
        case "core": return "figure.core.training"
        case "cardio": return "figure.run"
        default: return "figure.strengthtraining.functional"
        }
    }

    static func movement(mechanic: String?, force: String?, unilateral: Bool?) -> String? {
        let parts = [mechanic?.capitalized, force.map { "\($0.capitalized) movement" }, unilateral == true ? "One side at a time" : nil].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - Search model

/// The library's search state: term + filters → a live server-side query,
/// debounced, plus a debounced request that brings matching exercises into
/// the library on demand. The phone never downloads the library to search it.
@Observable
@MainActor
final class ExerciseSearchModel {
    var term = "" { didSet { if term != oldValue { schedule() } } }
    var muscleGroup: String? { didSet { if muscleGroup != oldValue { resetPaging(); schedule(immediately: true) } } }
    var equipment: String? { didSet { if equipment != oldValue { resetPaging(); schedule(immediately: true) } } }
    var difficulty: String? { didSet { if difficulty != oldValue { schedule(immediately: true) } } }
    var category: String? { didSet { if category != oldValue { schedule(immediately: true) } } }

    let results = ConvexQuery<LibrarySearchResult>()
    let facets = ConvexQuery<LibraryFacets>()
    private(set) var isFetchingMore = false
    /// The last on-demand fetch couldn't reach the exercise source.
    private(set) var sourceUnavailable = false

    static let pageSize = 40
    private var limit = pageSize
    private var providerPage = 0
    private var debounce: Task<Void, Never>?
    private var started = false

    var hasFilters: Bool { muscleGroup != nil || equipment != nil || difficulty != nil || category != nil }

    func start() {
        guard !started else { return }
        started = true
        facets.subscribe(to: "exerciseLibrary:facets")
        schedule(immediately: true)
    }

    func clearFilters() {
        muscleGroup = nil
        equipment = nil
        difficulty = nil
        category = nil
    }

    /// Filters that live in the filter sheet (muscle has its own tabs).
    var sheetFilterCount: Int { [equipment, difficulty, category].compactMap { $0 }.count }

    /// Try again after a failure.
    func retry() {
        schedule(immediately: true)
    }

    /// Next page: more of what the library holds, and the next page from the
    /// source when the library has run out.
    func loadMore() {
        limit += Self.pageSize
        subscribe()
        providerPage += 1
        Task { await refreshFromSource(page: providerPage) }
    }

    private func resetPaging() {
        limit = Self.pageSize
        providerPage = 0
    }

    private func schedule(immediately: Bool = false) {
        debounce?.cancel()
        debounce = Task { [weak self] in
            if !immediately { try? await Task.sleep(nanoseconds: 300_000_000) }
            guard !Task.isCancelled, let self else { return }
            self.resetPaging()
            self.subscribe()
            await self.refreshFromSource(page: 0)
        }
    }

    private func subscribe() {
        var args: [String: ConvexEncodable?] = ["limit": Double(limit)]
        let trimmed = term.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { args["term"] = trimmed }
        if let muscleGroup { args["muscleGroup"] = muscleGroup }
        if let equipment { args["equipment"] = equipment }
        if let difficulty { args["difficulty"] = difficulty }
        if let category { args["category"] = category }
        results.subscribe(to: "exerciseLibrary:search", with: args)
    }

    private func refreshFromSource(page: Int) async {
        let trimmed = term.trimmingCharacters(in: .whitespaces)
        let group = muscleGroup
        let equip = equipment
        isFetchingMore = true
        defer { isFetchingMore = false }
        do {
            var args: [String: ConvexEncodable?] = ["page": Double(page)]
            if trimmed.count >= 2 { args["term"] = trimmed }
            if let group { args["muscleGroup"] = group }
            if let equip { args["equipment"] = equip }
            let result: LibraryRefreshResult = try await ConvexClientProvider.client.action("exerciseLibrary:refresh", with: args)
            sourceUnavailable = result.status == "unavailable" || result.status == "busy"
        } catch {
            sourceUnavailable = true
        }
    }
}

// MARK: - Glass pill tabs

/// Sombrey's glass pill language as a scrolling tab row: each value a 44pt
/// glass key, the selected one lit (the same raised ivory key as the tab bar
/// and Train's mode pills) and gliding to its new position.
struct GlassPillTabs<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var keySpace

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(options, id: \.value) { option in
                        let isActive = option.value == selection
                        Button {
                            guard !isActive else { return }
                            withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
                                selection = option.value
                                proxy.scrollTo(option.value, anchor: .center)
                            }
                        } label: {
                            Text(option.label)
                                .font(StudioFont.body(13, weight: isActive ? .semibold : .medium))
                                .foregroundStyle(isActive ? StudioColor.ink : StudioColor.ink.opacity(0.62))
                                .padding(.horizontal, 16)
                                .frame(minHeight: 44)
                                .background {
                                    if isActive {
                                        Capsule(style: .continuous)
                                            .fill(Color.white.opacity(0.62))
                                            .overlay { Capsule(style: .continuous).strokeBorder(Color.white.opacity(0.75), lineWidth: 0.5) }
                                            .shadow(color: StudioColor.env0.opacity(0.14), radius: 6, y: 3)
                                            .matchedGeometryEffect(id: "key", in: keySpace)
                                    } else {
                                        Capsule(style: .continuous)
                                            .fill(.ultraThinMaterial)
                                            .environment(\.colorScheme, .light)
                                            .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.07), lineWidth: 1) }
                                    }
                                }
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .id(option.value)
                        .accessibilityAddTraits(isActive ? [.isSelected, .isButton] : .isButton)
                    }
                }
                .padding(.vertical, 2)
            }
            .primaryNavigationExclusion()
            .scrollClipDisabled()
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: selection)
    }
}

// MARK: - Search panel (shared)

/// The Sombrey Exercise Library's search surface — search, muscle tabs,
/// filters and results. The library, the session builder, plan editing and
/// adding an exercise mid-workout all use it. What a card's accessory shows
/// and what selecting does are the caller's.
struct ExerciseSearchPanel<Trailing: View>: View {
    @Bindable var model: ExerciseSearchModel
    let onSelect: (LibraryExercise) -> Void
    @ViewBuilder var trailing: (LibraryExercise) -> Trailing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingFilters = false
    @State private var selectedCount = 0

    /// "all" stands for no muscle filter in the tab row.
    private var muscleTab: Binding<String> {
        Binding(get: { model.muscleGroup ?? "all" }, set: { model.muscleGroup = $0 == "all" ? nil : $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LibrarySearchField(text: $model.term, isWorking: model.isFetchingMore && !model.term.isEmpty)

            HStack(spacing: 8) {
                GlassPillTabs(
                    options: muscleOptions,
                    selection: muscleTab
                )
                if hasSheetFilters {
                    filtersButton
                }
            }

            results
        }
        .task { model.start() }
        .sheet(isPresented: $showingFilters) {
            LibraryFilterSheet(model: model)
                .presentationDetents([.medium, .large])
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: selectedCount)
    }

    private var muscleOptions: [(value: String, label: String)] {
        let groups = model.facets.value?.muscleGroups ?? ["chest", "back", "shoulders", "arms", "legs", "core", "cardio"]
        return [(value: "all", label: "All")] + groups.map { (value: $0, label: ExerciseVocabulary.muscleGroup($0)) }
    }

    private var hasSheetFilters: Bool {
        guard let facets = model.facets.value else { return false }
        return !facets.equipment.isEmpty || !facets.difficulties.isEmpty || facets.categories.count > 1
    }

    private var filtersButton: some View {
        Button {
            showingFilters = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 13, weight: .semibold))
                if model.sheetFilterCount > 0 {
                    Text("\(model.sheetFilterCount)")
                        .font(StudioFont.body(12, weight: .semibold))
                }
            }
            .foregroundStyle(model.sheetFilterCount > 0 ? StudioColor.paper : StudioColor.ink)
            .padding(.horizontal, 14)
            .frame(minWidth: 44, minHeight: 44)
            .background {
                if model.sheetFilterCount > 0 {
                    Capsule(style: .continuous).fill(StudioColor.env0.opacity(0.85))
                } else {
                    Capsule(style: .continuous).fill(.ultraThinMaterial).environment(\.colorScheme, .light)
                        .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.07), lineWidth: 1) }
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.sheetFilterCount > 0 ? "Filters, \(model.sheetFilterCount) on" : "Filters")
    }

    @ViewBuilder
    private var results: some View {
        let items = model.results.value?.items ?? []
        if model.results.isLoading && items.isEmpty {
            LibraryState(title: "Finding exercises…", working: true)
        } else if model.results.errorMessage != nil && items.isEmpty {
            LibraryState(title: "We couldn't load the library.", message: "Check your connection and try again.",
                         action: ("Try again", { model.retry() }))
        } else if items.isEmpty {
            emptyState
        } else {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text(resultsHeading)
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(StudioColor.inkSoft)
                    .padding(.bottom, 2)
                ForEach(Array(items.enumerated()), id: \.element.id) { index, exercise in
                    ExerciseCard(exercise: exercise, trailing: trailing(exercise)) {
                        selectedCount += 1
                        onSelect(exercise)
                    }
                    .studioReveal(index: min(index, 6))
                }
                if model.results.value?.hasMore == true || !model.sourceUnavailable {
                    Button {
                        model.loadMore()
                    } label: {
                        HStack(spacing: 8) {
                            if model.isFetchingMore { ProgressView().tint(StudioColor.ink).controlSize(.small) }
                            Text(model.isFetchingMore ? "Finding more…" : "Show more exercises")
                                .font(StudioFont.body(13, weight: .medium))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .animation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion), value: items.map(\.id))
        }
    }

    private var resultsHeading: String {
        let trimmed = model.term.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return "RESULTS FOR \u{201C}\(trimmed.uppercased())\u{201D}" }
        if let group = model.muscleGroup { return ExerciseVocabulary.muscleGroup(group).uppercased() }
        return "ALL EXERCISES"
    }

    @ViewBuilder
    private var emptyState: some View {
        let trimmed = model.term.trimmingCharacters(in: .whitespaces)
        if model.isFetchingMore {
            LibraryState(title: "Finding exercises…", working: true)
        } else if model.sourceUnavailable && (model.facets.value?.total ?? 0) == 0 {
            LibraryState(title: "The library isn't ready yet.",
                         message: "Exercises appear here as soon as it is. Workouts you've already logged aren't affected.",
                         action: ("Try again", { model.retry() }))
        } else if !trimmed.isEmpty || model.hasFilters {
            LibraryState(title: trimmed.isEmpty ? "No exercises match these filters." : "No exercises match that search.",
                         message: "Try another muscle, movement, or equipment.",
                         action: model.hasFilters ? ("Clear filters", { model.clearFilters() }) : nil)
        } else {
            LibraryState(title: "Search for an exercise to begin.", message: "Try a movement (\u{201C}squat\u{201D}), a muscle (\u{201C}glutes\u{201D}) or equipment (\u{201C}dumbbell\u{201D}).")
        }
    }
}

/// The library's search surface: a glass field with a quiet working state.
private struct LibrarySearchField: View {
    @Binding var text: String
    let isWorking: Bool
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(focused ? StudioColor.ink : StudioColor.inkSoft)
            TextField("", text: $text, prompt: Text("Search exercises").foregroundStyle(StudioColor.inkFaint))
                .font(StudioFont.body(16))
                .foregroundStyle(StudioColor.ink)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if isWorking {
                ProgressView().tint(StudioColor.inkSoft).controlSize(.small)
            } else if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(StudioColor.inkFaint)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, text.isEmpty && !isWorking ? 16 : 4)
        .frame(minHeight: 54)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .light)
                .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).fill(StudioColor.env5.opacity(focused ? 0.34 : 0.2)) }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [Color.white.opacity(0.7), Color.white.opacity(0.1)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
                }
                .shadow(color: StudioColor.env0.opacity(focused ? 0.16 : 0.08), radius: 12, y: 6)
        }
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onTapGesture { focused = true }
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: focused)
    }
}

/// Loading, empty and failure — minimal, in Sombrey's voice.
private struct LibraryState: View {
    let title: String
    var message: String? = nil
    var working = false
    var action: (label: String, run: () -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                if working { ProgressView().tint(StudioColor.ink).controlSize(.small) }
                Text(title)
                    .font(StudioFont.body(16, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let message {
                Text(message)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let action {
                Button(action.label, action: action.run)
                    .font(StudioFont.body(13, weight: .semibold))
                    .foregroundStyle(StudioColor.accentInk)
                    .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 20)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Exercise card

/// An exercise as a Sombrey card: graphite glass, the exercise's mark, then
/// the name, its classification and what it takes. The demonstration itself
/// is on the exercise's page.
struct ExerciseCard<Trailing: View>: View {
    let exercise: LibraryExercise
    let trailing: Trailing
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ExerciseMark(glyph: ExerciseVocabulary.glyph(category: exercise.category, muscleGroup: exercise.muscleGroup))
                VStack(alignment: .leading, spacing: 4) {
                    Text(exercise.classification.uppercased())
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(StudioColor.paperSoft)
                        .lineLimit(1)
                    Text(exercise.name)
                        .font(StudioFont.hero(18, weight: .semibold))
                        .foregroundStyle(StudioColor.paper)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = detailLine {
                        Text(detail)
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.paperFaint)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                trailing
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            .background { GraphiteSurface(cornerRadius: 22) }
            .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(CardPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the exercise")
    }

    private var detailLine: String? {
        let parts = [exercise.equipment.first, exercise.difficulty.map(ExerciseVocabulary.difficulty)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// The cool graphite glass Sombrey uses for instruments — Home's hero bezel
/// language, scaled down for cards.
struct GraphiteSurface: View {
    var cornerRadius: CGFloat = 22

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        ZStack {
            shape.fill(StudioColor.env0.opacity(0.78))
            LinearGradient(colors: [StudioColor.paper.opacity(0.07), .clear], startPoint: .top, endPoint: .center)
                .clipShape(shape)
        }
        .overlay {
            shape.strokeBorder(
                LinearGradient(colors: [StudioColor.paper.opacity(0.18), StudioColor.paper.opacity(0.03)], startPoint: .top, endPoint: .bottom),
                lineWidth: 1)
        }
        .shadow(color: StudioColor.env0.opacity(0.18), radius: 12, y: 6)
    }
}

/// A physical press: the card settles slightly under the finger.
private struct CardPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(configuration.isPressed ? StudioMotion.press : StudioMotion.release, value: configuration.isPressed)
    }
}

/// The card's mark: the exercise's type or muscle group as a quiet glyph
/// on graphite — the same for every exercise in the library.
struct ExerciseMark: View {
    let glyph: String

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        Image(systemName: glyph)
            .font(.system(size: 24, weight: .regular))
            .foregroundStyle(StudioColor.paperSoft)
            .frame(width: 64, height: 64)
            .background(StudioColor.env1.opacity(0.7), in: shape)
            .overlay { shape.strokeBorder(StudioColor.paper.opacity(0.1), lineWidth: 1) }
            .accessibilityHidden(true)
    }
}

// MARK: - Filter sheet

/// Equipment, difficulty and type — the filters beyond muscle — as glass
/// pills, only for values the library actually holds.
private struct LibraryFilterSheet: View {
    @Bindable var model: ExerciseSearchModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let facets = model.facets.value
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let equipment = facets?.equipment, !equipment.isEmpty {
                        group("Equipment", options: equipment.map { ($0.key, $0.label) }, selection: $model.equipment)
                    }
                    if let difficulties = facets?.difficulties, !difficulties.isEmpty {
                        group("Difficulty", options: difficulties.map { ($0, ExerciseVocabulary.difficulty($0)) }, selection: $model.difficulty)
                    }
                    if let categories = facets?.categories, categories.count > 1 {
                        group("Type", options: categories.map { ($0, ExerciseVocabulary.category($0)) }, selection: $model.category)
                    }
                }
                .padding(20)
            }
            .background(StudioColor.env5.ignoresSafeArea())
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        model.equipment = nil
                        model.difficulty = nil
                        model.category = nil
                    }
                    .disabled(model.sheetFilterCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func group(_ title: String, options: [(key: String, label: String)], selection: Binding<String?>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TrainEyebrow(text: title)
            FlowLayout(spacing: 8) {
                ForEach(options, id: \.key) { option in
                    let isOn = selection.wrappedValue == option.key
                    Button {
                        selection.wrappedValue = isOn ? nil : option.key
                    } label: {
                        Text(option.label)
                            .font(StudioFont.body(13, weight: isOn ? .semibold : .medium))
                            .foregroundStyle(isOn ? StudioColor.paper : StudioColor.ink)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .background {
                                if isOn {
                                    Capsule(style: .continuous).fill(StudioColor.env0.opacity(0.85))
                                } else {
                                    Capsule(style: .continuous).fill(.ultraThinMaterial).environment(\.colorScheme, .light)
                                        .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
                                }
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? [.isSelected, .isButton] : .isButton)
                }
            }
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: selection.wrappedValue)
    }
}

/// Wraps pills onto as many lines as they need — no horizontal overflow at
/// any width or text size.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - The library (Train › Exercise Library)

/// Train › Exercise Library: a Sombrey destination — search, muscle tabs,
/// filters, exercise cards; open one, add it to a workout.
struct ExerciseLibraryView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = ExerciseSearchModel()
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        TrainEyebrow(text: "Train")
                        Text("Exercise Library")
                            .font(StudioFont.hero(34, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                        Text("Every movement, clearly explained — and one tap from your next workout.")
                            .font(StudioFont.body(14))
                            .foregroundStyle(StudioColor.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .studioReveal(index: 0)
                    ExerciseSearchPanel(model: model, onSelect: { path.append($0.id) }) { _ in
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(StudioColor.paperFaint)
                            .accessibilityHidden(true)
                    }
                    .studioReveal(index: 1)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .navigationDestination(for: String.self) { id in
                ExerciseDetailView(exerciseId: id) { path.append($0) }
            }
        }
    }
}

/// Choosing an exercise from the library — plans, the session builder and a
/// workout in progress all pick through this.
struct ExercisePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    var title = "Add exercise"
    let onPick: (Exercise) -> Void
    @State private var model = ExerciseSearchModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                ExerciseSearchPanel(model: model, onSelect: { exercise in
                    onPick(exercise.asExercise)
                    dismiss()
                }) { _ in
                    Image(systemName: "plus.circle")
                        .font(.system(size: 22))
                        .foregroundStyle(StudioColor.paper)
                        .accessibilityHidden(true)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}
