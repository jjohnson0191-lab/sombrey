import { cn } from "@sombrey/shared";
import type { ReadinessResult } from "@sombrey/readiness";

/**
 * Renders a ReadinessResult conservatively: `score` is nullable by
 * design (see packages/readiness) and this component treats that as a
 * normal, expected state — "still collecting data" — never fabricating
 * a number. No medical/clinical language anywhere here.
 */
export function ReadinessIndicator({
  result,
  className,
}: {
  result: ReadinessResult | null;
  className?: string;
}) {
  if (!result || result.score === null) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <span className="text-sm font-medium text-foreground-muted">Readiness</span>
        <span className="text-xs text-foreground-faint">
          {result?.missingInputs.length
            ? "Still collecting data — check back soon."
            : "Not enough data yet."}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-foreground">{result.score}</span>
        <span className="text-xs text-foreground-faint">
          confidence {Math.round(result.confidence * 100)}%
        </span>
      </div>
      <span className="text-xs text-foreground-muted">
        v{result.algorithmVersion} · not a medical measurement
      </span>
      {result.contributingFactors.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {result.contributingFactors.slice(0, 3).map((f) => (
            <li key={f.metric} className="text-xs text-foreground-muted">
              {f.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
