import type { DeviceConnectionState } from "@sombrey/wearable";
import { cn } from "@sombrey/shared";

/**
 * Wearable status — approved V1 treatment. Not a chip, not a dot, not
 * an icon: the environment's own light carries the state (a small
 * swatch of the same tonal field, warm and steady when connected, one
 * one-shot sweep while syncing, dimmed and cooled when disconnected),
 * with a plain text label alongside for accessibility — color/light is
 * never the only signal. Same prop contract as the badge this replaces,
 * so every existing call site is a drop-in.
 */
const SWATCH: Record<DeviceConnectionState, string> = {
  connected:
    "linear-gradient(158deg, var(--color-env-2) 0%, var(--color-env-3) 45%, var(--color-env-5) 100%)",
  syncing:
    "linear-gradient(158deg, var(--color-env-2) 0%, var(--color-env-3) 45%, var(--color-env-5) 100%)",
  connecting:
    "linear-gradient(158deg, var(--color-env-2) 0%, var(--color-env-3) 100%)",
  disconnected: "linear-gradient(158deg, #4c555e 0%, #6e766d 55%, #8b8e82 100%)",
  error: "linear-gradient(158deg, #4c555e 0%, #6e766d 55%, #8b8e82 100%)",
};

const LABEL: Record<DeviceConnectionState, string> = {
  connected: "Connected",
  syncing: "Syncing",
  connecting: "Connecting",
  disconnected: "Disconnected",
  error: "Connection error",
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
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn("h-4 w-8 shrink-0 overflow-hidden rounded", state === "syncing" && "relative")}
        style={{ background: SWATCH[state] }}
      >
        {state === "syncing" && (
          <span
            className="si-sweep-once absolute inset-0 block"
            style={{
              background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent)",
              width: "40%",
            }}
          />
        )}
      </span>
      <span className="text-xs text-ink-soft">
        {LABEL[state]}
        {typeof batteryPct === "number" && state !== "disconnected" && state !== "error" && (
          <span> &middot; {Math.round(batteryPct)}%</span>
        )}
      </span>
    </span>
  );
}
