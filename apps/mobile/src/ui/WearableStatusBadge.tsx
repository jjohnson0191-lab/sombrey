import { Bluetooth, BluetoothConnected, BluetoothOff } from "lucide-react";
import type { DeviceConnectionState } from "@sombrey/wearable";
import { cn } from "@sombrey/shared";

const STATE_CONFIG: Record<DeviceConnectionState, { label: string; icon: typeof Bluetooth; tone: string }> = {
  connected: { label: "Connected", icon: BluetoothConnected, tone: "text-success" },
  syncing: { label: "Syncing", icon: BluetoothConnected, tone: "text-accent" },
  connecting: { label: "Connecting", icon: Bluetooth, tone: "text-foreground-muted" },
  disconnected: { label: "Disconnected", icon: BluetoothOff, tone: "text-foreground-faint" },
  error: { label: "Connection error", icon: BluetoothOff, tone: "text-danger" },
};

export function WearableStatusBadge({
  state,
  batteryPct,
  className,
}: {
  state: DeviceConnectionState;
  batteryPct?: number;
  className?: string;
}) {
  const { label, icon: Icon, tone } = STATE_CONFIG[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", tone, className)}>
      <Icon className="h-3.5 w-3.5" />
      {label}
      {typeof batteryPct === "number" && state !== "disconnected" && (
        <span className="text-foreground-faint">· {Math.round(batteryPct)}%</span>
      )}
    </span>
  );
}
