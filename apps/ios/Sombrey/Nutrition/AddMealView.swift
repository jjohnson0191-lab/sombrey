import SwiftUI
import ConvexMobile

/// Logs a real entry via the existing `nutritionLogs:logFood` mutation,
/// against the existing `foods` table (`foods:list`, searchable) — the
/// architecture the future camera AI macro calculator plugs into later:
/// that flow ends the same way this one does (a `foodId` + servings +
/// mealType passed to `logFood`), it just skips the manual search step
/// in favor of a photo. Nothing here fabricates a food or its macros.
struct AddMealView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var results = ConvexQuery<[Food]>()
    @State private var selectedFood: Food?
    @State private var servings: Double = 1
    @State private var mealType = "breakfast"
    @State private var isSaving = false
    @State private var saveError: String?

    private let mealTypes = ["breakfast", "lunch", "dinner", "snack"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Find a food") {
                    TextField("Search foods", text: $searchText)
                        .onChange(of: searchText) { _, newValue in
                            results.subscribe(to: "foods:list", with: ["searchTerm": newValue])
                        }
                    if let list = results.value {
                        ForEach(list) { food in
                            Button {
                                selectedFood = food
                            } label: {
                                HStack {
                                    Text(food.name)
                                    Spacer()
                                    if selectedFood == food {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                }

                if let food = selectedFood {
                    Section("Log \(food.name)") {
                        Stepper("Servings: \(servings, specifier: "%.1f")", value: $servings, in: 0.5...10, step: 0.5)
                        Picker("Meal", selection: $mealType) {
                            ForEach(mealTypes, id: \.self) { Text($0.capitalized).tag($0) }
                        }
                    }
                }

                if let saveError {
                    Text(saveError).foregroundStyle(StudioColor.danger)
                }
            }
            .navigationTitle("Add meal")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { save() }
                        .disabled(selectedFood == nil || isSaving)
                }
            }
        }
        .task {
            results.subscribe(to: "foods:list", with: [:])
        }
    }

    private func save() {
        guard let food = selectedFood else { return }
        isSaving = true
        saveError = nil
        Task {
            do {
                try await ConvexClientProvider.client.mutation("nutritionLogs:logFood", with: [
                    "date": NutritionDate.todayUTCMidnightMillis,
                    "foodId": food.id,
                    "servings": servings,
                    "mealType": mealType,
                ])
                isSaving = false
                dismiss()
            } catch {
                isSaving = false
                saveError = String(describing: error)
            }
        }
    }
}
