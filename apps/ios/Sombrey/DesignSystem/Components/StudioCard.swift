import SwiftUI

/// The restrained glass card surface `HomeScreen` and `VitalsScreen`
/// share for their data sections — `.ultraThinMaterial` plus a soft ink
/// border, matching the treatment already used elsewhere
/// (`BandPairingView`'s device rows, `MealScheduleView`'s slot rows),
/// not a new visual language. One shared definition rather than each
/// screen redeclaring the same modifier.
struct StudioCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(StudioColor.ink.opacity(0.08), lineWidth: 1)
            }
    }
}

extension View {
    func studioCard() -> some View {
        modifier(StudioCardModifier())
    }
}
