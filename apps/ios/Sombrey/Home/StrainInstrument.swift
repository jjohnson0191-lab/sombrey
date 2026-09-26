import SwiftUI

/// `intelligence:todayStrain` — today's Sombrey Strain exactly as the server
/// computed it (convex/strain/*). No strain arithmetic happens on the phone.
struct TodayStrainDTO: Decodable, Equatable {
    struct Baseline: Decodable, Equatable {
        struct Required: Decodable, Equatable { let historyDays: Double; let activeDays: Double; let qualitySessions: Double }
        let status: String
        let historyDays: Double
        let activeDays: Double
        let qualitySessions: Double
        let required: Required
    }
    let date: String
    /// NOT_ENOUGH_DATA | BUILDING_BASELINE | LOW_CONFIDENCE | READY
    let state: String
    let confidence: String
    let version: String
    /// Physically validated. False until the band passes validation.
    let validated: Bool
    let value: Double?
    let band: String?
    let relativeLabel: String?
    let sessions: Double
    let activeMinutes: Double
    let baseline: Baseline
}

/// What the Strain instrument says, from the server's state alone.
enum StrainPresentation: Equatable {
    case loading
    case unavailable
    case value(Int, band: String, note: String?)
    case message(title: String, detail: String)

    init(_ dto: TodayStrainDTO?, isLoading: Bool) {
        guard let dto else { self = isLoading ? .loading : .unavailable; return }
        if let v = dto.value, dto.state == "READY" || dto.state == "LOW_CONFIDENCE" {
            let note = dto.state == "LOW_CONFIDENCE" ? "Limited data today" : dto.relativeLabel
            self = .value(Int(v.rounded()), band: dto.band ?? "", note: note)
            return
        }
        switch dto.state {
        case "BUILDING_BASELINE":
            let b = dto.baseline
            self = .message(title: "Building your baseline",
                            detail: "\(Int(min(b.activeDays, b.required.activeDays))) of \(Int(b.required.activeDays)) active days · \(Int(min(b.historyDays, b.required.historyDays))) of \(Int(b.required.historyDays)) days of history")
        case "NOT_ENOUGH_DATA":
            self = .message(title: "Not enough data", detail: "Today's sessions don't have enough heart-rate or set data to measure load.")
        default:
            self = dto.sessions == 0
                ? .message(title: "No load yet today", detail: "Strain builds as you train or move with your band.")
                : .message(title: "Not enough data", detail: "Load couldn't be measured yet.")
        }
    }
}

/// Daily Strain beside the Sombrey Score on Home: how much load you've placed
/// on yourself today. The companion to the readiness hero — smaller, same
/// dark glass. Tap opens Progress, where Strain has its full history.
struct StrainInstrument: View {
    let strain: TodayStrainDTO?
    let isLoading: Bool
    var onOpen: () -> Void

    var body: some View {
        let p = StrainPresentation(strain, isLoading: isLoading)
        Button(action: onOpen) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("DAILY STRAIN")
                        .font(StudioFont.body(11, weight: .semibold))
                        .tracking(1.8)
                        .foregroundStyle(StudioColor.paper)
                    switch p {
                    case .loading:
                        Text("Reading…").font(StudioFont.body(13)).foregroundStyle(StudioColor.paperFaint)
                    case .unavailable:
                        Text("Unavailable right now").font(StudioFont.body(13)).foregroundStyle(StudioColor.paperFaint)
                    case .value(_, let band, let note):
                        Text(band.uppercased())
                            .font(StudioFont.body(14, weight: .semibold))
                            .tracking(1.4)
                            .foregroundStyle(StudioColor.paper)
                        if let note { Text(note).font(StudioFont.body(12)).foregroundStyle(StudioColor.paperSoft) }
                    case .message(let title, let detail):
                        Text(title).font(StudioFont.body(14, weight: .semibold)).foregroundStyle(StudioColor.paper)
                        Text(detail).font(StudioFont.body(11)).foregroundStyle(StudioColor.paperFaint).fixedSize(horizontal: false, vertical: true)
                    }
                    if let strain {
                        Text("Strain \(shortVersion(strain.version))\(strain.validated ? "" : " · not yet validated")")
                            .font(StudioFont.body(9))
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                }
                Spacer(minLength: 8)
                if case .value(let v, _, _) = p {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(v)")
                            .font(StudioFont.hero(46, weight: .bold))
                            .foregroundStyle(StudioColor.paper)
                            .monospacedDigit()
                            .studioNumericTransition(Double(v))
                        Text("of 100")
                            .font(StudioFont.body(10))
                            .foregroundStyle(StudioColor.paperFaint)
                    }
                    StrainArc(value: Double(v))
                        .frame(width: 36, height: 36)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
            .frame(minHeight: 44)
            .background {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(StudioColor.env0.opacity(0.30))
                    .overlay {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .strokeBorder(LinearGradient(colors: [StudioColor.paper.opacity(0.18), StudioColor.paper.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
                    }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(p))
        .accessibilityHint("Opens Progress")
        .accessibilityIdentifier("home.strain")
    }

    private func shortVersion(_ v: String) -> String {
        v.hasPrefix("strain-") ? "v" + v.dropFirst("strain-".count).split(separator: ".").first.map(String.init)! : v
    }

    private func accessibilityText(_ p: StrainPresentation) -> String {
        switch p {
        case .loading: return "Daily strain, loading"
        case .unavailable: return "Daily strain unavailable"
        case .value(let v, let band, let note): return "Daily strain \(v) of 100, \(band)\(note.map { ", \($0)" } ?? ""). Not yet validated."
        case .message(let title, let detail): return "Daily strain: \(title). \(detail)"
        }
    }
}

/// A quiet 0–100 arc for the Strain value — the dial language of the
/// Sombrey mark, not a new chart.
struct StrainArc: View {
    let value: Double
    var body: some View {
        ZStack {
            Circle().trim(from: 0, to: 0.75)
                .stroke(StudioColor.paper.opacity(0.14), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            Circle().trim(from: 0, to: 0.75 * min(max(value, 0), 100) / 100)
                .stroke(StudioColor.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
        .rotationEffect(.degrees(135))
        .accessibilityHidden(true)
    }
}
