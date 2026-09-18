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
};

export default config;
