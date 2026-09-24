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

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, description, muscleGroup, primaryMuscles, equipment, difficulty, category, hasMedia
    }

    /// The session/plan model's exercise value.
    var asExercise: Exercise {
        Exercise(id: id, name: name, description: description, muscleGroup: muscleGroup,
                 primaryMuscles: primaryMuscles, equipment: equipment, difficulty: difficulty)
    }

    /// "Glutes · Barbell" — the row's second line.
    var summaryLine: String {
        ([primaryMuscles.first ?? ExerciseVocabulary.muscleGroup(muscleGroup)] + equipment.prefix(1)).joined(separator: " · ")
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

// MARK: - Search panel (shared)

/// The Sombrey Exercise Library's search surface — used by the library, the
/// session builder, plan editing and adding an exercise mid-workout. What a
/// row does is the caller's (`trailing` + `onSelect`).
struct ExerciseSearchPanel<Trailing: View>: View {
    @Bindable var model: ExerciseSearchModel
    let onSelect: (LibraryExercise) -> Void
    @ViewBuilder var trailing: (LibraryExercise) -> Trailing
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            searchField
            filterBar
            content
        }
        .task { model.start() }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(StudioColor.inkSoft)
            TextField("Search exercises, muscles, equipment", text: $model.term)
                .font(StudioFont.body(15))
                .foregroundStyle(StudioColor.ink)
                .focused($searchFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !model.term.isEmpty {
                Button {
                    model.term = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(StudioColor.inkFaint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
    }

    private var filterBar: some View {
        let facets = model.facets.value
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterPill(title: "Muscle", value: model.muscleGroup.map(ExerciseVocabulary.muscleGroup),
                           options: (facets?.muscleGroups ?? ["chest", "back", "shoulders", "arms", "legs", "core", "cardio"]).map { ($0, ExerciseVocabulary.muscleGroup($0)) },
                           selection: $model.muscleGroup)
                if let equipment = facets?.equipment, !equipment.isEmpty {
                    FilterPill(title: "Equipment", value: equipment.first { $0.key == model.equipment }?.label,
                               options: equipment.map { ($0.key, $0.label) }, selection: $model.equipment)
                }
                if let difficulties = facets?.difficulties, !difficulties.isEmpty {
                    FilterPill(title: "Difficulty", value: model.difficulty.map(ExerciseVocabulary.difficulty),
                               options: difficulties.map { ($0, ExerciseVocabulary.difficulty($0)) }, selection: $model.difficulty)
                }
                if let categories = facets?.categories, !categories.isEmpty {
                    FilterPill(title: "Type", value: model.category.map(ExerciseVocabulary.category),
                               options: categories.map { ($0, ExerciseVocabulary.category($0)) }, selection: $model.category)
                }
                if model.hasFilters {
                    Button("Clear") { model.clearFilters() }
                        .font(StudioFont.body(12, weight: .medium))
                        .foregroundStyle(StudioColor.inkSoft)
                        .frame(minHeight: 36)
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
        .sensoryFeedback(StudioHaptic.focus, trigger: [model.muscleGroup, model.equipment, model.difficulty, model.category].compactMap { $0 })
    }

    @ViewBuilder
    private var content: some View {
        let items = model.results.value?.items ?? []
        if model.results.isLoading && items.isEmpty {
            HStack(spacing: 10) {
                ProgressView().tint(StudioColor.ink)
                Text("Searching the library…")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .frame(maxWidth: .infinity, minHeight: 80)
        } else if model.results.errorMessage != nil && items.isEmpty {
            LibraryMessage(title: "Couldn't reach the exercise library",
                           text: "Check your connection — the library comes back as soon as you're online.")
        } else if items.isEmpty {
            emptyState
        } else {
            VStack(spacing: 0) {
                ForEach(items) { exercise in
                    ExerciseRow(exercise: exercise, trailing: trailing(exercise)) { onSelect(exercise) }
                    Divider().overlay(StudioColor.ink.opacity(0.07))
                }
                if model.results.value?.hasMore == true || !model.sourceUnavailable {
                    Button {
                        model.loadMore()
                    } label: {
                        HStack(spacing: 8) {
                            if model.isFetchingMore { ProgressView().tint(StudioColor.ink) }
                            Text("Show more")
                                .font(StudioFont.body(13, weight: .medium))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.plain)
                }
            }
            .studioCard()
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let trimmed = model.term.trimmingCharacters(in: .whitespaces)
        if model.isFetchingMore {
            HStack(spacing: 10) {
                ProgressView().tint(StudioColor.ink)
                Text(trimmed.isEmpty ? "Loading exercises…" : "Looking for \u{201C}\(trimmed)\u{201D}…")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .frame(maxWidth: .infinity, minHeight: 80)
        } else if model.sourceUnavailable && (model.facets.value?.total ?? 0) == 0 {
            LibraryMessage(title: "The exercise library isn't available yet",
                           text: "Exercises will appear here as soon as the library is ready. Workouts you've already logged are unaffected.")
        } else if !trimmed.isEmpty || model.hasFilters {
            LibraryMessage(title: "No exercises match",
                           text: trimmed.isEmpty ? "Try fewer filters." : "Try another name, a muscle (\u{201C}glutes\u{201D}) or equipment (\u{201C}dumbbell\u{201D}).")
        } else {
            LibraryMessage(title: "The exercise library is empty",
                           text: model.sourceUnavailable ? "Exercises will appear here as soon as the library is ready." : "Search for an exercise to begin.")
        }
    }
}

private struct LibraryMessage: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(StudioFont.body(15, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text(text)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .studioCard()
    }
}

/// A filter as a glass pill with a menu of the values the library holds.
private struct FilterPill: View {
    let title: String
    let value: String?
    let options: [(key: String, label: String)]
    @Binding var selection: String?

    var body: some View {
        Menu {
            Button("Any \(title.lowercased())") { selection = nil }
            ForEach(options, id: \.key) { option in
                Button {
                    selection = option.key
                } label: {
                    if selection == option.key { Label(option.label, systemImage: "checkmark") } else { Text(option.label) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(value ?? title)
                    .font(StudioFont.body(13, weight: .medium))
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(value == nil ? StudioColor.ink : StudioColor.paper)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .background {
                if value == nil {
                    Capsule(style: .continuous).fill(.ultraThinMaterial)
                        .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
                } else {
                    Capsule(style: .continuous).fill(StudioColor.env0.opacity(0.85))
                }
            }
        }
        .accessibilityLabel(value.map { "\(title): \($0)" } ?? title)
    }
}

private struct ExerciseRow<Trailing: View>: View {
    let exercise: LibraryExercise
    let trailing: Trailing
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(exercise.name)
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        Text(exercise.summaryLine)
                        if let difficulty = exercise.difficulty {
                            Text("·")
                            Text(ExerciseVocabulary.difficulty(difficulty))
                        }
                    }
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .lineLimit(1)
                }
                Spacer(minLength: 8)
                trailing
            }
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The library (Train › Exercise Library)

/// Train › Exercise Library: search, filter, open an exercise, add it to a
/// workout or plan.
struct ExerciseLibraryView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = ExerciseSearchModel()
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Exercise Library")
                        .font(StudioFont.hero(30, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    ExerciseSearchPanel(model: model, onSelect: { path.append($0.id) }) { _ in
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                .padding(20)
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
                        .font(.system(size: 20))
                        .foregroundStyle(StudioColor.accentInk)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(StudioColor.env5.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}
