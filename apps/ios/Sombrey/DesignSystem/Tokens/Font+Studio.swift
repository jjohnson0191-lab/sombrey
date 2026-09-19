import SwiftUI

/// Sombrey typography tokens. Bricolage Grotesque is reserved for exactly
/// the highest-attention numerical moments (readiness score, a live rep
/// count, a rest timer) — see `HeroNumberText`, the only view type allowed
/// to reference `.hero`. Every other number/label in the app stays in
/// Instrument Sans. This mirrors the web app's `HeroNumber.tsx` rule
/// verbatim; do not reach for the hero font "because it's a number."
///
/// Font files are bundled from Google Fonts (Bricolage Grotesque 600/700,
/// Instrument Sans 400/500/600/700 + 500 italic — the exact weight set the
/// web app loads in `apps/mobile/index.html`) and registered via
/// `UIAppFonts` in Info.plist. PostScript names below were read directly
/// from each font file's `name` table.
enum StudioFont {
    enum Instrument {
        static let regular = "InstrumentSans-Regular"
        static let medium = "InstrumentSans-Medium"
        static let mediumItalic = "InstrumentSans-MediumItalic"
        static let semibold = "InstrumentSans-SemiBold"
        static let bold = "InstrumentSans-Bold"
    }

    enum Hero {
        static let semibold = "BricolageGrotesque-SemiBold"
        static let bold = "BricolageGrotesque-Bold"
    }

    /// Body/interface text — Instrument Sans, the default everywhere.
    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .bold, .heavy, .black:
            return .custom(Instrument.bold, size: size)
        case .semibold:
            return .custom(Instrument.semibold, size: size)
        case .medium:
            return .custom(Instrument.medium, size: size)
        default:
            return .custom(Instrument.regular, size: size)
        }
    }

    /// Hero numerals only — see `HeroNumberText`.
    static func hero(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        weight == .semibold
            ? .custom(Hero.semibold, size: size)
            : .custom(Hero.bold, size: size)
    }
}
