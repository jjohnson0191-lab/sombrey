import SwiftUI
import ConvexMobile

// MARK: - Daily Strain hero

/// The hero: Daily Strain. Sombrey has no validated strain formula yet, so
/// the instrument says so ("Building your baseline…") and shows what IS
/// measured — today's sessions and active minutes against the week and
/// the user's usual. Tap: the day in detail, and how strain will be scored.
struct StrainHero: View {
    let overview: ProgressOverviewDTO
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var strain: StrainDayDTO { overview.strain }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button(action: toggle) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        TrainEyebrow(text: "Daily strain", tone: StudioColor.paperSoft)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(StudioColor.paperFaint)
                            .rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                    scoreLine
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(Int(strain.load.activeMinutes))")
                            .font(StudioFont.hero(44, weight: .bold))
                            .foregroundStyle(StudioColor.paper)
                            .monospacedDigit()
                            .studioNumericTransition(strain.load.activeMinutes)
                        Text("active min today")
                            .font(StudioFont.body(13, weight: .medium))
                            .foregroundStyle(StudioColor.paperSoft)
                        Spacer()
                        Text("\(Int(strain.load.sessionCount)) session\(strain.load.sessionCount == 1 ? "" : "s")")
                            .font(StudioFont.body(12, weight: .medium))
                            .foregroundStyle(StudioColor.paperSoft)
                    }
                    WeekLoadBars(week: strain.week, usual: strain.usualActiveMinutes)
                    ForEach(strain.context.filter { !$0.hasSuffix("active min") && !$0.contains("session") }, id: \.self) { line in
                        Text(line)
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.paperSoft)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? "Hides today's detail" : "Shows today's detail")

            if expanded {
                detail
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -6)))
            }
        }
        .instrumentBezel(tint: StudioColor.training)
        .sensoryFeedback(trigger: expanded) { _, open in open ? StudioHaptic.expand : StudioHaptic.collapse }
    }

    @ViewBuilder
    private var scoreLine: some View {
        switch strain.score.state {
        case "scored":
            if let value = strain.score.value {
                Text(String(format: "%.1f", value))
                    .font(StudioFont.hero(56, weight: .bold))
                    .foregroundStyle(StudioColor.paper)
            }
        default:
            VStack(alignment: .leading, spacing: 3) {
                Text("Building your baseline…")
                    .font(StudioFont.hero(26, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                Text("Strain scoring arrives once Sombrey's formula is validated. Today's measured load is below.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.paperFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(StudioColor.paper.opacity(0.12)).frame(height: 1)
            TrainEyebrow(text: "Today", tone: StudioColor.paperSoft)
            if overview.todaySessions.isEmpty {
                Text("Nothing recorded yet today.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.paperSoft)
            }
            ForEach(overview.todaySessions) { s in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name)
                            .font(StudioFont.body(14, weight: .semibold))
                            .foregroundStyle(StudioColor.paper)
                        Text([s.kind == "workout" ? "Workout" : "Activity", ProgressProvenance.label(s.durationSource)].compactMap { $0 }.joined(separator: " · "))
                            .font(StudioFont.body(11))
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                    Spacer()
                    Text(s.minutes.map { "\(Int($0)) min" } ?? "Not recorded")
                        .font(StudioFont.body(13, weight: .semibold))
                        .foregroundStyle(StudioColor.paper)
                }
                .accessibilityElement(children: .combine)
            }
            HStack(spacing: 18) {
                stat("Workouts", "\(Int(strain.load.workoutMinutes)) min")
                stat("Activities", "\(Int(strain.load.activityMinutes)) min")
                stat("Band-recorded", "\(Int(strain.load.bandRecordedMinutes)) min")
            }
            Text(strain.usualActiveMinutes != nil
                 ? "Your usual day: \(Int(strain.usualActiveMinutes!)) active minutes (median of \(Int(strain.baselineDays)) days)."
                 : "Your usual day appears after \(14) days of history — \(Int(strain.baselineDays)) so far.")
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.paperSoft)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("How strain will be scored")
                    .font(StudioFont.body(12, weight: .semibold))
                    .foregroundStyle(StudioColor.paper)
                Text("Sombrey doesn't score strain yet. It will combine heart-rate intensity, time and session type against your own baseline — once that formula is validated. Until then, only measured minutes and sessions are shown.")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.paperFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(StudioFont.body(9, weight: .semibold))
                .tracking(1)
                .foregroundStyle(StudioColor.paperFaint)
            Text(value)
                .font(StudioFont.body(13, weight: .semibold))
                .foregroundStyle(StudioColor.paper)
        }
        .accessibilityElement(children: .combine)
    }

    private func toggle() {
        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) { expanded.toggle() }
    }
}

// MARK: - Body

/// Body — weight now and against a baseline the user chooses; history,
/// trend and entries on open. Entries you made can be edited. Body fat and
/// lean mass appear only once a scan (or entry) provides them.
struct BodySection: View {
    let summary: BodySummaryDTO
    @Binding var baseline: String
    let photoCount: Int
    @State private var editing: WeightEditorTarget?

    enum WeightEditorTarget: Identifiable {
        case new
        case existing(WeightEntryDTO)
        var id: String {
            switch self {
            case .new: return "new"
            case .existing(let e): return e.id
            }
        }
    }

    var body: some View {
        MetricInstrument(title: "BODY", accessory: {
            Button {
                editing = .new
            } label: {
                Label("Add weight", systemImage: "plus")
                    .labelStyle(.iconOnly)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add weight")
        }, readout: {
            readout
        }, detail: {
            detail
        })
        .sheet(item: $editing) { target in
            WeightEntrySheet(target: target)
                .presentationDetents([.medium])
        }
    }

    @ViewBuilder
    private var readout: some View {
        if let latest = summary.latest {
            HStack(alignment: .firstTextBaseline, spacing: 18) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("WEIGHT").font(StudioFont.body(9, weight: .semibold)).tracking(1.1).foregroundStyle(StudioColor.inkSoft)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(String(format: "%.1f", latest.weightKg))
                            .font(StudioFont.hero(34, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                        Text("kg").font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
                    }
                }
                if let change = summary.changeKg {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(baselineTitle.uppercased()).font(StudioFont.body(9, weight: .semibold)).tracking(1.1).foregroundStyle(StudioColor.inkSoft)
                        Text("\(change > 0 ? "+" : change < 0 ? "−" : "")\(String(format: "%.1f", abs(change))) kg")
                            .font(StudioFont.hero(22, weight: .semibold))
                            .foregroundStyle(StudioColor.ink)
                            .monospacedDigit()
                    }
                }
                Spacer(minLength: 0)
            }
            Text("\(latest.dateValue.formatted(.dateTime.day().month(.abbreviated))) · \(ProgressProvenance.label(latest.source) ?? "")")
                .font(StudioFont.body(11))
                .foregroundStyle(StudioColor.inkFaint)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("No weight recorded yet.")
                    .font(StudioFont.body(15, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                Text("Add your weight with + — it builds your trend from the first entry.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkSoft)
            }
        }
    }

    private var baselineTitle: String {
        switch baseline {
        case "30d": return "Since 30 days ago"
        case "90d": return "Since 90 days ago"
        default: return "Since first entry"
        }
    }

    @ViewBuilder
    private var detail: some View {
        VStack(alignment: .leading, spacing: 14) {
            GlassPillTabs(options: [(value: "first", label: "First entry"), (value: "30d", label: "30 days"), (value: "90d", label: "90 days")], selection: $baseline)
            if summary.baseline == nil && summary.latest != nil {
                Text("No entry that far back to compare with.")
                    .font(StudioFont.body(12))
                    .foregroundStyle(StudioColor.inkFaint)
            }
            if summary.entries.count >= 2 {
                ProgressSeriesChart(
                    points: summary.entries.map { .init(t: $0.date, value: $0.weightKg, source: $0.source, label: nil) },
                    unit: "kg",
                    baseline: summary.baseline?.entry.weightKg,
                    baselineLabel: "Baseline",
                    height: 150)
            }
            VStack(spacing: 0) {
                ForEach(summary.entries.reversed().prefix(12)) { entry in
                    Button {
                        if entry.source == "manual" { editing = .existing(entry) }
                    } label: {
                        HStack {
                            Text(entry.dateValue.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))
                                .font(StudioFont.body(13))
                                .foregroundStyle(StudioColor.inkSoft)
                            Spacer()
                            Text(String(format: "%.1f kg", entry.weightKg))
                                .font(StudioFont.body(14, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                                .monospacedDigit()
                            if entry.source != "manual", let s = ProgressProvenance.label(entry.source) {
                                Text(s).font(StudioFont.body(10)).foregroundStyle(StudioColor.inkFaint)
                            }
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(entry.source == "manual" ? "Edit this entry" : "")
                }
            }
            if photoCount > 0 {
                Text("\(photoCount) progress photo\(photoCount == 1 ? "" : "s") logged")
                    .font(StudioFont.body(11))
                    .foregroundStyle(StudioColor.inkFaint)
            }
        }
    }
}

/// Entering or correcting a weight: the value and when it was taken.
struct WeightEntrySheet: View {
    let target: BodySection.WeightEditorTarget
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var date = Date()
    @State private var isSaving = false
    @State private var error: String?
    @State private var saved = 0
    @FocusState private var focused: Bool

    private var kg: Double? { Double(text.replacingOccurrences(of: ",", with: ".")) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    TextField("", text: $text, prompt: Text("0.0").foregroundStyle(StudioColor.inkFaint))
                        .font(StudioFont.hero(56, weight: .bold))
                        .foregroundStyle(StudioColor.ink)
                        .keyboardType(.decimalPad)
                        .focused($focused)
                        .fixedSize()
                    Text("kg").font(StudioFont.body(18, weight: .medium)).foregroundStyle(StudioColor.inkSoft)
                }
                DatePicker("Taken", selection: $date, in: ...Date())
                    .font(StudioFont.body(15))
                if let error {
                    Text(error).font(StudioFont.body(12)).foregroundStyle(StudioColor.danger)
                }
                Spacer()
            }
            .padding(24)
            .background(StudioColor.env5.ignoresSafeArea())
            .navigationTitle(isNew ? "Add weight" : "Edit weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save", action: save).disabled(kg == nil || isSaving)
                }
            }
        }
        .onAppear {
            if case .existing(let e) = target {
                text = String(format: "%.1f", e.weightKg)
                date = e.dateValue
            }
            focused = true
        }
        .sensoryFeedback(.success, trigger: saved)
    }

    private var isNew: Bool { if case .new = target { return true } else { return false } }

    private func save() {
        guard let kg else { return }
        isSaving = true
        error = nil
        let dateMs = date.timeIntervalSince1970 * 1000
        let target = target
        Task {
            do {
                switch target {
                case .new:
                    let _: String = try await ConvexClientProvider.client.mutation("measurements:logWeight", with: ["weightKg": kg, "date": dateMs])
                case .existing(let e):
                    try await ConvexClientProvider.client.mutation("measurements:updateWeight", with: ["id": e.id, "weightKg": kg, "date": dateMs])
                }
                saved += 1
                dismiss()
            } catch {
                self.error = "Enter a weight between 20 and 400 kg. If that's right, check your connection and try again."
            }
            isSaving = false
        }
    }
}

// MARK: - Performance

/// Performance: WORKOUTS | ACTIVITIES, the subject (all workouts, an
/// exercise, or an activity) and its metrics — at rest the period's
/// numbers; opened, the graph with each reading, the personal baseline and
/// the comparison with the previous period.
struct PerformanceSection: View {
    @State private var mode = "workouts"
    @State private var subject: String?
    @State private var metric: String?
    @State private var range: String?
    @State private var expanded = false
    @State private var result = ConvexQuery<PerformanceDTO>()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            TrainEyebrow(text: "Performance")
            GlassSwitch(options: [(value: "workouts", label: "WORKOUTS"), (value: "activities", label: "ACTIVITIES")], selection: $mode)
            content
        }
        .studioCard()
        .task(id: queryKey) { subscribe() }
        .onChange(of: mode) { _, _ in subject = nil; metric = nil; range = nil }
        .sensoryFeedback(trigger: expanded) { _, open in open ? StudioHaptic.expand : StudioHaptic.collapse }
    }

    private var queryKey: String { "\(mode)|\(subject ?? "")|\(metric ?? "")|\(range ?? "")" }

    private func subscribe() {
        var args: [String: ConvexEncodable?] = ["tzOffsetMinutes": Double(TimeZone.current.secondsFromGMT() / 60), "mode": mode]
        if let subject { args["subject"] = subject }
        if let metric { args["metric"] = metric }
        if let range { args["range"] = range }
        result.subscribe(to: "progress:performance", with: args)
    }

    @ViewBuilder
    private var content: some View {
        if let r = result.value {
            if r.subjects.isEmpty {
                Text(mode == "workouts"
                     ? "No workouts recorded yet. Your first one starts this history."
                     : "No activities recorded yet. Start one in Train › Activity, or on your band.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                GlassPillTabs(options: r.subjects.map { (value: $0.id, label: $0.label) }, selection: Binding(get: { r.subject ?? "" }, set: { subject = $0; metric = nil }))
                if r.metrics.count > 1 {
                    GlassPillTabs(options: r.metrics.map { (value: $0.key, label: $0.label) }, selection: Binding(get: { r.metric?.key ?? "" }, set: { metric = $0 }))
                }
                if let m = r.metric, let stats = r.stats {
                    if r.ranges.count > 1 {
                        GlassPillTabs(options: r.ranges.map { (value: $0, label: ProgressFormat.rangeLabel($0)) }, selection: Binding(get: { r.range ?? "" }, set: { range = $0 }))
                    }
                    ProgressStatsRow(stats: stats, unit: m.unit)
                    if m.estimated == true {
                        Text("Estimated from your sets (Epley, 1–10 reps).")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    if let c = r.comparison {
                        Text("\(Int((abs(c.change) * 100).rounded()))% \(c.change > 0 ? "above" : "below") the previous \(ProgressFormat.rangeLabel(r.range ?? "30d").lowercased()) period")
                            .font(StudioFont.body(12, weight: .medium))
                            .foregroundStyle(StudioColor.ink)
                    }
                    Button {
                        withAnimation(StudioMotion.resolve(StudioMotion.unfold, reduceMotion: reduceMotion)) { expanded.toggle() }
                    } label: {
                        HStack(spacing: 6) {
                            Text(expanded ? "Hide graph" : "Show graph")
                            Image(systemName: "chevron.down").rotationEffect(.degrees(expanded ? 180 : 0))
                        }
                        .font(StudioFont.body(12, weight: .semibold))
                        .foregroundStyle(StudioColor.inkSoft)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    if expanded {
                        ProgressSeriesChart(points: r.points, unit: m.unit, baseline: r.baseline, baselineLabel: "Your earlier average")
                            .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -6)))
                        if r.baseline == nil {
                            Text("A personal baseline appears once there are readings before this period.")
                                .font(StudioFont.body(11))
                                .foregroundStyle(StudioColor.inkFaint)
                        }
                    }
                } else {
                    Text("Not recorded for \(r.subjects.first { $0.id == r.subject }?.label ?? "this") yet.")
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.inkSoft)
                }
            }
        } else if result.isLoading {
            ProgressView().tint(StudioColor.ink)
        } else if result.errorMessage != nil {
            Text("We couldn't load your performance. Check your connection.")
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
        }
    }
}

// MARK: - You vs You

struct YouVsYouSection: View {
    let insights: [InsightDTO]

    var body: some View {
        MetricInstrument(title: "YOU VS YOU", readout: {
            if let first = insights.first {
                Text(first.text)
                    .font(StudioFont.body(15, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Not enough history yet to compare you with yourself. Comparisons appear once two periods each have a few sessions.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }, detail: {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(insights) { i in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(i.text)
                            .font(StudioFont.body(14, weight: .medium))
                            .foregroundStyle(StudioColor.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(i.basis)
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.inkFaint)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        })
    }
}

// MARK: - Consistency

struct ConsistencySection: View {
    let consistency: ConsistencyDTO

    var body: some View {
        let w = consistency.thisWeek
        MetricInstrument(title: "TRAINING CONSISTENCY", readout: {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(Int(w.trainingDays))").font(StudioFont.hero(34, weight: .semibold)).foregroundStyle(StudioColor.ink)
                            Text("training day\(w.trainingDays == 1 ? "" : "s") this week").font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
                        }
                    }
                    Spacer(minLength: 0)
                    if let usual = consistency.usualTrainingDays {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("YOUR USUAL").font(StudioFont.body(9, weight: .semibold)).tracking(1.1).foregroundStyle(StudioColor.inkSoft)
                            Text("\(Int(usual.rounded())) days").font(StudioFont.body(15, weight: .semibold)).foregroundStyle(StudioColor.ink)
                        }
                    }
                }
                WeekPattern(days: w.days)
            }
        }, detail: {
            VStack(alignment: .leading, spacing: 14) {
                WeekPattern(days: w.days, showMinutes: true)
                HStack(spacing: 18) {
                    fact("Active days", "\(Int(w.activeDays))")
                    fact("Rest days", "\(Int(w.restDays))")
                    fact("Time", "\(Int(w.minutes)) min")
                }
                if let scheduled = w.plannedScheduled {
                    Text("\(Int(w.plannedCompleted)) of \(Int(scheduled)) planned workouts completed this week.")
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                } else if w.plannedCompleted > 0 {
                    Text("\(Int(w.plannedCompleted)) planned workout\(w.plannedCompleted == 1 ? "" : "s") completed this week.")
                        .font(StudioFont.body(13, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                }
                if !consistency.previousWeeks.isEmpty {
                    TrainEyebrow(text: "Training days, previous weeks")
                    HStack(alignment: .bottom, spacing: 8) {
                        ForEach(Array(consistency.previousWeeks.reversed().enumerated()), id: \.offset) { _, week in
                            VStack(spacing: 4) {
                                RoundedRectangle(cornerRadius: 3, style: .continuous)
                                    .fill(StudioColor.env0.opacity(0.6))
                                    .frame(height: max(3, CGFloat(week.trainingDays) * 8))
                                Text("\(Int(week.trainingDays))").font(StudioFont.body(9)).foregroundStyle(StudioColor.inkFaint)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(height: 76, alignment: .bottom)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Training days per week, oldest first: " + consistency.previousWeeks.reversed().map { "\(Int($0.trainingDays))" }.joined(separator: ", "))
                }
                if consistency.usualTrainingDays == nil {
                    Text("Your usual week appears after three weeks of history.")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                }
            }
        })
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(StudioFont.body(9, weight: .semibold)).tracking(1.1).foregroundStyle(StudioColor.inkSoft)
            Text(value).font(StudioFont.body(15, weight: .semibold)).foregroundStyle(StudioColor.ink)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Personal records

struct RecordsSection: View {
    let records: [PersonalRecordDTO]

    var body: some View {
        MetricInstrument(title: "PERSONAL RECORDS", readout: {
            if let r = records.first {
                VStack(alignment: .leading, spacing: 4) {
                    if r.isNew {
                        Text("NEW PERSONAL BEST").font(StudioFont.body(10, weight: .semibold)).tracking(1.3).foregroundStyle(StudioColor.accentInk)
                    }
                    Text(r.subject).font(StudioFont.body(14, weight: .medium)).foregroundStyle(StudioColor.inkSoft)
                    Text(r.display).font(StudioFont.hero(28, weight: .semibold)).foregroundStyle(StudioColor.ink)
                    Text("\(r.metric) · \(Date(timeIntervalSince1970: r.date / 1000).formatted(.dateTime.day().month(.abbreviated)))")
                        .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
                }
                .accessibilityElement(children: .combine)
            } else {
                Text("Records appear once you've repeated an exercise or activity and beaten an earlier session.")
                    .font(StudioFont.body(13))
                    .foregroundStyle(StudioColor.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }, detail: {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(records) { r in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.subject).font(StudioFont.body(14, weight: .semibold)).foregroundStyle(StudioColor.ink)
                            Text([r.metric, r.previous.map { "was \($0.display)" }, ProgressProvenance.label(r.source)].compactMap { $0 }.joined(separator: " · "))
                                .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(r.display).font(StudioFont.body(14, weight: .semibold)).foregroundStyle(StudioColor.ink).monospacedDigit()
                            Text(Date(timeIntervalSince1970: r.date / 1000).formatted(.dateTime.day().month(.abbreviated).year()))
                                .font(StudioFont.body(10)).foregroundStyle(StudioColor.inkFaint)
                        }
                    }
                    .padding(.vertical, 10)
                    .accessibilityElement(children: .combine)
                }
            }
        })
    }
}

// MARK: - Load & recovery

struct LoadRecoverySection: View {
    let loadRecovery: LoadRecoveryDTO
    let longer: [LoadRecoveryDayDTO]

    var body: some View {
        MetricInstrument(title: "LOAD & RECOVERY", readout: {
            VStack(alignment: .leading, spacing: 8) {
                PairedTimeline(days: loadRecovery.days)
                HStack(spacing: 14) {
                    legend(bar: true, "Active minutes")
                    legend(bar: false, "Readiness")
                }
            }
        }, detail: {
            VStack(alignment: .leading, spacing: 12) {
                TrainEyebrow(text: "Last 28 days")
                PairedTimeline(days: longer, compact: false)
                if let rel = loadRecovery.relationship {
                    Text(rel.statement)
                        .font(StudioFont.body(14, weight: .medium))
                        .foregroundStyle(StudioColor.ink)
                    Text("Based on \(Int(loadRecovery.pairedDays)) days of load paired with the next morning's readiness.")
                        .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
                } else {
                    Text("Sombrey looks for a relationship between your load and next-morning readiness once there are 21 paired days — \(Int(loadRecovery.pairedDays)) so far.")
                        .font(StudioFont.body(12)).foregroundStyle(StudioColor.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("Load here is measured active minutes; it becomes strain once strain scoring is validated.")
                    .font(StudioFont.body(10)).foregroundStyle(StudioColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        })
    }

    private func legend(bar: Bool, _ label: String) -> some View {
        HStack(spacing: 5) {
            if bar {
                RoundedRectangle(cornerRadius: 1.5).fill(StudioColor.env0.opacity(0.75)).frame(width: 8, height: 10)
            } else {
                Text("72").font(StudioFont.body(9, weight: .semibold)).foregroundStyle(StudioColor.accentInk).accessibilityHidden(true)
            }
            Text(label).font(StudioFont.body(10)).foregroundStyle(StudioColor.inkSoft)
        }
    }
}

// MARK: - Milestones

struct MilestonesSection: View {
    let milestones: [MilestoneDTO]

    var body: some View {
        MetricInstrument(title: "MILESTONES", readout: {
            if let m = milestones.first {
                HStack(alignment: .firstTextBaseline) {
                    Text(m.title).font(StudioFont.body(15, weight: .semibold)).foregroundStyle(StudioColor.ink)
                    Spacer()
                    Text(Date(timeIntervalSince1970: m.achievedAt / 1000).formatted(.dateTime.day().month(.abbreviated).year()))
                        .font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
                }
                .accessibilityElement(children: .combine)
            } else {
                Text("Your first workout or activity will be the first milestone.")
                    .font(StudioFont.body(13)).foregroundStyle(StudioColor.inkSoft)
            }
        }, detail: {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(milestones.dropFirst()) { m in
                    HStack(alignment: .firstTextBaseline) {
                        Text(m.title).font(StudioFont.body(13, weight: .medium)).foregroundStyle(StudioColor.ink)
                        Spacer()
                        Text(Date(timeIntervalSince1970: m.achievedAt / 1000).formatted(.dateTime.day().month(.abbreviated).year()))
                            .font(StudioFont.body(10)).foregroundStyle(StudioColor.inkFaint)
                    }
                    .accessibilityElement(children: .combine)
                }
                if milestones.count <= 1 {
                    Text("More appear as your history grows.").font(StudioFont.body(11)).foregroundStyle(StudioColor.inkFaint)
                }
            }
        })
    }
}
