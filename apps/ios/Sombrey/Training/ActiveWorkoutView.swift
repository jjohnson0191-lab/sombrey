import SwiftUI

/// The active workout — Training's own instrument, deliberately unlike
/// Home or Vitals: one exercise at a time, a large set logger built for a
/// moving, out-of-breath, one-handed user, and a rest dial that takes
/// over between sets. The session is a state machine
/// (`TrainingSessionManager`): EXERCISE ⇄ REST, PAUSED over either, then
/// COMPLETE — each state has its own look, and the header always says
/// which one you're in.
///
/// Real data only: reps/weight are what the user enters (pre-filled only
/// from what they actually did — earlier this workout, or last time);
/// heart rate and band activity come from the band and are labelled
/// LIVE only while genuinely fresh. No nav ticks while a session is
/// active.
struct ActiveWorkoutView: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var session: TrainingSessionManager

    @State private var reps: Int?
    @State private var weightKg: Double?
    @State private var history = ConvexQuery<[ExerciseHistorySetDTO]>()
    @State private var prefilledFor: String?
    @State private var editingSet: CompletedSet?
    @State private var showingAddExercise = false
    @State private var showingEndConfirm = false
    @State private var isFinishing = false
    @State private var setLoggedCount = 0
    @State private var justLoggedID: UUID?

    private var lastTime: ExerciseHistory.LastSession? {
        ExerciseHistory.lastSession(history.value ?? [], excludingWorkout: session.convexWorkoutId)
    }

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainActive, showsNav: false, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 20) {
                WorkoutHUD(
                    session: session,
                    onPause: togglePause,
                    onAddExercise: { showingAddExercise = true },
                    onSkipExercise: { session.skipCurrentExercise() },
                    onEnd: { showingEndConfirm = true }
                )
                .padding(.top, 16)

                LiveSignalLine()

                if let exercise = session.currentExercise {
                    ExerciseStage(
                        exercise: exercise,
                        exerciseNumber: session.currentExerciseIndex + 1,
                        exerciseCount: session.selectedExercises.count,
                        sets: session.currentExerciseSets,
                        lastTime: lastTime,
                        planTarget: session.planTargets[exercise.id],
                        justLoggedID: justLoggedID,
                        onEditSet: { editingSet = $0 }
                    )
                    .id(exercise.id)
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .opacity.combined(with: .offset(x: 24)),
                        removal: .opacity.combined(with: .offset(x: -24))))

                    stateBody
                } else {
                    Text("No exercise selected.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkFaint)
                }

                if let error = session.persistError {
                    Text(session.pendingUploadCount > 0
                         ? "\(session.pendingUploadCount) set\(session.pendingUploadCount == 1 ? "" : "s") saved on this phone — will upload when the connection returns."
                         : "Sync issue: \(error)")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            }
            .padding(.bottom, 24)
            .animation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion), value: session.currentExerciseIndex)
            .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: session.isResting)
            .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: session.isPaused)
        }
        .sensoryFeedback(StudioHaptic.setLogged, trigger: setLoggedCount)
        .sensoryFeedback(StudioHaptic.pauseToggle, trigger: session.isPaused)
        .task(id: session.currentExercise?.id) { loadHistoryAndPrefill() }
        .task { await session.flushPendingSets() }
        .onChange(of: history.value) { _, _ in prefillIfNeeded() }
        .sheet(isPresented: $showingAddExercise) {
            AddExerciseDuringWorkoutView(session: session)
        }
        .sheet(item: $editingSet) { set in
            SetCorrectionSheet(set: set) { reps, weight in
                session.updateSet(id: set.id, reps: reps, weightKg: weight)
            } onDelete: {
                session.deleteSet(id: set.id)
            }
            .presentationDetents([.height(340)])
        }
        .confirmationDialog("End this workout?", isPresented: $showingEndConfirm, titleVisibility: .visible) {
            if session.completedSets.isEmpty {
                Button("Discard workout", role: .destructive) { endEarly() }
            } else {
                Button("Finish and save \(session.completedSets.count) set\(session.completedSets.count == 1 ? "" : "s")") { finishWorkout() }
            }
            Button("Keep training", role: .cancel) {}
        } message: {
            Text(session.completedSets.isEmpty
                 ? "Nothing has been logged yet, so nothing will be saved."
                 : "Everything you've logged is kept.")
        }
    }

    // MARK: - State body

    @ViewBuilder
    private var stateBody: some View {
        if session.isPaused {
            PausedPanel(session: session, onResume: togglePause, onFinish: finishWorkout, isFinishing: isFinishing)
                .transition(.opacity)
        } else if session.isResting {
            RestInstrument(
                session: session,
                upNext: upNextText,
                isFinishing: isFinishing,
                onAnotherSet: { session.skipRest() },
                onNextExercise: advance
            )
            .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96)))
        } else {
            SetLogger(
                setNumber: session.currentSetNumber,
                reps: $reps,
                weightKg: $weightKg,
                onComplete: completeSet
            )
            .transition(.opacity)
        }
    }

    private var upNextText: String {
        guard let exercise = session.currentExercise else { return "" }
        let another = "Set \(session.currentSetNumber) · \(exercise.name)"
        if let next = session.nextExercise { return "\(another)  —  or next: \(next.name)" }
        return another
    }

    // MARK: - Actions

    private func completeSet() {
        guard let reps, reps > 0 else { return }
        if let logged = session.completeSet(reps: reps, weightKg: weightKg) {
            justLoggedID = logged.id
            setLoggedCount += 1
        }
    }

    /// Moves to the next exercise, or finishes after the last one.
    private func advance() {
        if session.nextExercise == nil {
            finishWorkout()
        } else {
            session.nextExerciseOrFinish()
        }
    }

    private func togglePause() {
        if session.isPaused {
            session.resume()
            if wearableManager.activeSportSession != nil {
                Task { await wearableManager.resumeSportSession() }
            }
        } else {
            session.pause()
            if wearableManager.activeSportSession != nil {
                Task { await wearableManager.pauseSportSession() }
            }
        }
    }

    private func endEarly() {
        if wearableManager.activeSportSession != nil {
            Task { await wearableManager.stopSportSession() }
        }
        session.discard()
    }

    private func finishWorkout() {
        guard !isFinishing else { return }
        isFinishing = true
        Task {
            var summary: WorkoutSportSummary?
            if let active = wearableManager.activeSportSession {
                let sportType = active.sportType
                _ = await wearableManager.stopSportSession()
                if let update = wearableManager.lastCompletedSportSession {
                    summary = WorkoutSportSummary(
                        sportType: sportType,
                        durationSeconds: update.durationSeconds,
                        lastHeartRate: update.heartRate,
                        calories: update.calories,
                        distanceMeters: update.distanceMeters,
                        steps: update.steps
                    )
                }
            }
            await session.finish(sportSummary: summary)
            let todayWeekday = Calendar.current.component(.weekday, from: Date())
            NotificationManager.shared.cancelMissedWorkoutReminder(forDayOfWeek: todayWeekday)
            isFinishing = false
        }
    }

    // MARK: - Pre-fill (real values only)

    private func loadHistoryAndPrefill() {
        guard let exercise = session.currentExercise else { return }
        history.subscribe(to: "sombreyWorkouts:getExerciseHistory", with: ["exerciseId": exercise.id, "limit": 30.0])
        prefilledFor = nil
        prefillIfNeeded()
    }

    /// Starts the logger at what the user really did: their last set of
    /// this exercise in this workout, otherwise their last set last time,
    /// otherwise empty (reps must be chosen; weight stays bodyweight).
    private func prefillIfNeeded() {
        guard let exercise = session.currentExercise, prefilledFor != exercise.id else { return }
        if let last = session.currentExerciseSets.last {
            reps = last.reps
            weightKg = last.weightKg
            prefilledFor = exercise.id
        } else if let target = session.planTargets[exercise.id], history.value != nil {
            // The user's own plan sets the reps; load comes from what they
            // actually lifted last time, else the target load they set.
            reps = target.reps
            weightKg = lastTime?.lastSet?.weightKg ?? target.weightKg
            prefilledFor = exercise.id
        } else if let previous = lastTime?.lastSet {
            reps = previous.reps
            weightKg = previous.weightKg
            prefilledFor = exercise.id
        } else if history.value != nil {
            reps = nil
            weightKg = nil
            prefilledFor = exercise.id
        }
    }
}

// MARK: - HUD

/// Always answers "where am I": the state, the exercise/set position, and
/// the workout clock (paused time excluded, frozen while paused).
private struct WorkoutHUD: View {
    let session: TrainingSessionManager
    let onPause: () -> Void
    let onAddExercise: () -> Void
    let onSkipExercise: () -> Void
    let onEnd: () -> Void

    private var stateLabel: String {
        if session.isPaused { return "PAUSED" }
        if session.isResting { return "REST" }
        return "SET \(session.currentSetNumber)"
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(stateLabel)
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(session.isPaused ? StudioColor.inkSoft : StudioColor.accentInk)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(TrainingMath.clock(session.activeSeconds(at: context.date)))
                        .font(StudioFont.hero(24, weight: .semibold))
                        .foregroundStyle(session.isPaused ? StudioColor.inkFaint : StudioColor.ink)
                        .monospacedDigit()
                }
                .accessibilityLabel("Workout time")
            }
            Spacer()
            Button(action: onPause) {
                Image(systemName: session.isPaused ? "play.fill" : "pause.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .frame(width: 52, height: 52)
                    .background(StudioColor.ink.opacity(0.07), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(session.isPaused ? "Resume workout" : "Pause workout")
            Menu {
                Button("Add exercise", systemImage: "plus", action: onAddExercise)
                if session.nextExercise != nil {
                    Button("Skip to next exercise", systemImage: "forward", action: onSkipExercise)
                }
                Button("End workout", systemImage: "stop", role: .destructive, action: onEnd)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .frame(width: 52, height: 52)
                    .background(StudioColor.ink.opacity(0.07), in: Circle())
            }
            .accessibilityLabel("Workout options")
        }
    }
}

// MARK: - Live band signal

/// Heart rate and the band's Sport+ state in one quiet line. A value is
/// LIVE only while fresh; otherwise it says why it isn't there.
private struct LiveSignalLine: View {
    @Environment(WearableManager.self) private var wearableManager

    static let freshness: TimeInterval = 20

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let reading = heartRate(at: context.date)
            HStack(spacing: 10) {
                LivePulseMark(bpm: reading)
                if let reading {
                    Text("\(Int(reading.rounded()))")
                        .font(StudioFont.hero(22, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .monospacedDigit()
                        .studioNumericTransition(reading.rounded())
                    Text("BPM · LIVE")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.accentInk)
                } else {
                    Text(heartRateAbsence)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                Spacer(minLength: 8)
                bandActivity(at: context.date)
            }
            .accessibilityElement(children: .combine)
        }
    }

    /// Fresh band heart rate: the real-time stream, else the Sport+
    /// session's own push — whichever arrived within `freshness`.
    private func heartRate(at now: Date) -> Double? {
        if let hr = wearableManager.latestMeasurements[.heartRate], now.timeIntervalSince(hr.recordedAt) < Self.freshness {
            return hr.value
        }
        if let sport = wearableManager.activeSportSession, let update = sport.liveUpdate, update.heartRate > 0,
           let at = sport.liveUpdateAt, now.timeIntervalSince(at) < Self.freshness {
            return Double(update.heartRate)
        }
        return nil
    }

    private var heartRateAbsence: String {
        switch wearableManager.displayState {
        case .connected, .syncing: return "Heart rate — waiting for the band"
        case .reconnecting, .connecting, .searching: return "Heart rate — band reconnecting"
        case .notPaired: return "No band paired"
        case .disconnected, .error, .unavailable: return "Heart rate — band disconnected"
        }
    }

    @ViewBuilder
    private func bandActivity(at now: Date) -> some View {
        if let sport = wearableManager.activeSportSession {
            let name = ActivityCatalog.resolve(activityKey: nil, vendorSportType: sport.sportType)?.name ?? "Activity"
            let connected = wearableManager.displayState == .connected || wearableManager.displayState == .syncing
            let fresh = sport.liveUpdateAt.map { now.timeIntervalSince($0) < 60 } ?? false
            VStack(alignment: .trailing, spacing: 1) {
                Text(connected ? "BAND RECORDING" : "BAND OUT OF RANGE")
                    .font(StudioFont.body(9, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(connected ? StudioColor.accentInk : StudioColor.inkSoft)
                Text(connected ? (fresh ? name : "\(name) · waiting for data") : "Live band data paused")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }
}

// MARK: - Exercise stage

/// The current movement, unmistakable: its name large, where it sits in
/// the workout, a mark per logged set (tap to correct), and what the
/// user really did last time.
private struct ExerciseStage: View {
    let exercise: Exercise
    let exerciseNumber: Int
    let exerciseCount: Int
    let sets: [CompletedSet]
    let lastTime: ExerciseHistory.LastSession?
    let planTarget: TrainingSessionManager.PlanTarget?
    let justLoggedID: UUID?
    let onEditSet: (CompletedSet) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("EXERCISE \(exerciseNumber) OF \(exerciseCount)")
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            Text(exercise.name)
                .font(StudioFont.hero(36, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            if let planTarget {
                Text("Plan · \(planTarget.sets) × \(planTarget.reps)\(planTarget.restSeconds.map { " · rest \(TrainingMath.clock($0))" } ?? "")")
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
            }
            if let lastTime {
                Text("Last time · \(lastTime.summary)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            if !sets.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(sets) { set in
                            Button { onEditSet(set) } label: {
                                Text(set.weightKg.map { "\(set.reps) × \(TrainingMath.weightText($0))" } ?? "\(set.reps)")
                                    .font(StudioFont.body(13, weight: .semibold))
                                    .foregroundStyle(StudioColor.ink)
                                    .monospacedDigit()
                                    .padding(.horizontal, 12)
                                    .frame(minHeight: 36)
                                    .background(
                                        set.id == justLoggedID ? StudioColor.accentInk.opacity(0.16) : StudioColor.ink.opacity(0.06),
                                        in: Capsule()
                                    )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Set \(set.setIndex + 1): \(set.reps) reps\(set.weightKg.map { ", \(TrainingMath.weightText($0)) kilograms" } ?? ""). Double-tap to correct.")
                            .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Set logger

/// Built for a moving, one-handed user: two large controls and one large
/// action at thumb height. Reps must be a real choice — never an
/// invented default.
private struct SetLogger: View {
    let setNumber: Int
    @Binding var reps: Int?
    @Binding var weightKg: Double?
    let onComplete: () -> Void

    @State private var editingWeight = false
    @State private var weightEntry = ""

    private static let quickReps = [5, 8, 10, 12, 15]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center) {
                stepButton("minus", label: "Fewer reps") { reps = max(1, (reps ?? 1) - 1) }
                    .disabled(reps == nil)
                Spacer()
                VStack(spacing: 0) {
                    Text(reps.map(String.init) ?? "—")
                        .font(StudioFont.hero(88, weight: .bold))
                        .foregroundStyle(reps == nil ? StudioColor.inkFaint : StudioColor.ink)
                        .monospacedDigit()
                        .studioNumericTransition(Double(reps ?? 0))
                    Text("REPS")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.3)
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(reps.map { "\($0) reps" } ?? "Reps not chosen")
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: reps = min(100, (reps ?? 0) + 1)
                    case .decrement: reps = max(1, (reps ?? 1) - 1)
                    @unknown default: break
                    }
                }
                Spacer()
                stepButton("plus", label: "More reps") { reps = min(100, (reps ?? 0) + 1) }
            }

            if reps == nil {
                HStack(spacing: 8) {
                    ForEach(Self.quickReps, id: \.self) { value in
                        Button("\(value)") { reps = value }
                            .font(StudioFont.body(15, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(StudioColor.ink.opacity(0.06), in: Capsule())
                            .buttonStyle(.plain)
                    }
                }
            }

            HStack(alignment: .center) {
                stepButton("minus", label: "Less weight", size: 48) {
                    let next = (weightKg ?? 0) - 2.5
                    weightKg = next > 0 ? next : nil
                }
                .disabled(weightKg == nil)
                Spacer()
                Button {
                    weightEntry = weightKg.map { TrainingMath.weightText($0) } ?? ""
                    editingWeight = true
                } label: {
                    VStack(spacing: 0) {
                        Text(weightKg.map { TrainingMath.weightText($0) } ?? "Bodyweight")
                            // A load is a hero numeral; "Bodyweight" is a word.
                            .font(weightKg == nil ? StudioFont.body(20, weight: .semibold) : StudioFont.hero(30, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                        Text(weightKg == nil ? "TAP OR + TO ADD LOAD" : "KG · TAP TO TYPE")
                            .font(StudioFont.body(9, weight: .semibold))
                            .tracking(1.2)
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(weightKg.map { "\(TrainingMath.weightText($0)) kilograms" } ?? "Bodyweight")
                .accessibilityHint("Type a weight")
                Spacer()
                stepButton("plus", label: "More weight", size: 48) { weightKg = (weightKg ?? 0) + 2.5 }
            }

            Button(action: onComplete) {
                Text(reps == nil ? "Choose reps" : "Log set \(setNumber)")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .disabled(reps == nil)
            .padding(.top, 4)
        }
        .alert("Weight (kg)", isPresented: $editingWeight) {
            TextField("e.g. 42.5", text: $weightEntry)
                .keyboardType(.decimalPad)
            Button("Set") {
                let parsed = Double(weightEntry.replacingOccurrences(of: ",", with: "."))
                weightKg = (parsed ?? 0) > 0 ? parsed : nil
            }
            Button("Bodyweight") { weightKg = nil }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func stepButton(_ symbol: String, label: String, size: CGFloat = 64, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.32, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .frame(width: size, height: size)
                .background(StudioColor.ink.opacity(0.07), in: Circle())
                .overlay(Circle().strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Rest instrument

/// Rest takes over the screen between sets: a calm dial that empties over
/// the rest target (wall-clock based, so it's right after a lock or
/// background), then keeps counting past it rather than cutting the user
/// off. Adjustable by ±15s; ends when the user chooses.
private struct RestInstrument: View {
    let session: TrainingSessionManager
    let upNext: String
    let isFinishing: Bool
    let onAnotherSet: () -> Void
    let onNextExercise: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = session.restRemaining(at: context.date)
            let elapsed = session.restElapsed(at: context.date)
            VStack(spacing: 18) {
                RestDial(remaining: remaining, target: session.restTargetSeconds, elapsed: elapsed)
                    .frame(width: 236, height: 236)
                    .frame(maxWidth: .infinity)
                    .sensoryFeedback(trigger: remaining <= 0) { _, isOver in
                        isOver ? StudioHaptic.restComplete : nil
                    }

                HStack(spacing: 12) {
                    adjustButton("−15s", label: "Shorten rest by 15 seconds") { session.adjustRest(by: -TrainingSessionManager.restAdjustStep) }
                    Text("Target \(TrainingMath.clock(session.restTargetSeconds))")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                        .monospacedDigit()
                        .frame(maxWidth: .infinity)
                    adjustButton("+15s", label: "Lengthen rest by 15 seconds") { session.adjustRest(by: TrainingSessionManager.restAdjustStep) }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("UP NEXT")
                        .font(StudioFont.body(9, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(StudioColor.inkSoft)
                    Text(upNext)
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: onAnotherSet) {
                    Text(remaining <= 0 ? "Start next set" : "End rest · next set")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)

                Button(action: onNextExercise) {
                    Text(session.nextExercise == nil ? (isFinishing ? "Finishing…" : "Finish workout") : "Next exercise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
                .disabled(isFinishing)
            }
        }
    }

    private func adjustButton(_ title: String, label: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(StudioFont.body(14, weight: .semibold))
            .foregroundStyle(StudioColor.ink)
            .frame(minWidth: 72, minHeight: 44)
            .background(StudioColor.ink.opacity(0.06), in: Capsule())
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }
}

/// The rest dial: a full ring that empties as rest runs down, the
/// remaining time large in its centre; past the target it holds full in
/// the accent and counts the overtime.
private struct RestDial: View {
    let remaining: Int
    let target: Int
    let elapsed: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var fraction: CGFloat {
        guard target > 0 else { return 0 }
        return CGFloat(max(0, min(1, Double(remaining) / Double(target))))
    }

    var body: some View {
        let isOver = remaining <= 0
        ZStack {
            Circle()
                .stroke(StudioColor.ink.opacity(0.07), lineWidth: 10)
            Circle()
                .trim(from: 0, to: isOver ? 1 : fraction)
                .stroke(isOver ? StudioColor.accentInk : StudioColor.ink.opacity(0.8), style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .linear(duration: 1), value: remaining)
            VStack(spacing: 4) {
                Text(isOver ? "REST COMPLETE" : "REST")
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(isOver ? StudioColor.accentInk : StudioColor.inkSoft)
                Text(isOver ? "+\(TrainingMath.clock(-remaining))" : TrainingMath.clock(remaining))
                    .font(StudioFont.hero(56, weight: .bold))
                    .foregroundStyle(StudioColor.ink)
                    .monospacedDigit()
                Text("\(TrainingMath.clock(elapsed)) rested")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isOver
            ? "Rest complete, \(-remaining) seconds over target"
            : "Resting, \(remaining) seconds remaining")
    }
}

// MARK: - Paused

private struct PausedPanel: View {
    let session: TrainingSessionManager
    let onResume: () -> Void
    let onFinish: () -> Void
    let isFinishing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Workout paused")
                    .font(StudioFont.hero(24, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text("The clock and rest are stopped. Everything logged is saved.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            Button(action: onResume) {
                Text("Resume").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            if !session.completedSets.isEmpty {
                Button(action: onFinish) {
                    Text(isFinishing ? "Finishing…" : "Finish workout").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
                .disabled(isFinishing)
            }
        }
        .padding(18)
        .background(StudioColor.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

// MARK: - Correct a set

private struct SetCorrectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    let set: CompletedSet
    let onSave: (Int, Double?) -> Void
    let onDelete: () -> Void

    @State private var reps: Int
    @State private var weightText: String

    init(set: CompletedSet, onSave: @escaping (Int, Double?) -> Void, onDelete: @escaping () -> Void) {
        self.set = set
        self.onSave = onSave
        self.onDelete = onDelete
        _reps = State(initialValue: set.reps)
        _weightText = State(initialValue: set.weightKg.map { TrainingMath.weightText($0) } ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Correct set \(set.setIndex + 1) · \(set.exercise.name)")
                .font(StudioFont.body(15, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Stepper(value: $reps, in: 1...100) {
                Text("\(reps) reps")
                    .font(StudioFont.body(17, weight: .semibold))
                    .monospacedDigit()
            }
            TextField("Weight in kg (empty = bodyweight)", text: $weightText)
                .keyboardType(.decimalPad)
                .font(StudioFont.body(15))
                .padding(12)
                .background(StudioColor.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
            HStack(spacing: 12) {
                Button("Remove set", role: .destructive) {
                    onDelete()
                    dismiss()
                }
                .buttonStyle(.outlineCTA)
                Button("Save") {
                    let parsed = Double(weightText.replacingOccurrences(of: ",", with: "."))
                    onSave(reps, (parsed ?? 0) > 0 ? parsed : nil)
                    dismiss()
                }
                .buttonStyle(.illuminatedCTA)
            }
        }
        .padding(24)
    }
}

/// Adding an exercise mid-workout — through the Sombrey Exercise Library.
private struct AddExerciseDuringWorkoutView: View {
    @Bindable var session: TrainingSessionManager

    var body: some View {
        ExercisePickerSheet(title: "Add exercise") { exercise in
            session.addExerciseDuringWorkout(exercise)
        }
    }
}
