import SwiftUI
import ConvexMobile

/// Per-weekday meal schedule — Monday's times are independent of
/// Tuesday's by construction (matches `mealSchedules`' own per-day
/// rows), never a single global daily schedule. Reached from
/// Settings → Notifications → "Manage meal schedule."
struct MealScheduleView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var slots = ConvexQuery<[MealScheduleSlot]>()
    @State private var editingSlot: MealScheduleSlot?
    @State private var editingDay: Weekday?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(Weekday.allCases) { day in
                        daySection(day)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Meal Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { slots.subscribe(to: "mealSchedules:list") }
        .sheet(item: $editingDay) { day in
            MealSlotEditorView(day: day, existingSlots: slotsForDay(day.rawValue)) {
                slots.subscribe(to: "mealSchedules:list")
            }
        }
    }

    private func slotsForDay(_ dayOfWeek: Int) -> [MealScheduleSlot] {
        (slots.value ?? []).filter { $0.dayOfWeek == dayOfWeek }.sorted { $0.slotOrder < $1.slotOrder }
    }

    private func daySection(_ day: Weekday) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(day.name.uppercased())
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.3)
                    .foregroundStyle(StudioColor.inkSoft)
                Spacer()
                Button("Edit") { editingDay = day }
                    .font(StudioFont.body(11, weight: .medium))
                    .foregroundStyle(StudioColor.accentInk)
            }
            let daySlots = slotsForDay(day.rawValue)
            if daySlots.isEmpty {
                Text("No meals scheduled")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkFaint)
            } else {
                ForEach(daySlots) { slot in
                    HStack {
                        Text(slot.name)
                            .font(StudioFont.body(14, weight: .medium))
                            .foregroundStyle(slot.enabled ? StudioColor.ink : StudioColor.inkFaint)
                        Spacer()
                        Text(Self.timeString(hour: slot.hour, minute: slot.minute))
                            .font(StudioFont.body(13))
                            .foregroundStyle(StudioColor.inkSoft)
                            .monospacedDigit()
                    }
                }
            }
        }
    }

    static func timeString(hour: Int, minute: Int) -> String {
        var comps = DateComponents()
        comps.hour = hour
        comps.minute = minute
        let date = Calendar.current.date(from: comps) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}

/// Add/edit/remove the meal slots for a single day — never touches any
/// other day's rows.
private struct MealSlotEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let day: Weekday
    @State var editableSlots: [EditableSlot]
    let onSave: () -> Void

    struct EditableSlot: Identifiable {
        let id: String?
        var name: String
        var time: Date
        var enabled: Bool
        var reminderEnabled: Bool
        var missedReminderEnabled: Bool
        var slotOrder: Int
        let uiID = UUID()
    }

    init(day: Weekday, existingSlots: [MealScheduleSlot], onSave: @escaping () -> Void) {
        self.day = day
        self.onSave = onSave
        _editableSlots = State(initialValue: existingSlots.map {
            var comps = DateComponents()
            comps.hour = $0.hour
            comps.minute = $0.minute
            return EditableSlot(
                id: $0.id,
                name: $0.name,
                time: Calendar.current.date(from: comps) ?? Date(),
                enabled: $0.enabled,
                reminderEnabled: $0.reminderEnabled,
                missedReminderEnabled: $0.missedReminderEnabled,
                slotOrder: $0.slotOrder
            )
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                ForEach($editableSlots) { $slot in
                    Section {
                        TextField("Meal name", text: $slot.name)
                        DatePicker("Time", selection: $slot.time, displayedComponents: .hourAndMinute)
                        Toggle("Enabled", isOn: $slot.enabled)
                        Toggle("Reminder", isOn: $slot.reminderEnabled)
                        Toggle("Missed-log reminder", isOn: $slot.missedReminderEnabled)
                    }
                }
                Button("Add meal") {
                    editableSlots.append(EditableSlot(id: nil, name: "Meal", time: Date(), enabled: true, reminderEnabled: true, missedReminderEnabled: false, slotOrder: editableSlots.count))
                }
            }
            .navigationTitle(day.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                }
            }
        }
    }

    private func save() {
        Task {
            for (index, slot) in editableSlots.enumerated() {
                let comps = Calendar.current.dateComponents([.hour, .minute], from: slot.time)
                var args: [String: ConvexEncodable?] = [
                    "dayOfWeek": day.rawValue,
                    "slotOrder": index,
                    "name": slot.name,
                    "hour": comps.hour ?? 0,
                    "minute": comps.minute ?? 0,
                    "enabled": slot.enabled,
                    "reminderEnabled": slot.reminderEnabled,
                    "missedReminderEnabled": slot.missedReminderEnabled,
                ]
                if let id = slot.id { args["id"] = id }
                try? await ConvexClientProvider.client.mutation("mealSchedules:upsertSlot", with: args)
            }
            await NotificationManager.shared.reconcileAll()
            onSave()
            dismiss()
        }
    }
}
