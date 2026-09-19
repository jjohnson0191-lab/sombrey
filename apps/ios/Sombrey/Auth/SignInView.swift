import SwiftUI
import ClerkKit
import ClerkKitUI

/// Native sign-in — replaces `apps/mobile/src/screens/auth/SignInScreen.tsx`'s
/// Clerk-in-a-WebView approach with ClerkKitUI's prebuilt `AuthView`,
/// wrapped in Sombrey's own Studio Instrument chrome so it reads as
/// Sombrey rather than a generic auth template. `AuthView` is Clerk's
/// native surface for Apple / Google / email — same dashboard
/// configuration the old `<SignIn routing="virtual" />` read from, just
/// rendered natively instead of inside a WebView.
///
/// Phase 0 scope: enough to validate the auth architecture end-to-end
/// (loading + error states), not the final polished screen — see the
/// migration plan's Phase 2/3 split.
struct SignInView: View {
    @Environment(Clerk.self) private var clerk
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        EnvironmentView(scene: .settings) {
            VStack(spacing: 24) {
                Spacer()

                VStack(spacing: 8) {
                    Text("Sombrey")
                        .font(StudioFont.hero(40, weight: .bold))
                        .foregroundStyle(StudioColor.ink)
                    Text("Sign in to continue")
                        .font(StudioFont.body(14))
                        .foregroundStyle(StudioColor.inkSoft)
                }

                if isLoading {
                    ProgressView()
                        .tint(StudioColor.ink)
                        .padding(.top, 8)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(StudioFont.body(13))
                        .foregroundStyle(StudioColor.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                AuthView()
                    .padding(.horizontal, 24)

                Spacer()
            }
            .padding(.vertical, 32)
        }
    }
}
