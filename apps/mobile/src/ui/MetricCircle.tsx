import { cn } from "@sombrey/shared";
import type { MetricVisualState } from "@/features/wearable/metricVisual.ts";

/**
 * PLACEHOLDER — see features/wearable/metricVisual.ts. Renders a plain
 * flat matte circle with the value and unit; no translucent glass, no
 * perimeter light, no motion. This is intentional: the real "translucent
 * illuminated circular material + soft colored perimeter light" system
 * is deferred until after QCBANDSDK integration (see the implementation
 * report) — this component exists so screens have a real, laid-out slot
 * to upgrade in place, not a TODO comment.
 */
export function MetricCircle({
  state,
  label,
  className,
}: {
  state: MetricVisualState;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-env-4/60">
        <span className="tabular text-sm font-semibold text-ink">
          {state.value === null ? "—" : Math.round(state.value)}
        </span>
      </div>
      <span className="text-[10px] text-ink-soft">{label}</span>
    </div>
  );
}
