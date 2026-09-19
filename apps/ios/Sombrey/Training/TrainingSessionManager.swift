import Foundation
import Observation

/// One completed set, entered by the user in real time — never
/// fabricated, never pre-filled with invented numbers.
struct CompletedSet: Identifiable {
    let id = UUID()
    let exercise: Exercise
    let reps: Int
    let weightKg: Double?
}

/// Drives the Train tab's Overview -> Active -> Complete flow. There is
/// no Sombrey-native workout-generation backend yet (see the migration
/// plan's Convex audit — `workoutLogs`/`assignedPrograms` are shaped
/// around human-coach program assignment and are deliberately not
/// reused here), so "today's workout" isn't a real, existing thing to
/// fetch. What IS real: the `exercises` table (a genuine, existing
/// Convex query, not fabricated) and the session mechanics themselves
/// (timer, set logging, completion) — all real, local, user-driven
/// state, nothing invented. Nothing here is persisted to Convex yet;
/// see `TrainCompleteView`'s doc comment for why that's an honest
/// limitation, not an oversight.
@Observable
@MainActor
final class TrainingSessionManager {
    enum Phase: Hashable {
        case overview
        case active
        case complete
    }

    private(set) var phase: Phase = .overview
    var selectedExercises: [Exercise] = []

    private(set) var currentExerciseIndex = 0
    private(set) var completedSets: [CompletedSet] = []
    private(set) var isResting = false
    private(set) var restSecondsRemaining = 0
    private(set) var startedAt: Date?
    private(set) var finishedAt: Date?

    private var restTimer: Timer?

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

    func toggle(_ exercise: Exercise) {
        if let index = selectedExercises.firstIndex(of: exercise) {
            selectedExercises.remove(at: index)
        } else {
            selectedExercises.append(exercise)
        }
    }

    func startWorkout() {
        guard !selectedExercises.isEmpty else { return }
        currentExerciseIndex = 0
        completedSets = []
        startedAt = Date()
        finishedAt = nil
        phase = .active
    }

    func completeSet(reps: Int, weightKg: Double?) {
        guard let exercise = currentExercise else { return }
        completedSets.append(CompletedSet(exercise: exercise, reps: reps, weightKg: weightKg))
        beginRest()
    }

    func skipRest() {
        endRest()
    }

    func nextExerciseOrFinish() {
        endRest()
        if currentExerciseIndex + 1 < selectedExercises.count {
            currentExerciseIndex += 1
        } else {
            finish()
        }
    }

    func finish() {
        endRest()
        finishedAt = Date()
        phase = .complete
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
