import SwiftUI

/// The complete 180-entry Sport+ catalog (`SombreySportType.all`, driven
/// directly from the vendor's real header — see that file) — reachable
/// in full, not just the featured subset `TrainOverviewView` surfaces
/// first. One scalable list/search, not 180 bespoke screens.
struct SportTypePickerView: View {
    @Environment(\.dismiss) private var dismiss
    let onSelect: (SombreySportType) -> Void

    @State private var searchTerm = ""

    private var filtered: [SombreySportType] {
        guard !searchTerm.isEmpty else { return SombreySportType.all }
        let term = searchTerm.lowercased()
        return SombreySportType.all.filter { $0.displayName.lowercased().contains(term) }
    }

    private var grouped: [(category: String, types: [SombreySportType])] {
        SombreySportType.categories.compactMap { category in
            let types = filtered.filter { $0.category == category }
            return types.isEmpty ? nil : (category, types)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(grouped, id: \.category) { group in
                    Section(group.category) {
                        ForEach(group.types) { type in
                            Button(type.displayName) {
                                onSelect(type)
                                dismiss()
                            }
                        }
                    }
                }
            }
            .searchable(text: $searchTerm, prompt: "Search all sports")
            .navigationTitle("Choose a sport")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
