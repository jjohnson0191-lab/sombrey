import type { ReactNode } from "react";
import { cn } from "@sombrey/shared";

/**
 * Bricolage Grotesque — reserved for exactly the highest-attention
 * numerical moments (readiness score, a live rep count, a rest timer,
 * the workout-duration stat on completion). Every other number in the
 * app stays in Instrument Sans. Do not reach for this component for a
 * heading, a trend callout, or "just because it's a number" — see the
 * approved typography decision.
 */
export function HeroNumber({
  children,
  size = "lg",
  tone = "ink",
  className,
}: {
  children: ReactNode;
  size?: "lg" | "md" | "sm";
  tone?: "ink" | "paper";
  className?: string;
}) {
  const sizeClass = { lg: "text-[6.5rem]", md: "text-[3.5rem]", sm: "text-[2.25rem]" }[size];
  const toneClass = tone === "paper" ? "text-paper" : "text-ink";
  return (
    <div
      className={cn("tabular font-bold leading-[0.88]", sizeClass, toneClass, className)}
      style={{ fontFamily: "var(--font-hero)" }}
    >
      {children}
    </div>
  );
}
