import SwiftUI
import PhotosUI
import UIKit

/// `mealPhotos:get` — the live status and estimate. Never carries the photo.
struct PhotoMealDTO: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let foodName: String
        let grams: Double
        let calories: Double
        let protein: Double
        let carbs: Double
        let fat: Double
        let matched: Bool
        var id: String { "\(foodName)-\(grams)" }
    }
    let id: String
    let status: String          // pending | done | error
    let reason: String?         // not_configured | no_food | failed
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

    // Review fields — the user's own values from here on.
    @State private var name = ""
    @State private var mealType = MacroCalculatorFlow.defaultMealType()
    @State private var calories: Double = 0
    @State private var protein: Double = 0
    @State private var carbs: Double = 0
    @State private var fat: Double = 0
    @State private var logging = false
    @State private var loggedTick = 0

    nonisolated static let mealTypes = ["breakfast", "lunch", "dinner", "snack"]

    var body: some View {
        EnvironmentView(scene: .aiCoach) {
            VStack(spacing: 0) {
                topBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        switch stage {
                        case .capture: captureStage
                        case .uploading: analyzingStage(label: "Preparing your photo…")
                        case .analyzing: analyzingStage(label: "Reading your meal…")
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
                withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { stage = .review(id) }
            case "error":
                problem = Self.message(for: dto.reason)
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
        .sensoryFeedback(.success, trigger: loggedTick)
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

            if let problem {
                Text(problem)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("macro.problem")
            }

            VStack(spacing: 10) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { problem = nil; showingCamera = true } label: {
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

    // MARK: Analyzing

    private func analyzingStage(label: String) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let preview {
                MealAnalysisImage(image: preview, analyzing: true)
                    .padding(.top, 16)
            }
            Text(label)
                .font(StudioFont.hero(22, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .accessibilityAddTraits(.updatesFrequently)
            Text("Identifying the foods and estimating each portion.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
        }
    }

    // MARK: Review

    private var reviewStage: some View {
        let dto = analysis.value ?? nil
        return VStack(alignment: .leading, spacing: 20) {
            if let preview {
                MealAnalysisImage(image: preview, analyzing: false)
                    .frame(height: 180)
                    .padding(.top, 16)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("DETECTED MEAL")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                TextField("Meal name", text: $name)
                    .font(StudioFont.hero(24, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .submitLabel(.done)
                    .accessibilityLabel("Meal name")
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    MacroNumberField(value: $calories, font: StudioFont.hero(44, weight: .bold), accessibility: "Calories")
                    Text("kcal")
                        .font(StudioFont.body(14))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                Text("SOMBREY ESTIMATE · from your photo — check it before logging")
                    .font(StudioFont.body(10, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(StudioColor.inkFaint)
            }

            HStack(spacing: 12) {
                macroCell("Protein", $protein)
                macroCell("Carbs", $carbs)
                macroCell("Fat", $fat)
            }

            if let items = dto?.items, !items.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("WHAT SOMBREY SAW")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(StudioColor.inkSoft)
                    ForEach(items) { item in
                        HStack(alignment: .firstTextBaseline) {
                            Text(item.foodName.prefix(1).uppercased() + item.foodName.dropFirst())
                                .font(StudioFont.body(13, weight: .medium))
                                .foregroundStyle(StudioColor.ink)
                            Text("≈ \(Int(item.grams)) g")
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.inkSoft)
                            Spacer()
                            Text(item.matched ? "\(Int(item.calories)) kcal" : "not found")
                                .font(StudioFont.body(12))
                                .foregroundStyle(item.matched ? StudioColor.inkSoft : StudioColor.inkFaint)
                                .monospacedDigit()
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if items.contains(where: { !$0.matched }) {
                        Text("Items marked “not found” have no nutrition data — add them to the totals above if they matter.")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkFaint)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
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
                .disabled(logging || name.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("macro.logMeal")
                Button("Discard") { close() }
                    .buttonStyle(.outlineCTA)
            }
        }
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
        default: return "Sombrey couldn't analyse that photo. Try again, or log the meal from search."
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweep = false

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(maxWidth: .infinity)
            .frame(height: 240)
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
