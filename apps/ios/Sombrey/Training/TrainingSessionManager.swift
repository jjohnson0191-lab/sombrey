import Foundation
import Observation
import ConvexMobile

/// One completed set, entered by the user in real time — never
/// fabricated, never pre-filled with invented numbers.
struct CompletedSet: Identifiable {
    let id = UUID()
    let exercise: Exercise
    let reps: Int
    let weightKg: Double?
}

/// Drives the Train tab's Overview -> Active -> Complete flow.
///
/// Phase 3 training-architecture expansion: a Sombrey training session
/// (this type — exercises/sets/reps/weight) and a QCBand Sport+ session
/// (`WearableManager.activeSportSession`) are deliberately separate
/// objects, per the training-architecture spec's own example ("Leg Day"
/// starts a Sombrey session; Sport+ Strength Training starts
/// independently on the band; the completed Sombrey session references
/// the Sport+ session's id, never merges the two). This type has no
/// `WearableManager` reference of its own — the owning view
/// (`TrainOverviewView`/`ActiveWorkoutView`/`TrainCompleteView`) reads
/// both from the environment and coordinates them, matching how
/// `AppState`/`WearableManager` are already independent, view-coordinated
/// environment objects elsewhere in the app.
///
/// Persists to `sombreyWorkouts`/`sombreyWorkoutSets` — deliberately not
/// `workoutLogs`, which is shaped around human-coach program assignment
/// (see `convex/sombreyWorkouts.ts`'s own header).
@Observable
@MainActor
final class TrainingSessionManager {
    enum Phase: Hashable {
        case overview
        case active
        case complete
    }

    enum WorkoutSource: String {
        case userCreated = "user_created"
        case aiCreated = "ai_created"
        case repeated
    }

    private(set) var phase: Phase = .overview
    var selectedExercises: [Exercise] = []
    var workoutSource: WorkoutSource = .userCreated

    private(set) var currentExerciseIndex = 0
    private(set) var completedSets: [CompletedSet] = []
    private(set) var isResting = false
    private(set) var restSecondsRemaining = 0
    private(set) var startedAt: Date?
    private(set) var finishedAt: Date?

    /// Set once `startWorkout()` has created the Convex row — every
    /// `completeSet`/`finish` call needs it; `nil` means the persist
    /// itself failed and `persistError` explains why.
    private(set) var convexWorkoutId: String?
    private(set) var persistError: String?

    private var restTimer: Timer?
    private var orderCounter = 0

    var currentExercise: Exercise? {
        guard currentExerciseIndex < selectedExercises.count else { return nil }
        return selectedExercises[currentExerciseIndex]
    }

    var nextExercise: Exercise? {
        let next = currentExerciseIndex + 1
        guard next < selectedExercises.count else { return nil }
        return selectedExercises[next]
    }

    var elapsedSeconds: Int {
        guard let startedAt else { return 0 }
        let end = finishedAt ?? Date()
        return max(0, Int(end.timeIntervalSince(startedAt)))
    }

    // MARK: - Building the session (works with or without AI)

    func toggle(_ exercise: Exercise) {
        if let index = selectedExercises.firstIndex(of: exercise) {
            selectedExercises.remove(at: index)
        } else {
            selectedExercises.append(exercise)
        }
    }

    func moveExercise(fromOffsets source: IndexSet, toOffset destination: Int) {
        selectedExercises.move(fromOffsets: source, toOffset: destination)
    }

    /// Mid-workout addition — inserted right after the current exercise
    /// so it's next up, not appended to the end where it'd be missed.
    func addExerciseDuringWorkout(_ exercise: Exercise) {
        guard !selectedExercises.contains(exercise) else { return }
        let insertAt = min(currentExerciseIndex + 1, selectedExercises.count)
        selectedExercises.insert(exercise, at: insertAt)
    }

    func skipCurrentExercise() {
        endRest()
        if currentExerciseIndex + 1 < selectedExercises.count {
            currentExerciseIndex += 1
        } else {
            Task { await finish() }
        }
    }

    /// Preselects the most recent completed workout's exercises — real
    /// "repeat previous workout," not a template guess.
    func loadRepeatTemplate(name: String, exercises: [Exercise]) {
        selectedExercises = exercises
        workoutSource = .repeated
    }

    // MARK: - Session lifecycle

    func startWorkout(name: String = "Training Session") async {
        guard !selectedExercises.isEmpty else { return }
        currentExerciseIndex = 0
        completedSets = []
        startedAt = Date()
        finishedAt = nil
        convexWorkoutId = nil
        persistError = nil
        orderCounter = 0
        phase = .active

        do {
            let id: String = try await ConvexClientProvider.client.mutation("sombreyWorkouts:startWorkout", with: [
                "name": name,
                "startedAt": startedAt!.timeIntervalSince1970 * 1000,
                "source": workoutSource.rawValue,
            ])
            convexWorkoutId = id
        } catch {
            persistError = String(describing: error)
        }
    }

    func completeSet(reps: Int, weightKg: Double?) {
        guard let exercise = currentExercise else { return }
        let setIndexForExercise = completedSets.filter { $0.exercise == exercise }.count
        completedSets.append(CompletedSet(exercise: exercise, reps: reps, weightKg: weightKg))
        orderCounter += 1
        beginRest()

        guard let workoutId = convexWorkoutId else { return }
        let capturedOrder = orderCounter
        Task {
            do {
                try await ConvexClientProvider.client.mutation("sombreyWorkouts:logSet", with: [
                    "workoutId": workoutId,
                    "exerciseId": exercise.id,
                    "orderIndex": capturedOrder,
                    "setIndex": setIndexForExercise,
                    "reps": reps,
                    "weightKg": weightKg,
                    "completedAt": Date().timeIntervalSince1970 * 1000,
                ])
            } catch {
                self.persistError = String(describing: error)
            }
        }
    }

    func skipRest() {
        endRest()
    }

    func nextExerciseOrFinish() {
        endRest()
        if currentExerciseIndex + 1 < selectedExercises.count {
            currentExerciseIndex += 1
        } else {
            Task { await finish() }
        }
    }

    /// `sportPlusSessionId`: the Convex id of an already-stopped
    /// `WearableManager` Sport+ session, if the user paired one — passed
    /// in by the view, never looked up here (this type has no wearable
    /// reference of its own).
    func finish(sportPlusSessionId: String? = nil) async {
        endRest()
        finishedAt = Date()
        phase = .complete

        guard let workoutId = convexWorkoutId else { return }
        do {
            try await ConvexClientProvider.client.mutation("sombreyWorkouts:finishWorkout", with: [
                "workoutId": workoutId,
                "completedAt": finishedAt!.timeIntervalSince1970 * 1000,
                "durationSeconds": elapsedSeconds,
                "sportPlusSessionId": sportPlusSessionId,
            ])
        } catch {
            persistError = String(describing: error)
        }
    }

    /// Called on an early exit before any set was logged — discards the
    /// half-started Convex row rather than leaving a phantom "in
    /// progress forever" workout in history.
    func discard() {
        if let workoutId = convexWorkoutId, completedSets.isEmpty {
            Task {
                try? await ConvexClientProvider.client.mutation("sombreyWorkouts:discardWorkout", with: ["workoutId": workoutId])
            }
        }
        reset()
    }

    /// Returns to Overview with a clean slate — called after Complete's
    /// "Return to Home" (and available if the user exits early).
    func reset() {
        restTimer?.invalidate()
        restTimer = nil
        phase = .overview
        selectedExercises = []
        currentExerciseIndex = 0
        completedSets = []
        isResting = false
        restSecondsRemaining = 0
        startedAt = nil
        finishedAt = nil
        convexWorkoutId = nil
        persistError = nil
        workoutSource = .userCreated
    }

    private func beginRest(seconds: Int = 60) {
        isResting = true
        restSecondsRemaining = seconds
        restTimer?.invalidate()
        restTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tickRest()
            }
        }
    }

    private func tickRest() {
        guard restSecondsRemaining > 0 else {
            endRest()
            return
        }
        restSecondsRemaining -= 1
    }

    private func endRest() {
        restTimer?.invalidate()
        restTimer = nil
        isResting = false
        restSecondsRemaining = 0
    }
}
