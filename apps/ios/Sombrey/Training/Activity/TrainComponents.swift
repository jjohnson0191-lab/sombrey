import SwiftUI

// MARK: - Mode pills

/// Train's two modes. Structured training and real-world activity are
/// different things, and Train says so at the top.
enum TrainMode: String, CaseIterable, Identifiable {
    case training, activity

    var id: String { rawValue }
    var label: String { self == .training ? "TRAINING" : "ACTIVITY" }
}

/// TRAINING | ACTIVITY — the navigation tab bar's glass key language
/// (`NavTicks`) at the top of Train: the same material, ivory tint and light
/// edge, and a lit key that glides between the two modes. Not a segmented
/// control: each half is a full 44pt+ key with its own label.
struct TrainModePills: View {
    @Binding var selection: TrainMode
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var keySpace

    var body: some View {
        HStack(spacing: 4) {
            ForEach(TrainMode.allCases) { mode in
                let isActive = mode == selection
                Button {
                    guard mode != selection else { return }
                    withAnimation(StudioMotion.resolve(StudioMotion.release, reduceMotion: reduceMotion)) {
                        selection = mode
                    }
                } label: {
                    Text(mode.label)
                        .font(StudioFont.body(12, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(isActive ? StudioColor.ink : StudioColor.ink.opacity(0.5))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background {
                            if isActive {
                                Capsule(style: .continuous)
                                    .fill(Color.white.opacity(0.55))
                                    .overlay {
                                        Capsule(style: .continuous)
                                            .strokeBorder(Color.white.opacity(0.7), lineWidth: 0.5)
                                    }
                                    .shadow(color: StudioColor.env0.opacity(0.14), radius: 6, y: 3)
                                    .matchedGeometryEffect(id: "key", in: keySpace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(mode == .training ? "Training" : "Activity")
                .accessibilityAddTraits(isActive ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(4)
        .background {
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .light)
                .overlay { Capsule(style: .continuous).fill(StudioColor.env5.opacity(0.28)) }
                .overlay {
                    Capsule(style: .continuous)
                        .strokeBorder(
                            LinearGradient(colors: [Color.white.opacity(0.7), Color.white.opacity(0.12)], startPoint: .top, endPoint: .bottom),
                            lineWidth: 1
                        )
                }
                .shadow(color: StudioColor.env0.opacity(0.16), radius: 12, y: 6)
        }
        .sensoryFeedback(StudioHaptic.tabChange, trigger: selection)
    }
}

// MARK: - Hero bezel

/// The dark glass instrument face Home's Sombrey Score sits in, reused for
/// Train's heroes: continuous 28pt corners, a backlight (here tinted by the
/// activity's character), a sheen from above and a light top edge. Content
/// inside uses the paper tones.
struct InstrumentBezel: ViewModifier {
    var tint: Color = StudioColor.env2

    func body(content: Content) -> some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(StudioColor.env0.opacity(0.82))
                    RadialGradient(
                        colors: [tint.opacity(0.55), .clear],
                        center: UnitPoint(x: 0.85, y: 0.15), startRadius: 0, endRadius: 260
                    )
                    LinearGradient(
                        colors: [StudioColor.paper.opacity(0.07), .clear],
                        startPoint: .top, endPoint: .center
                    )
                }
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .strokeBorder(
                            LinearGradient(colors: [StudioColor.paper.opacity(0.22), StudioColor.paper.opacity(0.04)], startPoint: .top, endPoint: .bottom),
                            lineWidth: 1
                        )
                }
                .shadow(color: StudioColor.env0.opacity(0.28), radius: 22, y: 12)
                .allowsHitTesting(false)
            }
    }
}

extension View {
    func instrumentBezel(tint: Color = StudioColor.env2) -> some View {
        modifier(InstrumentBezel(tint: tint))
    }
}

// MARK: - Small shared pieces

/// A small tracked uppercase label — the Studio section voice.
struct TrainEyebrow: View {
    let text: String
    var tone: Color = StudioColor.inkSoft

    var body: some View {
        Text(text.uppercased())
            .font(StudioFont.body(10, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(tone)
    }
}

/// A chosen-or-choosable activity: glyph and name on glass.
struct ActivityChip: View {
    let activity: SombreyActivity
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: activity.profile.glyph)
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 18)
                Text(activity.name)
                    .font(StudioFont.body(13, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? StudioColor.paper : StudioColor.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background {
                if isSelected {
                    Capsule(style: .continuous).fill(StudioColor.env0.opacity(0.85))
                } else {
                    Capsule(style: .continuous)
                        .fill(.ultraThinMaterial)
                        .overlay { Capsule(style: .continuous).strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1) }
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(activity.name)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }
}

/// One measurement in an activity's instrument grid. `value == nil` reads
/// "Not measured" — never zero, never an estimate.
struct ActivityMetricTile: View {
    let label: String
    let value: String?
    var unit: String? = nil
    var caption: String? = nil
    var tone: Tone = .ink
    /// What an absent value reads as — "Not measured" once final; during a
    /// live session, that the band hasn't reported it yet.
    var missingText: String = "Not measured"

    enum Tone { case ink, paper }

    private var primary: Color { tone == .ink ? StudioColor.ink : StudioColor.paper }
    private var soft: Color { tone == .ink ? StudioColor.inkSoft : StudioColor.paperSoft }
    private var faint: Color { tone == .ink ? StudioColor.inkFaint : StudioColor.paperFaint }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(StudioFont.body(10, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(soft)
            if let value {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value)
                        .font(StudioFont.hero(26, weight: .semibold))
                        .foregroundStyle(primary)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let unit {
                        Text(unit)
                            .font(StudioFont.body(12, weight: .medium))
                            .foregroundStyle(soft)
                    }
                }
            } else {
                Text(missingText)
                    .font(StudioFont.body(14, weight: .medium))
                    .foregroundStyle(faint)
                    .frame(minHeight: 32, alignment: .leading)
            }
            if let caption {
                Text(caption)
                    .font(StudioFont.body(11))
                    .foregroundStyle(faint)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A tappable destination row on glass (Train's secondary entry points).
struct TrainActionTile: View {
    let title: String
    let detail: String?
    let glyph: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: glyph)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(StudioColor.ink)
                    .frame(height: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(StudioFont.body(14, weight: .semibold))
                        .foregroundStyle(StudioColor.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Text(detail ?? " ")
                        .font(StudioFont.body(11))
                        .foregroundStyle(StudioColor.inkFaint)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(detail.map { "\(title), \($0)" } ?? title)
    }
}
