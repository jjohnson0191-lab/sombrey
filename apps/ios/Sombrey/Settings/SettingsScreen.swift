import SwiftUI
import UIKit

/// Settings — account, app controls, privacy & data, legal and support.
/// Consumer-facing only: domain features live in their own destinations
/// (Vitals in Progress, meal times in AI › Nutrition, workout days in
/// Train), and developer diagnostics exist only in debug builds.
///
/// Pages whose content doesn't exist yet (legal documents, the privacy
/// explanation, data export, help) are honest entry points — they say
/// the content isn't published, and never invent policy text.
struct SettingsScreen: View {
    @Environment(AppState.self) private var appState
    @State private var isSigningOut = false
    @State private var activeGoal = ConvexQuery<ClientGoal?>()
    @State private var coachingMode: CoachingMode = .recommendations
    @State private var isSavingGoal = false
    @State private var selectedGoalCategory: GoalCategory = .generalFitness
    @State private var showingNotificationSettings = false
    @State private var showingWeatherInfo = false
    @State private var placeholder: SettingsPlaceholder?
    @State private var confirmingDelete = false
    @State private var confirmingDeleteFinal = false
    @State private var isDeleting = false
    @State private var deleteError: String?
    #if DEBUG
    @State private var showingDeveloperDiagnostics = false
    #endif

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .settings, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 30) {
                VStack(alignment: .leading, spacing: 10) {
                    SombreyLogo(size: .header, tone: .onLight)
                    Text("Settings")
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                }
                .padding(.top, 16)

                settingsGroup("PROFILE") {
                    ProfileSection()
                }

                settingsGroup("ACCOUNT") {
                    row("Subscription", detail: "Not available yet") { placeholder = .subscription }
                    WearableBandSection()
                    goalSection
                    row("Units", detail: "Metric · kg, km") { placeholder = .units }
                }

                settingsGroup("APP") {
                    row("Notifications") { showingNotificationSettings = true }
                    coachingModeSection
                    row("Appearance", detail: "Studio") { placeholder = .appearance }
                    row("Language", detail: "English") { placeholder = .language }
                }

                settingsGroup("PRIVACY & DATA") {
                    row("How Sombrey uses your data") { placeholder = .dataUse }
                    row("Permissions", detail: "Bluetooth, notifications") { openSystemSettings() }
                    row("Download my data", detail: "Not available yet") { placeholder = .dataExport }
                    Button {
                        confirmingDelete = true
                    } label: {
                        HStack {
                            Text(isDeleting ? "Deleting…" : "Delete account")
                                .font(StudioFont.body(14, weight: .medium))
                                .foregroundStyle(StudioColor.danger)
                            Spacer()
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isDeleting)
                    if let deleteError {
                        Text("Couldn't delete your account: \(deleteError)")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.danger)
                    }
                }

                settingsGroup("LEGAL") {
                    row("Terms & Conditions") { placeholder = .terms }
                    row("Privacy Policy") { placeholder = .privacyPolicy }
                    row("Cookie Policy") { placeholder = .cookiePolicy }
                    row("AI Disclosure") { placeholder = .aiDisclosure }
                    row("Health & Medical Disclaimer") { placeholder = .healthDisclaimer }
                    row("Weather & location", detail: "MET Norway") { showingWeatherInfo = true }
                }

                settingsGroup("SUPPORT") {
                    row("Help & Support") { placeholder = .help }
                    row("Contact Sombrey") { placeholder = .contact }
                    row("About Sombrey", detail: AppVersion.text) { placeholder = .about }
                }

                #if DEBUG
                settingsGroup("DEVELOPER (DEBUG BUILDS ONLY)") {
                    row("Wearable diagnostics") { showingDeveloperDiagnostics = true }
                }
                #endif

                Button {
                    isSigningOut = true
                    Task {
                        await appState.signOut()
                        isSigningOut = false
                    }
                } label: {
                    if isSigningOut {
                        ProgressView().tint(StudioColor.ink)
                    } else {
                        Text("Sign out")
                    }
                }
                .buttonStyle(.outlineCTA)
                .disabled(isSigningOut)
            }
            .padding(.bottom, 12)
        }
        .task {
            activeGoal.subscribe(to: "goals:getActiveGoal")
        }
        .onChange(of: appState.currentUser?.coachingMode) { _, newValue in
            coachingMode = CoachingMode(rawValue: newValue ?? "") ?? .recommendations
        }
        .onChange(of: activeGoal.value) { _, newValue in
            if let category = newValue.flatMap({ $0 })?.category, let match = GoalCategory(rawValue: category) {
                selectedGoalCategory = match
            }
        }
        .sheet(isPresented: $showingWeatherInfo) {
            WeatherPrivacyView()
        }
        .sheet(isPresented: $showingNotificationSettings) {
            NotificationSettingsView()
        }
        .sheet(item: $placeholder) { page in
            SettingsPlaceholderPage(page: page)
                .presentationDetents([.medium])
        }
        #if DEBUG
        .sheet(isPresented: $showingDeveloperDiagnostics) {
            WearableDiagnosticsView()
        }
        #endif
        .confirmationDialog("Delete your Sombrey account?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Continue", role: .destructive) { confirmingDeleteFinal = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes your Sombrey profile and the data stored with it — band measurements, sleep, workouts, training plans, readiness, nutrition and AI conversations. It can't be undone.")
        }
        .alert("Delete everything permanently?", isPresented: $confirmingDeleteFinal) {
            Button("Delete account", role: .destructive, action: deleteAccount)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It doesn't cancel an App Store subscription — manage that in your Apple account. Signing in again later starts a new, empty profile.")
        }
    }

    // MARK: - Building blocks

    private func settingsGroup<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            content()
        }
    }

    private func row(_ title: String, detail: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(StudioFont.body(14, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                Spacer()
                if let detail {
                    Text(detail)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    /// Deletes the account server-side (`users:deleteSelfAccount`, which
    /// removes the profile and every Sombrey data table), then signs out.
    private func deleteAccount() {
        isDeleting = true
        deleteError = nil
        Task {
            do {
                try await ConvexClientProvider.client.mutation("users:deleteSelfAccount")
                await appState.signOut()
            } catch {
                deleteError = String(describing: error)
            }
            isDeleting = false
        }
    }

    private var goalSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TRAINING GOAL")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            Menu {
                ForEach(GoalCategory.allCases) { category in
                    Button(category.displayName) {
                        selectedGoalCategory = category
                        saveGoal(category: category)
                    }
                }
            } label: {
                HStack {
                    Text(selectedGoalCategory.displayName)
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
                .padding(12)
                .background(StudioColor.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            }
            if isSavingGoal {
                Text("Saving…").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
            }
        }
    }

    private var coachingModeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("AI COACHING MODE")
                .font(StudioFont.body(11, weight: .semibold))
                .tracking(1.3)
                .foregroundStyle(StudioColor.inkSoft)
            ForEach(CoachingMode.allCases) { mode in
                Button {
                    coachingMode = mode
                    Task {
                        try? await ConvexClientProvider.client.mutation("users:setCoachingMode", with: ["coachingMode": mode.rawValue])
                    }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: coachingMode == mode ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(coachingMode == mode ? StudioColor.accentInk : StudioColor.ink.opacity(0.25))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(mode.title)
                                .font(StudioFont.body(14, weight: .medium))
                                .foregroundStyle(StudioColor.ink)
                            Text(mode.subtitle)
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                    }
                }
                .buttonStyle(.plain)
                .padding(.vertical, 6)
            }
        }
    }

    private func saveGoal(category: GoalCategory) {
        isSavingGoal = true
        Task {
            try? await ConvexClientProvider.client.mutation("goals:setGoal", with: [
                "primaryGoal": category.displayName,
                "category": category.rawValue,
            ])
            isSavingGoal = false
        }
    }
}

/// Wire shape of `goals:getActiveGoal`'s result — only the fields this
/// screen needs, not the whole `clientGoals` row.
struct ClientGoal: Decodable, Equatable {
    let primaryGoal: String
    let category: String?
}

enum GoalCategory: String, CaseIterable, Identifiable {
    case strength, hypertrophy
    case bodyComposition = "body_composition"
    case fatLoss = "fat_loss"
    case endurance
    case runningPerformance = "running_performance"
    case cyclingPerformance = "cycling_performance"
    case sportPerformance = "sport_performance"
    case recovery
    case generalFitness = "general_fitness"
    case maintenance
    case custom

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .strength: return "Strength"
        case .hypertrophy: return "Hypertrophy"
        case .bodyComposition: return "Body composition"
        case .fatLoss: return "Fat loss"
        case .endurance: return "Endurance"
        case .runningPerformance: return "Running performance"
        case .cyclingPerformance: return "Cycling performance"
        case .sportPerformance: return "Sport performance"
        case .recovery: return "Recovery"
        case .generalFitness: return "General fitness"
        case .maintenance: return "Maintenance"
        case .custom: return "Custom"
        }
    }
}

enum CoachingMode: String, CaseIterable, Identifiable {
    case fullControl = "full_control"
    case recommendations
    case trackingOnly = "tracking_only"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .fullControl: return "Full control"
        case .recommendations: return "Recommendations"
        case .trackingOnly: return "Tracking only"
        }
    }

    var subtitle: String {
        switch self {
        case .fullControl: return "Sombrey AI can create and adjust your training and nutrition directly."
        case .recommendations: return "You stay in control of your program — Sombrey offers suggestions, never changes it."
        case .trackingOnly: return "Sombrey records and analyzes your data without proactive coaching."
        }
    }
}

/// Settings pages whose real content doesn't exist yet. Each says so
/// plainly — none of them states a policy.
enum SettingsPlaceholder: String, Identifiable {
    case subscription, units, appearance, language
    case dataUse, dataExport
    case terms, privacyPolicy, cookiePolicy, aiDisclosure, healthDisclaimer
    case help, contact, about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .subscription: return "Subscription"
        case .units: return "Units"
        case .appearance: return "Appearance"
        case .language: return "Language"
        case .dataUse: return "How Sombrey uses your data"
        case .dataExport: return "Download my data"
        case .terms: return "Terms & Conditions"
        case .privacyPolicy: return "Privacy Policy"
        case .cookiePolicy: return "Cookie Policy"
        case .aiDisclosure: return "AI Disclosure"
        case .healthDisclaimer: return "Health & Medical Disclaimer"
        case .help: return "Help & Support"
        case .contact: return "Contact Sombrey"
        case .about: return "About Sombrey"
        }
    }

    var message: String {
        switch self {
        case .subscription:
            return "Subscriptions aren't available in this build yet. Nothing is being charged through the app."
        case .units:
            return "Sombrey currently shows metric units (kilograms, kilometres). A choice of units will come here."
        case .appearance:
            return "Sombrey uses its Studio appearance throughout. Appearance options will come here."
        case .language:
            return "Sombrey is available in English. More languages will come here."
        case .dataUse:
            return "The full explanation of what Sombrey collects from you and your band, what it stores, what its AI uses, which service providers receive data, retention, export, deletion and whether data is used to train models will be published here. It hasn't been published yet."
        case .dataExport:
            return "Exporting a copy of your data isn't available in this build yet. It will be offered here."
        case .terms, .privacyPolicy, .cookiePolicy, .aiDisclosure, .healthDisclaimer:
            return "Not yet published. Sombrey's \(title) will appear here once it is. Nothing on this page is a policy statement."
        case .help:
            return "Help articles will appear here."
        case .contact:
            return "A way to contact the Sombrey team will appear here."
        case .about:
            return "Sombrey — a premium wearable and AI fitness instrument.\nVersion \(AppVersion.text)"
        }
    }
}

private struct SettingsPlaceholderPage: View {
    let page: SettingsPlaceholder
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(page.title)
                    .font(StudioFont.hero(24, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Spacer()
                Button("Done") { dismiss() }
                    .font(StudioFont.body(14, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .frame(minHeight: 44)
            }
            Text(page.message)
                .font(StudioFont.body(14))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(24)
        .background(StudioColor.env4.ignoresSafeArea())
    }
}

/// The installed app's version and build, e.g. "1.0 (29)".
enum AppVersion {
    static var text: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }
}
