import SwiftUI
import PhotosUI
import UIKit

/// `mealPhotos:get` — the live status and estimate. Never carries the photo.
struct PhotoMealDTO: Decodable, Equatable {
    struct Item: Decodable, Equatable {
        let foodName: String
        let grams: Double
        let calories: Double
        let protein: Double
        let carbs: Double
        let fat: Double
        let matched: Bool
        // How it was read and matched (absent on analyses from before them).
        var preparationState: String? = nil     // raw | dry | cooked | fried | … | unknown
        var confidence: String? = nil           // high | medium | low (Gemini's own signal)
        var matchedFood: String? = nil          // the Edamam entry used
        var preparationMatched: Bool? = nil     // that entry states the preparation seen
        var preparationAssumed: Bool? = nil     // cooked-or-dry unseen; matched as cooked
        var lookupIssue: String? = nil          // why there's no nutrition (not shown raw)
    }
    let id: String
    let status: String          // pending | done | error
    let reason: String?         // not_configured | no_food | nutrition_unavailable | failed
    let items: [Item]
    let calories: Double?
    let protein: Double?
    let carbs: Double?
    let fat: Double?
    let suggestedName: String?
    let confirmed: Bool
}

/// `mealPhotos:confirm`'s result.
struct PhotoMealConfirmResult: Decodable {
    let foodId: String
    let alreadyLogged: Bool
}

/// Nutrition › AI Macro Calculator — photograph a meal, Sombrey estimates
/// it, you review and confirm, and only then is it logged (through the
/// normal nutrition log, so totals, history and the Coach see it).
///
/// Privacy, said on screen before the photo is taken: the photo goes to
/// Google Gemini (food identification, portion estimate) and food names to
/// Edamam (nutrition); it's deleted from Sombrey's storage as soon as it's
/// analysed. It's resized and re-encoded first (no location/camera data).
struct MacroCalculatorFlow: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Stage: Equatable { case capture, uploading, analyzing(String), review(String), logged(String) }

    @State private var stage: Stage = .capture
    @State private var preview: UIImage?
    @State private var pickerItem: PhotosPickerItem?
    @State private var showingCamera = false
    @State private var analysis = ConvexQuery<PhotoMealDTO?>()
    @State private var problem: String?
    /// An analysis that ended without an estimate: title + plain message.
    @State private var notice: (title: String, message: String)?

    // Review fields — the user's own values from here on.
    @State private var name = ""
    @State private var mealType = MacroCalculatorFlow.defaultMealType()
    @State private var calories: Double = 0
    @State private var protein: Double = 0
    @State private var carbs: Double = 0
    @State private var fat: Double = 0
    @State private var logging = false
    @State private var loggedTick = 0
    // Per-food corrections (index into the analysis's items), the food
    // open for review, and whether the user typed their own total.
    @State private var edits: [Int: FoodEdit] = [:]
    @State private var reviewing: ReviewTarget?
    @State private var totalTypedByUser = false
    @State private var estimateTick = 0
    @State private var adjustTick = 0

    struct ReviewTarget: Identifiable { let index: Int; var id: Int { index } }

    nonisolated static let mealTypes = ["breakfast", "lunch", "dinner", "snack"]

    var body: some View {
        EnvironmentView(scene: .aiCoach) {
            VStack(spacing: 0) {
                topBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        switch stage {
                        case .capture: captureStage
                        case .uploading: MealAnalyzingPanel(image: preview, sending: true)
                        case .analyzing: MealAnalyzingPanel(image: preview, sending: false)
                        case .review: reviewStage
                        case .logged(let meal): loggedStage(meal)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                pickerItem = nil
                guard let data, let image = UIImage(data: data) else { problem = "That photo couldn't be read."; return }
                await begin(with: image)
            }
        }
        .onChange(of: analysis.value) { _, value in
            guard let dto = value ?? nil, case .analyzing(let id) = stage, dto.id == id else { return }
            switch dto.status {
            case "done":
                name = dto.suggestedName.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? ""
                calories = dto.calories ?? 0
                protein = dto.protein ?? 0
                carbs = dto.carbs ?? 0
                fat = dto.fat ?? 0
                edits = [:]
                totalTypedByUser = false
                estimateTick += 1
                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .review(id) }
            case "error":
                notice = (Self.title(for: dto.reason), Self.message(for: dto.reason))
                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .capture }
            default: break
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker(device: .rear, allowsEditing: false) { image in
                showingCamera = false
                if let image { Task { await begin(with: image) } }
            }
            .ignoresSafeArea()
        }
        .sensoryFeedback(StudioHaptic.mealLogged, trigger: loggedTick)
        .sensoryFeedback(StudioHaptic.estimateReady, trigger: estimateTick)
        .sensoryFeedback(StudioHaptic.estimateAdjusted, trigger: adjustTick)
        .sheet(item: $reviewing) { target in
            if let items = (analysis.value ?? nil)?.items, items.indices.contains(target.index) {
                let item = items[target.index]
                FoodReviewSheet(item: item, draft: MacroReview.edit(for: item, edits[target.index])) { applyEdit(target.index, $0) }
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: Bar

    private var topBar: some View {
        HStack {
            Button(isLogged ? "Done" : "Cancel") { close() }
                .font(StudioFont.body(15, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .frame(minHeight: 44)
            Spacer()
            SombreyLogo(size: .header, tone: .onLight)
            Spacer()
            Color.clear.frame(width: 60, height: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var isLogged: Bool { if case .logged = stage { return true } else { return false } }

    // MARK: Capture

    private var captureStage: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("NUTRITION")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                Text("AI Macro Calculator")
                    .font(StudioFont.hero(30, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Take a photo of your meal. Sombrey estimates what's on the plate — you check it before anything is logged.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 16)

            VStack(alignment: .leading, spacing: 10) {
                guidance("square.dashed", "The whole plate in frame, from slightly above")
                guidance("sun.max", "Good, even light — no flash glare")
                guidance("fork.knife", "Before you eat, with everything that's part of the meal")
            }

            if let notice {
                MealAnalysisNotice(title: notice.title, message: notice.message)
                    .studioReveal()
            }
            if let problem {
                Text(problem)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("macro.problem")
            }

            VStack(spacing: 10) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { problem = nil; notice = nil; showingCamera = true } label: {
                        Label("Take photo", systemImage: "camera").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.illuminatedCTA)
                    .accessibilityIdentifier("macro.takePhoto")
                }
                PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                    Text("Choose from library").frame(maxWidth: .infinity)
                }
                .buttonStyle(.outlineCTA)
            }

            Text("Your photo is resized and sent to Google Gemini to identify the food and estimate portions; food names go to Edamam for nutrition. It's deleted as soon as it's analysed. Image-based nutrition is an estimate.")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func guidance(_ glyph: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: glyph)
                .font(.system(size: 13))
                .foregroundStyle(StudioColor.inkSoft)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(text)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Review

    private var reviewStage: some View {
        let items = (analysis.value ?? nil)?.items ?? []
        let completeness = MacroReview.completeness(items, edits: edits, totalTypedByUser: totalTypedByUser)
        let toReview = items.indices.filter { MacroReview.needsReview(MacroReview.signal(items[$0], edits[$0])) }.count
        let uncountedOnly = items.indices.allSatisfy { !MacroReview.edit(for: items[$0], edits[$0]).included || MacroReview.isUncounted(items[$0], edits[$0]) }
        return VStack(alignment: .leading, spacing: 22) {
            if let preview {
                ZStack(alignment: .bottomLeading) {
                    MealAnalysisImage(image: preview, analyzing: false, height: 200)
                    completenessBadge(completeness)
                        .padding(12)
                }
                .padding(.top, 16)
                .studioReveal()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("SOMBREY ESTIMATE")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                TextField("Meal name", text: $name)
                    .font(StudioFont.hero(24, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .submitLabel(.done)
                    .accessibilityLabel("Meal name")
            }
            .studioReveal(index: 1)

            VStack(alignment: .leading, spacing: 14) {
                MealEstimateHeader(completeness: completeness, calories: $calories) { totalTypedByUser = true }
                HStack(spacing: 10) {
                    macroCell("Protein", $protein)
                    macroCell("Carbs", $carbs)
                    macroCell("Fat", $fat)
                }
            }
            .studioReveal(index: 2)

            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("WHAT SOMBREY SAW")
                            .font(StudioFont.body(10, weight: .semibold))
                            .tracking(1.6)
                            .foregroundStyle(StudioColor.inkSoft)
                        Spacer()
                        if toReview > 0 {
                            Text(toReview == 1 ? "1 to review" : "\(toReview) to review")
                                .font(StudioFont.body(11, weight: .semibold))
                                .foregroundStyle(StudioColor.caution)
                        }
                    }
                    ForEach(items.indices, id: \.self) { index in
                        FoodResultRow(item: items[index], edit: edits[index]) { reviewing = ReviewTarget(index: index) }
                    }
                    Text("Tap a food to correct its portion, add what Sombrey couldn't find, or remove it.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .studioReveal(index: 3)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("MEAL")
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(StudioColor.inkSoft)
                StudioModePills(
                    options: Self.mealTypes.map { StudioModeOption(value: $0, label: $0.uppercased(), accessibilityLabel: $0.capitalized) },
                    selection: $mealType
                )
            }

            if let problem {
                Text(problem)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.danger)
            }

            VStack(spacing: 10) {
                Button { confirm() } label: {
                    Group {
                        if logging { ProgressView().tint(StudioColor.ink) } else { Text("Log meal") }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                // Nothing counted and nothing typed: logging would record a false 0.
                .disabled(logging || name.trimmingCharacters(in: .whitespaces).isEmpty || (uncountedOnly && calories <= 0))
                .accessibilityIdentifier("macro.logMeal")
                Text(Self.confirmNote(completeness))
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Discard") { close() }
                    .buttonStyle(.outlineCTA)
            }
        }
    }

    /// Complete vs partial, readable in a second, on the photo itself.
    private func completenessBadge(_ completeness: MacroReview.Completeness) -> some View {
        let (text, partial): (String, Bool) = {
            switch completeness {
            case .complete(let foods): return (foods == 1 ? "1 FOOD · ALL COUNTED" : "\(foods) FOODS · ALL COUNTED", false)
            case .partial(let counted, let of): return ("\(counted) OF \(of) COUNTED", true)
            case .adjusted: return ("ADJUSTED BY YOU", false)
            }
        }()
        return HStack(spacing: 6) {
            Circle().fill(partial ? StudioColor.caution : StudioColor.nutrition).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(text)
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(StudioColor.ink)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background { Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .light) }
        .overlay { Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1) }
        .animation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion), value: text)
        .accessibilityElement(children: .combine)
    }

    nonisolated static func confirmNote(_ completeness: MacroReview.Completeness) -> String {
        switch completeness {
        case .partial: return "Nothing is logged until you tap Log meal. Foods without nutrition aren't counted unless you add them."
        default: return "Nothing is logged until you tap Log meal."
        }
    }

    /// A correction to one food moves the totals by exactly what that food
    /// adds or loses — values the user typed into the totals are kept.
    private func applyEdit(_ index: Int, _ new: FoodEdit) {
        guard let items = (analysis.value ?? nil)?.items, items.indices.contains(index) else { return }
        let item = items[index]
        let before = MacroReview.contribution(item, edits[index])
        let after = MacroReview.contribution(item, new)
        let r1 = { (v: Double) in (v * 10).rounded() / 10 }
        withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
            edits[index] = new
            calories = max(0, (calories + after.calories - before.calories).rounded())
            protein = max(0, r1(protein + after.protein - before.protein))
            carbs = max(0, r1(carbs + after.carbs - before.carbs))
            fat = max(0, r1(fat + after.fat - before.fat))
        }
        adjustTick += 1
    }

    private func macroCell(_ label: String, _ value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                MacroNumberField(value: value, font: StudioFont.hero(22, weight: .semibold), accessibility: "\(label) grams")
                Text("g")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 16) }
    }

    // MARK: Logged

    private func loggedStage(_ meal: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("LOGGED")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(StudioColor.inkSoft)
                .padding(.top, 40)
            Text(meal)
                .font(StudioFont.hero(28, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text("\(Int(calories.rounded())) kcal · \(Int(protein.rounded()))g protein · \(Int(carbs.rounded()))g carbs · \(Int(fat.rounded()))g fat — added to \(mealType)'s entries and today's totals.")
                .font(StudioFont.body(14))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Button { dismiss() } label: { Text("Done").frame(maxWidth: .infinity) }
                .buttonStyle(.illuminatedCTA)
                .padding(.top, 16)
        }
    }

    // MARK: Actions

    private func begin(with image: UIImage) async {
        problem = nil
        guard let data = SombreyImage.prepared(image, maxPixel: 1280, quality: 0.8) else {
            problem = "That photo couldn't be prepared."
            return
        }
        // Only the prepared (small) image is kept in memory for the preview.
        preview = UIImage(data: data)
        withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .uploading }
        do {
            let storageId = try await SombreyImage.upload(data, uploadUrlMutation: "mealPhotos:generateUploadUrl")
            let id: String = try await ConvexClientProvider.client.mutation("mealPhotos:startAnalysis", with: [
                "storageId": storageId,
                "localDate": Self.localDate(),
            ])
            stage = .analyzing(id)
            analysis.subscribe(to: "mealPhotos:get", with: ["id": id])
        } catch {
            problem = "Couldn't send the photo. Check your connection and try again."
            stage = .capture
        }
    }

    private func confirm() {
        guard case .review(let id) = stage, !logging else { return }
        logging = true
        problem = nil
        let meal = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                let _: PhotoMealConfirmResult = try await ConvexClientProvider.client.mutation("mealPhotos:confirm", with: [
                    "id": id,
                    "name": meal,
                    "mealType": mealType,
                    "date": NutritionDate.todayUTCMidnightMillis,
                    "calories": calories,
                    "protein": protein,
                    "carbs": carbs,
                    "fat": fat,
                ])
                loggedTick += 1
                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .logged(meal) }
            } catch {
                problem = "Couldn't log the meal: check the values and your connection."
            }
            logging = false
        }
    }

    /// Leaving before logging discards the analysis (and any photo still held).
    private func close() {
        switch stage {
        case .analyzing(let id), .review(let id):
            Task { try? await ConvexClientProvider.client.mutation("mealPhotos:discard", with: ["id": id]) }
        default: break
        }
        dismiss()
    }

    nonisolated static func message(for reason: String?) -> String {
        switch reason {
        case "not_configured": return "Photo analysis isn't switched on for Sombrey yet. You can still log the meal from search."
        case "no_food": return "Sombrey couldn't find food in that photo. Try again with the whole plate in frame."
        case "nutrition_unavailable": return "Sombrey recognised the food but couldn't look up its nutrition just now. Try again in a minute, or log the meal from search."
        default: return "Sombrey couldn't analyse that photo. Try again, or log the meal from search."
        }
    }

    nonisolated static func title(for reason: String?) -> String {
        switch reason {
        case "not_configured": return "Photo analysis is off"
        case "no_food": return "No food found"
        case "nutrition_unavailable": return "Nutrition unavailable right now"
        default: return "Couldn't analyse that photo"
        }
    }

    nonisolated static func localDate(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    nonisolated static func defaultMealType(_ date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<11: return "breakfast"
        case 11..<16: return "lunch"
        case 16..<22: return "dinner"
        default: return "snack"
        }
    }
}

/// A macro value the user can edit — the display face, a numeric keyboard.
struct MacroNumberField: View {
    @Binding var value: Double
    let font: Font
    let accessibility: String

    var body: some View {
        TextField("0", value: $value, format: .number.precision(.fractionLength(0...1)))
            .font(font)
            .foregroundStyle(StudioColor.ink)
            .keyboardType(.decimalPad)
            .monospacedDigit()
            .fixedSize()
            .accessibilityLabel(accessibility)
    }
}

/// The meal photo, framed in the chamber glass; while analysing, a single
/// soft band of light passes over it (still under Reduce Motion).
struct MealAnalysisImage: View {
    let image: UIImage
    let analyzing: Bool
    var height: CGFloat = 240
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweep = false

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .clipped()
            .overlay {
                if analyzing {
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, Color.white.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: geo.size.height * 0.35)
                            .offset(y: reduceMotion ? geo.size.height * 0.33 : (sweep ? geo.size.height : -geo.size.height * 0.35))
                            .animation(reduceMotion ? nil : .easeInOut(duration: 2.2).repeatForever(autoreverses: false), value: sweep)
                    }
                    .allowsHitTesting(false)
                    .onAppear { sweep = true }
                }
            }
            .overlay { if analyzing { Color.white.opacity(0.12) } }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.7), lineWidth: 1)
            }
            .accessibilityLabel(analyzing ? "Your meal photo, being analysed" : "Your meal photo")
    }
}
