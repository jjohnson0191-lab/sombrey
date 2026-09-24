import SwiftUI
import ConvexMobile

// MARK: - Wire shapes

/// One of the user's training plans (`trainingPlans:list`).
struct TrainingPlanDTO: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let source: String
    let days: [Day]
    let isCurrent: Bool
    let nextDayIndex: Double

    struct Day: Decodable, Equatable {
        let name: String
        let weekday: Double?
        let exercises: [Item]
    }

    struct Item: Decodable, Equatable {
        let exerciseId: String
        let sets: Double
        let reps: Double
        let restSeconds: Double?
    }

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, source, days, isCurrent, nextDayIndex
    }

    var nextDay: (index: Int, day: Day)? {
        guard !days.isEmpty else { return nil }
        let index = min(max(Int(nextDayIndex), 0), days.count - 1)
        return (index, days[index])
    }
}

/// A completed workout of any origin (`sombreyWorkouts:listHistory`).
struct WorkoutHistoryDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let startedAt: Double
    let completedAt: Double?
    let durationSeconds: Double?
    let source: String
    let activityType: String?
    let distanceMeters: Double?
    let userReportedCalories: Double?
    let sportPlusSessionId: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, startedAt, completedAt, durationSeconds, source, activityType, distanceMeters, userReportedCalories, sportPlusSessionId
    }
}

/// A Sport+ session (`sportPlusSessions:getRecentSessions`) — started on
/// the band or from Sombrey. Every measurement is optional: absent means
/// the band didn't report it.
struct SportSessionHistoryDTO: Decodable, Identifiable, Equatable {
    let id: String
    let startedAt: Double
    let endedAt: Double?
    let durationSeconds: Double?
    let sportType: Int?
    let calories: Double?
    let distanceMeters: Double?
    let recordSource: String?
    let summarySource: String?
    let activityKey: String?
    let activityCategory: String?
    let averageHeartRate: Double?
    let lowestHeartRate: Double?
    let highestHeartRate: Double?
    let averageSpeedMetersPerSecond: Double?
    let fastestSpeedMetersPerSecond: Double?
    let steps: Double?
    let stepFrequency: Double?
    let actionCount: Double?
    let averageAltitudeMeters: Double?
    let climbMeters: Double?
    let descentMeters: Double?
    let bandStartTimeSec: Double?
    let bandDurationRaw: Double?
    let timestampSuspect: Bool?
    let importedAt: Double?
    let appActiveSeconds: Double?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case startedAt, endedAt, durationSeconds, sportType, calories, distanceMeters, recordSource, summarySource
        case activityKey, activityCategory, averageHeartRate, lowestHeartRate, highestHeartRate
        case averageSpeedMetersPerSecond, fastestSpeedMetersPerSecond, steps, stepFrequency, actionCount
        case averageAltitudeMeters, climbMeters, descentMeters, bandStartTimeSec, bandDurationRaw, timestampSuspect, importedAt
        case appActiveSeconds
    }

    /// In progress (app-started, not stopped, no band record yet).
    var isOpen: Bool { endedAt == nil && bandStartTimeSec == nil }
}

/// Exercise detail for the library (`exercises:list`).
struct ExerciseDetailDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let muscleGroup: String
    let equipment: [String]
    let primaryMuscles: [String]
    let secondaryMuscles: [String]
    let instructions: [String]

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, description, muscleGroup, equipment, primaryMuscles, secondaryMuscles, instructions
    }

    var asExercise: Exercise { Exercise(id: id, name: name, description: description, muscleGroup: muscleGroup) }
}

/// The AI-generated plan (`premiumOnboarding:getMyAiPlan`), read-only.
struct AIGeneratedPlanDTO: Decodable {
    let status: String?
    let workoutSplit: String?
    let workoutDays: [Day]?

    struct Day: Decodable {
        let dayName: String
        let exercises: [Item]
    }

    struct Item: Decodable {
        let name: String
        let sets: Double
        let reps: String
    }
}

/// Merged, de-duplicated training history across Sombrey workouts (built,
/// plan, repeated), manually logged workouts and band Sport+ sessions. A
/// Sport+ session already attached to a Sombrey workout appears once — as
/// that workout — never twice.
enum WorkoutHistory {
    enum Origin: Equatable {
        case sombrey, plan, manual(String), band, appSport
    }

    struct Entry: Identifiable, Equatable {
        let id: String
        let title: String
        let startedAt: Date
        let durationSeconds: Int?
        let origin: Origin
        let detail: String?
    }

    static func merge(workouts: [WorkoutHistoryDTO], sessions: [SportSessionHistoryDTO], sportName: (Int) -> String) -> [Entry] {
        let attached = Set(workouts.compactMap(\.sportPlusSessionId))
        var entries: [Entry] = workouts.map { workout in
            let origin: Origin
            switch workout.source {
            case "manual": origin = .manual(workout.activityType ?? "other")
            case "plan": origin = .plan
            default: origin = .sombrey
            }
            var details: [String] = []
            if let meters = workout.distanceMeters, meters > 0 { details.append(String(format: "%.2f km", meters / 1000)) }
            if let kcal = workout.userReportedCalories, kcal > 0 { details.append("\(Int(kcal)) kcal (your figure)") }
            return Entry(
                id: workout.id,
                title: workout.name,
                startedAt: Date(timeIntervalSince1970: workout.startedAt / 1000),
                durationSeconds: workout.durationSeconds.map { Int($0) },
                origin: origin,
                detail: details.isEmpty ? nil : details.joined(separator: " · ")
            )
        }
        for session in sessions where !attached.contains(session.id) && !session.isOpen {
            var details: [String] = []
            if let meters = session.distanceMeters, meters > 0 { details.append(String(format: "%.2f km", meters / 1000)) }
            if let kcal = session.calories, kcal > 0 { details.append("\(Int(kcal)) kcal (band)") }
            if let hr = session.averageHeartRate, session.summarySource == "band_record" { details.append("avg \(Int(hr)) bpm") }
            entries.append(Entry(
                id: session.id,
                title: sportName(session.sportType ?? 0),
                startedAt: Date(timeIntervalSince1970: session.startedAt / 1000),
                durationSeconds: session.durationSeconds.map { Int($0) },
                origin: session.recordSource == "app" ? .appSport : .band,
                detail: details.isEmpty ? nil : details.joined(separator: " · ")
            ))
        }
        return entries.sorted { $0.startedAt > $1.startedAt }
    }
}

// MARK: - Training plans

struct TrainingPlansView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: TrainingSessionManager
    @State private var plans = ConvexQuery<[TrainingPlanDTO]>()
    @State private var editing: PlanEditorTarget?
    @State private var deleting: TrainingPlanDTO?

    enum PlanEditorTarget: Identifiable {
        case new
        case edit(TrainingPlanDTO)
        var id: String {
            switch self {
            case .new: return "new"
            case .edit(let plan): return plan.id
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Build your own plan, or follow one Sombrey creates. Plans you make are yours — Sombrey never replaces them.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                    if plans.isLoading {
                        ProgressView().tint(StudioColor.ink)
                    } else if let list = plans.value, !list.isEmpty {
                        ForEach(list) { plan in
                            planRow(plan)
                        }
                    } else {
                        Text("No plans yet.")
                            .font(StudioFont.body(14))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    Button {
                        editing = .new
                    } label: {
                        Text("New plan").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .padding(.top, 8)
                }
                .padding(24)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Training plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { plans.subscribe(to: "trainingPlans:list") }
        .sheet(item: $editing) { target in
            switch target {
            case .new: PlanEditorView(plan: nil)
            case .edit(let plan): PlanEditorView(plan: plan)
            }
        }
        .confirmationDialog("Delete this plan?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete \(deleting?.name ?? "plan")", role: .destructive) {
                if let plan = deleting {
                    Task { try? await ConvexClientProvider.client.mutation("trainingPlans:remove", with: ["planId": plan.id]) }
                }
                deleting = nil
            }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: {
            Text("Workouts you've already done from it stay in your history.")
        }
    }

    private func planRow(_ plan: TrainingPlanDTO) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(plan.name)
                    .font(StudioFont.body(16, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                if plan.isCurrent {
                    Text("CURRENT")
                        .font(StudioFont.body(9, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.accentInk)
                }
                if plan.source == "sombrey" {
                    Text("BY SOMBREY")
                        .font(StudioFont.body(9, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.inkSoft)
                }
                Spacer()
                Menu {
                    if !plan.isCurrent {
                        Button("Make current") {
                            Task { try? await ConvexClientProvider.client.mutation("trainingPlans:setCurrent", with: ["planId": plan.id]) }
                        }
                    }
                    Button("Edit") { editing = .edit(plan) }
                    Button("Delete", role: .destructive) { deleting = plan }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Plan options")
            }
            Text(plan.days.map(\.name).joined(separator: " · "))
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
            if let next = plan.nextDay {
                Text("Next: \(next.day.name)")
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
            }
        }
        .studioCard()
    }
}

/// Create or edit a plan: name, days (optionally tied to a weekday), and
/// each day's exercises with sets, reps and rest.
struct PlanEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let plan: TrainingPlanDTO?

    @State private var name: String
    @State private var days: [EditableDay]
    @State private var exerciseNames: [String: String] = [:]
    @State private var resolver = ConvexQuery<[Exercise]>()
    @State private var pickingForDay: Int?
    @State private var isSaving = false
    @State private var saveError: String?

    struct EditableItem: Identifiable, Equatable {
        let id = UUID()
        var exerciseId: String
        var sets: Int
        var reps: Int
        var restSeconds: Int
    }

    struct EditableDay: Identifiable, Equatable {
        let id = UUID()
        var name: String
        var weekday: Int?
        var items: [EditableItem]
    }

    init(plan: TrainingPlanDTO?) {
        self.plan = plan
        _name = State(initialValue: plan?.name ?? "")
        _days = State(initialValue: plan?.days.map { day in
            EditableDay(name: day.name, weekday: day.weekday.map { Int($0) }, items: day.exercises.map {
                EditableItem(exerciseId: $0.exerciseId, sets: Int($0.sets), reps: Int($0.reps), restSeconds: Int($0.restSeconds ?? 90))
            })
        } ?? [EditableDay(name: "Day 1", weekday: nil, items: [])])
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !days.isEmpty && days.allSatisfy { !$0.items.isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Plan") {
                    TextField("Plan name", text: $name)
                }
                ForEach($days) { $day in
                    Section {
                        TextField("Day name", text: $day.name)
                        Picker("Day of week", selection: $day.weekday) {
                            Text("Any day").tag(Int?.none)
                            ForEach(1...7, id: \.self) { weekday in
                                Text(Calendar.current.weekdaySymbols[weekday - 1]).tag(Int?.some(weekday))
                            }
                        }
                        ForEach($day.items) { $item in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(exerciseNames[item.exerciseId] ?? "Exercise")
                                    .font(StudioFont.body(15, weight: .medium))
                                Stepper("\(item.sets) sets", value: $item.sets, in: 1...20)
                                Stepper("\(item.reps) reps", value: $item.reps, in: 1...100)
                                Stepper("Rest \(TrainingMath.clock(item.restSeconds))", value: $item.restSeconds, in: 0...600, step: 15)
                            }
                            .padding(.vertical, 4)
                        }
                        .onDelete { offsets in day.items.remove(atOffsets: offsets) }
                        Button("Add exercise") {
                            pickingForDay = days.firstIndex(where: { $0.id == day.id })
                        }
                        if days.count > 1 {
                            Button("Remove this day", role: .destructive) {
                                let dayId = day.id
                                days.removeAll { $0.id == dayId }
                            }
                        }
                    } header: {
                        Text(day.name.isEmpty ? "Day" : day.name)
                    }
                }
                Section {
                    Button("Add day") {
                        days.append(EditableDay(name: "Day \(days.count + 1)", weekday: nil, items: []))
                    }
                }
                if let saveError {
                    Section { Text(saveError).foregroundStyle(StudioColor.danger) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle(plan == nil ? "New plan" : "Edit plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save", action: save).disabled(!canSave || isSaving)
                }
            }
        }
        .task {
            let ids = days.flatMap { $0.items.map(\.exerciseId) }
            guard !ids.isEmpty else { return }
            resolver.subscribe(to: "exercises:getMany", with: ["ids": ids.map { $0 as ConvexEncodable? }])
        }
        .onChange(of: resolver.value) { _, rows in
            for exercise in rows ?? [] { exerciseNames[exercise.id] = exercise.name }
        }
        .sheet(item: Binding(get: { pickingForDay.map { PickTarget(dayIndex: $0) } }, set: { pickingForDay = $0?.dayIndex })) { target in
            ExercisePickerView { exercise in
                exerciseNames[exercise.id] = exercise.name
                guard days.indices.contains(target.dayIndex) else { return }
                days[target.dayIndex].items.append(EditableItem(exerciseId: exercise.id, sets: 3, reps: 10, restSeconds: 90))
            }
        }
    }

    private struct PickTarget: Identifiable {
        let dayIndex: Int
        var id: Int { dayIndex }
    }

    private func save() {
        isSaving = true
        saveError = nil
        // Only plain values cross into the Task; the Convex payload (not
        // Sendable) is built inside it.
        let planId = plan?.id
        let planName = name
        let editedDays = days
        Task {
            let payload: [ConvexEncodable?] = editedDays.map { day in
                PlanDayPayload(
                    name: day.name.trimmingCharacters(in: .whitespaces).isEmpty ? "Day" : day.name,
                    weekday: day.weekday,
                    exercises: day.items.map { PlanItemPayload(exerciseId: $0.exerciseId, sets: $0.sets, reps: $0.reps, restSeconds: $0.restSeconds) }
                ) as ConvexEncodable?
            }
            do {
                if let planId {
                    try await ConvexClientProvider.client.mutation("trainingPlans:update", with: ["planId": planId, "name": planName, "days": payload])
                } else {
                    let _: String = try await ConvexClientProvider.client.mutation("trainingPlans:create", with: ["name": planName, "days": payload])
                }
                dismiss()
            } catch {
                saveError = "Couldn't save the plan: \(error)"
            }
            isSaving = false
        }
    }
}

private struct PlanItemPayload: Encodable, ConvexEncodable {
    let exerciseId: String
    let sets: Int
    let reps: Int
    let restSeconds: Int

    enum CodingKeys: String, CodingKey { case exerciseId, sets, reps, restSeconds }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(exerciseId, forKey: .exerciseId)
        try container.encode(Double(sets), forKey: .sets)
        try container.encode(Double(reps), forKey: .reps)
        try container.encode(Double(restSeconds), forKey: .restSeconds)
    }
}

private struct PlanDayPayload: Encodable, ConvexEncodable {
    let name: String
    let weekday: Int?
    let exercises: [PlanItemPayload]

    enum CodingKeys: String, CodingKey { case name, weekday, exercises }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        if let weekday { try container.encode(Double(weekday), forKey: .weekday) }
        try container.encode(exercises, forKey: .exercises)
    }
}

/// Searchable picker over Sombrey's exercise library.
struct ExercisePickerView: View {
    @Environment(\.dismiss) private var dismiss
    let onPick: (Exercise) -> Void
    @State private var exercises = ConvexQuery<[Exercise]>()
    @State private var searchTerm = ""

    var body: some View {
        NavigationStack {
            List {
                if exercises.value?.isEmpty == true {
                    Text("The exercise library is empty right now.")
                        .foregroundStyle(StudioColor.inkFaint)
                }
                ForEach(exercises.value ?? []) { exercise in
                    Button {
                        onPick(exercise)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(exercise.name).foregroundStyle(StudioColor.ink)
                            Text(exercise.muscleGroup.capitalized)
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                    }
                }
            }
            .searchable(text: $searchTerm)
            .onChange(of: searchTerm) { _, newValue in
                exercises.subscribe(to: "exercises:list", with: ["searchTerm": newValue])
            }
            .navigationTitle("Add exercise")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .task { exercises.subscribe(to: "exercises:list") }
    }
}

// MARK: - Log a workout

/// A workout done outside Sombrey/Sport+, entered afterwards. Saved as
/// user-entered data (source "manual") so it joins training history for
/// the AI and future training-load systems — never presented as band data.
struct LogWorkoutView: View {
    @Environment(\.dismiss) private var dismiss

    enum ActivityKind: String, CaseIterable, Identifiable {
        case gym, run, cycle, walk, swim, other
        var id: String { rawValue }
        var title: String {
            switch self {
            case .gym: return "Gym workout"
            case .run: return "Run"
            case .cycle: return "Ride"
            case .walk: return "Walk"
            case .swim: return "Swim"
            case .other: return "Other exercise"
            }
        }
        var hasDistance: Bool { self == .run || self == .cycle || self == .walk || self == .swim }
    }

    @State private var kind: ActivityKind = .gym
    @State private var name = ""
    @State private var startedAt = Date().addingTimeInterval(-3600)
    @State private var durationMinutes = 45
    @State private var distanceKm = ""
    @State private var calories = ""
    @State private var notes = ""
    @State private var isSaving = false
    @State private var saveError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Activity", selection: $kind) {
                        ForEach(ActivityKind.allCases) { Text($0.title).tag($0) }
                    }
                    TextField("Name (optional)", text: $name)
                    DatePicker("Started", selection: $startedAt, in: ...Date())
                    Stepper("\(durationMinutes) min", value: $durationMinutes, in: 1...600, step: 5)
                }
                if kind.hasDistance {
                    Section("Distance") {
                        TextField("Kilometres (optional)", text: $distanceKm).keyboardType(.decimalPad)
                    }
                }
                Section {
                    TextField("Calories (optional)", text: $calories).keyboardType(.numberPad)
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                } footer: {
                    Text("Saved as entered by you — it's never shown as band data. Calories are only your own figure (for example, from another device).")
                }
                if let saveError {
                    Section { Text(saveError).foregroundStyle(StudioColor.danger) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Log a workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(isSaving ? "Saving…" : "Save", action: save).disabled(isSaving) }
            }
        }
    }

    private func save() {
        isSaving = true
        saveError = nil
        // Only plain values cross into the Task; the Convex arguments (not
        // Sendable) are built inside it.
        let workoutName = name.trimmingCharacters(in: .whitespaces).isEmpty ? kind.title : name
        let activityType = kind.rawValue
        let startedAtMs = startedAt.timeIntervalSince1970 * 1000
        let durationSeconds = Double(durationMinutes * 60)
        let distanceMeters: Double? = kind.hasDistance
            ? Double(distanceKm.replacingOccurrences(of: ",", with: ".")).flatMap { $0 > 0 ? $0 * 1000 : nil }
            : nil
        let reportedCalories: Double? = Double(calories).flatMap { $0 > 0 ? $0 : nil }
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            var args: [String: ConvexEncodable?] = [
                "name": workoutName,
                "activityType": activityType,
                "startedAt": startedAtMs,
                "durationSeconds": durationSeconds,
            ]
            if let distanceMeters { args["distanceMeters"] = distanceMeters }
            if let reportedCalories { args["userReportedCalories"] = reportedCalories }
            if !trimmedNotes.isEmpty { args["notes"] = trimmedNotes }
            do {
                let _: String = try await ConvexClientProvider.client.mutation("sombreyWorkouts:logManualWorkout", with: args)
                dismiss()
            } catch {
                saveError = "Couldn't save: \(error)"
            }
            isSaving = false
        }
    }
}

// MARK: - History

struct WorkoutHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(WearableManager.self) private var wearableManager
    @State private var workouts = ConvexQuery<[WorkoutHistoryDTO]>()
    @State private var sessions = ConvexQuery<[SportSessionHistoryDTO]>()
    @State private var selectedSession: SportSessionHistoryDTO?
    @State private var isSyncing = false

    private var entries: [WorkoutHistory.Entry] {
        WorkoutHistory.merge(workouts: workouts.value ?? [], sessions: sessions.value ?? []) { raw in
            ActivityCatalog.resolve(activityKey: nil, vendorSportType: raw)?.name ?? "Activity"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    bandSyncRow
                    if workouts.isLoading && sessions.isLoading {
                        ProgressView().tint(StudioColor.ink)
                    } else if entries.isEmpty {
                        Text("No workouts yet. Workouts you train in Sombrey, log yourself, or record on the band appear here.")
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    ForEach(entries) { entry in
                        HistoryRow(entry: entry)
                            .onTapGesture {
                                selectedSession = sessions.value?.first { $0.id == entry.id }
                            }
                    }
                }
                .padding(24)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Workout history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task {
            workouts.subscribe(to: "sombreyWorkouts:listHistory", with: ["limit": 60.0])
            sessions.subscribe(to: "sportPlusSessions:getRecentSessions", with: ["limit": 60.0])
        }
        .sheet(item: $selectedSession) { session in
            SportSessionDetailView(session: session)
                .presentationDetents([.medium, .large])
        }
    }

    /// Pull band-recorded Sport+ sessions now, and say what the last
    /// import found — sessions done on the band also arrive on every sync.
    private var bandSyncRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                isSyncing = true
                Task {
                    await wearableManager.importBandSportSessions(reason: "manual")
                    isSyncing = false
                }
            } label: {
                Text(isSyncing ? "Syncing band activities…" : "Sync band activities")
                    .font(StudioFont.body(14, weight: .semibold))
                    .foregroundStyle(StudioColor.accentInk)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .disabled(isSyncing || wearableManager.displayState != .connected)
            if let status = wearableManager.lastSportImport {
                Text(status.error.map { "Last band sync failed: \($0)" }
                     ?? "Last band sync \(status.at.formatted(.dateTime.hour().minute())): \(status.fetched) found · \(status.inserted) new · \(status.merged) matched · \(status.skipped) skipped")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
            } else if wearableManager.displayState != .connected {
                Text("Connect the band to sync activities recorded on it.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    static func originLabel(_ origin: WorkoutHistory.Origin) -> String {
        switch origin {
        case .sombrey: return "SOMBREY"
        case .plan: return "PLAN"
        case .manual(let type): return "LOGGED · \(type.uppercased())"
        case .band: return "BAND ACTIVITY"
        case .appSport: return "ACTIVITY"
        }
    }
}

// MARK: - Exercise library

/// Sombrey's exercise library. Its content may come from an exercise-data
/// provider behind the scenes; the user only ever sees Sombrey's library.
struct ExerciseLibraryView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var exercises = ConvexQuery<[ExerciseDetailDTO]>()
    @State private var searchTerm = ""
    @State private var selected: ExerciseDetailDTO?

    var body: some View {
        NavigationStack {
            List {
                if exercises.value?.isEmpty == true {
                    Text("The exercise library is empty right now.")
                        .foregroundStyle(StudioColor.inkFaint)
                }
                ForEach(exercises.value ?? []) { exercise in
                    Button { selected = exercise } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(exercise.name).foregroundStyle(StudioColor.ink)
                            Text(([exercise.muscleGroup.capitalized] + exercise.equipment).joined(separator: " · "))
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                    }
                }
            }
            .searchable(text: $searchTerm)
            .onChange(of: searchTerm) { _, newValue in
                exercises.subscribe(to: "exercises:list", with: ["searchTerm": newValue])
            }
            .navigationTitle("Exercise library")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { exercises.subscribe(to: "exercises:list") }
        .sheet(item: $selected) { exercise in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(exercise.name)
                        .font(StudioFont.hero(24, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    if !exercise.primaryMuscles.isEmpty {
                        Text("Muscles · " + (exercise.primaryMuscles + exercise.secondaryMuscles).joined(separator: ", "))
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                    if !exercise.equipment.isEmpty {
                        Text("Equipment · " + exercise.equipment.joined(separator: ", "))
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                    if !exercise.description.isEmpty {
                        Text(exercise.description)
                            .font(StudioFont.body(14))
                            .foregroundStyle(StudioColor.ink)
                    }
                    ForEach(Array(exercise.instructions.enumerated()), id: \.offset) { index, step in
                        Text("\(index + 1). \(step)")
                            .font(StudioFont.body(14))
                            .foregroundStyle(StudioColor.ink)
                    }
                }
                .padding(24)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .presentationDetents([.medium, .large])
        }
    }
}

// MARK: - Sombrey workouts

/// Sombrey-generated workouts: the AI plan, when one exists — read here
/// exactly as generated. Nothing is generated from this screen, and no
/// workout is invented when there's no plan.
struct SombreyWorkoutsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var plan = ConvexQuery<AIGeneratedPlanDTO?>()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if plan.isLoading {
                        ProgressView().tint(StudioColor.ink)
                    } else if let ai = plan.value ?? nil, ai.status == "ready", let days = ai.workoutDays, !days.isEmpty {
                        HStack(spacing: 8) {
                            Text(ai.workoutSplit ?? "Your Sombrey plan")
                                .font(StudioFont.hero(22, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                            AiDisclosureBadge()
                        }
                        ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(day.dayName)
                                    .font(StudioFont.body(15, weight: .semibold))
                                    .foregroundStyle(StudioColor.ink)
                                ForEach(Array(day.exercises.enumerated()), id: \.offset) { _, item in
                                    Text("\(item.name) · \(Int(item.sets)) × \(item.reps)")
                                        .font(StudioFont.body(13))
                                        .foregroundStyle(StudioColor.inkSoft)
                                }
                            }
                            .studioCard()
                        }
                    } else {
                        Text("Sombrey-generated workouts appear here once Sombrey has built a plan for you. Until then, build your own plan or start a session yourself — nothing is generated without your data.")
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                }
                .padding(24)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Sombrey workouts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { plan.subscribe(to: "premiumOnboarding:getMyAiPlan") }
    }
}

/// One history line: title, when, detail, duration and where it came from.
private struct HistoryRow: View {
    let entry: WorkoutHistory.Entry

    private var isSportSession: Bool { entry.origin == .band || entry.origin == .appSport }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            titleColumn
            Spacer()
            trailingColumn
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle().fill(StudioColor.ink.opacity(0.07)).frame(height: 1)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSportSession ? .isButton : [])
    }

    private var titleColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.title)
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
            Text(entry.startedAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkSoft)
            if let detail = entry.detail {
                Text(detail)
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }

    private var trailingColumn: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if let seconds = entry.durationSeconds {
                Text(TrainingMath.clock(seconds))
                    .font(StudioFont.body(13, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
            }
            Text(WorkoutHistoryView.originLabel(entry.origin))
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
        }
    }
}

/// Everything Sombrey holds for one band-recorded activity — what the band
/// measured, what it didn't ("Not measured", never a zero), where each
/// figure came from, and (tucked at the end) the band's raw timing, kept
/// for verifying the band's clock.
struct SportSessionDetailView: View {
    let session: SportSessionHistoryDTO
    @Environment(\.dismiss) private var dismiss

    private var activity: SombreyActivity? {
        ActivityCatalog.resolve(activityKey: session.activityKey, vendorSportType: session.sportType)
    }

    private var sportName: String {
        activity?.name ?? session.sportType.flatMap { SombreySportType.byRawValue[$0]?.displayName } ?? "Activity"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(sportName)
                            .font(StudioFont.hero(26, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                        if let group = activity.flatMap({ a in ActivityCatalog.groups.first { $0.id == a.group } }) {
                            Text(group.name)
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        Text(provenance)
                            .font(StudioFont.body(12, weight: .medium))
                            .foregroundStyle(StudioColor.accentInk)
                    }
                    if session.timestampSuspect == true {
                        Text("The band's time for this session looks wrong (it ends in the future). It's shown exactly as the band reported it.")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.danger)
                    }
                    group("SESSION") {
                        line("Started", Date(timeIntervalSince1970: session.startedAt / 1000).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute().second()))
                        line("Duration", session.durationSeconds.map { TrainingMath.clock(Int($0)) })
                        if let appActiveSeconds = session.appActiveSeconds {
                            line("Active time (timed by Sombrey)", TrainingMath.clock(Int(appActiveSeconds)))
                        }
                    }
                    group("HEART RATE") {
                        line("Lowest", hr(session.lowestHeartRate))
                        line("Average", hr(session.averageHeartRate))
                        line("Highest", hr(session.highestHeartRate))
                    }
                    group("MOVEMENT & ENERGY") {
                        line("Calories", session.calories.map { "\(Int($0.rounded())) kcal" })
                        line("Distance", session.distanceMeters.map { String(format: "%.2f km", $0 / 1000) })
                        line("Steps", session.steps.map { "\(Int($0))" })
                        line("Step frequency", session.stepFrequency.map { "\(Int($0)) /min" })
                        line("Actions", session.actionCount.map { "\(Int($0))" })
                        line("Average speed", session.averageSpeedMetersPerSecond.map { String(format: "%.2f m/s", $0) })
                        line("Fastest speed", session.fastestSpeedMetersPerSecond.map { String(format: "%.2f m/s", $0) })
                        line("Average altitude", session.averageAltitudeMeters.map { "\(Int($0)) m" })
                        line("Climb / descent", session.climbMeters.map { c in "\(Int(c)) m / \(session.descentMeters.map { "\(Int($0)) m" } ?? "—")" })
                    }
                    group("RECORDING DETAILS") {
                        line("Figures from", summarySourceText)
                        line("Band start (raw)", session.bandStartTimeSec.map { String(format: "%.0f", $0) })
                        line("Band duration (raw)", session.bandDurationRaw.map { String(format: "%.0f", $0) })
                        line("Imported", session.importedAt.map { Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.month(.abbreviated).day().hour().minute()) })
                    }
                }
                .padding(24)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private var provenance: String {
        switch session.recordSource {
        case "band": return "Recorded on the band"
        case "app": return "Started from Sombrey, recorded by the band"
        default: return "Recorded by the band"
        }
    }

    private var summarySourceText: String {
        switch session.summarySource {
        case "band_record": return "Your band's full record"
        case "live_final_tick": return "Your band's last live update (full record not in yet)"
        default: return "—"
        }
    }

    private func hr(_ value: Double?) -> String? {
        // Heart-rate statistics are only real when they came from the
        // band's own record.
        guard session.summarySource == "band_record", let value else { return nil }
        return "\(Int(value)) bpm"
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            content()
        }
    }

    private func line(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
            Spacer()
            Text(value ?? "Not measured")
                .font(StudioFont.body(13, weight: value == nil ? .regular : .semibold))
                .foregroundStyle(value == nil ? StudioColor.inkFaint : StudioColor.ink)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}
