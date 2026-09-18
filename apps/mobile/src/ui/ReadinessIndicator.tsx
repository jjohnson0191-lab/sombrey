import { cn } from "@sombrey/shared";
import type { ReadinessResult } from "@sombrey/readiness";
import { HeroNumber } from "./HeroNumber.tsx";

/**
 * Renders a ReadinessResult conservatively: `score` is nullable by
 * design (see packages/readiness) and this component treats that as a
 * normal, expected state — "still collecting data" — never fabricating
 * a number. No medical/clinical language anywhere here. Visual layout
 * matches the approved Home screen: a Bricolage hero numeral, a
 * "READINESS" label, and quiet contributing-factor lines — with no
 * numeral shown at all until there's a real one.
 */
export function ReadinessIndicator({
  result,
  tone = "paper",
  className,
}: {
  result: ReadinessResult | null;
  tone?: "ink" | "paper";
  className?: string;
}) {
  const softClass = tone === "paper" ? "text-paper-soft" : "text-ink-soft";
  const faintClass = tone === "paper" ? "text-paper-faint" : "text-ink-faint";

  if (!result || result.score === null) {
    return (
      <div className={cn("flex flex-col items-end gap-1 text-right", className)}>
        <div className={cn("h-[3px] w-16 rounded-full", tone === "paper" ? "bg-paper/25" : "bg-ink/15")} />
        <span className={cn("text-[11px] tracking-[0.12em] uppercase", softClass)}>Readiness</span>
        <span className={cn("max-w-[180px] text-xs", faintClass)}>
          {result?.missingInputs.length
            ? "Still collecting data — check back soon."
            : "Not enough data yet."}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-end gap-1.5 text-right", className)}>
      <HeroNumber tone={tone} size="lg">
        {result.score}
      </HeroNumber>
      <span className={cn("text-[11px] tracking-[0.12em] uppercase", softClass)}>Readiness</span>
      {result.contributingFactors.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {result.contributingFactors.slice(0, 3).map((f) => (
            <li key={f.metric} className={cn("text-xs", softClass)}>
              {f.description}
            </li>
          ))}
        </ul>
      )}
      <span className={cn("text-[10px]", faintClass)}>
        v{result.algorithmVersion} &middot; confidence {Math.round(result.confidence * 100)}% &middot;
        not a medical measurement
      </span>
    </div>
  );
}
