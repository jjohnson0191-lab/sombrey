import type { PluginListenerHandle } from "@capacitor/core";

/**
 * The Capacitor plugin contract for the Sombrey wearable native layer.
 *
 * React never imports QCBANDSDK — it imports this interface (via
 * registerPlugin, see index.ts) and nothing else. The Swift
 * implementation (native/ios/SombreyWearablePlugin.swift — not yet wired
 * into an Xcode target, see that file's header comment) is the only code
 * allowed to import QCBANDSDK, matching the approved architecture:
 *
 *   React/TypeScript -> SombreyWearableService -> this Capacitor plugin
 *   -> Swift -> QCBANDSDK -> Sombrey Band
 *
 * Payload shapes intentionally mirror @sombrey/wearable's domain types
 * (packages/wearable/src/types.ts) — this plugin is the transport, that
 * package is the shared vocabulary between it and the rest of the app.
 */
export interface SombreyWearablePlugin {
  scanForDevices(): Promise<{ devices: PluginDevice[] }>;
  pairDevice(options: { deviceId: string }): Promise<void>;
  unpairDevice(options: { deviceId: string }): Promise<void>;
  getDeviceStatus(options: { deviceId: string }): Promise<PluginDeviceStatus>;
  sync(options: { deviceId: string }): Promise<PluginSyncResult>;

  addListener(
    eventName: "measurement",
    listenerFunc: (measurement: PluginMeasurement) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export interface PluginDevice {
  id: string;
  serial: string;
  model: string;
  nickname?: string;
  firmwareVersion?: string;
}

export interface PluginDeviceStatus {
  deviceId: string;
  connectionState: "disconnected" | "connecting" | "connected" | "syncing" | "error";
  batteryPct?: number;
  lastSeenAt?: number;
}

export interface PluginMeasurement {
  deviceId: string;
  metricType: string;
  value: number;
  unit: string;
  recordedAt: number;
}

export interface PluginSyncResult {
  status: "idle" | "syncing" | "success" | "partial" | "failed";
  recordsSynced: number;
  errorMessage?: string;
  syncedAt: number;
}
