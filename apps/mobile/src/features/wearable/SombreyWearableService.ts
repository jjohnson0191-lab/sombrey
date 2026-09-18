import type {
  SombreyWearableService,
  SombreyDevice,
  DeviceId,
  DeviceStatus,
  SyncResult,
  WearableMeasurement,
} from "@sombrey/wearable";
import { SombreyWearable } from "./plugin/index.ts";
import type { PluginListenerHandle } from "@capacitor/core";

/**
 * The concrete implementation of @sombrey/wearable's SombreyWearableService
 * contract, for the mobile app specifically. This is the ONLY place that
 * imports the Capacitor plugin — every screen/hook in the app imports
 * this service (or the useWearable() hook wrapping it), never the plugin
 * or QCBANDSDK.
 */
class MobileSombreyWearableService implements SombreyWearableService {
  async scanForDevices(): Promise<SombreyDevice[]> {
    const { devices } = await SombreyWearable.scanForDevices();
    return devices;
  }

  async pairDevice(deviceId: DeviceId): Promise<void> {
    await SombreyWearable.pairDevice({ deviceId });
  }

  async unpairDevice(deviceId: DeviceId): Promise<void> {
    await SombreyWearable.unpairDevice({ deviceId });
  }

  async getDeviceStatus(deviceId: DeviceId): Promise<DeviceStatus> {
    return SombreyWearable.getDeviceStatus({ deviceId });
  }

  async sync(deviceId: DeviceId): Promise<SyncResult> {
    return SombreyWearable.sync({ deviceId });
  }

  onMeasurement(callback: (measurement: WearableMeasurement) => void): () => void {
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;

    SombreyWearable.addListener("measurement", (m) => {
      callback({
        deviceId: m.deviceId,
        metricType: m.metricType as WearableMeasurement["metricType"],
        value: m.value,
        unit: m.unit,
        recordedAt: m.recordedAt,
      });
    }).then((h) => {
      if (cancelled) {
        void h.remove();
      } else {
        handle = h;
      }
    });

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }
}

export const sombreyWearableService: SombreyWearableService = new MobileSombreyWearableService();
