import SwiftUI
import ConvexMobile

/// Train › ACTIVITY — what the user is physically doing in the real world.
/// Choose an activity, start it, and the band records it; nothing here
/// asks the user to "pair" anything.
///
/// Order: anything Sombrey noticed but can't name (asks), the activity
/// hero (what are you doing today → START), quick picks (recent, frequent
/// — or popular before there's any history), browse all, and what Sombrey
/// remembers of the chosen activity.
struct ActivityModeView: View {
    @Environment(WearableManager.self) private var wearableManager
    @Environment(ActivitySessionManager.self) private var activitySession
    @State private var usage = ConvexQuery<[ActivityUsageDTO]>()
    @State private var detections = ConvexQuery<[DetectedActivityDTO]>()
    @State private var reviews = ConvexQuery<[ActivityRecordDTO]>()
    @State private var reviewedLocally = Set<String>()
    @State private var openedSession: ActivityRecordDTO?
    @AppStorage("sombreyTrain.selectedActivity") private var selectedKey = ""
    @State private var browsing: BrowseIntent?
    /// The activity whose own page is open.
    @State private var openActivity: SombreyActivity?
    @State private var labelling: DetectedActivityDTO?
    @State private var dismissedLocally = Set<Double>()

    enum BrowseIntent: Identifiable {
        case choose
        case label(DetectedActivityDTO)
        case classify(ActivityRecordDTO)
        var id: String {
            switch self {
            case .choose: return "choose"
            case .label(let window): return "label-\(window.startedAt)"
            case .classify(let record): return "classify-\(record.id)"
            }
        }
    }

    private var recent: [SombreyActivity] {
        ActivityRanking.recent(usage: usage.value ?? [], local: ActivityRecents.recent())
    }

    private var selected: SombreyActivity? {
        ActivityCatalog.byKey[selectedKey] ?? recent.first
    }

    private var pendingDetection: DetectedActivityDTO? {
        (detections.value ?? []).first { !dismissedLocally.contains($0.startedAt) }
    }

    private var pendingReviews: [ActivityRecordDTO] {
        (reviews.value ?? []).filter { !reviewedLocally.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(pendingReviews.prefix(2)) { record in
                BandRecordCard(
                    record: record,
                    suggestions: detectionSuggestions,
                    onOpen: { review(record, as: nil); openedSession = record },
                    onClassify: { review(record, as: $0) },
                    onOther: { browsing = .classify(record) },
                    onDismiss: { review(record, as: nil) }
                )
                .transition(.opacity)
            }

            if let window = pendingDetection {
                NoticedActivityCard(
                    window: window,
                    suggestions: detectionSuggestions,
                    onPick: { label(window, as: $0) },
                    onOther: { browsing = .label(window) },
                    onDismiss: { label(window, as: nil) }
                )
                .transition(.opacity)
            }

            ActivityHero(activity: selected, onOpen: { openActivity = $0 }, onChange: { browsing = .choose })

            quickPicks

            Button {
                browsing = .choose
            } label: {
                HStack {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .medium))
                    Text("Browse all activities")
                        .font(StudioFont.body(14, weight: .medium))
                    Spacer()
                    Text("\(ActivityCatalog.all.count)")
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.inkFaint)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                .foregroundStyle(StudioColor.ink)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .studioCard()

            if let selected {
                YourActivityCard(activity: selected) { openActivity = selected }
                    .id(selected.key)
            }
        }
        .task {
            usage.subscribe(to: "activities:usage")
            detections.subscribe(to: "activities:pendingDetections")
            reviews.subscribe(to: "activities:pendingReviews")
        }
        .sheet(item: $browsing) { intent in
            ActivityBrowserView(recent: recent) { activity in
                switch intent {
                case .choose:
                    selectedKey = activity.key
                    // Choosing an activity opens its own page.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { openActivity = activity }
                case .label(let window): label(window, as: activity)
                case .classify(let record): review(record, as: activity)
                }
            }
        }
        .sheet(item: $openActivity) { activity in
            ActivityExperienceView(activity: activity)
        }
        .sheet(item: $openedSession) { record in
            ActivitySessionSheet(record: record)
        }
        .sensoryFeedback(StudioHaptic.focus, trigger: selectedKey)
    }

    // MARK: Quick picks

    @ViewBuilder
    private var quickPicks: some View {
        let recentPicks = Array(recent.prefix(6))
        let frequent = ActivityRanking.frequent(usage: usage.value ?? []).filter { f in !recentPicks.prefix(3).contains(f) }
        VStack(alignment: .leading, spacing: 14) {
            if recentPicks.isEmpty {
                pickRow(title: "Popular", activities: ActivityCatalog.popularKeys.compactMap { ActivityCatalog.byKey[$0] })
            } else {
                pickRow(title: "Recent", activities: recentPicks)
                if !frequent.isEmpty {
                    pickRow(title: "You do most", activities: Array(frequent.prefix(6)))
                }
            }
        }
    }

    private func pickRow(title: String, activities: [SombreyActivity]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TrainEyebrow(text: title)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(activities) { activity in
                        ActivityChip(activity: activity, isSelected: activity == selected) {
                            selectedKey = activity.key
                            openActivity = activity
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
        }
    }

    // MARK: Detection

    /// What to offer first when asking: the user's own recent activities,
    /// then a few common ones.
    private var detectionSuggestions: [SombreyActivity] {
        var keys = recent.prefix(3).map(\.key)
        for key in ["run", "strength_training", "bike", "walk", "tennis"] where !keys.contains(key) && keys.count < 5 {
            keys.append(key)
        }
        return keys.compactMap { ActivityCatalog.byKey[$0] }
    }

    /// Marks a band record as seen; `activity` answers "what was it?" for a
    /// record whose band mode was too generic.
    private func review(_ record: ActivityRecordDTO, as activity: SombreyActivity?) {
        reviewedLocally.insert(record.id)
        Task {
            var args: [String: ConvexEncodable?] = ["sessionId": record.id]
            if let activity { args["activityKey"] = activity.key }
            do {
                try await ConvexClientProvider.client.mutation("activities:reviewSession", with: args)
            } catch {
                reviewedLocally.remove(record.id)
            }
        }
    }

    private func label(_ window: DetectedActivityDTO, as activity: SombreyActivity?) {
        dismissedLocally.insert(window.startedAt)
        Task {
            var args: [String: ConvexEncodable?] = ["startedAt": window.startedAt, "endedAt": window.endedAt]
            if let activity { args["activityKey"] = activity.key }
            do {
                try await ConvexClientProvider.client.mutation("activities:labelDetection", with: args)
            } catch {
                dismissedLocally.remove(window.startedAt)
            }
        }
    }
}

// MARK: - Hero

/// "What are you doing today?" — the chosen activity, large, in its own
/// character, with one action: start it.
private struct ActivityHero: View {
    @Environment(WearableManager.self) private var wearableManager
    @Environment(ActivitySessionManager.self) private var activitySession
    let activity: SombreyActivity?
    let onOpen: (SombreyActivity) -> Void
    let onChange: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                TrainEyebrow(text: "What are you doing today?", tone: StudioColor.paperSoft)
                Spacer()
                bandState
            }

            if let activity {
                Button { onOpen(activity) } label: {
                    HStack(alignment: .center, spacing: 14) {
                        Image(systemName: activity.glyph)
                            .font(.system(size: 34, weight: .regular))
                            .foregroundStyle(StudioColor.paper)
                            .frame(width: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(activity.name)
                                .font(StudioFont.hero(38, weight: .semibold))
                                .foregroundStyle(StudioColor.paper)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                            Text(activity.categoryName)
                                .font(StudioFont.body(12, weight: .medium))
                                .foregroundStyle(StudioColor.paperFaint)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(activity.name). Open")

                Text(activity.terms.focus)
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    Task { await activitySession.start(activity, wearable: wearableManager) }
                } label: {
                    Text(activitySession.isStarting ? "Starting…" : "Start \(activity.name)")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
                .disabled(activitySession.isStarting)

                Button("Choose a different activity", action: onChange)
                    .font(StudioFont.body(12, weight: .medium))
                    .foregroundStyle(StudioColor.paperSoft)
                    .frame(minHeight: 36)

                if let failure = activitySession.startFailure {
                    Text(failure)
                        .font(StudioFont.body(12))
                        .foregroundStyle(StudioColor.accentInkDark)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("Choose an activity")
                    .font(StudioFont.hero(34, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                Text("Tennis, a run, a round of golf — pick what you're doing and your band records it.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
                Button(action: onChange) {
                    Text("Choose activity").frame(maxWidth: .infinity)
                }
                .buttonStyle(.illuminatedCTA)
            }
        }
        .instrumentBezel(tint: activity?.terms.character.tint ?? StudioColor.env2)
        .onChange(of: activity?.key) { _, _ in activitySession.clearStartFailure() }
    }

    private var bandState: some View {
        let connected = wearableManager.displayState == .connected || wearableManager.displayState == .syncing
        let text: String
        switch wearableManager.displayState {
        case .notPaired: text = "No band"
        case .connected, .syncing: text = "Band ready"
        case .connecting, .reconnecting, .searching: text = "Band reconnecting"
        default: text = "Band disconnected"
        }
        return HStack(spacing: 5) {
            Circle()
                .fill(connected ? StudioColor.accent : StudioColor.paperFaint)
                .frame(width: 6, height: 6)
            Text(text.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(StudioColor.paperSoft)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - From your band

/// A session the band recorded on its own. When the band's mode says what it
/// was, that's the source of truth and the card simply offers it; when the
/// mode is too generic ("free training"), Sombrey asks — it never guesses.
private struct BandRecordCard: View {
    let record: ActivityRecordDTO
    let suggestions: [SombreyActivity]
    let onOpen: () -> Void
    let onClassify: (SombreyActivity) -> Void
    let onOther: () -> Void
    let onDismiss: () -> Void

    private var summary: String {
        var parts = [record.startDate.formatted(.relative(presentation: .named))]
        if let d = record.durationSeconds, d > 0 { parts.append(ActivityFormat.duration(d)) }
        if let hr = record.averageHeartRate, record.heartRateSource != nil { parts.append("\(Int(hr)) avg bpm") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                TrainEyebrow(text: "From your band", tone: StudioColor.accentInk)
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(StudioColor.inkFaint)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
            if record.needsClassification == true {
                Text("Your band recorded an activity it couldn't name.")
                    .font(StudioFont.body(17, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(record.displayName) on the band · \(summary)")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
                Text("What was it?")
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(suggestions) { activity in
                            ActivityChip(activity: activity, isSelected: false) { onClassify(activity) }
                        }
                        Button("Other…", action: onOther)
                            .font(StudioFont.body(13, weight: .medium))
                            .foregroundStyle(StudioColor.inkSoft)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 44)
                    }
                }
                .scrollClipDisabled()
            } else {
                Button(action: onOpen) {
                    HStack(spacing: 14) {
                        if let activity = record.activity {
                            Image(systemName: activity.glyph)
                                .font(.system(size: 24))
                                .foregroundStyle(StudioColor.ink)
                                .frame(width: 32)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(record.activity?.name ?? record.displayName)
                                .font(StudioFont.hero(22, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                            Text(summary)
                                .font(StudioFont.body(12))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .studioCard()
    }
}

// MARK: - We noticed activity

/// A period the band's heart rate says was active, that nothing recorded
/// explains. Sombrey doesn't know what it was, and asks.
private struct NoticedActivityCard: View {
    let window: DetectedActivityDTO
    let suggestions: [SombreyActivity]
    let onPick: (SombreyActivity) -> Void
    let onOther: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TrainEyebrow(text: "We noticed activity", tone: StudioColor.accentInk)
            Text("Looks like you were active for about \(window.minutes) minutes.")
                .font(StudioFont.body(17, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(window.startDate.formatted(.relative(presentation: .named))) · heart rate averaged \(Int(window.averageHeartRate)) bpm, up to \(Int(window.highestHeartRate)) — from your band's readings.")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Text("What were you doing?")
                .font(StudioFont.body(13, weight: .medium))
                .foregroundStyle(StudioColor.ink)
                .padding(.top, 2)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions) { activity in
                        ActivityChip(activity: activity, isSelected: false) { onPick(activity) }
                    }
                    Button("Other…", action: onOther)
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.inkSoft)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                }
            }
            .scrollClipDisabled()
            Button("Not an activity", action: onDismiss)
                .font(StudioFont.body(12, weight: .medium))
                .foregroundStyle(StudioColor.inkFaint)
                .frame(minHeight: 32)
        }
        .studioCard()
    }
}

// MARK: - Your <activity>

/// What Sombrey remembers about the chosen activity — from the user's own
/// sessions only. Opens the full history.
private struct YourActivityCard: View {
    let activity: SombreyActivity
    let onOpen: () -> Void
    @State private var history = ConvexQuery<ActivityHistoryDTO>()

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    TrainEyebrow(text: "Your \(activity.name)")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioColor.inkFaint)
                }
                content
                if let note = activity.terms.notMeasured {
                    Text(note)
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .studioCard()
        .task { history.subscribe(to: "activities:history", with: ["activityKey": activity.key, "limit": 12.0]) }
    }

    @ViewBuilder
    private var content: some View {
        if let value = history.value, value.profile.sessionCount > 0 {
            let count = Int(value.profile.sessionCount)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(count)")
                    .font(StudioFont.hero(34, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text(count == 1 ? activity.terms.sessionNoun : "\(activity.terms.sessionNoun)s")
                    .font(StudioFont.body(13, weight: .medium))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            if let last = value.sessions.first {
                Text("Last · " + lastLine(last))
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
            RecentDurationBars(sessions: Array(value.sessions.prefix(8)))
        } else if history.isLoading {
            ProgressView().tint(StudioColor.ink)
        } else {
            Text("Your first \(activity.name) \(activity.terms.sessionNoun) starts your \(activity.name) history — Sombrey keeps every one.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func lastLine(_ session: ActivityRecordDTO) -> String {
        var parts = [session.startDate.formatted(.relative(presentation: .named))]
        if let duration = session.durationSeconds, duration > 0 { parts.append(ActivityFormat.duration(duration)) }
        if let hr = session.averageHeartRate, hr > 0 { parts.append("\(Int(hr)) avg bpm") }
        return parts.joined(separator: " · ")
    }
}

/// The last few sessions' durations, oldest to newest — real durations
/// only; a session without one leaves a gap, not a zero bar.
struct RecentDurationBars: View {
    let sessions: [ActivityRecordDTO]
    var tone: Color = StudioColor.ink

    var body: some View {
        let ordered = sessions.reversed().map { $0.durationSeconds.flatMap { $0 > 0 ? $0 : nil } }
        let maxValue = ordered.compactMap { $0 }.max() ?? 0
        if maxValue > 0 && ordered.count >= 2 {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(ordered.enumerated()), id: \.offset) { index, value in
                    VStack(spacing: 4) {
                        if let value {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(tone.opacity(index == ordered.count - 1 ? 0.75 : 0.28))
                                .frame(height: max(4, CGFloat(value / maxValue) * 44))
                            Text("\(Int((value / 60).rounded()))")
                                .font(StudioFont.body(9, weight: .medium))
                                .foregroundStyle(tone.opacity(0.5))
                        } else {
                            Spacer().frame(height: 4)
                            Text("–")
                                .font(StudioFont.body(9))
                                .foregroundStyle(tone.opacity(0.3))
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 62, alignment: .bottom)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Recent session durations in minutes: " + ordered.map { $0.map { "\(Int(($0 / 60).rounded()))" } ?? "not recorded" }.joined(separator: ", "))
        }
    }
}

// MARK: - Browser

/// Every activity, organised the way people think about them — search,
/// recent, then groups. 172 activities, one scalable browser.
struct ActivityBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    let recent: [SombreyActivity]
    let onSelect: (SombreyActivity) -> Void
    @State private var searchTerm = ""

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22, pinnedViews: []) {
                    if searchTerm.trimmingCharacters(in: .whitespaces).isEmpty {
                        if !recent.isEmpty {
                            section(title: "Recent", activities: Array(recent.prefix(6)))
                        }
                        ForEach(ActivityCatalog.groups) { group in
                            section(title: group.name, activities: ActivityCatalog.activities(in: group))
                        }
                    } else {
                        let results = ActivityCatalog.search(searchTerm)
                        if results.isEmpty {
                            Text("No activity matches \"\(searchTerm)\".")
                                .font(StudioFont.body(13))
                                .foregroundStyle(StudioColor.inkFaint)
                        } else {
                            grid(results)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(StudioColor.env5.ignoresSafeArea())
            .searchable(text: $searchTerm, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search activities")
            .navigationTitle("Activities")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func section(title: String, activities: [SombreyActivity]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TrainEyebrow(text: title)
            grid(activities)
        }
    }

    private func grid(_ activities: [SombreyActivity]) -> some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(activities) { activity in
                Button {
                    onSelect(activity)
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: activity.glyph)
                            .font(.system(size: 16, weight: .regular))
                            .frame(width: 22)
                        Text(activity.name)
                            .font(StudioFont.body(14, weight: .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(StudioColor.ink)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .background(Color.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(StudioColor.ink.opacity(0.07), lineWidth: 1)
                    }
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }
}
