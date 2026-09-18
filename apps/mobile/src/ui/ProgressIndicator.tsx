import { cn } from "@sombrey/shared";

/** A plain progress bar — neutral ink fill, not the reserved accent
 * (the accent stays exclusive to readiness/live-state and the glass
 * CTA's glow). */
export function ProgressIndicator({
  value,
  max = 100,
  className,
}: {
  value: number;
  max?: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink/10", className)}>
      <div className="h-full rounded-full bg-ink/70 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
