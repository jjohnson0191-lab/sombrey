import SwiftUI
import ConvexMobile

/// Train — two related modes of the same instrument:
///
/// - TRAINING: structured exercise — plans, built sessions, logged
///   workouts, the exercise library and history (`TrainingModeView`).
/// - ACTIVITY: what the user physically does in the real world — Tennis,
///   a run, a round of golf (`ActivityModeView`).
///
/// They are never collapsed into one "workout" concept. The mode pill
/// remembers the last choice.
struct TrainOverviewView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var session: TrainingSessionManager
    @AppStorage("sombreyTrain.mode") private var modeRaw = TrainMode.training.rawValue

    private var mode: Binding<TrainMode> {
        Binding(get: { TrainMode(rawValue: modeRaw) ?? .training }, set: { modeRaw = $0.rawValue })
    }

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainOverview, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Train")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)
                    .studioReveal(index: 0)

                TrainModePills(selection: mode)
                    .studioReveal(index: 1)

                Group {
                    switch mode.wrappedValue {
                    case .training:
                        TrainingModeView(session: session)
                            .transition(.opacity.combined(with: .offset(x: reduceMotion ? 0 : -12)))
                    case .activity:
                        ActivityModeView()
                            .transition(.opacity.combined(with: .offset(x: reduceMotion ? 0 : 12)))
                    }
                }
                .animation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion), value: modeRaw)
                .studioReveal(index: 2)
            }
            .padding(.bottom, 24)
        }
    }
}

// MARK: - Training mode

/// Structured training: today's training hero (the current plan's next
/// day, or ready to build a session), then Training's destinations.
struct TrainingModeView: View {
    @Environment(WearableManager.self) private var wearableManager
    @Bindable var session: TrainingSessionManager
    @State private var plans = ConvexQuery<[TrainingPlanDTO]>()
    @State private var readiness = ConvexQuery<ReadinessResultDTO?>()
    @State private var sheet: TrainSheet?
    @State private var startAfterBuilder = false
    /// A planned workout was chosen in Log a Workout: review it next.
    @State private var reviewAfterLog = false

    enum TrainSheet: String, Identifiable {
        case build, plans, log, sombrey, library, history, schedule
        var id: String { rawValue }
    }

    private var currentPlan: TrainingPlanDTO? { plans.value?.first(where: \.isCurrent) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            hero

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                TrainActionTile(title: "Log Workout", detail: "Done outside Sombrey", glyph: "square.and.pencil") { sheet = .log }
                TrainActionTile(title: "Training Plans", detail: plansDetail, glyph: "calendar") { sheet = .plans }
                TrainActionTile(title: "Workout History", detail: "Everything you've trained", glyph: "clock.arrow.circlepath") { sheet = .history }
                TrainActionTile(title: "Exercise Library", detail: "Form and muscles", glyph: "books.vertical") { sheet = .library }
            }

            VStack(spacing: 0) {
                secondaryRow("Sombrey workouts") { sheet = .sombrey }
                secondaryRow("Workout days & reminders") { sheet = .schedule }
            }
            .studioCard()
        }
        .task {
            plans.subscribe(to: "trainingPlans:list")
            readiness.subscribe(to: "readiness:getLatest")
        }
        .sheet(item: $sheet, onDismiss: startIfRequested) { which in
            switch which {
            case .build: StartTrainingView(session: session) { startAfterBuilder = true }
            case .plans: TrainingPlansView(session: session)
            case .log:
                LogWorkoutView { choice in
                    session.loadPlanDay(planId: choice.plan.id, planName: choice.plan.name, dayIndex: choice.dayIndex,
                                        dayName: choice.plan.days[choice.dayIndex].name, exercises: choice.exercises)
                    reviewAfterLog = true
                }
            case .sombrey: SombreyWorkoutsView()
            case .library: ExerciseLibraryView()
            case .history: WorkoutHistoryView()
            case .schedule: WorkoutScheduleView()
            }
        }
    }

    // MARK: Hero

    @ViewBuilder
    private var hero: some View {
        if let plan = currentPlan, let next = plan.nextDay {
            CurrentPlanHero(plan: plan, dayIndex: next.index, day: next.day, session: session, readinessLine: readinessLine) {
                sheet = .build
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                TrainEyebrow(text: session.selectedExercises.isEmpty ? "Ready to train" : "Your next session", tone: StudioColor.paperSoft)
                Text(session.selectedExercises.isEmpty
                     ? "What are you training today?"
                     : session.selectedExercises.prefix(3).map(\.name).joined(separator: ", ") + (session.selectedExercises.count > 3 ? " +\(session.selectedExercises.count - 3)" : ""))
                    .font(StudioFont.hero(session.selectedExercises.isEmpty ? 30 : 24, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                if let readinessLine {
                    readinessLabel(readinessLine)
                }
                Button {
                    sheet = .build
                } label: {
                    Text(session.selectedExercises.isEmpty ? "Start Training" : "Review and start").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
            }
            .instrumentBezel(tint: StudioColor.training)
        }
    }

    /// Today's real readiness, acknowledged — not a prescription, and
    /// nothing when there's no score.
    private var readinessLine: String? {
        guard let result = readiness.value.flatMap({ $0 })?.toReadinessResult(), let score = result.score else { return nil }
        return "Sombrey Score \(score)\(result.scoreBand.map { " · \($0)" } ?? "") · \(result.confidenceBand.lowercased()) confidence"
    }

    private func readinessLabel(_ text: String) -> some View {
        HStack(spacing: 8) {
            Capsule().fill(StudioColor.accent).frame(width: 14, height: 3)
            Text(text)
                .font(StudioFont.body(12, weight: .medium))
                .foregroundStyle(StudioColor.paperSoft)
        }
        .accessibilityElement(children: .combine)
    }

    private var plansDetail: String {
        guard let count = plans.value?.count, count > 0 else { return "Build your own" }
        return "\(count) plan\(count == 1 ? "" : "s")"
    }

    private func secondaryRow(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(StudioFont.body(14, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func startIfRequested() {
        if reviewAfterLog {
            reviewAfterLog = false
            // The builder opens once the log sheet has gone.
            DispatchQueue.main.async { sheet = .build }
            return
        }
        guard startAfterBuilder else { return }
        startAfterBuilder = false
        Task { await TrainingStart.begin(session: session, wearable: wearableManager) }
    }
}

/// Starting structured training: the Sombrey session first, then — when
/// the band is connected — the band's own recording alongside it, so heart
/// rate and energy are captured without the user choosing anything.
/// A band that doesn't start leaves the workout unaffected.
enum TrainingStart {
    /// The band mode used for structured training (Strength Training).
    static let bandSportType = 88

    @MainActor
    static func begin(session: TrainingSessionManager, wearable: WearableManager) async {
        if session.workoutSource != .repeated && session.workoutSource != .plan {
            session.workoutSource = .userCreated
        }
        await session.startWorkout()
        guard wearable.displayState == .connected || wearable.displayState == .syncing, wearable.activeSportSession == nil,
              let type = SombreySportType.byRawValue[bandSportType] else { return }
        if await wearable.startSportSession(type: type) {
            session.attachSportSession(id: wearable.activeSportSession?.convexSessionId)
        }
    }
}

/// The current plan's next day as Training's hero, startable in one tap.
private struct CurrentPlanHero: View {
    @Environment(WearableManager.self) private var wearableManager
    let plan: TrainingPlanDTO
    let dayIndex: Int
    let day: TrainingPlanDTO.Day
    @Bindable var session: TrainingSessionManager
    let readinessLine: String?
    let onBuildInstead: () -> Void
    @State private var exercises = ConvexQuery<[Exercise]>()
    @State private var isStarting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TrainEyebrow(text: "Next in \(plan.name)", tone: StudioColor.paperSoft)
            Text(day.name)
                .font(StudioFont.hero(32, weight: .semibold))
                .foregroundStyle(StudioColor.paper)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            Text("\(day.exercises.count) exercise\(day.exercises.count == 1 ? "" : "s") · day \(dayIndex + 1) of \(plan.days.count)")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.paperSoft)
            if let readinessLine {
                HStack(spacing: 8) {
                    Capsule().fill(StudioColor.accent).frame(width: 14, height: 3)
                    Text(readinessLine)
                        .font(StudioFont.body(12, weight: .medium))
                        .foregroundStyle(StudioColor.paperSoft)
                }
            }
            Button {
                start()
            } label: {
                Text(isStarting ? "Starting…" : "Start \(day.name)").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .disabled(isStarting || !canStart)
            if !canStart && exercises.value != nil {
                Text("This day's exercises aren't in the exercise library right now.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.paperFaint)
            }
            Button("Build a different session", action: onBuildInstead)
                .font(StudioFont.body(12, weight: .medium))
                .foregroundStyle(StudioColor.paperSoft)
                .frame(minHeight: 36)
        }
        .instrumentBezel(tint: StudioColor.training)
        .task(id: day.exercises.map(\.exerciseId)) {
            exercises.subscribe(to: "exercises:getMany", with: ["ids": day.exercises.map { $0.exerciseId as ConvexEncodable? }])
        }
    }

    private var resolved: [(Exercise, TrainingSessionManager.PlanTarget)] {
        day.resolved(with: exercises.value ?? [])
    }

    private var canStart: Bool { !resolved.isEmpty }

    private func start() {
        isStarting = true
        session.loadPlanDay(planId: plan.id, planName: plan.name, dayIndex: dayIndex, dayName: day.name, exercises: resolved)
        Task {
            await TrainingStart.begin(session: session, wearable: wearableManager)
            isStarting = false
        }
    }
}

// MARK: - Start Training (session builder)

/// Build a session from the Sombrey Exercise Library: repeat the last
/// workout, or search and choose exercises, order them, start. Your band
/// records alongside automatically — there is nothing to pair.
struct StartTrainingView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: TrainingSessionManager
    let onStart: () -> Void
    @State private var library = ExerciseSearchModel()
    @State private var editing: Exercise?
    @State private var repeatTemplate = ConvexQuery<RepeatTemplate?>()
    @State private var templateExercises = ConvexQuery<[Exercise]>()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    repeatPreviousButton

                    if !session.selectedExercises.isEmpty {
                        selectedExercisesSection
                    }

                    ExerciseSearchPanel(model: library, onSelect: { session.toggle($0.asExercise) }) { exercise in
                        let isSelected = session.selectedExercises.contains { $0.id == exercise.id }
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22))
                            .foregroundStyle(isSelected ? StudioColor.accentInkDark : StudioColor.paper.opacity(0.35))
                            .accessibilityLabel(isSelected ? "Selected" : "Not selected")
                    }
                }
                .padding(20)
                .padding(.bottom, 80)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
            .navigationTitle("Start Training")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                if !session.selectedExercises.isEmpty {
                    Button {
                        onStart()
                        dismiss()
                    } label: {
                        Text("Start · \(session.selectedExercises.count) exercise\(session.selectedExercises.count == 1 ? "" : "s")")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                }
            }
        }
        .task { repeatTemplate.subscribe(to: "sombreyWorkouts:getMostRecentWorkoutTemplate") }
        .sheet(item: $editing) { exercise in
            TargetEditorSheet(exercise: exercise, target: session.planTargets[exercise.id]) { session.setTarget($0, for: exercise.id) }
                .presentationDetents([.medium])
        }
        .onChange(of: repeatTemplate.value.flatMap { $0 }?.exerciseIds) { _, ids in
            guard let ids, !ids.isEmpty else { return }
            templateExercises.subscribe(to: "exercises:getMany", with: ["ids": ids.map { $0 as ConvexEncodable? }])
        }
    }

    @ViewBuilder
    private var repeatPreviousButton: some View {
        if let template = repeatTemplate.value, let template {
            Button {
                let byId = Dictionary((templateExercises.value ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                session.loadRepeatTemplate(name: template.workoutName, exercises: template.exerciseIds.compactMap { byId[$0] })
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        TrainEyebrow(text: "Repeat last workout")
                        Text(template.workoutName)
                            .font(StudioFont.body(15, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                    }
                    Spacer()
                    Image(systemName: "arrow.counterclockwise")
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(templateExercises.value == nil)
            .studioCard()
        }
    }

    @ViewBuilder
    private var selectedExercisesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            TrainEyebrow(text: "Selected — drag to reorder")
            List {
                ForEach(session.selectedExercises) { exercise in
                    Button { editing = exercise } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(exercise.name)
                                    .font(StudioFont.body(13))
                                    .foregroundStyle(StudioColor.ink)
                                if let target = session.planTargets[exercise.id] {
                                    Text(TargetText.summary(target))
                                        .font(StudioFont.body(11))
                                        .foregroundStyle(StudioColor.inkSoft)
                                } else {
                                    LastTimeLine(exerciseId: exercise.id)
                                }
                            }
                            Spacer()
                            Text("Edit")
                                .font(StudioFont.body(11, weight: .semibold))
                                .foregroundStyle(StudioColor.accentInk)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .onMove { session.moveExercise(fromOffsets: $0, toOffset: $1) }
                .onDelete { offsets in
                    for index in offsets { session.toggle(session.selectedExercises[index]) }
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .frame(height: CGFloat(min(session.selectedExercises.count, 5)) * 56 + 8)
            .scrollDisabled(session.selectedExercises.count <= 5)
        }
    }
}

/// "Last time · 3 × 10 · 40 kg" for one exercise, from real stored sets
/// only; nothing when it has never been trained.
private struct LastTimeLine: View {
    let exerciseId: String
    @State private var history = ConvexQuery<[ExerciseHistorySetDTO]>()

    var body: some View {
        Group {
            if let last = ExerciseHistory.lastSession(history.value ?? [], excludingWorkout: nil) {
                Text("Last time · \(last.summary)")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
        .task { history.subscribe(to: "sombreyWorkouts:getExerciseHistory", with: ["exerciseId": exerciseId, "limit": 30.0]) }
    }
}

/// "3 × 8 · 60 kg · rest 2:00".
enum TargetText {
    static func summary(_ t: TrainingSessionManager.PlanTarget) -> String {
        var parts = ["\(t.sets) × \(t.reps)"]
        if let w = t.weightKg { parts.append("\(TrainingMath.weightText(w)) kg") }
        if let r = t.restSeconds, r > 0 { parts.append("rest \(TrainingMath.clock(r))") }
        return parts.joined(separator: " · ")
    }
}

/// Adjusting one exercise's target before the session starts.
struct TargetEditorSheet: View {
    let exercise: Exercise
    let target: TrainingSessionManager.PlanTarget?
    let onSave: (TrainingSessionManager.PlanTarget) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var sets = 3
    @State private var reps = 10
    @State private var rest = 90
    @State private var weightText = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(exercise.name)
                        .font(StudioFont.hero(24, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    VStack(spacing: 0) {
                        TargetStepper(label: "Sets", value: $sets, range: 1...20, step: 1, format: { "\($0)" })
                        TargetStepper(label: "Reps", value: $reps, range: 1...100, step: 1, format: { "\($0)" })
                        HStack {
                            Text("Weight").font(StudioFont.body(15, weight: .medium)).foregroundStyle(StudioColor.ink)
                            Spacer()
                            TextField("", text: $weightText, prompt: Text("Bodyweight").foregroundStyle(StudioColor.inkFaint))
                                .font(StudioFont.hero(20, weight: .semibold))
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 140)
                            Text("kg").font(StudioFont.body(13, weight: .medium)).foregroundStyle(StudioColor.inkSoft)
                        }
                        .frame(minHeight: 56)
                        TargetStepper(label: "Rest", value: $rest, range: 0...600, step: 15, format: { TrainingMath.clock($0) })
                    }
                    .padding(.horizontal, 16)
                    .studioCard()
                }
                .padding(20)
            }
            .background(StudioColor.env5.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let weight = Double(weightText.replacingOccurrences(of: ",", with: ".")).flatMap { $0 > 0 ? $0 : nil }
                        onSave(.init(sets: sets, reps: reps, restSeconds: rest, weightKg: weight))
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            if let target {
                sets = target.sets
                reps = target.reps
                rest = target.restSeconds ?? 90
                weightText = target.weightKg.map { TrainingMath.weightText($0) } ?? ""
            }
        }
    }
}

/// Wire shape of `sombreyWorkouts:getMostRecentWorkoutTemplate`'s result.
struct RepeatTemplate: Decodable {
    let workoutName: String
    let exerciseIds: [String]
}
