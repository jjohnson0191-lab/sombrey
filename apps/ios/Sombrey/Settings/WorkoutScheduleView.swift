import SwiftUI
import ConvexMobile

/// A user's own explicitly-configured training days/times — Sombrey has
/// no AI-generated workout-scheduling feature yet, so this is what
/// drives workout reminders and missed-workout detection (never
/// inferred from app-open behavior). Reached from
/// Settings → Notifications → "Configure reminder behavior."
struct WorkoutScheduleView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var slots = ConvexQuery<[WorkoutScheduleSlot]>()
    @State private var editableByDay: [Int: EditableWorkoutSlot] = [:]
    @State private var isSaving = false

    struct EditableWorkoutSlot {
        var id: String?
        var name: String
        var time: Date
        var enabled: Bool
        var reminderEnabled: Bool
        var missedReminderEnabled: Bool
    }

    var body: some View {
        NavigationStack {
            Form {
                ForEach(Weekday.allCases) { day in
                    Section(day.name) {
                        let binding = bindingForDay(day)
                        Toggle("Scheduled", isOn: binding.enabled)
                        if binding.wrappedValue.enabled {
                            TextField("Name (optional)", text: binding.name)
                            DatePicker("Time", selection: binding.time, displayedComponents: .hourAndMinute)
                            Toggle("Reminder", isOn: binding.reminderEnabled)
                            Toggle("Missed-workout reminder", isOn: binding.missedReminderEnabled)
                        }
                    }
                }
            }
            .navigationTitle("Workout Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { save() }
                        .disabled(isSaving)
                }
            }
        }
        .task {
            slots.subscribe(to: "workoutSchedules:list")
        }
        .onChange(of: slots.value) { _, newValue in
            guard let newValue, editableByDay.isEmpty else { return }
            for slot in newValue {
                editableByDay[slot.dayOfWeek] = Self.editable(from: slot)
            }
        }
    }

    private func bindingForDay(_ day: Weekday) -> Binding<EditableWorkoutSlot> {
        Binding(
            get: { editableByDay[day.rawValue] ?? Self.emptySlot() },
            set: { editableByDay[day.rawValue] = $0 }
        )
    }

    private static func editable(from slot: WorkoutScheduleSlot) -> EditableWorkoutSlot {
        var comps = DateComponents()
        comps.hour = slot.hour
        comps.minute = slot.minute
        return EditableWorkoutSlot(
            id: slot.id,
            name: slot.name ?? "",
            time: Calendar.current.date(from: comps) ?? Date(),
            enabled: slot.enabled,
            reminderEnabled: slot.reminderEnabled,
            missedReminderEnabled: slot.missedReminderEnabled
        )
    }

    private static func emptySlot() -> EditableWorkoutSlot {
        EditableWorkoutSlot(id: nil, name: "", time: Date(), enabled: false, reminderEnabled: true, missedReminderEnabled: false)
    }

    private func save() {
        isSaving = true
        Task {
            for (dayOfWeek, slot) in editableByDay {
                let comps = Calendar.current.dateComponents([.hour, .minute], from: slot.time)
                var args: [String: ConvexEncodable?] = [
                    "dayOfWeek": dayOfWeek,
                    "name": slot.name.isEmpty ? nil : slot.name,
                    "hour": comps.hour ?? 0,
                    "minute": comps.minute ?? 0,
                    "enabled": slot.enabled,
                    "reminderEnabled": slot.reminderEnabled,
                    "missedReminderEnabled": slot.missedReminderEnabled,
                ]
                if let id = slot.id { args["id"] = id }
                try? await ConvexClientProvider.client.mutation("workoutSchedules:upsertSlot", with: args)
            }
            await NotificationManager.shared.reconcileAll()
            isSaving = false
            dismiss()
        }
    }
}
