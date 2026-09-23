import Foundation
import Observation
import ConvexMobile

/// One set the user actually performed and entered — never fabricated,
/// never pre-filled with invented numbers. Correctable after the fact
/// (`TrainingSessionManager.updateSet`/`deleteSet`).
struct CompletedSet: Identifiable, Codable, Equatable {
    var id = UUID()
    let exercise: Exercise
    var reps: Int
    var weightKg: Double?
    /// Position within this exercise (0-based), as persisted.
    let setIndex: Int
    /// Position within the whole workout, as persisted.
    let orderIndex: Int
    let completedAt: Date
    /// The `sombreyWorkoutSets` row id once Convex has it; `nil` means
    /// the set is still queued for upload (see `flushPendingSets`).
    var convexId: String?
}

/// The Sport+ figures the band reported for THIS workout, captured when
/// its band session was stopped — never carried over from a previous one.
struct WorkoutSportSummary: Codable, Equatable {
    let sportType: Int
    let durationSeconds: Int
    let lastHeartRate: Int
    let calories: Double
    let distanceMeters: Int
    let steps: Int
}

/// Pure training arithmetic over real logged sets — kept apart from the
/// manager so it can be tested on its own.
enum TrainingMath {
    /// Σ reps × weight over sets that HAVE a weight. Bodyweight sets
    /// contribute nothing rather than an invented load.
    static func volumeKg(_ sets: [CompletedSet]) -> Double {
        sets.reduce(0) { total, set in total + Double(set.reps) * (set.weightKg ?? 0) }
    }

    static func hasWeightedSets(_ sets: [CompletedSet]) -> Bool {
        sets.contains { ($0.weightKg ?? 0) > 0 }
    }

    /// Heaviest set, ties broken by reps; bodyweight-only falls back to
    /// most reps.
    static func bestSet(_ sets: [CompletedSet]) -> CompletedSet? {
        sets.max { lhs, rhs in
            let l = lhs.weightKg ?? 0, r = rhs.weightKg ?? 0
            return l == r ? lhs.reps < rhs.reps : l < r
        }
    }

    /// Exercises the user actually trained (≥1 set), in workout order.
    static func trainedExercises(_ sets: [CompletedSet]) -> [Exercise] {
        var seen = Set<String>()
        return sets.sorted { $0.orderIndex < $1.orderIndex }.compactMap { set in
            seen.insert(set.exercise.id).inserted ? set.exercise : nil
        }
    }

    static func clock(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return s >= 3600
            ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
            : String(format: "%d:%02d", s / 60, s % 60)
    }

    static func weightText(_ kg: Double?) -> String {
        guard let kg, kg > 0 else { return "BW" }
        return kg.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(kg))" : String(format: "%.1f", kg)
    }
}

/// One stored set from `sombreyWorkouts:getExerciseHistory`.
struct ExerciseHistorySetDTO: Decodable, Equatable {
    let workoutId: String
    let setIndex: Double
    let reps: Double
    let weightKg: Double?
    let completedAt: Double
}

/// What the user really did for an exercise last time — from stored sets
/// only. `nil` when there's no earlier workout with this exercise.
enum ExerciseHistory {
    struct LastSession: Equatable {
        let date: Date
        /// In the order performed.
        let sets: [(reps: Int, weightKg: Double?)]

        static func == (lhs: LastSession, rhs: LastSession) -> Bool {
            lhs.date == rhs.date
                && lhs.sets.map { $0.reps } == rhs.sets.map { $0.reps }
                && lhs.sets.map { $0.weightKg } == rhs.sets.map { $0.weightKg }
        }

        /// "3 × 10 · 40 kg" when every set matched, else each set.
        var summary: String {
            guard let first = sets.first else { return "" }
            if sets.allSatisfy({ $0.reps == first.reps && $0.weightKg == first.weightKg }) {
                let load = first.weightKg.map { " · \(TrainingMath.weightText($0)) kg" } ?? ""
                return "\(sets.count) × \(first.reps)\(load)"
            }
            return sets.map { set in
                set.weightKg.map { "\(set.reps)×\(TrainingMath.weightText($0))" } ?? "\(set.reps)"
            }.joined(separator: " · ")
        }

        var lastSet: (reps: Int, weightKg: Double?)? { sets.last }
    }

    /// The most recent workout's sets for this exercise, excluding the
    /// workout in progress.
    static func lastSession(_ rows: [ExerciseHistorySetDTO], excludingWorkout currentId: String?) -> LastSession? {
        let earlier = rows.filter { $0.workoutId != currentId }
        guard let newest = earlier.max(by: { $0.completedAt < $1.completedAt }) else { return nil }
        let sets = earlier
            .filter { $0.workoutId == newest.workoutId }
            .sorted { $0.setIndex < $1.setIndex }
            .map { (reps: Int($0.reps), weightKg: $0.weightKg) }
        return LastSession(date: Date(timeIntervalSince1970: newest.completedAt / 1000), sets: sets)
    }
}

/// Drives Training as a state machine: overview → active (exercise ↔ rest,
/// pausable) → complete.
///
/// A Sombrey training session (this type — exercises/sets/reps/weight)
/// and a QCBand Sport+ session (`WearableManager.activeSportSession`)
/// stay separate objects: the view coordinates them, and the completed
/// Sombrey workout references the Sport+ session's id. This type has no
/// `WearableManager` reference of its own.
///
/// Reliability (UI4):
/// - Owned at app level (`SombreyApp`), not by `TrainScreen`, so a tab
///   switch or deep link can't destroy a workout in progress.
/// - Snapshotted to `UserDefaults` on every change while a workout is
///   live, and restored at launch (`restoreIfNeeded`) — an app kill or
///   crash doesn't lose it.
/// - Sets are queued locally and uploaded in order; a set logged before
///   the workout row exists, or while offline, is retried rather than
///   silently dropped.
/// - Elapsed time and rest are computed from wall-clock dates, so
///   backgrounding or locking the phone can't stall or skew them.
///
/// Persists to `sombreyWorkouts`/`sombreyWorkoutSets` — deliberately not
/// `workoutLogs`, which is shaped around human-coach program assignment.
@Observable
@MainActor
final class TrainingSessionManager {
    enum Phase: String, Hashable, Codable {
        case overview
        case active
        case complete
    }

    enum WorkoutSource: String, Codable {
        case userCreated = "user_created"
        case aiCreated = "ai_created"
        case repeated
    }

    static let defaultRestSeconds = 60
    static let restAdjustStep = 15

    private(set) var phase: Phase = .overview
    var selectedExercises: [Exercise] = []
    var workoutSource: WorkoutSource = .userCreated
    private(set) var workoutName = "Training Session"

    private(set) var currentExerciseIndex = 0
    private(set) var completedSets: [CompletedSet] = []
    private(set) var startedAt: Date?
    private(set) var finishedAt: Date?

    // Pause — paused time never counts toward the workout's duration.
    private(set) var pausedAt: Date?
    private(set) var pausedSeconds: TimeInterval = 0

    // Rest — a wall-clock window, never a decrementing counter.
    private(set) var restStartedAt: Date?
    private(set) var restTargetSeconds = TrainingSessionManager.defaultRestSeconds

    /// The Sport+ session paired with this workout, if one was started.
    private(set) var sportPlusSessionId: String?
    private(set) var sportSummary: WorkoutSportSummary?

    /// Set once `startWorkout()` has created the Convex row; `nil` with
    /// `persistError` set means that create failed (retried on flush).
    private(set) var convexWorkoutId: String?
    private(set) var persistError: String?
    private(set) var isFlushing = false
    /// True once Convex has confirmed the finished workout.
    private(set) var completionSaved = false

    private let defaults: UserDefaults
    private static let snapshotKey = "sombreyTraining.activeSession.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Derived state

    var currentExercise: Exercise? {
        guard currentExerciseIndex < selectedExercises.count else { return nil }
        return selectedExercises[currentExerciseIndex]
    }

    var nextExercise: Exercise? {
        let next = currentExerciseIndex + 1
        guard next < selectedExercises.count else { return nil }
        return selectedExercises[next]
    }

    var isResting: Bool { restStartedAt != nil }
    var isPaused: Bool { pausedAt != nil }

    /// Sets logged for the current exercise, in order.
    var currentExerciseSets: [CompletedSet] {
        guard let exercise = currentExercise else { return [] }
        return completedSets.filter { $0.exercise == exercise }.sorted { $0.setIndex < $1.setIndex }
    }

    /// 1-based number of the set being performed now for this exercise.
    var currentSetNumber: Int { currentExerciseSets.count + 1 }

    var pendingUploadCount: Int { completedSets.filter { $0.convexId == nil }.count }

    /// Active (unpaused) workout seconds at `date`.
    func activeSeconds(at date: Date = Date()) -> Int {
        guard let startedAt else { return 0 }
        let end = finishedAt ?? pausedAt ?? date
        let paused = pausedSeconds
        return max(0, Int(end.timeIntervalSince(startedAt) - paused))
    }

    var elapsedSeconds: Int { activeSeconds() }

    /// Seconds rested so far (frozen while paused).
    func restElapsed(at date: Date = Date()) -> Int {
        guard let restStartedAt else { return 0 }
        let end = pausedAt ?? date
        return max(0, Int(end.timeIntervalSince(restStartedAt)))
    }

    /// Seconds left of the rest target; negative once over.
    func restRemaining(at date: Date = Date()) -> Int {
        restTargetSeconds - restElapsed(at: date)
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
        save()
    }

    func skipCurrentExercise() {
        endRest()
        if currentExerciseIndex + 1 < selectedExercises.count {
            currentExerciseIndex += 1
            save()
        } else if phase == .active {
            Task { await finish() }
        }
    }

    /// Preselects the most recent completed workout's exercises — real
    /// "repeat previous workout," not a template guess.
    func loadRepeatTemplate(name: String, exercises: [Exercise]) {
        selectedExercises = exercises
        workoutSource = .repeated
        workoutName = name
    }

    // MARK: - Session lifecycle

    func startWorkout(name: String? = nil) async {
        guard !selectedExercises.isEmpty else { return }
        if let name { workoutName = name }
        currentExerciseIndex = 0
        completedSets = []
        startedAt = Date()
        finishedAt = nil
        pausedAt = nil
        pausedSeconds = 0
        restStartedAt = nil
        restTargetSeconds = Self.defaultRestSeconds
        sportPlusSessionId = nil
        sportSummary = nil
        convexWorkoutId = nil
        persistError = nil
        completionSaved = false
        phase = .active
        save()
        await createWorkoutRowIfNeeded()
    }

    /// Records that the band's Sport+ session for this workout started.
    func attachSportSession(id: String?) {
        sportPlusSessionId = id
        save()
    }

    /// Logs a set and begins rest. Returns the set so the view can mark it.
    @discardableResult
    func completeSet(reps: Int, weightKg: Double?) -> CompletedSet? {
        guard let exercise = currentExercise, !isPaused else { return nil }
        let set = CompletedSet(
            exercise: exercise,
            reps: reps,
            weightKg: weightKg,
            setIndex: (currentExerciseSets.map(\.setIndex).max() ?? -1) + 1,
            orderIndex: (completedSets.map(\.orderIndex).max() ?? 0) + 1,
            completedAt: Date()
        )
        completedSets.append(set)
        restStartedAt = Date()
        save()
        Task { await flushPendingSets() }
        return set
    }

    /// Corrects reps/weight of an already-logged set.
    func updateSet(id: UUID, reps: Int, weightKg: Double?) {
        guard let index = completedSets.firstIndex(where: { $0.id == id }) else { return }
        completedSets[index].reps = reps
        completedSets[index].weightKg = weightKg
        save()
        guard let convexId = completedSets[index].convexId else { return }
        Task {
            var args: [String: ConvexEncodable?] = ["setId": convexId, "reps": Double(reps)]
            if let weightKg { args["weightKg"] = weightKg }
            do {
                try await ConvexClientProvider.client.mutation("sombreyWorkouts:updateSet", with: args)
            } catch {
                self.persistError = String(describing: error)
            }
        }
    }

    /// Removes a set logged by mistake.
    func deleteSet(id: UUID) {
        guard let index = completedSets.firstIndex(where: { $0.id == id }) else { return }
        let removed = completedSets.remove(at: index)
        save()
        guard let convexId = removed.convexId else { return }
        Task {
            try? await ConvexClientProvider.client.mutation("sombreyWorkouts:deleteSet", with: ["setId": convexId])
        }
    }

    func adjustRest(by seconds: Int) {
        restTargetSeconds = min(max(restTargetSeconds + seconds, Self.restAdjustStep), 15 * 60)
        save()
    }

    func skipRest() {
        endRest()
        save()
    }

    func nextExerciseOrFinish() {
        endRest()
        if currentExerciseIndex + 1 < selectedExercises.count {
            currentExerciseIndex += 1
            save()
        } else {
            Task { await finish() }
        }
    }

    func pause() {
        guard phase == .active, pausedAt == nil else { return }
        pausedAt = Date()
        save()
    }

    func resume() {
        guard let pausedAt else { return }
        let gap = Date().timeIntervalSince(pausedAt)
        pausedSeconds += gap
        // Rest is frozen while paused: shift its start by the pause.
        if let restStartedAt { self.restStartedAt = restStartedAt.addingTimeInterval(gap) }
        self.pausedAt = nil
        save()
    }

    /// `sportSummary`: the band's own tally for this workout's Sport+
    /// session, if one was paired and stopped — passed in by the view.
    func finish(sportSummary: WorkoutSportSummary? = nil) async {
        if isPaused { resume() }
        endRest()
        finishedAt = Date()
        if let sportSummary { self.sportSummary = sportSummary }
        phase = .complete
        save()
        await persistCompletion()
    }

    /// Sends the finished workout (and any queued sets) to Convex. Also
    /// used to retry after an interruption; clears the local snapshot
    /// only once the server has it.
    func persistCompletion() async {
        guard phase == .complete, let finishedAt else { return }
        await createWorkoutRowIfNeeded()
        await flushPendingSets()
        guard let workoutId = convexWorkoutId else { return }
        do {
            var args: [String: ConvexEncodable?] = [
                "workoutId": workoutId,
                "completedAt": finishedAt.timeIntervalSince1970 * 1000,
                "durationSeconds": Double(elapsedSeconds),
            ]
            if let sportPlusSessionId { args["sportPlusSessionId"] = sportPlusSessionId }
            try await ConvexClientProvider.client.mutation("sombreyWorkouts:finishWorkout", with: args)
            completionSaved = pendingUploadCount == 0
            persistError = completionSaved ? nil : "Some sets are still uploading."
            if completionSaved { clearSnapshot() }
        } catch {
            persistError = String(describing: error)
        }
    }

    /// Early exit. With no sets logged, the half-started Convex row is
    /// discarded rather than left "in progress forever"; with sets, the
    /// real work is kept by finishing the workout instead.
    func discard() {
        if completedSets.isEmpty {
            if let workoutId = convexWorkoutId {
                Task {
                    try? await ConvexClientProvider.client.mutation("sombreyWorkouts:discardWorkout", with: ["workoutId": workoutId])
                }
            }
            reset()
        } else {
            Task { await finish() }
        }
    }

    /// Returns to Overview with a clean slate.
    func reset() {
        phase = .overview
        selectedExercises = []
        workoutName = "Training Session"
        currentExerciseIndex = 0
        completedSets = []
        restStartedAt = nil
        restTargetSeconds = Self.defaultRestSeconds
        pausedAt = nil
        pausedSeconds = 0
        startedAt = nil
        finishedAt = nil
        sportPlusSessionId = nil
        sportSummary = nil
        convexWorkoutId = nil
        persistError = nil
        completionSaved = false
        workoutSource = .userCreated
        clearSnapshot()
    }

    private func endRest() {
        restStartedAt = nil
    }

    // MARK: - Persistence to Convex

    private func createWorkoutRowIfNeeded() async {
        guard convexWorkoutId == nil, let startedAt else { return }
        do {
            let id: String = try await ConvexClientProvider.client.mutation("sombreyWorkouts:startWorkout", with: [
                "name": workoutName,
                "startedAt": startedAt.timeIntervalSince1970 * 1000,
                "source": workoutSource.rawValue,
            ])
            convexWorkoutId = id
            persistError = nil
            save()
            await flushPendingSets()
        } catch {
            persistError = String(describing: error)
        }
    }

    /// Uploads queued sets in workout order, one at a time. Safe to call
    /// repeatedly; a failure leaves the rest queued for the next attempt.
    func flushPendingSets() async {
        guard !isFlushing else { return }
        guard let workoutId = convexWorkoutId else {
            await createWorkoutRowIfNeeded()
            return
        }
        isFlushing = true
        defer { isFlushing = false }
        let pending = completedSets.filter { $0.convexId == nil }.sorted { $0.orderIndex < $1.orderIndex }
        for set in pending {
            // The set may have been corrected or deleted while queued.
            guard let current = completedSets.first(where: { $0.id == set.id }) else { continue }
            do {
                var args: [String: ConvexEncodable?] = [
                    "workoutId": workoutId,
                    "exerciseId": current.exercise.id,
                    "orderIndex": Double(current.orderIndex),
                    "setIndex": Double(current.setIndex),
                    "reps": Double(current.reps),
                    "completedAt": current.completedAt.timeIntervalSince1970 * 1000,
                ]
                if let weightKg = current.weightKg { args["weightKg"] = weightKg }
                let convexId: String = try await ConvexClientProvider.client.mutation("sombreyWorkouts:logSet", with: args)
                if let index = completedSets.firstIndex(where: { $0.id == set.id }) {
                    completedSets[index].convexId = convexId
                    // Corrected while its upload was in flight: send the
                    // latest values now that the row exists.
                    let latest = completedSets[index]
                    if latest.reps != current.reps || latest.weightKg != current.weightKg {
                        updateSet(id: latest.id, reps: latest.reps, weightKg: latest.weightKg)
                    }
                } else {
                    try? await ConvexClientProvider.client.mutation("sombreyWorkouts:deleteSet", with: ["setId": convexId])
                }
                persistError = nil
                save()
            } catch {
                persistError = String(describing: error)
                return
            }
        }
    }

    // MARK: - Local snapshot (recovery after interruption)

    private struct Snapshot: Codable {
        let phase: Phase
        let selectedExercises: [Exercise]
        let workoutSource: WorkoutSource
        let workoutName: String
        let currentExerciseIndex: Int
        let completedSets: [CompletedSet]
        let startedAt: Date?
        let finishedAt: Date?
        let pausedAt: Date?
        let pausedSeconds: TimeInterval
        let restStartedAt: Date?
        let restTargetSeconds: Int
        let sportPlusSessionId: String?
        let sportSummary: WorkoutSportSummary?
        let convexWorkoutId: String?
        /// Last moment the app was known to be running this workout.
        let savedAt: Date
    }

    private func save() {
        guard phase != .overview else { return }
        let snapshot = Snapshot(
            phase: phase, selectedExercises: selectedExercises, workoutSource: workoutSource,
            workoutName: workoutName, currentExerciseIndex: currentExerciseIndex, completedSets: completedSets,
            startedAt: startedAt, finishedAt: finishedAt, pausedAt: pausedAt, pausedSeconds: pausedSeconds,
            restStartedAt: restStartedAt, restTargetSeconds: restTargetSeconds,
            sportPlusSessionId: sportPlusSessionId, sportSummary: sportSummary, convexWorkoutId: convexWorkoutId,
            savedAt: Date()
        )
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: Self.snapshotKey)
        }
    }

    private func clearSnapshot() {
        defaults.removeObject(forKey: Self.snapshotKey)
    }

    /// Restores a workout interrupted by an app kill/crash, then retries
    /// any uploads that hadn't landed. A workout that already completed
    /// and saved has no snapshot left, so nothing is restored for it.
    func restoreIfNeeded() {
        guard phase == .overview,
              let data = defaults.data(forKey: Self.snapshotKey),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        phase = snapshot.phase
        selectedExercises = snapshot.selectedExercises
        workoutSource = snapshot.workoutSource
        workoutName = snapshot.workoutName
        currentExerciseIndex = snapshot.currentExerciseIndex
        completedSets = snapshot.completedSets
        startedAt = snapshot.startedAt
        finishedAt = snapshot.finishedAt
        pausedAt = snapshot.pausedAt
        pausedSeconds = snapshot.pausedSeconds
        restStartedAt = snapshot.restStartedAt
        restTargetSeconds = snapshot.restTargetSeconds
        sportPlusSessionId = snapshot.sportPlusSessionId
        sportSummary = snapshot.sportSummary
        convexWorkoutId = snapshot.convexWorkoutId
        // A killed app can't have kept running: from the last saved
        // moment on, the workout is paused — that gap never counts as
        // training time — and the user resumes it deliberately.
        if phase == .active && pausedAt == nil {
            pausedAt = snapshot.savedAt
        }
        Task {
            if phase == .complete {
                await persistCompletion()
            } else {
                await flushPendingSets()
            }
        }
    }
}
