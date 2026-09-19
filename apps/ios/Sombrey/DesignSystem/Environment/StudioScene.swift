import SwiftUI

/// Studio Instrument environments — the design system's core idea: one
/// continuous tonal field, and every screen uses a different "crop" of it
/// rather than its own background color. Ported 1:1 (same stops, same
/// angles, same radial focal points) from `apps/mobile/src/ui/Environment.tsx`'s
/// `SCENES` map — the literal source of truth.
///
/// Do not add an ad-hoc gradient for a screen that isn't listed here;
/// extend this enum instead, exactly as the web app's own rule requires.
///
/// NOTE: CSS's `linear-gradient(158deg, ...)` angle is approximated here
/// with `.topLeading -> .bottomTrailing` (SwiftUI has no direct degree
/// API). Flagged for a visual side-by-side QA pass against the web
/// reference once real screens are built — see the migration plan's
/// design-system risk item.
enum StudioScene: String, CaseIterable, Identifiable {
    case home
    case trainOverview
    case trainActive
    case trainComplete
    case progress
    case aiCoach
    case settings

    var id: String { rawValue }

    /// The full-bleed background for this scene, built from `StudioColor`
    /// stops. `ZStack`-composed to match CSS's layered
    /// `radial-gradient(...), linear-gradient(...)` background lists.
    @ViewBuilder
    var background: some View {
        switch self {
        case .home:
            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: StudioColor.env0, location: 0),
                        .init(color: StudioColor.env1, location: 0.28),
                        .init(color: StudioColor.env2, location: 0.52),
                        .init(color: StudioColor.env3, location: 0.74),
                        .init(color: StudioColor.env4, location: 0.90),
                        .init(color: StudioColor.env5, location: 1.0),
                    ],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [StudioColor.env5, StudioColor.env5.opacity(0)],
                    center: UnitPoint(x: 0.30, y: 0.84), startRadius: 0, endRadius: 420
                )
            }
        case .trainOverview:
            LinearGradient(
                stops: [
                    .init(color: StudioColor.env2, location: 0),
                    .init(color: StudioColor.env3, location: 0.30),
                    .init(color: StudioColor.env4, location: 0.65),
                    .init(color: StudioColor.env5, location: 1.0),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        case .trainActive:
            LinearGradient(
                stops: [
                    .init(color: StudioColor.env3, location: 0),
                    .init(color: StudioColor.env4, location: 0.45),
                    .init(color: StudioColor.env5, location: 1.0),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        case .trainComplete:
            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: 0x4A5866), location: 0),
                        .init(color: Color(hex: 0x93A0A5), location: 0.16),
                        .init(color: Color(hex: 0xC7C2B4), location: 0.36),
                        .init(color: StudioColor.env4, location: 0.58),
                        .init(color: StudioColor.env5, location: 1.0),
                    ],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [Color.white.opacity(0.3), Color.white.opacity(0)],
                    center: UnitPoint(x: 0.75, y: 0.04), startRadius: 0, endRadius: 340
                )
            }
        case .progress:
            LinearGradient(
                stops: [
                    .init(color: StudioColor.env1, location: 0),
                    .init(color: StudioColor.env2, location: 0.35),
                    .init(color: StudioColor.env3, location: 0.68),
                    .init(color: Color(hex: 0xD6D0C1), location: 1.0),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        case .aiCoach:
            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: 0x5C6975), location: 0),
                        .init(color: Color(hex: 0x9FA79E), location: 0.35),
                        .init(color: Color(hex: 0xE3DECE), location: 0.70),
                        .init(color: Color(hex: 0xF6EEDE), location: 1.0),
                    ],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [StudioColor.env5, StudioColor.env5.opacity(0)],
                    center: UnitPoint(x: 0.5, y: 0.42), startRadius: 0, endRadius: 300
                )
            }
        case .settings:
            LinearGradient(
                stops: [
                    .init(color: Color(hex: 0xB7BBB2), location: 0),
                    .init(color: Color(hex: 0xD8D2C4), location: 0.60),
                    .init(color: StudioColor.env4, location: 1.0),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        }
    }
}
