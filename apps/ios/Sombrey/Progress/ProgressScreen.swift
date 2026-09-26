import SwiftUI
import ConvexMobile

/// Progress — how the user is changing, over time. Calm by default: each
/// section rests as one concise reading and opens in place (the Vitals
/// interaction model), each with its own character — strain accumulates,
/// body trends, performance graphs, consistency patterns, records reveal,
/// load pairs with recovery.
///
/// Everything is derived from the user's recorded history on the server
/// (`progress:overview` / `progress:performance`, convex/progress/*); a
/// section with too little data says so rather than inventing a value.
/// Daily Strain (v1) is shown with its state and marked "not yet validated"
/// until the band passes physical validation.
struct ProgressScreen: View {
    @Environment(AppState.self) private var appState
    @State private var overview = ConvexQuery<ProgressOverviewDTO>()
    @State private var photos = ConvexQuery<[ProgressPhotoEntry]>()
    @AppStorage("sombreyProgress.bodyBaseline") private var bodyBaseline = "first"
    @State private var showingVitals = false

    private var tzOffsetMinutes: Double { Double(TimeZone.current.secondsFromGMT() / 60) }

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .progress, selection: $appState.selectedTab) {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    SombreyLogo(size: .header, tone: .onLight)
                        .padding(.bottom, 6)
                    TrainEyebrow(text: "Your progress")
                    Text("Progress")
                        .font(StudioFont.hero(32, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                }
                .padding(.top, 16)
                .studioReveal(index: 0)

                content
            }
            .padding(.bottom, 24)
        }
        .task { photos.subscribe(to: "progressPhotos:list") }
        .task(id: bodyBaseline) {
            overview.subscribe(to: "progress:overview", with: ["timeZone": TimeZone.current.identifier, "tzOffsetMinutes": tzOffsetMinutes, "bodyBaseline": bodyBaseline])
        }
        .fullScreenCover(isPresented: $showingVitals) { VitalsScreen() }
    }

    @ViewBuilder
    private var content: some View {
        if let o = overview.value {
            StrainHero(overview: o).studioReveal(index: 1)
            StrainHistorySection(overview: o).studioReveal(index: 1)
            BodySection(summary: o.body, baseline: $bodyBaseline, photoCount: photos.value?.count ?? 0).studioReveal(index: 2)
            PerformanceSection().studioReveal(index: 3)
            YouVsYouSection(insights: o.insights).studioReveal(index: 4)
            ConsistencySection(consistency: o.consistency).studioReveal(index: 5)
            RecordsSection(records: o.records).studioReveal(index: 6)
            LoadRecoverySection(loadRecovery: o.loadRecovery, longer: o.loadRecovery28).studioReveal(index: 6)
            MilestonesSection(milestones: o.milestones).studioReveal(index: 6)
            vitalsEntry
        } else if overview.isLoading {
            HStack(spacing: 10) {
                ProgressView().tint(StudioColor.ink).controlSize(.small)
                Text("Reading your history…")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .padding(.top, 40)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("We couldn't load your progress.")
                    .font(StudioFont.body(16, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text("Check your connection and try again.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            .padding(.top, 24)
        }
    }

    /// Vitals — the band's full biometric history — stays one tap away.
    private var vitalsEntry: some View {
        Button {
            showingVitals = true
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    TrainEyebrow(text: "Vitals")
                    Text("Heart rate, SpO2, temperature, blood pressure, activity and sleep — full history")
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .studioCard()
    }
}

struct WearableMeasurementDTO: Decodable {
    let metricType: String
    let value: Double
    let recordedAt: Double
}

struct SleepStageDTO: Decodable {
    let stage: String
    let durationMinutes: Int
    /// Epoch ms — the band's own per-stage timestamp
    /// (`QCSleepModel.happenDate`), stored with every stage. Optional so a
    /// row without it still decodes; such a stage is never placed on a
    /// timeline at a guessed time.
    var startedAt: Double?
}

struct SleepSessionSummaryDTO: Decodable {
    let totalSleepMinutes: Int
    let stages: [SleepStageDTO]?
    // Added for VitalsScreen's sleep timing/trend — same query already
    // returns these (`wearableSleepSessions`' own required fields), this
    // screen just didn't decode them before.
    let startedAt: Double
    let endedAt: Double
}

struct SportSessionSummaryDTO: Decodable {
    let startedAt: Double
    let durationSeconds: Double?
    // Added for HomeScreen's Training card — same query
    // (`sportPlusSessions:getRecentSessions`) already returns these; this
    // screen just didn't need them before.
    let sportType: Int?
    let calories: Double?
    let averageHeartRate: Double?
    let distanceMeters: Double?
}

struct SombreyWorkoutSummaryDTO: Decodable {
    let name: String
    let startedAt: Double
}
