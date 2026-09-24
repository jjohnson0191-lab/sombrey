import SwiftUI
import ConvexMobile

/// An activity's own page — what choosing Tennis, Golf or Surfing opens.
/// Same structure for every activity: Header (with Start) → Your <activity>
/// (your typical session, in the activity's own terms) → Sombrey's read →
/// Sessions → About. Everything in it is the user's own recorded history or
/// the activity's framework terms; nothing is invented to fill space.
struct ActivityExperienceView: View {
    let activity: SombreyActivity
    @Environment(\.dismiss) private var dismiss
    @Environment(WearableManager.self) private var wearableManager
    @Environment(ActivitySessionManager.self) private var activitySession
    @State private var history = ConvexQuery<ActivityHistoryDTO>()
    @State private var opened: ActivityRecordDTO?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                        .studioReveal(index: 0)
                    if let value = history.value {
                        if value.profile.sessionCount > 0 {
                            typical(value)
                                .studioReveal(index: 1)
                            let insights = ActivityIntelligence.activityInsights(activity: activity, sessions: value.sessions)
                            if !insights.isEmpty {
                                InsightCard(title: "Sombrey's read on your \(activity.name)", insights: insights)
                                    .studioReveal(index: 2)
                            }
                            sessionList(value.sessions)
                                .studioReveal(index: 3)
                        } else {
                            Text("No \(activity.name) \(activity.terms.sessionNoun)s yet. Start one here or on your band — Sombrey brings band sessions in automatically, and from your first one on, every \(activity.terms.sessionNoun) is compared with your own.")
                                .font(StudioFont.body(13))
                                .foregroundStyle(StudioColor.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                                .studioCard()
                        }
                    } else if history.isLoading {
                        ProgressView().tint(StudioColor.ink).frame(maxWidth: .infinity)
                    } else if let error = history.errorMessage {
                        Text("Couldn't load your \(activity.name) history: \(error)")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.danger)
                    }
                    AboutActivityCard(activity: activity)
                        .studioReveal(index: 4)
                }
                .padding(20)
            }
            .background(EnvironmentView(scene: .trainOverview) { Color.clear }.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { history.subscribe(to: "activities:history", with: ["activityKey": activity.key, "limit": 60.0]) }
            .sheet(item: $opened) { record in
                ActivitySessionSheet(record: record)
            }
            .onChange(of: activitySession.phase) { _, phase in
                // Started from here: the live screen takes over Train.
                if phase == .active { dismiss() }
            }
        }
    }

    // MARK: Header

    private var header: some View {
        ActivityHeader(activity: activity, status: .ready) {
            VStack(alignment: .leading, spacing: 12) {
                Text(activity.terms.focus)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
                    .fixedSize(horizontal: false, vertical: true)
                bandLine
                Button {
                    Task { await activitySession.start(activity, wearable: wearableManager) }
                } label: {
                    Text(activitySession.isStarting ? "Starting…" : "Start \(activity.name)").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                .disabled(activitySession.isStarting || activitySession.phase != .idle)
                if let failure = activitySession.startFailure {
                    Text(failure)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.accentInkDark)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .onAppear { activitySession.clearStartFailure() }
    }

    private var bandLine: some View {
        let connected = wearableManager.displayState == .connected || wearableManager.displayState == .syncing
        let text: String
        switch wearableManager.displayState {
        case .notPaired: text = "No band connected"
        case .connected, .syncing: text = "Band ready to record"
        case .connecting, .reconnecting, .searching: text = "Band reconnecting"
        default: text = "Band disconnected"
        }
        return HStack(spacing: 6) {
            Circle().fill(connected ? StudioColor.accent : StudioColor.paperFaint).frame(width: 6, height: 6)
            Text(text)
                .font(StudioFont.body(12, weight: .medium))
                .foregroundStyle(StudioColor.paperSoft)
        }
    }

    // MARK: Your typical session

    /// The user's typical session, in the order this activity's terms put
    /// its metrics — averages only over sessions that recorded each value.
    private func typical(_ value: ActivityHistoryDTO) -> some View {
        let p = value.profile
        let terms = activity.terms
        let count = Int(p.sessionCount)
        let order = terms.primary + terms.secondary
        let tiles: [(ActivityMetric, String, String?, AveragedDTO)] = order.compactMap { metric in
            switch metric {
            case .duration:
                return p.averageDurationSeconds.map { (metric, ActivityFormat.duration($0.value), nil, $0) }
            case .heartRate:
                return p.averageHeartRate.map { (metric, "\(Int($0.value.rounded()))", "bpm", $0) }
            case .distance:
                return p.averageDistanceMeters.map { let f = ActivityFormat.distance($0.value); return (metric, f.value, f.unit, $0) }
            case .steps:
                return p.averageSteps.map { (metric, ActivityFormat.count($0.value), nil, $0) }
            case .calories:
                return p.averageCalories.map { (metric, "\(Int($0.value.rounded()))", "kcal", $0) }
            default:
                return nil
            }
        }
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                TrainEyebrow(text: "Your \(activity.name)")
                Spacer()
                Text("\(count) \(terms.sessionNoun)\(count == 1 ? "" : "s") · \(Int(p.sessionsLast30Days)) in 30 days")
                    .font(StudioFont.body(11, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            if !tiles.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], alignment: .leading, spacing: 18) {
                    ForEach(tiles, id: \.0) { metric, text, unit, averaged in
                        IndicatorTile(indicator: ActivityIndicator(
                            metric: metric,
                            label: "Typical \(ActivityIntelligence.label(metric, terms: terms, live: false).lowercased())",
                            value: text, unit: unit, source: .bandRecord,
                            detail: "over \(Int(averaged.sessions)) \(terms.sessionNoun)\(Int(averaged.sessions) == 1 ? "" : "s")"))
                    }
                }
            }
            if value.sessions.count >= 2 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Recent \(terms.sessionNoun)s · minutes")
                        .font(StudioFont.body(10, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(StudioColor.inkSoft)
                    RecentDurationBars(sessions: Array(value.sessions.prefix(10)))
                }
            }
        }
        .studioCard()
    }

    // MARK: Sessions

    private func sessionList(_ sessions: [ActivityRecordDTO]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            TrainEyebrow(text: "\(activity.terms.sessionNoun.capitalized)s")
                .padding(.bottom, 6)
            ForEach(sessions) { record in
                Button {
                    opened = record
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.startDate.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))
                                .font(StudioFont.body(14, weight: .medium))
                                .foregroundStyle(StudioColor.ink)
                            Text(record.sourceLine)
                                .font(StudioFont.body(11))
                                .foregroundStyle(StudioColor.inkFaint)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(record.durationSeconds.map { ActivityFormat.duration($0) } ?? "—")
                                .font(StudioFont.body(14, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                            if let hr = record.averageHeartRate, record.heartRateSource != nil {
                                Text("\(Int(hr)) avg bpm")
                                    .font(StudioFont.body(11))
                                    .foregroundStyle(StudioColor.inkSoft)
                            }
                        }
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    .frame(minHeight: 52)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(StudioColor.ink.opacity(0.07)).frame(height: 1)
                }
            }
        }
        .studioCard()
    }
}
