import SwiftUI
import UIKit
import ImageIO
import ConvexMobile

/// An exercise's page in the Sombrey Exercise Library, read in the order
/// someone about to perform it needs: what it is, what it looks like, the
/// essentials (primary muscle, equipment, difficulty), how to perform it,
/// the muscles in full — then alternatives and similar exercises. "Add to
/// workout" stays within reach at the bottom. A field the library doesn't
/// hold is simply not shown.
struct ExerciseDetailView: View {
    let exerciseId: String
    /// Opens another exercise (alternatives / similar) in the same stack.
    var onOpen: ((String) -> Void)? = nil
    @State private var detail = ConvexQuery<LibraryExerciseDetail?>()
    @State private var addingToWorkout = false
    @State private var added: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            if let exercise = detail.value.flatMap({ $0 }) {
                content(exercise)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
            } else if detail.isLoading {
                HStack(spacing: 10) {
                    ProgressView().tint(StudioColor.ink).controlSize(.small)
                    Text("Opening exercise…")
                        .font(StudioFont.body(14))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("This exercise isn't in the library any more.")
                        .font(StudioFont.body(16, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                    Text("Workouts you've already logged with it are unaffected.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
        }
        .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if detail.value.flatMap({ $0 }) != nil {
                addBar
            }
        }
        .task(id: exerciseId) {
            detail.subscribe(to: "exerciseLibrary:detail", with: ["id": exerciseId])
            // Brings in alternatives, similar exercises and the visual, when
            // they aren't in the library yet. Silent if unavailable.
            let _: LibraryPrepareResult? = try? await ConvexClientProvider.client.action("exerciseLibrary:prepare", with: ["id": exerciseId])
        }
        .sheet(isPresented: $addingToWorkout) {
            if let exercise = detail.value.flatMap({ $0 }) {
                AddToWorkoutSheet(exercise: exercise.asExercise) { added = $0 }
                    .presentationDetents([.large])
            }
        }
        .sensoryFeedback(StudioHaptic.workoutFinish, trigger: added)
    }

    // MARK: Add bar

    private var addBar: some View {
        VStack(spacing: 6) {
            if let added {
                Text("Added to \(added)")
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .transition(.opacity)
            }
            Button {
                addingToWorkout = true
            } label: {
                Text(added == nil ? "Add to workout" : "Add again").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background {
            LinearGradient(colors: [StudioColor.env4.opacity(0), StudioColor.env4.opacity(0.85)], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
        }
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: added)
    }

    // MARK: Content

    private func content(_ e: LibraryExerciseDetail) -> some View {
        VStack(alignment: .leading, spacing: 26) {
            VStack(alignment: .leading, spacing: 8) {
                Text(classification(e).uppercased())
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(StudioColor.inkSoft)
                Text(e.name)
                    .font(StudioFont.hero(34, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .studioReveal(index: 0)

            if let url = e.mediaUrl.flatMap(URL.init(string:)) {
                ExerciseVisual(url: url, name: e.name)
                    .studioReveal(index: 1, distance: 10)
            }

            essentials(e)
                .studioReveal(index: 2)

            // The source's descriptions restate the facts above in a fixed
            // template, so the page leads with the steps instead.

            if !e.instructions.isEmpty {
                VStack(alignment: .leading, spacing: 16) {
                    TrainEyebrow(text: "How to perform")
                    ForEach(Array(e.instructions.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 14) {
                            Text(String(format: "%02d", index + 1))
                                .font(StudioFont.hero(15, weight: .semibold))
                                .foregroundStyle(StudioColor.accentInk)
                                .monospacedDigit()
                                .frame(minWidth: 24, alignment: .leading)
                            Text(step)
                                .font(StudioFont.body(15))
                                .foregroundStyle(StudioColor.ink)
                                .lineSpacing(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .studioCard()
                .studioReveal(index: 3)
            }

            if !e.primaryMuscles.isEmpty || !e.secondaryMuscles.isEmpty || movement(e) != nil {
                VStack(alignment: .leading, spacing: 18) {
                    if !e.primaryMuscles.isEmpty { fact("Primary muscles", e.primaryMuscles.joined(separator: ", ")) }
                    if !e.secondaryMuscles.isEmpty { fact("Also works", e.secondaryMuscles.joined(separator: ", ")) }
                    if let movement = movement(e) { fact("Movement", movement) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .studioCard()
                .studioReveal(index: 4)
            }

            related("Alternatives", e.alternatives, pending: e.relatedState == "pending")
            related("Similar exercises", e.similar, pending: false)
        }
    }

    private func classification(_ e: LibraryExerciseDetail) -> String {
        ([e.primaryMuscles.first ?? ExerciseVocabulary.muscleGroup(e.muscleGroup)] + [e.category.map(ExerciseVocabulary.category)].compactMap { $0 })
            .joined(separator: " · ")
    }

    private func movement(_ e: LibraryExerciseDetail) -> String? {
        ExerciseVocabulary.movement(mechanic: e.mechanic, force: e.force, unilateral: e.isUnilateral)
    }

    /// Primary · Equipment · Difficulty — the three things to know before
    /// starting, set in type rather than badges.
    private func essentials(_ e: LibraryExerciseDetail) -> some View {
        EssentialsRow(items: Self.essentialItems(e))
    }

    static func essentialItems(_ e: LibraryExerciseDetail) -> [EssentialsRow.Item] {
        var items: [EssentialsRow.Item] = []
        if let primary = e.primaryMuscles.first { items.append(.init(label: "Primary", value: primary, level: nil)) }
        if !e.equipment.isEmpty { items.append(.init(label: "Equipment", value: e.equipment.joined(separator: ", "), level: nil)) }
        if let difficulty = e.difficulty { items.append(.init(label: "Difficulty", value: ExerciseVocabulary.difficulty(difficulty), level: difficulty)) }
        return items
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            TrainEyebrow(text: label)
            Text(value)
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func related(_ title: String, _ items: [LibraryExercise], pending: Bool) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                TrainEyebrow(text: title)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(items) { item in
                            Button { onOpen?(item.id) } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(item.classification.uppercased())
                                        .font(StudioFont.body(9, weight: .semibold))
                                        .tracking(1.1)
                                        .foregroundStyle(StudioColor.paperSoft)
                                        .lineLimit(1)
                                    Text(item.name)
                                        .font(StudioFont.hero(15, weight: .semibold))
                                        .foregroundStyle(StudioColor.paper)
                                        .lineLimit(3)
                                        .multilineTextAlignment(.leading)
                                    Spacer(minLength: 0)
                                    if let equipment = item.equipment.first {
                                        Text(equipment)
                                            .font(StudioFont.body(11))
                                            .foregroundStyle(StudioColor.paperFaint)
                                            .lineLimit(1)
                                    }
                                }
                                .padding(14)
                                .frame(width: 176, height: 118, alignment: .topLeading)
                                .background { GraphiteSurface(cornerRadius: 18) }
                            }
                            .buttonStyle(.plain)
                            .disabled(onOpen == nil)
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .scrollClipDisabled()
            }
        } else if pending {
            HStack(spacing: 8) {
                ProgressView().tint(StudioColor.ink).controlSize(.small)
                Text("Finding alternatives…")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }
}

/// The essentials in a row, divided by hairlines — or stacked when the row
/// doesn't fit (small screens, large text).
struct EssentialsRow: View {
    struct Item: Hashable {
        let label: String
        let value: String
        let level: String?
    }

    let items: [Item]

    var body: some View {
        if !items.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element) { index, item in
                        cell(item).frame(maxWidth: .infinity, alignment: .leading)
                        if index < items.count - 1 {
                            Rectangle().fill(StudioColor.ink.opacity(0.1)).frame(width: 1).padding(.horizontal, 12)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(items, id: \.self) { cell($0) }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func cell(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TrainEyebrow(text: item.label)
            Text(item.value)
                .font(StudioFont.body(15, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let level = item.level {
                DifficultyTicks(level: level)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Beginner · intermediate · advanced as three ticks, the level lit.
private struct DifficultyTicks: View {
    let level: String
    private let levels = ["beginner", "intermediate", "advanced"]

    var body: some View {
        let index = levels.firstIndex(of: level) ?? 0
        HStack(spacing: 3) {
            ForEach(0..<3) { i in
                Capsule()
                    .fill(i <= index ? StudioColor.accentInk : StudioColor.ink.opacity(0.14))
                    .frame(width: 16, height: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Demonstration visual

/// The demonstration, framed as part of the page: a white stage (the
/// demonstrations' own ground) inside a soft glass edge. It plays on its own page only, can be paused, and is a
/// still frame under Reduce Motion.
private struct ExerciseVisual: View {
    let url: URL
    let name: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var paused = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)
        ZStack(alignment: .bottomTrailing) {
            // The demonstrations are drawn on white, so the stage is white:
            // the figure fills the frame instead of sitting on a square.
            ExerciseMediaView(url: url, still: reduceMotion || paused)
                .padding(18)
                .frame(maxWidth: .infinity)
                .aspectRatio(1.15, contentMode: .fit)
                .background(Color.white)
            if !reduceMotion {
                Button {
                    paused.toggle()
                } label: {
                    Image(systemName: paused ? "play.fill" : "pause.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .frame(width: 36, height: 36)
                        .background(.ultraThinMaterial, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .padding(8)
                .accessibilityLabel(paused ? "Play demonstration" : "Pause demonstration")
            }
        }
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(LinearGradient(colors: [Color.white.opacity(0.8), StudioColor.ink.opacity(0.06)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        }
        .shadow(color: StudioColor.env0.opacity(0.12), radius: 16, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Demonstration of \(name)")
    }
}

/// A demonstration GIF from Sombrey's own storage, animated — or its first
/// frame, still (list cards, Reduce Motion, paused).
struct ExerciseMediaView: UIViewRepresentable {
    let url: URL
    var still = false

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.contentMode = .scaleAspectFit
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        let still = still
        if let cached = ExerciseMediaCache.shared.image(for: url, still: still) {
            view.image = cached
            return
        }
        let url = url
        Task {
            guard let image = await ExerciseMediaCache.shared.load(url, still: still) else { return }
            await MainActor.run {
                UIView.transition(with: view, duration: 0.25, options: .transitionCrossDissolve) { view.image = image }
            }
        }
    }
}

/// Decoded demonstration images, kept in memory for the session.
final class ExerciseMediaCache: @unchecked Sendable {
    static let shared = ExerciseMediaCache()
    private let cache = NSCache<NSString, UIImage>()

    private func key(_ url: URL, _ still: Bool) -> NSString { "\(still ? "still" : "anim")|\(url.absoluteString)" as NSString }

    func image(for url: URL, still: Bool) -> UIImage? { cache.object(forKey: key(url, still)) }

    func load(_ url: URL, still: Bool) async -> UIImage? {
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        guard let image = Self.decode(data, still: still) else { return nil }
        cache.setObject(image, forKey: key(url, still))
        return image
    }

    static func decode(_ data: Data, still: Bool) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 0 else { return nil }
        if still || count == 1 {
            return CGImageSourceCreateImageAtIndex(source, 0, nil).map { UIImage(cgImage: $0) }
        }
        var frames: [UIImage] = []
        var duration: Double = 0
        for index in 0..<count {
            guard let frame = CGImageSourceCreateImageAtIndex(source, index, nil) else { continue }
            frames.append(UIImage(cgImage: frame))
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
            duration += delay < 0.02 ? 0.1 : delay
        }
        return UIImage.animatedImage(with: frames, duration: duration)
    }
}

// MARK: - Add to workout

/// Adding an exercise from the library into Sombrey's own training: the
/// workout in progress, the next session, or a day of one of the user's
/// training plans — with the user's sets, reps, weight and rest.
struct AddToWorkoutSheet: View {
    let exercise: Exercise
    let onAdded: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(TrainingSessionManager.self) private var session
    @State private var plans = ConvexQuery<[TrainingPlanDTO]>()
    @State private var destination: Destination?
    @State private var sets = 3
    @State private var reps = 10
    @State private var restSeconds = 90
    @State private var weightText = ""
    @State private var isSaving = false
    @State private var saveError: String?
    @FocusState private var weightFocused: Bool

    enum Destination: Hashable {
        case currentWorkout
        case nextSession
        case planDay(planId: String, dayIndex: Int)
        case newPlanDay(planId: String, dayCount: Int)
    }

    private var weightKg: Double? {
        Double(weightText.replacingOccurrences(of: ",", with: ".")).flatMap { $0 > 0 ? $0 : nil }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 6) {
                        TrainEyebrow(text: "Add to workout")
                        Text(exercise.name)
                            .font(StudioFont.hero(26, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        TrainEyebrow(text: "Where")
                        VStack(spacing: 8) {
                            if session.phase == .active {
                                destinationRow(.currentWorkout, title: "Workout in progress", detail: "Up next in \(session.workoutName)")
                            }
                            destinationRow(.nextSession, title: "Next session",
                                           detail: session.selectedExercises.isEmpty ? "Ready to start from Train" : "\(session.selectedExercises.count) exercise\(session.selectedExercises.count == 1 ? "" : "s") so far")
                            ForEach(plans.value ?? []) { plan in
                                ForEach(Array(plan.days.enumerated()), id: \.offset) { index, day in
                                    destinationRow(.planDay(planId: plan.id, dayIndex: index), title: "\(plan.name) · \(day.name)",
                                                   detail: "\(day.exercises.count) exercise\(day.exercises.count == 1 ? "" : "s")")
                                }
                                destinationRow(.newPlanDay(planId: plan.id, dayCount: plan.days.count), title: "\(plan.name) · new day", detail: nil)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        TrainEyebrow(text: "Target")
                        VStack(spacing: 0) {
                            TargetStepper(label: "Sets", value: $sets, range: 1...20, step: 1, format: { "\($0)" })
                            divider
                            TargetStepper(label: "Reps", value: $reps, range: 1...100, step: 1, format: { "\($0)" })
                            divider
                            HStack {
                                Text("Weight")
                                    .font(StudioFont.body(15, weight: .medium))
                                    .foregroundStyle(StudioColor.ink)
                                Spacer()
                                TextField("", text: $weightText, prompt: Text("Bodyweight").foregroundStyle(StudioColor.inkFaint))
                                    .font(StudioFont.hero(20, weight: .semibold))
                                    .foregroundStyle(StudioColor.ink)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .focused($weightFocused)
                                    .frame(maxWidth: 140)
                                Text("kg")
                                    .font(StudioFont.body(13, weight: .medium))
                                    .foregroundStyle(StudioColor.inkSoft)
                            }
                            .frame(minHeight: 56)
                            divider
                            TargetStepper(label: "Rest", value: $restSeconds, range: 0...600, step: 15, format: { TrainingMath.clock($0) })
                        }
                        .padding(.horizontal, 16)
                        .studioCardPlain()
                    }

                    if let saveError {
                        Text(saveError)
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.danger)
                    }
                }
                .padding(20)
                .padding(.bottom, 90)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { weightFocused = false }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: save) {
                    Text(isSaving ? "Adding…" : "Add to workout").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                .disabled(destination == nil || isSaving)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
        }
        .task {
            plans.subscribe(to: "trainingPlans:list")
            if destination == nil { destination = session.phase == .active ? .currentWorkout : .nextSession }
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: destination)
    }

    private var divider: some View {
        Rectangle().fill(StudioColor.ink.opacity(0.07)).frame(height: 1)
    }

    private func destinationRow(_ value: Destination, title: String, detail: String?) -> some View {
        let isOn = destination == value
        return Button {
            destination = value
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(StudioFont.body(15, weight: .semibold))
                        .foregroundStyle(isOn ? StudioColor.paper : StudioColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail {
                        Text(detail)
                            .font(StudioFont.body(12))
                            .foregroundStyle(isOn ? StudioColor.paperSoft : StudioColor.inkSoft)
                    }
                }
                Spacer()
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(isOn ? StudioColor.paper : StudioColor.ink.opacity(0.25))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 56)
            .background {
                if isOn {
                    GraphiteSurface(cornerRadius: 18)
                } else {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.ultraThinMaterial).environment(\.colorScheme, .light)
                        .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(StudioColor.ink.opacity(0.07), lineWidth: 1) }
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected, .isButton] : .isButton)
    }

    private func save() {
        guard let destination else { return }
        let target = TrainingSessionManager.PlanTarget(sets: sets, reps: reps, restSeconds: restSeconds, weightKg: weightKg)
        switch destination {
        case .currentWorkout:
            session.addExerciseDuringWorkout(exercise, target: target)
            onAdded("your workout")
            dismiss()
        case .nextSession:
            session.addToNextSession(exercise, target: target)
            onAdded("your next session")
            dismiss()
        case .planDay(let planId, let dayIndex):
            persist(planId: planId, dayIndex: dayIndex, newDayName: nil)
        case .newPlanDay(let planId, let dayCount):
            persist(planId: planId, dayIndex: dayCount, newDayName: "Day \(dayCount + 1)")
        }
    }

    private func persist(planId: String, dayIndex: Int, newDayName: String?) {
        isSaving = true
        saveError = nil
        let exerciseId = exercise.id
        let sets = sets, reps = reps, rest = restSeconds, weight = weightKg
        Task {
            var args: [String: ConvexEncodable?] = [
                "planId": planId, "dayIndex": Double(dayIndex), "exerciseId": exerciseId,
                "sets": Double(sets), "reps": Double(reps), "restSeconds": Double(rest),
            ]
            if let weight { args["targetWeightKg"] = weight }
            if let newDayName { args["newDayName"] = newDayName }
            do {
                try await ConvexClientProvider.client.mutation("trainingPlans:addExercise", with: args)
                onAdded("your plan")
                dismiss()
            } catch {
                saveError = "We couldn't add it to your plan. Check your connection and try again."
            }
            isSaving = false
        }
    }
}

/// A target value as an instrument: label, a display numeral, and − / +
/// keys (44pt) with a selection tick on each change.
struct TargetStepper: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    let step: Int
    let format: (Int) -> String

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
            Spacer()
            key("minus", enabled: value - step >= range.lowerBound) { value -= step }
            Text(format(value))
                .font(StudioFont.hero(20, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .monospacedDigit()
                .frame(minWidth: 52)
                .studioNumericTransition(Double(value))
            key("plus", enabled: value + step <= range.upperBound) { value += step }
        }
        .frame(minHeight: 56)
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(format(value))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: if value + step <= range.upperBound { value += step }
            case .decrement: if value - step >= range.lowerBound { value -= step }
            @unknown default: break
            }
        }
    }

    private func key(_ symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(enabled ? StudioColor.ink : StudioColor.inkFaint)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
                .environment(\.colorScheme, .light)
                .overlay { Circle().strokeBorder(StudioColor.ink.opacity(0.07), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

private extension View {
    /// The Studio card surface without its own padding (rows set their own).
    func studioCardPlain() -> some View {
        background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
    }
}
