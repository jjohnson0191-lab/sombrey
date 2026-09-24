import SwiftUI
import UIKit
import ImageIO
import ConvexMobile

/// One exercise in the Sombrey Exercise Library: name and muscle, its
/// visual (only when one may be shown), how to perform it, muscles,
/// equipment, difficulty — then Add to workout, and alternatives / similar
/// exercises. Every field is the library's; nothing is written in to fill
/// space, and an absent field is simply not shown.
struct ExerciseDetailView: View {
    let exerciseId: String
    /// Opens another exercise (alternatives / similar) in the same stack.
    var onOpen: ((String) -> Void)? = nil
    @State private var detail = ConvexQuery<LibraryExerciseDetail?>()
    @State private var addingToWorkout = false
    @State private var added: String?

    var body: some View {
        ScrollView {
            if let exercise = detail.value.flatMap({ $0 }) {
                content(exercise)
                    .padding(20)
            } else if detail.isLoading {
                ProgressView().tint(StudioColor.ink).padding(.top, 80)
            } else {
                Text("This exercise isn't in the library any more.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .padding(24)
            }
        }
        .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
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
        .sensoryFeedback(.success, trigger: added)
    }

    private func content(_ e: LibraryExerciseDetail) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                TrainEyebrow(text: ([e.primaryMuscles.first ?? ExerciseVocabulary.muscleGroup(e.muscleGroup)] + [e.category.map(ExerciseVocabulary.category)].compactMap { $0 }).joined(separator: " · "))
                Text(e.name)
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .studioReveal(index: 0)

            if let url = e.mediaUrl.flatMap(URL.init(string:)) {
                ExerciseMediaView(url: url)
                    .frame(maxWidth: .infinity)
                    .frame(height: 260)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
                    .accessibilityLabel("Demonstration of \(e.name)")
                    .studioReveal(index: 1)
            }

            Button {
                addingToWorkout = true
            } label: {
                Text(added.map { "Added to \($0)" } ?? "Add to workout").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .studioReveal(index: 1)

            if !e.description.isEmpty {
                Text(e.description)
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .studioCard()
            }

            if !e.instructions.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    TrainEyebrow(text: "How to perform")
                    ForEach(Array(e.instructions.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("\(index + 1)")
                                .font(StudioFont.hero(18, weight: .semibold))
                                .foregroundStyle(StudioColor.accentInk)
                                .frame(width: 22, alignment: .leading)
                            Text(step)
                                .font(StudioFont.body(14))
                                .foregroundStyle(StudioColor.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .studioCard()
                .studioReveal(index: 2)
            }

            facts(e)
                .studioReveal(index: 3)

            related("Alternatives", e.alternatives, pending: e.relatedState == "pending")
            related("Similar exercises", e.similar, pending: false)
        }
    }

    private func facts(_ e: LibraryExerciseDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if !e.primaryMuscles.isEmpty || !e.secondaryMuscles.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    TrainEyebrow(text: "Muscles")
                    if !e.primaryMuscles.isEmpty { factLine("Primary", e.primaryMuscles.joined(separator: ", ")) }
                    if !e.secondaryMuscles.isEmpty { factLine("Secondary", e.secondaryMuscles.joined(separator: ", ")) }
                }
            }
            if !e.equipment.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    TrainEyebrow(text: "Equipment")
                    Text(e.equipment.joined(separator: ", "))
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                }
            }
            if let difficulty = e.difficulty {
                VStack(alignment: .leading, spacing: 8) {
                    TrainEyebrow(text: "Difficulty")
                    DifficultyScale(level: difficulty)
                }
            }
            if let movement = ExerciseVocabulary.movement(mechanic: e.mechanic, force: e.force, unilateral: e.isUnilateral) {
                VStack(alignment: .leading, spacing: 8) {
                    TrainEyebrow(text: "Movement")
                    Text(movement)
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    private func factLine(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(StudioFont.body(14, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func related(_ title: String, _ items: [LibraryExercise], pending: Bool) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                TrainEyebrow(text: title)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(items) { item in
                            Button { onOpen?(item.id) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.name)
                                        .font(StudioFont.body(14, weight: .semibold))
                                        .foregroundStyle(StudioColor.ink)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                    Text(item.summaryLine)
                                        .font(StudioFont.body(11))
                                        .foregroundStyle(StudioColor.inkSoft)
                                        .lineLimit(1)
                                }
                                .frame(width: 170, height: 76, alignment: .topLeading)
                                .padding(12)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
                            }
                            .buttonStyle(.plain)
                            .disabled(onOpen == nil)
                        }
                    }
                }
                .scrollClipDisabled()
            }
        } else if pending {
            HStack(spacing: 8) {
                ProgressView().tint(StudioColor.ink)
                Text("Finding alternatives…")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }
}

/// Beginner · intermediate · advanced as three ticks, the level lit.
private struct DifficultyScale: View {
    let level: String
    private let levels = ["beginner", "intermediate", "advanced"]

    var body: some View {
        let index = levels.firstIndex(of: level) ?? 0
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Capsule()
                        .fill(i <= index ? StudioColor.accentInk : StudioColor.ink.opacity(0.14))
                        .frame(width: 22, height: 5)
                }
            }
            Text(ExerciseVocabulary.difficulty(level))
                .font(StudioFont.body(14, weight: .medium))
                .foregroundStyle(StudioColor.ink)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Demonstration media

/// A demonstration GIF from Sombrey's own storage, animated — or its first
/// frame, still, under Reduce Motion.
struct ExerciseMediaView: UIViewRepresentable {
    let url: URL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.contentMode = .scaleAspectFit
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        let still = reduceMotion
        if let cached = ExerciseMediaCache.shared.image(for: url, still: still) {
            view.image = cached
            return
        }
        Task {
            guard let image = await ExerciseMediaCache.shared.load(url, still: still) else { return }
            await MainActor.run { view.image = image }
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
            Form {
                Section("Where") {
                    if session.phase == .active {
                        destinationRow(.currentWorkout, title: "Workout in progress", detail: "Up next in \(session.workoutName)")
                    }
                    destinationRow(.nextSession, title: "Next session", detail: session.selectedExercises.isEmpty ? "Start it from Train" : "\(session.selectedExercises.count) exercise\(session.selectedExercises.count == 1 ? "" : "s") so far")
                    ForEach(plans.value ?? []) { plan in
                        ForEach(Array(plan.days.enumerated()), id: \.offset) { index, day in
                            destinationRow(.planDay(planId: plan.id, dayIndex: index), title: "\(plan.name) · \(day.name)", detail: "\(day.exercises.count) exercise\(day.exercises.count == 1 ? "" : "s")")
                        }
                        destinationRow(.newPlanDay(planId: plan.id, dayCount: plan.days.count), title: "\(plan.name) · new day", detail: nil)
                    }
                }
                Section("Target") {
                    Stepper("\(sets) sets", value: $sets, in: 1...20)
                    Stepper("\(reps) reps", value: $reps, in: 1...100)
                    HStack {
                        Text("Weight")
                        Spacer()
                        TextField("Bodyweight", text: $weightText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 120)
                        Text("kg").foregroundStyle(StudioColor.inkSoft)
                    }
                    Stepper("Rest \(TrainingMath.clock(restSeconds))", value: $restSeconds, in: 0...600, step: 15)
                }
                if let saveError {
                    Section { Text(saveError).foregroundStyle(StudioColor.danger) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle(exercise.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Adding…" : "Add", action: save).disabled(destination == nil || isSaving)
                }
            }
        }
        .task {
            plans.subscribe(to: "trainingPlans:list")
            if destination == nil { destination = session.phase == .active ? .currentWorkout : .nextSession }
        }
    }

    private func destinationRow(_ value: Destination, title: String, detail: String?) -> some View {
        Button {
            destination = value
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(StudioColor.ink)
                    if let detail {
                        Text(detail).font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft)
                    }
                }
                Spacer()
                if destination == value {
                    Image(systemName: "checkmark").foregroundStyle(StudioColor.accentInk)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(destination == value ? .isSelected : [])
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
                saveError = "Couldn't add it to the plan. Check your connection and try again."
            }
            isSaving = false
        }
    }
}
