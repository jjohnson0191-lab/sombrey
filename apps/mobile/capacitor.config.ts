import type { CapacitorConfig } from "@capacitor/cli";

/**
 * PLACEHOLDER bundle identifier — "com.sombrey.app" is not confirmed as
 * the final Sombrey App Store bundle ID. Finalize before any TestFlight/
 * App Store submission; changing it later requires a new Xcode signing
 * setup, not just an edit here.
 */
const config: CapacitorConfig = {
  appId: "com.sombrey.app",
  appName: "Sombrey",
  webDir: "dist",
  ios: {
    contentInset: "always",
  },
  server: {
    // Capacitor's default iOS scheme ("capacitor://localhost") is shared by
    // every unconfigured Capacitor app on the device, which makes it unsafe
    // to register as a URL scheme for OAuth returns (ambiguous which app iOS
    // hands the callback to). Using the bundle ID as the WebView's origin
    // scheme keeps it unique to Sombrey, matching what's registered in
    // Info.plist and what the native OAuth-return bridge expects
    // (see src/features/auth/nativeOAuthReturn.ts).
    iosScheme: "com.sombrey.app",
  },
};

export default config;
