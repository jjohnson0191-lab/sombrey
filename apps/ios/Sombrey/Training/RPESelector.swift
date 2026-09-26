import SwiftUI

/// Rate of Perceived Exertion — "How hard did that feel?" — the user's own
/// voice beside what the band measured. One tap records it on the session
/// (`effort:setRpe`); tapping another number replaces it. Anchors are in
/// words under the numbers, so nothing depends on colour. It's a separate
/// signal: RPE never changes Strain (strain-1.0).
struct RPESelector: View {
    /// "workout" | "band_activity" | "noticed_activity"
    let kind: String
    let sessionId: String?
    var initial: Int? = nil
    var onLight = true

    @State private var selected: Int?
    @State private var saving = false
    @State private var failed = false
    @State private var saves = 0

    static let anchors: [Int: String] = [1: "Very easy", 3: "Easy", 5: "Moderate", 7: "Hard", 9: "Very hard", 10: "Max"]

    private var ink: Color { onLight ? StudioColor.ink : StudioColor.paper }
    private var faint: Color { onLight ? StudioColor.inkFaint : StudioColor.paperFaint }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("How hard did that feel?")
                .font(StudioFont.body(15, weight: .semibold))
                .foregroundStyle(ink)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 5), spacing: 6) {
                ForEach(1...10, id: \.self) { n in cell(n) }
            }
            .primaryNavigationExclusion()
            Text(caption)
                .font(StudioFont.body(11))
                .foregroundStyle(failed ? StudioColor.danger : faint)
        }
        .sensoryFeedback(.success, trigger: saves)
        .onAppear { if selected == nil { selected = initial } }
        .accessibilityIdentifier("rpe.selector")
    }

    private var caption: String {
        if failed { return "Couldn't save — tap again to retry." }
        if saving { return "Saving…" }
        if let s = selected { return "Saved: \(s)/10\(RPESelector.label(s).map { " · \($0)" } ?? ""). Tap another to change it." }
        return "One tap. It's your perception — the band can't measure it."
    }

    nonisolated static func label(_ n: Int) -> String? {
        switch n {
        case 1: return "Very easy"
        case 2, 3: return "Easy"
        case 4, 5: return "Moderate"
        case 6, 7: return "Hard"
        case 8, 9: return "Very hard"
        case 10: return "Max effort"
        default: return nil
        }
    }

    private func cell(_ n: Int) -> some View {
        let isOn = selected == n
        return Button { save(n) } label: {
            VStack(spacing: 2) {
                Text("\(n)")
                    .font(StudioFont.hero(18, weight: isOn ? .bold : .semibold))
                    .foregroundStyle(isOn ? (onLight ? StudioColor.paper : StudioColor.ink) : ink)
                    .monospacedDigit()
                Text(Self.anchors[n] ?? " ")
                    .font(StudioFont.body(8, weight: .semibold))
                    .foregroundStyle(isOn ? (onLight ? StudioColor.paper.opacity(0.85) : StudioColor.ink.opacity(0.8)) : faint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isOn ? (onLight ? StudioColor.ink : StudioColor.paper) : (onLight ? Color.white.opacity(0.45) : StudioColor.paper.opacity(0.08)))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(isOn ? Color.clear : ink.opacity(0.1), lineWidth: 1)
                    }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(sessionId == nil || saving)
        .accessibilityLabel("\(n)\(RPESelector.label(n).map { ", \($0)" } ?? "")")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private func save(_ n: Int) {
        guard let sessionId else { return }
        let previous = selected
        selected = n
        saving = true
        failed = false
        Task {
            do {
                let _: RPESaveResult = try await ConvexClientProvider.client.mutation("effort:setRpe", with: ["kind": kind, "sessionId": sessionId, "rpe": Double(n)])
                saves += 1
            } catch {
                selected = previous
                failed = true
            }
            saving = false
        }
    }
}

/// `effort:setRpe`'s result.
struct RPESaveResult: Decodable, Equatable {
    let ratedOn: String
    let sessionId: String
    let rpe: Double
}

/// `effort:pending` — finished sessions from the last 36 h without a rating.
struct PendingRPEDTO: Decodable, Equatable, Identifiable {
    let kind: String
    let sessionId: String
    let name: String
    let endedAt: Double
    let minutes: Double?
    var id: String { sessionId }
}

/// Train › a band-recorded (or noticed) session the user hasn't rated yet —
/// one at a time, dismissible. Rated sessions leave the list by themselves.
struct PendingRPECard: View {
    @State private var pending = ConvexQuery<[PendingRPEDTO]>()
    @AppStorage("rpe.dismissed") private var dismissedRaw = ""

    private var dismissed: Set<String> { Set(dismissedRaw.split(separator: ",").map(String.init)) }

    var body: some View {
        Group {
            if let item = (pending.value ?? []).first(where: { !dismissed.contains($0.sessionId) }) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name)
                                .font(StudioFont.body(14, weight: .semibold))
                                .foregroundStyle(StudioColor.ink)
                            Text([item.minutes.map { "\(Int($0)) min" }, Date(timeIntervalSince1970: item.endedAt / 1000).formatted(.relative(presentation: .named))].compactMap { $0 }.joined(separator: " · "))
                                .font(StudioFont.body(11))
                                .foregroundStyle(StudioColor.inkSoft)
                        }
                        Spacer()
                        Button("Not now") { dismissedRaw = (dismissed.union([item.sessionId])).joined(separator: ",") }
                            .font(StudioFont.body(12, weight: .medium))
                            .foregroundStyle(StudioColor.inkSoft)
                            .frame(minHeight: 44)
                    }
                    RPESelector(kind: item.kind, sessionId: item.sessionId)
                        .id(item.sessionId)
                }
                .padding(18)
                .background {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Color.white.opacity(0.4))
                        .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(StudioColor.ink.opacity(0.07), lineWidth: 1) }
                }
                .transition(.opacity)
            }
        }
        .task { pending.subscribe(to: "effort:pending") }
    }
}
