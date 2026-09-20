import SwiftUI

/// Account + sign-out — the minimal real slice of
/// `apps/mobile/src/screens/SettingsScreen.tsx` needed for Phase 1's
/// completion criteria ("sign-out returns cleanly to unauthenticated
/// state"). The fuller settings surface (subscription, notifications,
/// delete account) lands in a later phase — see Settings/README.md.
///
/// Phase 3 training-architecture expansion: adds the goal and coaching-
/// mode controls the spec requires somewhere real (not a new screen —
/// "no final visual-polish pass yet," just functional UI using existing
/// tokens). AI Coach reads both from Convex directly; this screen is
/// where the user actually sets them.
struct SettingsScreen: View {
    @Environment(AppState.self) private var appState
    @State private var isSigningOut = false
    @State private var activeGoal = ConvexQuery<ClientGoal?>()
    @State private var coachingMode: CoachingMode = .recommendations
    @State private var isSavingGoal = false
    @State private var selectedGoalCategory: GoalCategory = .generalFitness

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .settings, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings")
                    .font(StudioFont.hero(32, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                VStack(alignment: .leading, spacing: 4) {
                    Text(appState.currentUser?.name ?? "—")
                        .font(StudioFont.body(15, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text(appState.currentUser?.email ?? "—")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }

                goalSection
                coachingModeSection

                Spacer()

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
