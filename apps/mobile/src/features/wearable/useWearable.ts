import { useCallback, useState } from "react";
import type { DeviceStatus, SombreyDevice } from "@sombrey/wearable";
import { sombreyWearableService } from "./SombreyWearableService.ts";

/**
 * Foundation-level wearable hook — connection lifecycle only. Deliberately
 * does not implement continuous background sync, offline queuing, or
 * real device-state persistence to Convex yet; those are the wearable
 * sync phase. This establishes the boundary every screen (Home's status
 * chip, Profile's device settings, the pairing flow) calls through.
 */
export function useWearable() {
  const [devices, setDevices] = useState<SombreyDevice[]>([]);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    try {
      const found = await sombreyWearableService.scanForDevices();
      setDevices(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setIsScanning(false);
    }
  }, []);

  const pair = useCallback(async (deviceId: string) => {
    setError(null);
    try {
      await sombreyWearableService.pairDevice(deviceId);
      const newStatus = await sombreyWearableService.getDeviceStatus(deviceId);
      setStatus(newStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    }
  }, []);

  const unpair = useCallback(async (deviceId: string) => {
    await sombreyWearableService.unpairDevice(deviceId);
    setStatus(null);
  }, []);

  const sync = useCallback(async (deviceId: string) => {
    setError(null);
    try {
      return await sombreyWearableService.sync(deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      return null;
    }
  }, []);

  return { devices, status, isScanning, error, scan, pair, unpair, sync };
}
