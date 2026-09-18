import type { ReactNode } from "react";
import { cn } from "@sombrey/shared";

/** A bounded surface for the few moments that genuinely need one
 * (a warning block, a settings row group) — flat, not glass. Studio
 * Instrument keeps cards rare; most content sits directly on the
 * environment. Assumes a light-ish local environment (ink text). */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-ink/10 bg-ink/[0.03] p-4 text-ink", className)}>
      {children}
    </div>
  );
}
