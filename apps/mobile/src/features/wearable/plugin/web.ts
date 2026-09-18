import { WebPlugin } from "@capacitor/core";
import type {
  SombreyWearablePlugin,
  PluginDevice,
  PluginDeviceStatus,
  PluginSyncResult,
} from "./definitions.ts";

/**
 * Web/dev fallback — there is no real Bluetooth band in a browser tab.
 * Every method fails clearly rather than pretending to succeed, so
 * developing the rest of the app (without a physical device attached)
 * surfaces wearable-unavailable states honestly instead of silently
 * no-op-ing. The real implementation is native/ios/SombreyWearablePlugin.swift.
 */
export class SombreyWearableWeb extends WebPlugin implements SombreyWearablePlugin {
  async scanForDevices(): Promise<{ devices: PluginDevice[] }> {
    throw this.unavailable("Wearable scanning is only available on iOS.");
  }

  async pairDevice(): Promise<void> {
    throw this.unavailable("Wearable pairing is only available on iOS.");
  }

  async unpairDevice(): Promise<void> {
    throw this.unavailable("Wearable pairing is only available on iOS.");
  }

  async getDeviceStatus(): Promise<PluginDeviceStatus> {
    throw this.unavailable("Wearable status is only available on iOS.");
  }

  async sync(): Promise<PluginSyncResult> {
    throw this.unavailable("Wearable sync is only available on iOS.");
  }
}
