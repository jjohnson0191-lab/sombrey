import SwiftUI

/// Primary CTA — a lit translucent glass pill. Genuinely translucent (low-
/// opacity fill, thin material blur) so the environment shows through it
/// rather than a frosted-opaque button; the layered radial gradients are
/// the "internal illumination" — one models a light source from above,
/// the other sits behind the label and doubles as the readability floor
/// so ink text stays legible even on the environment's darkest stop.
/// Ported from `apps/mobile/src/index.css`'s `.si-pill-primary`.
struct IlluminatedCTAButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(StudioFont.body(15, weight: .semibold))
            .foregroundStyle(isEnabled ? StudioColor.ink : StudioColor.inkFaint)
            .padding(.horizontal, 30)
            .frame(height: 52)
            .background {
                ZStack {
                    if isEnabled {
                        RoundedRectangle(cornerRadius: 26, style: .continuous)
                            .fill(.thinMaterial)
                        RadialGradient(
                            colors: [.white.opacity(configuration.isPressed ? 0.62 : 0.5), .clear],
                            center: UnitPoint(x: 0.5, y: -0.2), startRadius: 0, endRadius: 220
                        )
                        RadialGradient(
                            colors: [.white.opacity(configuration.isPressed ? 0.42 : 0.32), .clear],
                            center: UnitPoint(x: 0.5, y: 0.7), startRadius: 0, endRadius: 260
                        )
                        LinearGradient(
                            colors: [.white.opacity(configuration.isPressed ? 0.36 : 0.30),
                                     .white.opacity(configuration.isPressed ? 0.18 : 0.14)],
                            startPoint: .top, endPoint: .bottom
                        )
                    } else {
                        LinearGradient(colors: [.white.opacity(0.16), .white.opacity(0.08)],
                                        startPoint: .top, endPoint: .bottom)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .strokeBorder(.white.opacity(isEnabled ? 0.22 : 0.12), lineWidth: 1)
                }
            }
            .shadow(color: .black.opacity(isEnabled ? 0.4 : 0), radius: configuration.isPressed ? 5 : 11, y: configuration.isPressed ? 3 : 8)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.09), value: configuration.isPressed)
    }
}

/// Secondary CTA — outline only, no fill. Ported from `.si-pill-secondary`.
struct OutlineCTAButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(StudioFont.body(13, weight: .semibold))
            .foregroundStyle(StudioColor.ink)
            .padding(.horizontal, 22)
            .frame(height: 46)
            .background {
                RoundedRectangle(cornerRadius: 23, style: .continuous)
                    .strokeBorder(StudioColor.ink.opacity(0.28), lineWidth: 1.5)
            }
            .opacity(isEnabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.09), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == IlluminatedCTAButtonStyle {
    static var illuminatedCTA: IlluminatedCTAButtonStyle { .init() }
}

extension ButtonStyle where Self == OutlineCTAButtonStyle {
    static var outlineCTA: OutlineCTAButtonStyle { .init() }
}
