import SwiftUI
import UIKit

/// Settings → Weather & location. What Sombrey asks for, what it keeps,
/// what it discards — and the weather provider's attribution (MET Norway
/// data is licensed CC BY 4.0, which requires it).
struct WeatherPrivacyView: View {
    @State private var cleared = false
    @State private var clearing = false
    private var environment: EnvironmentService { EnvironmentService.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Weather & location")
                    .font(StudioFont.hero(28, weight: .semibold))
                    .foregroundStyle(StudioColor.ink)
                    .padding(.top, 20)

                block("Location access", accessText)
                if environment.access == .denied {
                    Button("Open iPhone Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    .font(StudioFont.body(13, weight: .semibold))
                    .foregroundStyle(StudioColor.accentInk)
                }
                block("What Sombrey asks for", "Your approximate location (reduced accuracy, about a kilometre), only while Sombrey is open, at most every 30 minutes. Your time zone comes from your iPhone — never from the band.")
                block("What is kept", "The place name your iPhone resolves (for example “Colombo”), your time zone, and the weather values. The latest reading, plus a copy for each workout or activity you finish so conditions can be compared later.")
                block("What is discarded", "Your coordinates. They're rounded to about a kilometre, used for one weather request, and never stored — on your iPhone or on Sombrey's servers. There is no location history.")
                block("How weather is used", "As context only. Weather never adds to your load or strain.")
                block("Weather data", "Weather data: MET Norway (Norwegian Meteorological Institute), licensed under CC BY 4.0. “Feels like” is calculated by Sombrey from temperature, humidity and wind. UV is the clear-sky index.")

                Button {
                    clearing = true
                    Task {
                        try? await ConvexClientProvider.client.mutation("environment:clearMine")
                        clearing = false
                        cleared = true
                    }
                } label: {
                    Text(cleared ? "Stored weather cleared" : clearing ? "Clearing…" : "Clear stored weather")
                        .font(StudioFont.body(13, weight: .semibold))
                        .foregroundStyle(cleared ? StudioColor.inkFaint : StudioColor.danger)
                }
                .disabled(clearing || cleared)
                .padding(.top, 6)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .background(StudioColor.env4.ignoresSafeArea())
    }

    private var accessText: String {
        switch environment.access {
        case .allowed: return "Allowed — local weather appears on Home."
        case .denied: return "Not allowed. Home shows your time zone's city and “Weather unavailable”."
        case .notDetermined: return "Not asked yet. Sombrey asks when Home first opens."
        }
    }

    private func block(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(StudioFont.body(13, weight: .semibold))
                .foregroundStyle(StudioColor.ink)
            Text(text)
                .font(StudioFont.body(12))
                .foregroundStyle(StudioColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
