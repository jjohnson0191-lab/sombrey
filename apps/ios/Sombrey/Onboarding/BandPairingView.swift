import SwiftUI

/// First-launch pairing scene — shown once, before authentication, using
/// the exact same Studio Instrument system as the rest of the app (the
/// `.auth` scene `SignInView`/`RootLoadingView`/`RootErrorView` already
/// share — no separate visual language, per the onboarding spec).
///
/// Pairing is entirely optional and never blocks reaching sign-in. Every
/// state shown here (searching/found/connecting/connected/unavailable/
/// failure) comes directly from `WearableManager`'s real Bluetooth flow
/// — nothing here fakes a connection or a discovered device.
struct BandPairingView: View {
    @Environment(WearableManager.self) private var wearableManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onFinished: () -> Void

    @State private var hasStartedPairing = false
    @State private var markIlluminated = false
    @State private var isFinishing = false

    var body: some View {
        EnvironmentView(scene: .auth) {
            VStack(spacing: 0) {
                Spacer(minLength: 28)

                mark
                    .studioReveal(index: 0, distance: 10)

                bandHero
                    .padding(.top, 28)
                    .studioReveal(index: 1, distance: 16)

                Text(statusText)
                    .font(StudioFont.body(14))
                    .foregroundStyle(StudioColor.paperSoft)
                    .multilineTextAlignment(.center)
                    .padding(.top, 20)
                    .padding(.horizontal, 40)
                    .studioReveal(index: 2, distance: 8)

                if wearableManager.isScanning {
                    ProgressView().tint(StudioColor.paper).padding(.top, 16)
                }

                if hasStartedPairing, wearableManager.pairedDevice == nil, !wearableManager.discoveredDevices.isEmpty {
                    deviceList
                        .padding(.top, 20)
                        .padding(.horizontal, 24)
                }

                Spacer()

                VStack(spacing: 12) {
                    Button(primaryButtonTitle) {
                        startScan()
                    }
                    .buttonStyle(.illuminatedCTA)
                    .disabled(wearableManager.isScanning || wearableManager.pairedDevice != nil)

                    Button(wearableManager.pairedDevice != nil ? "Continue" : "Continue without Band") {
                        finish()
                    }
                    .buttonStyle(.outlineCTA)
                    .disabled(isFinishing)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
                .studioReveal(index: 3, distance: 10)
            }
        }
        .onChange(of: wearableManager.pairedDevice?.id) { _, newValue in
            guard newValue != nil else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { finish() }
        }
    }

    private var mark: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [StudioColor.paper.opacity(markIlluminated ? 0.16 : 0), .clear],
                        center: .center, startRadius: 0, endRadius: 140
                    )
                )
                .frame(width: 200, height: 200)
                .onAppear {
                    let animation = StudioMotion.resolve(StudioMotion.settleOnce, reduceMotion: reduceMotion)
                    if let animation {
                        withAnimation(animation) { markIlluminated = true }
                    } else {
                        markIlluminated = true
                    }
                }
            Text("Sombrey")
                .font(StudioFont.hero(36, weight: .bold))
                .foregroundStyle(StudioColor.paper)
        }
        .frame(height: 80)
    }

    /// The band as a physical illuminated object — the same translucent-
    /// material language as `IlluminatedCTAButtonStyle`, not an image
    /// asset (none exists yet).
    private var bandHero: some View {
        RoundedRectangle(cornerRadius: 40, style: .continuous)
            .fill(.ultraThinMaterial)
            .environment(\.colorScheme, .dark)
            .overlay {
                RoundedRectangle(cornerRadius: 40, style: .continuous)
                    .strokeBorder(StudioColor.paper.opacity(bandGlowOpacity), lineWidth: 1.5)
            }
            .overlay {
                RadialGradient(
                    colors: [StudioColor.paper.opacity(bandGlowOpacity * 0.6), .clear],
                    center: .center, startRadius: 0, endRadius: 120
                )
                .clipShape(RoundedRectangle(cornerRadius: 40, style: .continuous))
            }
            .frame(width: 220, height: 64)
    }

    private var bandGlowOpacity: Double {
        switch wearableManager.status?.connectionState {
        case .connected: return 0.5
        case .connecting, .syncing: return 0.32
        default: return 0.16
        }
    }

    @ViewBuilder
    private var deviceList: some View {
        VStack(spacing: 8) {
            ForEach(wearableManager.discoveredDevices) { device in
                Button {
                    Task { await wearableManager.pair(device) }
                } label: {
                    HStack {
                        Text(device.nickname ?? device.model)
                            .font(StudioFont.body(14, weight: .medium))
                            .foregroundStyle(StudioColor.paper)
                        Spacer()
                        Text("Pair")
                            .font(StudioFont.body(12))
                            .foregroundStyle(StudioColor.paperSoft)
                    }
                    .padding(14)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .environment(\.colorScheme, .dark)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var primaryButtonTitle: String {
        wearableManager.pairedDevice != nil ? "Connected" : (hasStartedPairing ? "Scan again" : "Pair Band")
    }

    private var statusText: String {
        if wearableManager.pairedDevice != nil {
            return "Your Sombrey Band is connected — activity, sleep, and heart rate will sync automatically."
        }
        if wearableManager.status?.connectionState == .unavailable {
            return "Bluetooth is off. Turn it on in Settings to pair your band, or continue without one."
        }
        if wearableManager.isScanning {
            return "Searching for your Sombrey Band…"
        }
        if hasStartedPairing && wearableManager.discoveredDevices.isEmpty {
            return "No band found nearby. Make sure it's charged and close by, then try again."
        }
        if hasStartedPairing && !wearableManager.discoveredDevices.isEmpty {
            return "Found nearby bands — choose yours below."
        }
        return "Connect your Sombrey Band to sync activity, sleep, and heart rate automatically. You can always pair later."
    }

    private func startScan() {
        hasStartedPairing = true
        Task { await wearableManager.scan() }
    }

    private func finish() {
        guard !isFinishing else { return }
        isFinishing = true
        // Persisting "seen" is the caller's job (`RootView`'s
        // `@AppStorage`-backed flag) — this view only reports "the user
        // is done here."
        onFinished()
    }
}
