import SwiftUI
import UIKit

/// Sombrey typography tokens — two faces, one hierarchy:
///
/// - Bricolage Grotesque (`hero`) is the display face: the Sombrey
///   wordmark, screen titles, and the numbers that ARE the moment — the
///   Sombrey Score, live heart rate, the instrument clock, a set's reps,
///   the rest dial, a primary card value. Semibold for titles and
///   secondary hero values, bold for the single dominant numeral of a
///   view. Never for sentences, labels, controls or dense data.
/// - Instrument Sans (`body`) is everything else: labels, captions,
///   controls, metadata, long-form and accessibility-heavy text. It is
///   also the app-wide default (`defaultText`), set once at the root, so
///   any text that doesn't choose a font is still Sombrey, never the
///   system face.
///
/// Both are `Font.custom(_:size:)`, which scales with Dynamic Type
/// relative to body text. Mirrors the web app's `HeroNumber.tsx` rule.
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

    /// The display face — see this type's header for where it belongs.
    static func hero(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        weight == .semibold
            ? .custom(Hero.semibold, size: size)
            : .custom(Hero.bold, size: size)
    }

    /// App-wide default for any text that doesn't set a font — the same
    /// size as the system's body style, so nothing shifts in layout, but
    /// in Instrument Sans instead of the system face.
    static let defaultText: Font = body(17)

    /// UIKit-drawn text SwiftUI's font environment can't reach —
    /// navigation-bar titles in sheets (Add meal, schedules, exercise
    /// pickers). Standard titles in Instrument Sans, large titles in the
    /// display face; both scaled with Dynamic Type. Call once at launch.
    static func configureUIKitAppearance() {
        let standard = UINavigationBarAppearance()
        standard.configureWithDefaultBackground()
        applyFonts(to: standard)
        // iOS's own default at the scroll edge is transparent — kept, so
        // only the typeface changes, never the bar's look.
        let scrollEdge = UINavigationBarAppearance()
        scrollEdge.configureWithTransparentBackground()
        applyFonts(to: scrollEdge)
        UINavigationBar.appearance().standardAppearance = standard
        UINavigationBar.appearance().compactAppearance = standard
        UINavigationBar.appearance().scrollEdgeAppearance = scrollEdge
    }

    private static func applyFonts(to appearance: UINavigationBarAppearance) {
        if let title = UIFont(name: Instrument.semibold, size: 17) {
            appearance.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: title)]
        }
        if let large = UIFont(name: Hero.semibold, size: 32) {
            appearance.largeTitleTextAttributes = [.font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: large)]
        }
        if let button = UIFont(name: Instrument.medium, size: 17) {
            let attributes: [NSAttributedString.Key: Any] = [.font: UIFontMetrics(forTextStyle: .body).scaledFont(for: button)]
            appearance.buttonAppearance.normal.titleTextAttributes = attributes
            appearance.doneButtonAppearance.normal.titleTextAttributes = attributes
        }
    }
}
