import SwiftUI
import ConvexMobile

// MARK: - Live activity

/// An activity in progress — immersive and calm: what you're doing, how
/// long, your heart right now and how hard that is, then only the
/// measurements that matter for this activity. Large numbers; no
/// spreadsheet. Every value is live band data, labelled as waiting when the
/// band hasn't reported it (never a zero).
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
        .confirmationDialog("End \(activitySession.activity?.name ?? "activity")?", isPresented: $showingEndConfirm, titleVisibility: .visible) {
            Button("End and save") { finish() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text("Your band's record of this session is kept.")
        }
    }

    private func content(activity: SombreyActivity, now: Date) -> some View {
        let tally = liveTally(at: now)
        let heartRate = liveHeartRate(at: now)
        return VStack(alignment: .leading, spacing: 22) {
            header(activity: activity, now: now)
                .padding(.top, 16)

            VStack(alignment: .leading, spacing: 6) {
                HeroNumberText(text: TrainingMath.clock(activitySession.activeSeconds(at: now)), size: .lg, tone: .paper, animatesEntrance: false)
                    .monospacedDigit()
                    .accessibilityLabel("Active time \(TrainingMath.clock(activitySession.activeSeconds(at: now)))")
                TrainEyebrow(text: activitySession.isPaused ? "Paused" : "Active time", tone: StudioColor.paperSoft)
                heartReadout(heartRate)
                    .padding(.top, 14)
            }
            .instrumentBezel(tint: activity.profile.character.tint)

            liveMetrics(activity: activity, tally: tally, now: now)

            controls
        }
        .padding(.bottom, 24)
    }

    private func header(activity: SombreyActivity, now: Date) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: activity.profile.glyph)
                .font(.system(size: 22))
                .foregroundStyle(StudioColor.ink)
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.name)
                    .font(StudioFont.hero(24, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .lineLimit(1)
                recordingState(now: now)
            }
            Spacer()
        }
    }

    private func recordingState(now: Date) -> some View {
        let connected = wearableManager.displayState == .connected || wearableManager.displayState == .syncing
        let text: String
        if activitySession.isPaused {
            text = "Paused"
        } else if connected {
            text = "Band recording"
        } else {
            text = "Band out of range"
        }
        return HStack(spacing: 5) {
            Circle()
                .fill(connected && !activitySession.isPaused ? StudioColor.accentInk : StudioColor.inkFaint)
                .frame(width: 6, height: 6)
            Text(text.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.inkSoft)
        }
    }

    @ViewBuilder
    private func heartReadout(_ heartRate: Double?) -> some View {
        if let heartRate {
            let context = intensity.value
            let zone = ActivityIntensity.zone(heartRate: heartRate, maxHeartRate: context?.estimatedMaxHeartRate)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                LivePulseMark(bpm: heartRate)
                Text("\(Int(heartRate.rounded()))")
                    .font(StudioFont.hero(44, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                    .monospacedDigit()
                    .studioNumericTransition(heartRate.rounded())
                Text("BPM")
                    .font(StudioFont.body(11, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(StudioColor.paperSoft)
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let zone {
                        Text(zone.label)
                            .font(StudioFont.body(15, weight: .semibold))
                            .foregroundStyle(StudioColor.accentInkDark)
                        Text("\(zone.percentOfMax)% of est. max")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.paperFaint)
                    } else if let resting = context?.restingHeartRate, resting > 0, heartRate > resting {
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
            Text(heartRateAbsence)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.paperFaint)
        }
    }

    private var heartRateAbsence: String {
        switch wearableManager.displayState {
        case .connected, .syncing: return "Heart rate — waiting for the band"
        case .reconnecting, .connecting, .searching: return "Heart rate — band reconnecting"
        default: return "Heart rate — band out of range"
        }
    }

    private func liveMetrics(activity: SombreyActivity, tally: SportSessionLiveUpdate?, now: Date) -> some View {
        let seconds = Double(activitySession.activeSeconds(at: now))
        let metrics = (activity.profile.expected + activity.profile.optional).filter { $0 != .heartRate }
        let tiles: [(ActivityMetric, String?, String?, Bool)] = metrics.compactMap { metric in
            let expected = activity.profile.expected.contains(metric)
            let reading = Self.liveValue(metric, tally: tally, activeSeconds: seconds)
            guard reading != nil || expected else { return nil }
            return (metric, reading?.value, reading?.unit, expected)
        }
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], alignment: .leading, spacing: 18) {
            ForEach(tiles, id: \.0) { metric, value, unit, _ in
                ActivityMetricTile(label: metric.label, value: value, unit: unit,
                                   caption: metric == .pace || metric == .speed ? "Average so far" : nil,
                                   missingText: "Waiting for the band")
            }
        }
        .studioCard()
    }

    /// A live reading for a metric, or nil when the band hasn't reported a
    /// real (non-zero) one. Pace and speed are averages over the active
    /// time — calculated by Sombrey from the band's distance.
    static func liveValue(_ metric: ActivityMetric, tally: SportSessionLiveUpdate?, activeSeconds: Double) -> (value: String, unit: String?)? {
        guard let tally else { return nil }
        switch metric {
        case .steps:
            return tally.steps > 0 ? (ActivityFormat.count(Double(tally.steps)), nil) : nil
        case .distance:
            guard tally.distanceMeters > 0 else { return nil }
            let d = ActivityFormat.distance(Double(tally.distanceMeters))
            return (d.value, d.unit)
        case .calories:
            return tally.calories > 0 ? ("\(Int(tally.calories.rounded()))", "kcal") : nil
        case .pace:
            guard tally.distanceMeters >= 50, activeSeconds > 0,
                  let pace = ActivityFormat.pace(metersPerSecond: Double(tally.distanceMeters) / activeSeconds) else { return nil }
            return (pace, "/km")
        case .speed:
            guard tally.distanceMeters >= 50, activeSeconds > 0 else { return nil }
            return (ActivityFormat.speed(metersPerSecond: Double(tally.distanceMeters) / activeSeconds), "km/h")
        case .heartRate, .climb, .cadence:
            return nil
        }
    }

    private var controls: some View {
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
                Text(isFinishing ? "Saving…" : "End").frame(maxWidth: .infinity)
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

// MARK: - Summary

/// After an activity: what it was, how long, the heart's response, the
/// movement and energy that matter for it, and how it compares with the
/// user's own previous sessions. Figures come from the band's full record
/// once it's in (usually seconds after the end); until then the band's
/// last live update is shown and labelled as such. Heart-rate statistics
/// wait for the full record — a last live reading is never an average.
struct ActivitySummaryView: View {
    @Environment(AppState.self) private var appState
    @Environment(WearableManager.self) private var wearableManager
    @Environment(ActivitySessionManager.self) private var activitySession
    @State private var detail = ConvexQuery<SportSessionDetailDTO?>()
    @State private var history = ConvexQuery<ActivityHistoryDTO>()
    @State private var intensity = ConvexQuery<IntensityContextDTO>()
    @State private var showingHistory = false
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
                history.subscribe(to: "activities:history", with: ["activityKey": key, "limit": 30.0])
            }
            intensity.subscribe(to: "activities:intensityContext")
            // The band's full record is imported shortly after the end
            // (WearableManager schedules it); after a while, say so plainly.
            try? await Task.sleep(nanoseconds: 45_000_000_000)
            waitedLong = true
        }
        .sheet(isPresented: $showingHistory) {
            if let activity = activitySession.activity {
                ActivityHistoryView(activity: activity)
            }
        }
    }

    private func content(_ activity: SombreyActivity) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                TrainEyebrow(text: hasBandRecord ? "Recorded by your band" : "Activity saved", tone: StudioColor.paperSoft)
                HStack(spacing: 12) {
                    Image(systemName: activity.profile.glyph)
                        .font(.system(size: 28))
                        .foregroundStyle(StudioColor.paper)
                    Text(activity.name)
                        .font(StudioFont.hero(34, weight: .semibold))
                        .foregroundStyle(StudioColor.paper)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                HeroNumberText(text: ActivityFormat.duration(Double(durationSeconds)), size: .md, tone: .paper)
                Text(hasBandRecord ? "Duration from your band's record" : "Active time, timed by Sombrey")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.paperFaint)
            }
            .instrumentBezel(tint: activity.profile.character.tint)
            .padding(.top, 28)
            .studioReveal(index: 0)

            heartSection
                .studioReveal(index: 1)

            measurementsSection(activity)
                .studioReveal(index: 2)

            comparisonSection(activity)
                .studioReveal(index: 3)

            if let note = activity.profile.notMeasured {
                Text(note)
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 10) {
                Button {
                    activitySession.reset()
                } label: {
                    Text("Done").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                Button("Your \(activity.name)") { showingHistory = true }
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
                    .frame(minHeight: 44)
            }
            .padding(.top, 4)
            .studioReveal(index: 4)
        }
        .padding(.bottom, 24)
    }

    private var durationSeconds: Int {
        if hasBandRecord, let seconds = session?.durationSeconds, seconds > 0 { return Int(seconds) }
        return activitySession.activeSeconds()
    }

    // Heart rate

    @ViewBuilder
    private var heartSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            TrainEyebrow(text: "Heart rate")
            if hasBandRecord, let session, session.averageHeartRate != nil || session.highestHeartRate != nil {
                HStack(spacing: 16) {
                    ActivityMetricTile(label: "Average", value: session.averageHeartRate.map { "\(Int($0))" }, unit: "bpm")
                    ActivityMetricTile(label: "Peak", value: session.highestHeartRate.map { "\(Int($0))" }, unit: "bpm")
                }
                if let zone = ActivityIntensity.zone(heartRate: session.averageHeartRate, maxHeartRate: intensity.value?.estimatedMaxHeartRate) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Session intensity · \(zone.label)")
                            .font(StudioFont.body(15, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                        Text("Average at \(zone.percentOfMax)% of your estimated max heart rate (from your age).")
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                if let trace = detail.value.flatMap({ $0 })?.detail?.heartRates?.filter({ $0 > 0 }), trace.count >= 4 {
                    VStack(alignment: .leading, spacing: 6) {
                        HeartRateTrace(values: trace)
                            .frame(height: 64)
                        Text("How your heart rate rose and recovered through the session · band record")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
            } else if hasBandRecord {
                ActivityMetricTile(label: "Average", value: nil)
            } else if waitedLong {
                Text("Your band's full record hasn't arrived yet. It comes in automatically next time the band syncs — heart rate appears here and in your history.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    ProgressView().tint(StudioColor.ink)
                    Text("Bringing in your band's full record…")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            }
        }
        .studioCard()
    }

    // Movement & energy — the activity's own measurements

    private func measurementsSection(_ activity: SombreyActivity) -> some View {
        let values = summaryValues()
        let metrics = (activity.profile.expected + activity.profile.optional).filter { $0 != .heartRate }
        let shown = metrics.filter { activity.profile.expected.contains($0) || values[$0] != nil }
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                TrainEyebrow(text: "Movement & energy")
                Spacer()
                Text(hasBandRecord ? "Band record" : "Band · last live update")
                    .font(StudioFont.body(10))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], alignment: .leading, spacing: 18) {
                ForEach(shown, id: \.self) { metric in
                    ActivityMetricTile(label: metric.label, value: values[metric]?.value, unit: values[metric]?.unit)
                }
            }
        }
        .studioCard()
    }

    /// Real values only, from the stored session (band record, else the
    /// last live update it was saved with), else this phone's final tally.
    private func summaryValues() -> [ActivityMetric: (value: String, unit: String?)] {
        var values: [ActivityMetric: (value: String, unit: String?)] = [:]
        let tally = activitySession.finalTally
        let calories = session?.calories ?? tally.flatMap { $0.calories > 0 ? $0.calories : nil }
        let steps = session?.steps ?? tally.flatMap { $0.steps > 0 ? Double($0.steps) : nil }
        let distance = session?.distanceMeters ?? tally.flatMap { $0.distanceMeters > 0 ? Double($0.distanceMeters) : nil }
        if let calories, calories > 0 { values[.calories] = ("\(Int(calories.rounded()))", "kcal") }
        if let steps, steps > 0 { values[.steps] = (ActivityFormat.count(steps), nil) }
        if let distance, distance > 0 {
            let d = ActivityFormat.distance(distance)
            values[.distance] = (d.value, d.unit)
        }
        if let speed = session?.averageSpeedMetersPerSecond, speed > 0 {
            if let pace = ActivityFormat.pace(metersPerSecond: speed) { values[.pace] = (pace, "/km") }
            values[.speed] = (ActivityFormat.speed(metersPerSecond: speed), "km/h")
        }
        if let climb = session?.climbMeters, climb > 0 { values[.climb] = ("\(Int(climb.rounded()))", "m") }
        if let cadence = session?.stepFrequency, cadence > 0 { values[.cadence] = ("\(Int(cadence.rounded()))", "spm") }
        return values
    }

    // Compared with the user's own sessions

    @ViewBuilder
    private func comparisonSection(_ activity: SombreyActivity) -> some View {
        let others = (history.value?.sessions ?? []).filter { $0.id != activitySession.sessionId }
        let lines = ActivityComparison.lines(
            durationSeconds: Double(durationSeconds),
            averageHeartRate: hasBandRecord ? session?.averageHeartRate : nil,
            previous: others
        )
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                TrainEyebrow(text: "Compared with your \(activity.name)")
                ForEach(lines, id: \.self) { line in
                    Text(line)
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .studioCard()
        }
    }
}

/// A band heart-rate series drawn as one calm line — its rises and
/// recoveries, scaled to its own range. Values only; no invented points.
struct HeartRateTrace: View {
    let values: [Double]
    var tone: Color = StudioColor.accentInk

    var body: some View {
        GeometryReader { geo in
            let lo = (values.min() ?? 0) - 4
            let hi = (values.max() ?? 1) + 4
            let span = max(hi - lo, 1)
            Path { path in
                for (index, value) in values.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(max(values.count - 1, 1))
                    let y = geo.size.height * (1 - CGFloat((value - lo) / span))
                    index == 0 ? path.move(to: CGPoint(x: x, y: y)) : path.addLine(to: CGPoint(x: x, y: y))
                }
            }
            .stroke(tone, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Heart rate from \(Int(values.min() ?? 0)) to \(Int(values.max() ?? 0)) beats per minute")
    }
}

// MARK: - Your <activity>

/// Everything Sombrey remembers about one activity: how often, how long,
/// how hard (from band records), the recent trend, and every session.
struct ActivityHistoryView: View {
    let activity: SombreyActivity
    @Environment(\.dismiss) private var dismiss
    @State private var history = ConvexQuery<ActivityHistoryDTO>()
    @State private var opened: ActivityRecordDTO?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if let value = history.value {
                        if value.profile.sessionCount > 0 {
                            stats(value.profile)
                            if value.sessions.count >= 2 {
                                VStack(alignment: .leading, spacing: 10) {
                                    TrainEyebrow(text: "Recent sessions · minutes")
                                    RecentDurationBars(sessions: Array(value.sessions.prefix(10)))
                                }
                                .studioCard()
                            }
                            sessionList(value.sessions)
                        } else {
                            Text("No \(activity.name) sessions yet. Start one from Train › Activity, or on your band — Sombrey brings it in automatically.")
                                .font(StudioFont.body(13))
                                .foregroundStyle(StudioColor.inkSoft)
                                .studioCard()
                        }
                    } else if history.isLoading {
                        ProgressView().tint(StudioColor.ink)
                    } else if let error = history.errorMessage {
                        Text("Couldn't load your \(activity.name) history: \(error)")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.danger)
                    }
                    if let note = activity.profile.notMeasured {
                        Text(note)
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                }
                .padding(20)
            }
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationTitle("Your \(activity.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { history.subscribe(to: "activities:history", with: ["activityKey": activity.key, "limit": 60.0]) }
            .sheet(item: $opened) { record in
                ActivityRecordDetailSheet(record: record)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: activity.profile.glyph)
                    .font(.system(size: 26))
                    .foregroundStyle(StudioColor.paper)
                Text(activity.name)
                    .font(StudioFont.hero(30, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
            }
            if let profile = history.value?.profile, profile.sessionCount > 0 {
                let count = Int(profile.sessionCount)
                Text("\(count) session\(count == 1 ? "" : "s") · \(Int(profile.sessionsLast30Days)) in the last 30 days")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
            }
            Text(activity.profile.focus)
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.paperFaint)
        }
        .instrumentBezel(tint: activity.profile.character.tint)
    }

    private func stats(_ profile: ActivityProfileSummaryDTO) -> some View {
        let items: [(String, String?, String?, AveragedDTO?)] = [
            ("Typical duration", profile.averageDurationSeconds.map { ActivityFormat.duration($0.value) }, nil, profile.averageDurationSeconds),
            ("Average heart rate", profile.averageHeartRate.map { "\(Int($0.value.rounded()))" }, "bpm", profile.averageHeartRate),
            ("Typical peak", profile.averagePeakHeartRate.map { "\(Int($0.value.rounded()))" }, "bpm", profile.averagePeakHeartRate),
            ("Energy", profile.averageCalories.map { "\(Int($0.value.rounded()))" }, "kcal", profile.averageCalories),
            ("Steps", profile.averageSteps.map { ActivityFormat.count($0.value) }, nil, profile.averageSteps),
            ("Distance", profile.averageDistanceMeters.map { ActivityFormat.distance($0.value).value }, profile.averageDistanceMeters.map { ActivityFormat.distance($0.value).unit }, profile.averageDistanceMeters),
        ]
        let present = items.filter { $0.1 != nil }
        return VStack(alignment: .leading, spacing: 14) {
            TrainEyebrow(text: "Your \(activity.name), on average")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], alignment: .leading, spacing: 18) {
                ForEach(present, id: \.0) { label, value, unit, averaged in
                    ActivityMetricTile(label: label, value: value, unit: unit,
                                       caption: averaged.map { "over \(Int($0.sessions)) session\(Int($0.sessions) == 1 ? "" : "s")" })
                }
            }
            let last30 = Int(profile.sessionsLast30Days), previous30 = Int(profile.sessionsPrevious30Days)
            if last30 + previous30 > 0 {
                Text("Frequency · \(last30) in the last 30 days, \(previous30) in the 30 before")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
        .studioCard()
    }

    private func sessionList(_ sessions: [ActivityRecordDTO]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            TrainEyebrow(text: "Sessions")
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

/// One session from an activity's history: band sessions open the full
/// band record; a noticed-and-named period shows what it was built from.
struct ActivityRecordDetailSheet: View {
    let record: ActivityRecordDTO
    @Environment(\.dismiss) private var dismiss
    @State private var detail = ConvexQuery<SportSessionDetailDTO?>()

    var body: some View {
        Group {
            if record.provenance == "band_sport_plus" || record.provenance == "app_sport_plus" {
                if let session = detail.value.flatMap({ $0 })?.session {
                    SportSessionDetailView(session: session)
                } else {
                    ProgressView().tint(StudioColor.ink)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(StudioColor.env4.ignoresSafeArea())
                }
            } else {
                labelledDetail
            }
        }
        .task {
            if record.provenance == "band_sport_plus" || record.provenance == "app_sport_plus" {
                detail.subscribe(to: "sportPlusSessions:getSessionDetail", with: ["sessionId": record.id])
            }
        }
    }

    private var labelledDetail: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(record.displayName)
                    .font(StudioFont.hero(26, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text(record.sourceLine)
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.accentInk)
                Text(record.startDate.formatted(.dateTime.weekday(.wide).day().month().hour().minute()))
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                HStack(spacing: 16) {
                    ActivityMetricTile(label: "Duration", value: record.durationSeconds.map { ActivityFormat.duration($0) })
                    ActivityMetricTile(label: "Avg heart rate", value: record.averageHeartRate.map { "\(Int($0))" }, unit: "bpm")
                    ActivityMetricTile(label: "Peak", value: record.highestHeartRate.map { "\(Int($0))" }, unit: "bpm")
                }
                Text("Sombrey noticed this from your band's heart-rate readings and you named it. The duration spans the elevated readings; heart rate is calculated from them.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StudioColor.env4.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
