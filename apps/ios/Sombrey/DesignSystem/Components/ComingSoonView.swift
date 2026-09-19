import SwiftUI

/// Shared placeholder body for tabs whose full feature build is a later
/// migration phase (Train, Progress, AI Coach — see each tab's own
/// README for its phase and reference screen). Honest "not built yet"
/// state, not a fake preview of the feature.
struct ComingSoonView: View {
    let title: String
    let note: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(StudioFont.hero(32, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text(note)
                .font(StudioFont.body(13))
                .foregroundStyle(StudioColor.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 40)
    }
}
