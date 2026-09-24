import SwiftUI

/// Sombrey "Studio Instrument" color tokens — ported 1:1 from the literal
/// source of truth at `apps/mobile/src/index.css`'s `@theme` block. Nothing
/// downstream should hardcode a hex value; everything references a token
/// here, exactly as the web app's own convention requires.
///
/// Do not add a screen-specific color. Extend this file instead — see the
/// web app's own rule in `index.css`.
enum StudioColor {
    // MARK: Environment — one continuous tonal field, deep graphite to warm
    // ivory. Screens don't get their own background color; they pick a
    // "crop" of this same six-stop family (see `StudioScene`).
    static let env0 = Color(hex: 0x1E2731)
    static let env1 = Color(hex: 0x37434F)
    static let env2 = Color(hex: 0x667380)
    static let env3 = Color(hex: 0xA9AEA6)
    static let env4 = Color(hex: 0xE7E2D4)
    static let env5 = Color(hex: 0xF7EFE0)

    // MARK: Text — luminance-aware pairs. Ink on light environment, paper on
    // dark; never a fixed foreground color.
    static let ink = Color(hex: 0x1B2027)
    static let inkSoft = Color(hex: 0x1B2027).opacity(0.62)
    static let inkFaint = Color(hex: 0x1B2027).opacity(0.38)
    static let paper = Color(hex: 0xF2EEE4)
    static let paperSoft = Color(hex: 0xF2EEE4).opacity(0.62)
    static let paperFaint = Color(hex: 0xF2EEE4).opacity(0.38)

    // MARK: Accent — reserved for readiness/live state and the glass CTA's
    // internal glow. Never a decorative color, never a plain button fill.
    static let accent = Color(hex: 0xE1704A)
    static let accentInk = Color(hex: 0x9C4A28)
    static let accentInkDark = Color(hex: 0xF0A379)

    // MARK: Semantic domains — data-context only (chips, chart series),
    // never surfaces or chrome.
    static let training = Color(hex: 0x4C7A9E)
    static let nutrition = Color(hex: 0x7C8F5F)
    static let danger = Color(hex: 0x9C4A3A)

    // MARK: Activity character — the low-opacity backlight inside an
    // activity's hero bezel only (see `ActivityCharacter`): where the
    // activity happens, never a surface fill or a text color.
    static let activityCourt = Color(hex: 0xB0654A)
    static let activityRoad = Color(hex: 0x56687A)
    static let activityTrail = Color(hex: 0x6F7E5A)
    static let activityWater = Color(hex: 0x3F6F80)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
