import SwiftUI

/// AI disclosure — plain text, no icon. Sombrey's AI UX principle
/// explicitly rules out generic sparkle icons and "AI magic" visual
/// cliches; a quiet, consistent label is the whole marker. Ported from
/// `apps/mobile/src/ui/AiDisclosureBadge.tsx`.
struct AiDisclosureBadge: View {
    var label: String = "AI-generated"

    var body: some View {
        Text(label)
            .font(StudioFont.body(11, weight: .medium))
            .foregroundStyle(StudioColor.inkSoft)
    }
}
