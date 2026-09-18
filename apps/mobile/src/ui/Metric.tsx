import { cn } from "@sombrey/shared";

/** A single labeled number — the Home dashboard's basic building block. */
export function Metric({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-foreground-muted">{unit}</span>}
      </span>
      <span className="text-xs text-foreground-muted">{label}</span>
    </div>
  );
}
