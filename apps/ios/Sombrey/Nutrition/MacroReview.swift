import SwiftUI

// MARK: - Review model (pure)

/// The user's correction of one analysed food, made on the phone. Nothing
/// here is recalculated by the server: a portion change scales that food's
/// own analysed values linearly, and calories typed for an unmatched food
/// are the user's number. The meal is only logged when they confirm.
struct FoodEdit: Equatable {
    var grams: Double
    var included: Bool = true
    /// Calories the user supplied for a food Sombrey had no nutrition for.
    var addedCalories: Double?
}

/// Rules for reading an analysis honestly: what's counted, what isn't,
/// and which foods deserve the user's eye. Pure, so it's tested directly.
enum MacroReview {
    struct Contribution: Equatable { var calories, protein, carbs, fat: Double }

    /// Why a food deserves a look — each a different thing to check, in
    /// order of how much it can move the total.
    enum Signal: Equatable {
        /// No safe nutrition match: not counted until the user adds it.
        case noNutrition
        /// Gemini said it wasn't sure what, how much, or how it's cooked.
        case unsure
        /// Cooked-or-dry couldn't be seen; matched as cooked.
        case assumedCooked(String)
        /// The nutrition is a general entry, not the preparation seen.
        case generalEntry(String)
        /// Gemini was only fairly sure — worth a glance, no more.
        case glance
    }

    enum Completeness: Equatable {
        /// Every food on the plate is counted.
        case complete(foods: Int)
        /// Some foods aren't counted (no nutrition, nothing added).
        case partial(counted: Int, of: Int)
        /// The user typed their own total.
        case adjusted
    }

    static func edit(for item: PhotoMealDTO.Item, _ edit: FoodEdit?) -> FoodEdit {
        edit ?? FoodEdit(grams: item.grams)
    }

    /// What a food adds to the meal, given the user's correction.
    static func contribution(_ item: PhotoMealDTO.Item, _ edit: FoodEdit?) -> Contribution {
        let e = self.edit(for: item, edit)
        guard e.included else { return Contribution(calories: 0, protein: 0, carbs: 0, fat: 0) }
        guard item.matched else { return Contribution(calories: max(0, e.addedCalories ?? 0), protein: 0, carbs: 0, fat: 0) }
        let scale = item.grams > 0 ? max(0, e.grams) / item.grams : 1
        return Contribution(calories: item.calories * scale, protein: item.protein * scale, carbs: item.carbs * scale, fat: item.fat * scale)
    }

    /// A food with no nutrition that the user hasn't supplied or removed.
    static func isUncounted(_ item: PhotoMealDTO.Item, _ edit: FoodEdit?) -> Bool {
        let e = self.edit(for: item, edit)
        return e.included && !item.matched && e.addedCalories == nil
    }

    static func completeness(_ items: [PhotoMealDTO.Item], edits: [Int: FoodEdit], totalTypedByUser: Bool) -> Completeness {
        if totalTypedByUser { return .adjusted }
        let included = items.indices.filter { edit(for: items[$0], edits[$0]).included }
        let uncounted = included.filter { isUncounted(items[$0], edits[$0]) }.count
        return uncounted == 0 ? .complete(foods: included.count) : .partial(counted: included.count - uncounted, of: included.count)
    }

    /// The one signal a row shows (the most consequential), or none.
    static func signal(_ item: PhotoMealDTO.Item, _ edit: FoodEdit?) -> Signal? {
        let e = self.edit(for: item, edit)
        guard e.included else { return nil }
        if !item.matched { return e.addedCalories == nil ? .noNutrition : nil }
        if item.confidence == "low" { return .unsure }
        let state = item.preparationState ?? "unknown"
        if item.preparationAssumed == true { return .assumedCooked(state) }
        if item.preparationMatched == false, state != "unknown" { return .generalEntry(state) }
        if item.confidence == "medium" { return .glance }
        return nil
    }

    /// Signals that should make a row stand out (not the quiet glance).
    static func needsReview(_ signal: Signal?) -> Bool {
        switch signal {
        case .none, .glance: return false
        default: return true
        }
    }

    static func signalText(_ signal: Signal) -> String {
        switch signal {
        case .noNutrition: return "No nutrition match — not counted yet"
        case .unsure: return "Needs review — Sombrey wasn't sure"
        case .assumedCooked: return "Assumed cooked — check"
        case .generalEntry(let state): return "General entry, not specific to \(state)"
        case .glance: return "Worth a quick check"
        }
    }

    /// "Grilled · 180 g" — the preparation (when known) and the portion.
    static func detail(_ item: PhotoMealDTO.Item, _ edit: FoodEdit?) -> String {
        let e = self.edit(for: item, edit)
        var parts: [String] = []
        if let state = item.preparationState, state != "unknown" { parts.append(state.prefix(1).uppercased() + state.dropFirst()) }
        parts.append("\(Int(e.grams.rounded())) g")
        if item.grams > 0, abs(e.grams - item.grams) >= 1 { parts.append("adjusted") }
        return parts.joined(separator: " · ")
    }

    static func confidenceText(_ confidence: String?) -> String? {
        switch confidence {
        case "high": return "Sombrey was confident about this food."
        case "medium": return "Sombrey was fairly sure — worth a glance."
        case "low": return "Sombrey wasn't sure about this food, its portion or how it was cooked."
        default: return nil
        }
    }

    /// The grams a − / + tap moves by: finer for small portions.
    static func portionStep(_ grams: Double) -> Double { grams < 100 ? 5 : grams < 300 ? 10 : 25 }

    static func displayName(_ name: String) -> String { name.prefix(1).uppercased() + name.dropFirst() }
}

// MARK: - Result header

/// The estimate at the top of review: the number is the anchor, and its
/// eyebrow and status line say exactly how complete it is.
struct MealEstimateHeader: View {
    let completeness: MacroReview.Completeness
    @Binding var calories: Double
    var onCaloriesTyped: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow)
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(isPartial ? StudioColor.caution : StudioColor.inkSoft)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if isPartial {
                    Text("≥")
                        .font(StudioFont.hero(30, weight: .semibold))
                        .foregroundStyle(StudioColor.inkSoft)
                        .accessibilityHidden(true)
                }
                MacroNumberField(value: Binding(get: { calories }, set: { if $0 != calories { calories = $0; onCaloriesTyped() } }),
                                 font: StudioFont.hero(52, weight: .bold),
                                 accessibility: isPartial ? "Calories counted so far" : "Estimated calories")
                    .minimumScaleFactor(0.6)
                Text("kcal")
                    .font(StudioFont.body(15))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            status
        }
        .accessibilityElement(children: .contain)
    }

    private var isPartial: Bool { if case .partial = completeness { return true } else { return false } }

    private var eyebrow: String {
        switch completeness {
        case .complete: return "ESTIMATED TOTAL"
        case .partial: return "COUNTED SO FAR"
        case .adjusted: return "YOUR TOTAL"
        }
    }

    @ViewBuilder private var status: some View {
        switch completeness {
        case .complete(let foods):
            Text(foods == 1 ? "Sombrey estimate · 1 food, all counted" : "Sombrey estimate · \(foods) foods, all counted")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
        case .partial(let counted, let of):
            VStack(alignment: .leading, spacing: 2) {
                Text("\(counted) of \(of) foods counted")
                    .font(StudioFont.body(13, weight: .semibold))
                    .foregroundStyle(StudioColor.caution)
                Text(of - counted == 1
                     ? "One food has no nutrition match. Add its calories, or it won't be in this total."
                     : "\(of - counted) foods have no nutrition match. Add their calories, or they won't be in this total.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .adjusted:
            Text("Adjusted by you · Sombrey's estimate was the starting point")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
        }
    }
}

// MARK: - Food row

/// One analysed food: what it is, how it's cooked and how much, what it
/// adds — and, only when it matters, what to check. Tapping opens review.
struct FoodResultRow: View {
    let item: PhotoMealDTO.Item
    let edit: FoodEdit?
    let open: () -> Void

    var body: some View {
        let signal = MacroReview.signal(item, edit)
        let prominent = MacroReview.needsReview(signal)
        let e = MacroReview.edit(for: item, edit)
        let contribution = MacroReview.contribution(item, edit)
        Button(action: open) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(MacroReview.displayName(item.foodName))
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(e.included ? StudioColor.ink : StudioColor.inkFaint)
                        .strikethrough(!e.included, color: StudioColor.inkFaint)
                        .lineLimit(2)
                    Text(e.included ? MacroReview.detail(item, edit) : "Removed from this meal")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                    if let signal {
                        HStack(spacing: 5) {
                            if prominent {
                                Circle().fill(StudioColor.caution).frame(width: 5, height: 5).accessibilityHidden(true)
                            }
                            Text(MacroReview.signalText(signal))
                                .font(StudioFont.body(11, weight: prominent ? .semibold : .regular))
                                .foregroundStyle(prominent ? StudioColor.caution : StudioColor.inkFaint)
                        }
                        .padding(.top, 1)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    if !e.included {
                        Text("—").font(StudioFont.hero(17, weight: .semibold)).foregroundStyle(StudioColor.inkFaint)
                    } else if MacroReview.isUncounted(item, edit) {
                        // Never "0 kcal": the food isn't counted, it isn't zero.
                        Text("Add")
                            .font(StudioFont.body(13, weight: .semibold))
                            .foregroundStyle(StudioColor.caution)
                    } else {
                        Text("\(Int(contribution.calories.rounded()))")
                            .font(StudioFont.hero(19, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                        Text(item.matched ? "kcal" : "kcal · yours")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(StudioColor.inkFaint)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .background { SombreyGlassChamber(cornerRadius: 18) }
            .overlay {
                if prominent {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(StudioColor.caution.opacity(0.45), lineWidth: 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(SombreyPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText(signal: signal, e: e, contribution: contribution))
        .accessibilityHint("Opens this food to review its portion")
    }

    private func accessibilityText(signal: MacroReview.Signal?, e: FoodEdit, contribution: MacroReview.Contribution) -> String {
        var s = "\(item.foodName), \(MacroReview.detail(item, edit))"
        if !e.included { s += ", removed" }
        else if MacroReview.isUncounted(item, edit) { s += ", not counted" }
        else { s += ", \(Int(contribution.calories.rounded())) calories" }
        if let signal { s += ". \(MacroReview.signalText(signal))" }
        return s
    }
}

// MARK: - Food review sheet

/// One food, up close: correct the portion (its own values scale with it),
/// add calories Sombrey couldn't find, or take it out of the meal.
struct FoodReviewSheet: View {
    let item: PhotoMealDTO.Item
    @State var draft: FoodEdit
    let commit: (FoodEdit) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let contribution = MacroReview.contribution(item, draft)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("REVIEW FOOD")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.8)
                        .foregroundStyle(StudioColor.inkSoft)
                    Text(MacroReview.displayName(item.foodName))
                        .font(StudioFont.hero(26, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .accessibilityAddTraits(.isHeader)
                    if let state = item.preparationState, state != "unknown" {
                        Text(item.preparationAssumed == true ? "Assumed cooked — Sombrey couldn't see whether it was cooked or dry." : "Seen as \(state).")
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                    }
                    if let text = MacroReview.confidenceText(item.confidence) {
                        Text(text)
                            .font(StudioFont.body(13))
                            .foregroundStyle(item.confidence == "low" ? StudioColor.caution : StudioColor.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if item.matched {
                    portion
                    HStack(spacing: 10) {
                        figure("Calories", "\(Int(contribution.calories.rounded()))", "kcal")
                        figure("Protein", format(contribution.protein), "g")
                        figure("Carbs", format(contribution.carbs), "g")
                        figure("Fat", format(contribution.fat), "g")
                    }
                    if let entry = item.matchedFood {
                        Text("Nutrition from Edamam: “\(entry)”\(item.preparationMatched == false && (item.preparationState ?? "unknown") != "unknown" ? " — a general entry, not specific to \(item.preparationState!)." : ".") Changing the portion scales it.")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkFaint)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Sombrey couldn't find safe nutrition data for this food, so it isn't counted. If you know its calories, add them — otherwise the meal is logged without it.")
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("ESTIMATED ≈ \(Int(item.grams.rounded())) g")
                            .font(StudioFont.body(10, weight: .semibold))
                            .tracking(1.4)
                            .foregroundStyle(StudioColor.inkSoft)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            MacroNumberField(value: Binding(get: { draft.addedCalories ?? 0 }, set: { draft.addedCalories = $0 > 0 ? $0 : nil }),
                                             font: StudioFont.hero(40, weight: .bold), accessibility: "Calories for this food")
                            Text("kcal").font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background { SombreyGlassChamber(cornerRadius: 18) }
                    }
                }

                VStack(spacing: 10) {
                    Button { commit(draft); dismiss() } label: { Text("Update meal").frame(maxWidth: .infinity) }
                        .buttonStyle(.illuminatedCTA)
                        .accessibilityIdentifier("macro.food.update")
                    Button {
                        var d = draft; d.included.toggle(); commit(d); dismiss()
                    } label: { Text(draft.included ? "Remove from meal" : "Add back to meal").frame(maxWidth: .infinity) }
                        .buttonStyle(.outlineCTA)
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(StudioColor.env5.ignoresSafeArea())
    }

    private var portion: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PORTION")
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(spacing: 14) {
                stepButton("minus", "Less") { draft.grams = max(0, draft.grams - MacroReview.portionStep(draft.grams)) }
                Spacer(minLength: 0)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    MacroNumberField(value: $draft.grams, font: StudioFont.hero(40, weight: .bold), accessibility: "Portion in grams")
                    Text("g").font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft)
                }
                Spacer(minLength: 0)
                stepButton("plus", "More") { draft.grams += MacroReview.portionStep(draft.grams) }
            }
            .padding(14)
            .background { SombreyGlassChamber(cornerRadius: 18) }
            Text("Sombrey estimated ≈ \(Int(item.grams.rounded())) g from the photo.")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkFaint)
        }
    }

    private func stepButton(_ glyph: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .frame(width: 44, height: 44)
                .background { Circle().fill(Color.white.opacity(0.55)) }
                .overlay { Circle().strokeBorder(Color.white.opacity(0.8), lineWidth: 1) }
        }
        .buttonStyle(SombreyPressStyle())
        .accessibilityLabel("\(label) — portion")
    }

    private func figure(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(StudioFont.hero(17, weight: .semibold)).foregroundStyle(StudioColor.ink).monospacedDigit()
                Text(unit).font(StudioFont.body(10)).foregroundStyle(StudioColor.inkSoft)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func format(_ v: Double) -> String { v < 10 ? String(format: "%.1f", v) : "\(Int(v.rounded()))" }
}

// MARK: - Analysing

/// While Sombrey works: the photo with its single light pass, what's being
/// done (not a fake progress bar — the steps aren't reported one by one),
/// and an honest note if it takes longer than usual.
struct MealAnalyzingPanel: View {
    let image: UIImage?
    let sending: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var slow = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let image {
                MealAnalysisImage(image: image, analyzing: true)
                    .padding(.top, 16)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("SOMBREY ANALYSIS")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(StudioColor.inkSoft)
                Text(sending ? "Preparing your photo" : "Analysing your meal")
                    .font(StudioFont.hero(26, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            VStack(alignment: .leading, spacing: 10) {
                step("Identifying foods")
                step("Estimating portions")
                step("Checking nutrition")
            }
            .opacity(sending ? 0.55 : 1)
            if slow {
                Text("Still working — nutrition lookups can take a little longer at busy times.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
        .task(id: sending) {
            slow = false
            guard !sending else { return }
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            if !Task.isCancelled { withAnimation(StudioMotion.resolve(StudioMotion.contentShift, reduceMotion: reduceMotion)) { slow = true } }
        }
    }

    private func step(_ text: String) -> some View {
        HStack(spacing: 10) {
            Capsule().fill(StudioColor.inkFaint).frame(width: 14, height: 2).accessibilityHidden(true)
            Text(text)
                .font(StudioFont.body(14))
                .foregroundStyle(StudioColor.inkSoft)
        }
    }
}

// MARK: - Couldn't analyse

/// An analysis that ended without an estimate — said plainly, in the
/// chamber, never as a red alarm and never as "0 kcal".
struct MealAnalysisNotice: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(StudioFont.hero(18, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text(message)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { SombreyGlassChamber(cornerRadius: 20) }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("macro.problem")
    }
}
