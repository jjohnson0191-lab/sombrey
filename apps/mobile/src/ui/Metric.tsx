import { cn } from "@sombrey/shared";

/** A single labeled number for quiet, everyday metrics (steps, active
 * calories) — plain Instrument Sans, never Bricolage: those hero
 * numerals are reserved for readiness/rep/timer moments. */
export function Metric({
  label,
  value,
  unit,
  tone = "ink",
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "ink" | "paper";
  className?: string;
}) {
  const toneClasses = tone === "paper" ? "text-paper text-paper-soft" : "text-ink text-ink-soft";
  const [valueTone, labelTone] = toneClasses.split(" ");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className={cn("tabular text-xl font-semibold", valueTone)}>
        {value}
        {unit && <span className={cn("ml-1 text-sm font-normal", labelTone)}>{unit}</span>}
      </span>
      <span className={cn("text-xs", labelTone)}>{label}</span>
    </div>
  );
}
