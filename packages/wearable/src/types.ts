/**
 * Sombrey wearable domain boundary.
 *
 * This file defines the TypeScript contract between React and the
 * native wearable stack — it contains no implementation. The real
 * architecture is:
 *
 *   React/TypeScript
 *         -> SombreyWearableService (this contract)
 *         -> Capacitor native plugin
 *         -> Swift
 *         -> QCBANDSDK
 *         -> Sombrey Band
 *
 * React code depends only on SombreyWearableService below. Nothing in
 * this package imports QCBANDSDK, Capacitor, or Swift — those belong
 * to the native plugin implementation, built in a later phase once
 * the vendor SDK is available.
 *
 * Field shapes here are intentionally generic. Exact QCBANDSDK payload
 * shapes are unknown until the SDK is supplied — this contract will
 * evolve, not be treated as final.
 */

export type DeviceId = string;

export interface SombreyDevice {
  id: DeviceId;
  serial: string;
  model: string;
  nickname?: string;
  firmwareVersion?: string;
}

export type DeviceConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "syncing"
  | "error";

export interface DeviceStatus {
  deviceId: DeviceId;
  connectionState: DeviceConnectionState;
  batteryPct?: number;
  lastSeenAt?: number; // epoch ms
}

/**
 * Metrics approved as first-class V1 wearable metrics, where the
 * physical band + QCBANDSDK actually support them. HRV/stress are
 * included as optional — not guaranteed available.
 */
export type WearableMetricType =
  | "heart_rate"
  | "resting_heart_rate"
  | "steps"
  | "active_calories"
  | "spo2"
  | "skin_temperature"
  | "hrv"
  | "stress";

export interface WearableMeasurement {
  deviceId: DeviceId;
  metricType: WearableMetricType;
  value: number;
  unit: string;
  recordedAt: number; // epoch ms, device-reported when available
}

export interface SleepStage {
  stage: "light" | "deep" | "rem" | "awake";
  startedAt: number;
  durationMinutes: number;
}

export interface SleepSessionData {
  deviceId: DeviceId;
  startedAt: number;
  endedAt: number;
  totalSleepMinutes: number;
  /** Only present if the SDK actually exposes stage-level data. */
  stages?: SleepStage[];
}

export interface WorkoutSessionData {
  deviceId: DeviceId;
  startedAt: number;
  endedAt: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  caloriesBurned?: number;
}

export type SyncStatus = "idle" | "syncing" | "success" | "partial" | "failed";

export interface SyncResult {
  status: SyncStatus;
  recordsSynced: number;
  errorMessage?: string;
  syncedAt: number;
}

/**
 * The only wearable surface React is allowed to depend on. Implemented
 * in apps/mobile, backed by a Capacitor plugin that wraps QCBANDSDK —
 * React never imports that plugin or QCBANDSDK directly.
 */
export interface SombreyWearableService {
  scanForDevices(): Promise<SombreyDevice[]>;
  pairDevice(deviceId: DeviceId): Promise<void>;
  unpairDevice(deviceId: DeviceId): Promise<void>;
  getDeviceStatus(deviceId: DeviceId): Promise<DeviceStatus>;
  sync(deviceId: DeviceId): Promise<SyncResult>;
  onMeasurement(callback: (measurement: WearableMeasurement) => void): () => void;
}
