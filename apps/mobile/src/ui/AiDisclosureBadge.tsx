import { Sparkles } from "lucide-react";
import { cn } from "@sombrey/shared";

/**
 * AI disclosure — the Phase 2/3 requirement that AI-generated content is
 * labeled as such, not presented as human coaching or clinically verified
 * advice. No specific legal wording is claimed here; this is a plain,
 * consistent visual marker any AI-touched surface can attach. Exact
 * copy can be refined later without changing where it's used.
 */
export function AiDisclosureBadge({
  label = "AI-generated",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border",
        "bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-foreground-muted",
        className,
      )}
    >
      <Sparkles className="h-3 w-3" />
      {label}
    </span>
  );
}
