import SwiftUI
import ConvexMobile

// Every activity session — live, just finished, or from history — is the
// same structure: Header → Performance → Heart-rate behaviour → Session data
// → Sombrey's read → About. What fills it is decided by the activity's terms
// and the engine (`ActivityIntelligence`), so Tennis, Golf, a swim or a
// surf each read as themselves without any per-sport screen.

// MARK: - Session body (shared)

/// The body of a recorded session for any activity.
struct ActivitySessionBody: View {
    let activity: SombreyActivity
    let readings: ActivityReadings
    let previous: [ActivityRecordDTO]
    let maxHeartRate: Double?

    var body: some View {
        let terms = activity.terms
        let experience = ActivityIntelligence.experience(for: activity, readings: readings, previous: previous, maxHeartRate: maxHeartRate)
        let headline = experience.primary.filter { $0.metric != .duration }
        VStack(alignment: .leading, spacing: 16) {
            if !headline.isEmpty {
                IndicatorBoard(title: terms.performanceTitle, indicators: headline, readings: readings, maxHeartRate: maxHeartRate)
                    .studioReveal(index: 1)
            }

            if let zones = experience.zones {
                VStack(alignment: .leading, spacing: 14) {
                    TrainEyebrow(text: terms.effortTitle)
                    IntensityProfileBar(zones: zones, series: readings.heartRateSeries)
                }
                .studioCard()
                .studioReveal(index: 2)
            } else if readings.heartRateSeries.count >= 4 {
                VStack(alignment: .leading, spacing: 10) {
                    TrainEyebrow(text: terms.effortTitle)
                    HeartRateTrace(values: readings.heartRateSeries)
                        .frame(height: 64)
                    Text("How your heart rate rose and recovered · band heart-rate series")
                        .font(StudioFont.body(10))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                .studioCard()
                .studioReveal(index: 2)
            }

            if !experience.secondary.isEmpty {
                IndicatorBoard(title: "Session data", indicators: experience.secondary, readings: readings, maxHeartRate: maxHeartRate, large: false)
                    .studioReveal(index: 3)
            }

            if !experience.notRecorded.isEmpty {
                Text("Not recorded by the band this \(terms.sessionNoun): \(experience.notRecorded.joined(separator: ", ")).")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !experience.insights.isEmpty {
                InsightCard(title: "Sombrey's read on this \(terms.sessionNoun)", insights: experience.insights)
                    .studioReveal(index: 4)
            }

            AboutActivityCard(activity: activity)
                .studioReveal(index: 5)
        }
    }
}

// MARK: - Live activity

/// An activity in progress — immersive and calm: the header's clock, the
/// activity's own headline measurements as the band reports them, then
/// whatever else it's sending. Nothing is shown until it's real.
struct ActiveActivityView: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @Environment(ActivitySessionManager.self) private var activitySession
    @State private var intensity = ConvexQuery<IntensityContextDTO>()
    @State private var showingEndConfirm = false
    @State private var isFinishing = false

    static let heartRateFreshness: TimeInterval = 20
    static let tallyFreshness: TimeInterval = 60

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainActive, showsNav: false, selection: $appState.selectedTab) {
            if let activity = activitySession.activity {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    content(activity: activity, now: context.date)
                }
            }
        }
        .task {
            intensity.subscribe(to: "activities:intensityContext")
            activitySession.reattachIfNeeded(wearable: wearableManager)
        }
        .onChange(of: wearableManager.displayState) { _, _ in
            activitySession.reattachIfNeeded(wearable: wearableManager)
        }
        .sensoryFeedback(StudioHaptic.pauseToggle, trigger: activitySession.isPaused)
        .confirmationDialog("End this \(activitySession.activity?.terms.sessionNoun ?? "session")?", isPresented: $showingEndConfirm, titleVisibility: .visible) {
            Button("End and save") { finish() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text("Your band's record of it is kept.")
        }
    }

    private var bandConnected: Bool {
        wearableManager.displayState == .connected || wearableManager.displayState == .syncing
    }

    private func content(activity: SombreyActivity, now: Date) -> some View {
        let terms = activity.terms
        let seconds = activitySession.activeSeconds(at: now)
        let heartRate = liveHeartRate(at: now)
        let readings = ActivityReadings.live(tally: liveTally(at: now), heartRate: heartRate, activeSeconds: seconds)
        let maxHR = intensity.value?.estimatedMaxHeartRate
        let experience = ActivityIntelligence.experience(for: activity, readings: readings, previous: [], maxHeartRate: maxHR)
        let headline = experience.primary.filter { $0.metric != .duration && $0.metric != .heartRate && $0.metric != .intensity }
        let others = experience.secondary.filter { $0.metric != .heartRate && $0.metric != .intensity }
        return VStack(alignment: .leading, spacing: 18) {
            ActivityHeader(
                activity: activity,
                status: activitySession.isPaused ? .paused : .live(connected: bandConnected),
                time: TrainingMath.clock(seconds),
                timeCaption: activitySession.isPaused ? "Paused" : "Active time"
            ) {
                liveHeart(heartRate, maxHR: maxHR, resting: intensity.value?.restingHeartRate)
            }
            .padding(.top, 16)

            if !headline.isEmpty {
                IndicatorBoard(title: terms.performanceTitle, indicators: headline)
            }
            if !others.isEmpty {
                IndicatorBoard(title: terms.movementTitle, indicators: others, large: false)
            }
            if headline.isEmpty && others.isEmpty {
                Text(bandConnected
                     ? "Your band is recording. Its measurements appear here as it sends them."
                     : "Your band is out of range; its measurements appear when it's back.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .studioCard()
            }

            controls(terms: terms)
        }
        .padding(.bottom, 24)
    }

    @ViewBuilder
    private func liveHeart(_ heartRate: Double?, maxHR: Double?, resting: Double?) -> some View {
        if let heartRate {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                LivePulseMark(bpm: heartRate)
                Text("\(Int(heartRate.rounded()))")
                    .font(StudioFont.hero(40, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                    .monospacedDigit()
                    .studioNumericTransition(heartRate.rounded())
                Text("BPM")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(StudioColor.paperSoft)
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let zone = ActivityIntensity.zone(heartRate: heartRate, maxHeartRate: maxHR) {
                        Text(zone.label)
                            .font(StudioFont.body(15, weight: .semibold))
                            .foregroundStyle(StudioColor.accentInkDark)
                        Text("\(zone.percentOfMax)% of est. max")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.paperFaint)
                    } else if let resting, resting > 0, heartRate > resting {
                        Text("+\(Int((heartRate - resting).rounded()))")
                            .font(StudioFont.body(15, weight: .semibold))
                            .foregroundStyle(StudioColor.accentInkDark)
                        Text("above resting")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                }
            }
            .accessibilityElement(children: .combine)
        } else {
            Text(bandConnected ? "Heart rate — waiting for the band" : "Heart rate — band out of range")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.paperFaint)
        }
    }

    private func controls(terms: ActivityTerms) -> some View {
        HStack(spacing: 12) {
            Button {
                if activitySession.isPaused {
                    activitySession.resume(wearable: wearableManager)
                } else {
                    activitySession.pause(wearable: wearableManager)
                }
            } label: {
                Label(activitySession.isPaused ? "Resume" : "Pause", systemImage: activitySession.isPaused ? "play.fill" : "pause.fill")
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(.ultraThinMaterial, in: Capsule(style: .continuous))
                    .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.1), lineWidth: 1) }
            }
            .buttonStyle(.plain)

            Button {
                showingEndConfirm = true
            } label: {
                Text(isFinishing ? "Saving…" : "End \(terms.sessionNoun)").frame(maxWidth: .infinity)
            }
            .buttonStyle(.illuminatedCTA)
            .disabled(isFinishing)
        }
    }

    private func finish() {
        guard !isFinishing else { return }
        isFinishing = true
        Task {
            await activitySession.finish(wearable: wearableManager)
            isFinishing = false
        }
    }

    private func liveTally(at now: Date) -> SportSessionLiveUpdate? {
        guard let sport = wearableManager.activeSportSession, let update = sport.liveUpdate,
              let at = sport.liveUpdateAt, now.timeIntervalSince(at) < Self.tallyFreshness else { return nil }
        return update
    }

    /// Fresh band heart rate: the real-time stream, else the session's
    /// own push — whichever arrived within `heartRateFreshness`.
    private func liveHeartRate(at now: Date) -> Double? {
        if let hr = wearableManager.latestMeasurements[.heartRate], now.timeIntervalSince(hr.recordedAt) < Self.heartRateFreshness {
            return hr.value
        }
        if let sport = wearableManager.activeSportSession, let update = sport.liveUpdate, update.heartRate > 0,
           let at = sport.liveUpdateAt, now.timeIntervalSince(at) < Self.heartRateFreshness {
            return Double(update.heartRate)
        }
        return nil
    }
}

// MARK: - Just finished

/// After an activity: the recorded session in the shared structure. Figures
/// come from the band's full record once it's in (usually seconds after
/// the end); until then the band's last live update and Sombrey's own
/// timing are shown and labelled as such. Heart-rate statistics wait for
/// the full record.
struct ActivitySummaryView: View {
    @Environment(AppState.self) private var appState
    @Environment(ActivitySessionManager.self) private var activitySession
    @State private var detail = ConvexQuery<SportSessionDetailDTO?>()
    @State private var history = ConvexQuery<ActivityHistoryDTO>()
    @State private var intensity = ConvexQuery<IntensityContextDTO>()
    @State private var openActivity: SombreyActivity?
    @State private var waitedLong = false

    private var session: SportSessionHistoryDTO? { detail.value.flatMap { $0 }?.session }
    private var hasBandRecord: Bool { session?.summarySource == "band_record" }

    var body: some View {
        @Bindable var appState = appState
        ScreenContainer(scene: .trainComplete, showsNav: false, selection: $appState.selectedTab) {
            if let activity = activitySession.activity {
                content(activity)
            }
        }
        .task {
            if let id = activitySession.sessionId {
                detail.subscribe(to: "sportPlusSessions:getSessionDetail", with: ["sessionId": id])
            }
            if let key = activitySession.activity?.key {
                history.subscribe(to: "activities:history", with: ["activityKey": key, "limit": 60.0])
            }
            intensity.subscribe(to: "activities:intensityContext")
            // The band's full record is imported shortly after the end
            // (WearableManager schedules it); after a while, say so plainly.
            try? await Task.sleep(nanoseconds: 45_000_000_000)
            waitedLong = true
        }
        .sheet(item: $openActivity) { activity in
            ActivityExperienceView(activity: activity)
        }
    }

    private var readings: ActivityReadings {
        if let session {
            var r = ActivityReadings.from(session: session, heartRateSeries: detail.value.flatMap { $0 }?.detail?.heartRates)
            if r.durationSeconds == nil, activitySession.activeSeconds() > 0 {
                r.durationSeconds = Double(activitySession.activeSeconds())
                r.durationSource = .sombreyTimer
            }
            return r
        }
        // Before the stored row loads: this phone's final tally and timing.
        var r = ActivityReadings.live(
            tally: activitySession.finalTally.map {
                SportSessionLiveUpdate(sportType: 0, state: 0, durationSeconds: $0.durationSeconds, heartRate: 0,
                                       steps: $0.steps, distanceMeters: $0.distanceMeters, calories: $0.calories)
            },
            heartRate: nil, activeSeconds: activitySession.activeSeconds())
        r.isLive = false
        return r
    }

    private func content(_ activity: SombreyActivity) -> some View {
        let r = readings
        let previous = (history.value?.sessions ?? []).filter { $0.id != activitySession.sessionId }
        return VStack(alignment: .leading, spacing: 16) {
            ActivityHeader(
                activity: activity,
                status: .recorded(activitySession.startedAt ?? Date()),
                time: r.durationSeconds.map { ActivityFormat.duration($0) },
                timeCaption: r.durationSource == .sombreyTimer ? "Active time · timed by Sombrey" : "Duration · band record"
            ) {
                recordState
            }
            .padding(.top, 28)
            .studioReveal(index: 0)

            ActivitySessionBody(activity: activity, readings: r, previous: previous, maxHeartRate: intensity.value?.estimatedMaxHeartRate)

            // The user's own voice beside what the band measured.
            RPESelector(kind: "band_activity", sessionId: activitySession.sessionId)

            VStack(spacing: 10) {
                Button {
                    activitySession.reset()
                } label: {
                    Text("Done").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                Button("Your \(activity.name)") { openActivity = activity }
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .frame(minHeight: 44)
            }
            .padding(.top, 4)
        }
        .padding(.bottom, 24)
    }

    @ViewBuilder
    private var recordState: some View {
        if hasBandRecord {
            Text("Recorded by your band")
                .font(StudioFont.body(12, weight: .medium))
                .foregroundStyle(StudioColor.paperSoft)
        } else if waitedLong {
            Text("Your band's full record hasn't arrived yet — heart rate appears here and in your history once it syncs.")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.paperSoft)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            HStack(spacing: 8) {
                ProgressView().tint(StudioColor.paper)
                Text("Bringing in your band's full record…")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperSoft)
            }
        }
    }
}

// MARK: - A session from history

/// Any stored session, in the same structure: band sessions load their full
/// record (and keep the raw recording details one tap away); a period
/// Sombrey noticed and the user named shows what it was built from.
struct ActivitySessionSheet: View {
    let record: ActivityRecordDTO
    @Environment(\.dismiss) private var dismiss
    @State private var detail = ConvexQuery<SportSessionDetailDTO?>()
    @State private var history = ConvexQuery<ActivityHistoryDTO>()
    @State private var intensity = ConvexQuery<IntensityContextDTO>()
    @State private var showingRaw = false

    private var isBandSession: Bool { record.provenance == "band_sport_plus" || record.provenance == "app_sport_plus" }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let activity = record.activity {
                    content(activity)
                        .padding(20)
                } else {
                    Text(record.displayName)
                        .font(StudioFont.hero(26, weight: .semibold))
                        .padding(20)
                }
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(isPresented: $showingRaw) {
                if let session = detail.value.flatMap({ $0 })?.session {
                    SportSessionDetailView(session: session)
                }
            }
        }
        .task {
            if isBandSession {
                detail.subscribe(to: "sportPlusSessions:getSessionDetail", with: ["sessionId": record.id])
            }
            history.subscribe(to: "activities:history", with: ["activityKey": record.activityKey, "limit": 60.0])
            intensity.subscribe(to: "activities:intensityContext")
        }
    }

    private var readings: ActivityReadings {
        if let value = detail.value.flatMap({ $0 }) {
            return ActivityReadings.from(session: value.session, heartRateSeries: value.detail?.heartRates)
        }
        return ActivityReadings.from(record: record)
    }

    private func content(_ activity: SombreyActivity) -> some View {
        let previous = (history.value?.sessions ?? []).filter { $0.startedAt < record.startedAt }
        let r = readings
        return VStack(alignment: .leading, spacing: 16) {
            ActivityHeader(
                activity: activity,
                status: .recorded(record.startDate),
                time: r.durationSeconds.map { ActivityFormat.duration($0) },
                timeCaption: r.durationSource == .sombreyTimer ? "Active time · timed by Sombrey" : "Duration"
            ) {
                Text(record.sourceLine)
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.paperSoft)
            }
            ActivitySessionBody(activity: activity, readings: r, previous: previous, maxHeartRate: intensity.value?.estimatedMaxHeartRate)
            if record.provenance == "user_labelled" {
                Text("Sombrey noticed this from your band's heart-rate readings and you named it. The duration spans the elevated readings; heart rate is calculated from them.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isBandSession && detail.value.flatMap({ $0 }) != nil {
                Button("Recording details") { showingRaw = true }
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .frame(minHeight: 44)
            }
        }
    }
}
