import SwiftUI
import ClerkKit
import ClerkKitUI

/// Native sign-in — a Sombrey-branded shell around ClerkKitUI's `AuthView`,
/// not a translation of Clerk's own presentation. `AuthView` still owns
/// every actual authentication control (Apple / Google / email — whatever
/// Clerk's dashboard has configured; nothing invented here) and the
/// `com.sombrey.app://callback` session/callback lifecycle is completely
/// untouched — this file only changes what surrounds it: environment,
/// typography, composition, and motion. `AuthView` sits inside a
/// translucent glass panel (matching `IlluminatedCTAButtonStyle`'s
/// material language) rather than floating bare on the screen, which is
/// the actual lever available for making it read as Sombrey rather than
/// a generic Clerk/SaaS form without bypassing Clerk's own control
/// rendering.
///
/// Motion: Sombrey powering on, not a web page fading in — the dark
/// `.auth` environment settles in first, then the mark, the supporting
/// line, and the auth panel reveal in a short deliberate sequence
/// (`StudioMotion`/`.studioReveal`), never simultaneously.
struct SignInView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var markIlluminated = false

    var body: some View {
        EnvironmentView(scene: .auth) {
            VStack(spacing: 0) {
                Spacer(minLength: 40)

                mark
                    .studioReveal(index: 0, distance: 10)

                Text("Your AI coach and wearable, in one place.")
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.paperSoft)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .padding(.horizontal, 40)
                    .studioReveal(index: 1, distance: 8)

                if isLoading {
                    ProgressView()
                        .tint(StudioColor.paper)
                        .padding(.top, 20)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.accentInkDark)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.top, 12)
                }

                authPanel
                    .padding(.horizontal, 24)
                    .padding(.top, 32)
                    .studioReveal(index: 2, distance: 12)

                Spacer(minLength: 40)
            }
            .padding(.vertical, 32)
        }
    }

    /// The Sombrey wordmark — the existing hero typography treatment
    /// (Bricolage Grotesque, the same font every other high-attention
    /// numeral in the app uses), not a new logo asset. A single quiet
    /// illumination settles behind it once, then holds still.
    private var mark: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [StudioColor.paper.opacity(markIlluminated ? 0.16 : 0), .clear],
                        center: .center, startRadius: 0, endRadius: 140
                    )
                )
                .frame(width: 220, height: 220)
                .onAppear {
                    let animation = StudioMotion.resolve(.settleOnce, reduceMotion: reduceMotion)
                    if let animation {
                        withAnimation(animation) { markIlluminated = true }
                    } else {
                        markIlluminated = true
                    }
                }
            Text("Sombrey")
                .font(StudioFont.hero(44, weight: .bold))
                .foregroundStyle(StudioColor.paper)
        }
        .frame(height: 96)
    }

    /// The glass panel Clerk's `AuthView` renders inside — same
    /// translucent-material language as the illuminated CTA, so the
    /// authentication controls read as part of the instrument rather
    /// than a form floating on top of it.
    private var authPanel: some View {
        AuthView()
            .padding(20)
            .background {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .dark)
                    .overlay {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .strokeBorder(StudioColor.paper.opacity(0.14), lineWidth: 1)
                    }
            }
    }
}
