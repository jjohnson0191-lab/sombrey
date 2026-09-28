import SwiftUI

/// Settings › Profile › Body details — height, weight, sex, date of birth.
/// The same values the Body Scan asks for once (bodyScans:profile /
/// updateProfile). A new weight joins the weight history; earlier scans keep
/// the details they were taken with, so editing here never rewrites them.
struct BodyDetailsSection: View {
    @State private var profile = ConvexQuery<BodyScanProfileDTO>()
    @State private var editing = false

    var body: some View {
        let c = profile.value?.context
        Button { editing = true } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Body details")
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text(Self.summary(c))
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(StudioColor.inkFaint)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("settings.bodyDetails")
        .task { profile.subscribe(to: "bodyScans:profile") }
        .sheet(isPresented: $editing) {
            BodyDetailsEditor(context: c) { editing = false }
                .presentationDetents([.large])
        }
    }

    nonisolated static func summary(_ c: BodyScanProfileDTO.Context?) -> String {
        guard let c else { return "Height, weight, sex, date of birth" }
        var parts: [String] = []
        if let h = c.heightCm { parts.append("\(Int(h.rounded())) cm") }
        if let w = c.weightKg { parts.append(String(format: "%.1f kg", w)) }
        if let s = c.sex { parts.append(s.capitalized) }
        if let a = c.ageYears { parts.append("\(Int(a)) yrs") }
        return parts.isEmpty ? "Not set" : parts.joined(separator: " · ")
    }
}

struct BodyDetailsEditor: View {
    let context: BodyScanProfileDTO.Context?
    let onDone: () -> Void
    @State private var height = ""
    @State private var weight = ""
    @State private var sex = "male"
    @State private var setBirthDate = false
    @State private var birthDate = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("BODY DETAILS").font(StudioFont.body(11, weight: .semibold)).tracking(1.8).foregroundStyle(StudioColor.inkSoft)
                    Text("Your details").font(StudioFont.hero(28, weight: .semibold)).foregroundStyle(StudioColor.ink)
                    Text("Used across Sombrey and saved with each Body Scan. Earlier scans keep the details they were taken with.")
                        .font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft).fixedSize(horizontal: false, vertical: true)
                }
                field("HEIGHT", "cm", $height, "Height in centimetres")
                field("WEIGHT", "kg", $weight, "Weight in kilograms")
                VStack(alignment: .leading, spacing: 8) {
                    label("SEX")
                    StudioModePills(options: [
                        StudioModeOption(value: "male", label: "MALE", accessibilityLabel: "Male"),
                        StudioModeOption(value: "female", label: "FEMALE", accessibilityLabel: "Female"),
                        StudioModeOption(value: "other", label: "OTHER", accessibilityLabel: "Other"),
                    ], selection: $sex)
                }
                VStack(alignment: .leading, spacing: 8) {
                    label("DATE OF BIRTH")
                    Toggle("Update date of birth", isOn: $setBirthDate).tint(StudioColor.accentInk).frame(minHeight: 44)
                    if setBirthDate {
                        DatePicker("Date of birth", selection: $birthDate, in: ...Date(), displayedComponents: .date)
                            .labelsHidden().tint(StudioColor.ink).frame(minHeight: 44)
                    }
                }
                if let problem { Text(problem).font(StudioFont.body(13)).foregroundStyle(StudioColor.caution) }
                Button { save() } label: {
                    Group { if saving { ProgressView().tint(StudioColor.ink) } else { Text("Save") } }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                .disabled(saving)
                Button("Cancel", action: onDone).buttonStyle(.outlineCTA)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(StudioColor.env5.ignoresSafeArea())
        .onAppear {
            if let h = context?.heightCm { height = String(format: "%g", h) }
            if let w = context?.weightKg { weight = String(format: "%g", w) }
            if let s = context?.sex { sex = s }
        }
    }

    private func label(_ s: String) -> some View {
        Text(s).font(StudioFont.body(10, weight: .semibold)).tracking(1.6).foregroundStyle(StudioColor.inkSoft)
    }

    private func field(_ title: String, _ unit: String, _ text: Binding<String>, _ a11y: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label(title)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                TextField("0", text: text)
                    .font(StudioFont.hero(26, weight: .semibold)).foregroundStyle(StudioColor.ink)
                    .keyboardType(.decimalPad).accessibilityLabel(a11y)
                Text(unit).font(StudioFont.body(14)).foregroundStyle(StudioColor.inkSoft)
            }
            .padding(14)
            .background { SombreyGlassChamber(cornerRadius: 16) }
        }
    }

    /// Sends only what changed.
    private func save() {
        var args: [String: ConvexEncodable?] = [:]
        if !height.isEmpty {
            guard let h = BodyDetailsInput.number(height), (100...250).contains(h) else { problem = "Enter a height between 100 and 250 cm."; return }
            if h != context?.heightCm { args["heightCm"] = h }
        }
        if !weight.isEmpty {
            guard let w = BodyDetailsInput.number(weight), (20...400).contains(w) else { problem = "Enter a weight between 20 and 400 kg."; return }
            if w != context?.weightKg { args["weightKg"] = w }
        }
        if sex != context?.sex { args["sex"] = sex }
        if setBirthDate { args["dateOfBirth"] = BodyDetailsInput.isoDate(birthDate) }
        guard !args.isEmpty else { onDone(); return }
        saving = true
        problem = nil
        Task {
            do {
                try await ConvexClientProvider.client.mutation("bodyScans:updateProfile", with: args)
                saving = false
                onDone()
            } catch {
                saving = false
                problem = "Couldn't save. Check your connection and try again."
            }
        }
    }
}
