import { cn } from "@sombrey/shared";

/**
 * AI disclosure — plain text, no icon. Sombrey's AI UX principle
 * explicitly rules out generic sparkle icons and "AI magic" visual
 * cliches; a quiet, consistent label is the whole marker.
 */
export function AiDisclosureBadge({
  label = "AI-generated",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return <span className={cn("text-[11px] font-medium text-ink-soft", className)}>{label}</span>;
}
