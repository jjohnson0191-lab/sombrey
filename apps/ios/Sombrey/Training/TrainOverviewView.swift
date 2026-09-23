import SwiftUI
import ConvexMobile

/// Overview: picks from the real, existing `exercises` Convex table (no
/// fabricated "today's plan" — see `TrainingSessionManager`'s header) to
/// build a session, then starts it. Empty state when the exercise
/// library itself has nothing to show (a real, honest possibility, not
/// a loading glitch).
///
/// Phase 3 training-architecture expansion: search, reorder, and "repeat
/// previous workout" so a user can train entirely without AI — plus an
/// optional Sport+ pairing (the band's own activity type), started
/// alongside the Sombrey session, never replacing its set/rep/weight
/// system.
struct TrainOverviewView: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @Bindable var session: TrainingSessionManager
    @State private var exercises = ConvexQuery<[Exercise]>()
    @State private var searchTerm = ""
    @State private var selectedSportType: SombreySportType?
    @State private var showingSportPicker = false
    @State private var isStarting = false
    @State private var repeatTemplate = ConvexQuery<RepeatTemplate?>()
    @State private var readiness = ConvexQuery<ReadinessResultDTO?>()

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainOverview, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Train")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                readinessContext

                // Plans, manual logging, Sombrey workouts, the exercise
                // library, history and workout days — Train's destinations.
                TrainHubSection(session: session)

                VStack(alignment: .leading, spacing: 4) {
                    Text("START A SESSION")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                    Text("Choose exercises and train live with Sombrey and your band.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .padding(.top, 8)

                repeatPreviousButton

                TextField("Search exercises", text: $searchTerm)
                    .font(StudioFont.body(14))
                    .padding(10)
                    .background(StudioColor.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                    .onChange(of: searchTerm) { _, newValue in
                        exercises.subscribe(to: "exercises:list", with: ["searchTerm": newValue])
                    }

                if !session.selectedExercises.isEmpty {
                    selectedExercisesSection
                }

                content

                if wearableManager.pairedDevice != nil {
                    sportTypePicker
                }

                if !session.selectedExercises.isEmpty {
                    Button {
                        startWorkout()
                    } label: {
                        Text(isStarting ? "Starting…" : "Start workout · \(session.selectedExercises.count) exercise\(session.selectedExercises.count == 1 ? "" : "s")")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(isStarting)
                    .padding(.top, 8)
                }
            }
            .padding(.bottom, 24)
        }
        .task {
            exercises.subscribe(to: "exercises:list")
            repeatTemplate.subscribe(to: "sombreyWorkouts:getMostRecentWorkoutTemplate")
            readiness.subscribe(to: "readiness:getLatest")
        }
    }

    private func startWorkout() {
        isStarting = true
        Task {
            if session.workoutSource != .repeated && session.workoutSource != .plan {
                session.workoutSource = .userCreated
            }
            await session.startWorkout()
            if let sportType = selectedSportType, wearableManager.pairedDevice != nil {
                await wearableManager.startSportSession(type: sportType)
                // Only recorded if the band actually started it — the
                // workout never claims a band session that doesn't exist.
                session.attachSportSession(id: wearableManager.activeSportSession?.convexSessionId)
            }
            isStarting = false
        }
    }

    /// Today's real readiness, acknowledged — not advice, not a workout
    /// prescription, and nothing when there's no score.
    @ViewBuilder
    private var readinessContext: some View {
        if let result = readiness.value.flatMap({ $0 })?.toReadinessResult(), let score = result.score {
            HStack(spacing: 8) {
                Capsule()
                    .fill(StudioColor.accentInk)
                    .frame(width: 14, height: 3)
                Text("Readiness \(score)\(result.scoreBand.map { " · \($0)" } ?? "") · \(result.confidenceBand.lowercased()) confidence")
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private var repeatPreviousButton: some View {
        if let template = repeatTemplate.value, let template {
            Button("Repeat \"\(template.workoutName)\"") {
                let matched = template.exerciseIds.compactMap { id in exercises.value?.first { $0.id == id } }
                session.loadRepeatTemplate(name: template.workoutName, exercises: matched)
            }
            .font(StudioFont.body(12, weight: .medium))
            .foregroundStyle(StudioColor.inkSoft)
            .underline()
        }
    }

    @ViewBuilder
    private var selectedExercisesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("SELECTED — DRAG TO REORDER")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(StudioColor.inkSoft)
            List {
                ForEach(session.selectedExercises) { exercise in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(exercise.name)
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.ink)
                        LastTimeLine(exerciseId: exercise.id)
                    }
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

    @ViewBuilder
    private var sportTypePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("PAIR WITH BAND ACTIVITY (OPTIONAL)")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(StudioColor.inkSoft)
            if let selectedSportType, !SombreySportType.featuredRawValues.contains(selectedSportType.rawValue) {
                Text("Selected: \(selectedSportType.displayName)")
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.accentInk)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SombreySportType.featuredRawValues.compactMap { SombreySportType.byRawValue[$0] }) { type in
                        Button(type.displayName) {
                            selectedSportType = (selectedSportType == type) ? nil : type
                        }
                        .font(StudioFont.body(12, weight: .medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            selectedSportType == type ? StudioColor.accentInk.opacity(0.15) : StudioColor.ink.opacity(0.05),
                            in: Capsule()
                        )
                        .foregroundStyle(StudioColor.ink)
                    }
                    // The full 180-entry catalog stays one tap away — see
                    // SportTypePickerView.
                    Button("More sports…") { showingSportPicker = true }
                        .font(StudioFont.body(12, weight: .medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(StudioColor.ink.opacity(0.05), in: Capsule())
                        .foregroundStyle(StudioColor.inkSoft)
                }
            }
        }
        .sheet(isPresented: $showingSportPicker) {
            SportTypePickerView { selectedSportType = $0 }
        }
    }

    @ViewBuilder
    private var content: some View {
        if exercises.isLoading {
            ProgressView().tint(StudioColor.ink).padding(.top, 24)
        } else if let error = exercises.errorMessage {
            Text("Couldn't load exercises: \(error)")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.danger)
        } else if let list = exercises.value, !list.isEmpty {
            VStack(spacing: 0) {
                ForEach(list) { exercise in
                    ExerciseRow(exercise: exercise, isSelected: session.selectedExercises.contains(exercise)) {
                        session.toggle(exercise)
                    }
                    Divider().overlay(StudioColor.ink.opacity(0.08))
                }
            }
        } else {
            Text("No exercises available yet.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkFaint)
                .padding(.top, 24)
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

/// Wire shape of `sombreyWorkouts:getMostRecentWorkoutTemplate`'s result.
struct RepeatTemplate: Decodable {
    let workoutName: String
    let exerciseIds: [String]
}

private struct ExerciseRow: View {
    let exercise: Exercise
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(exercise.name)
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text(exercise.muscleGroup.capitalized)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(exercise.name)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
