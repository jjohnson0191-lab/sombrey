import type { ReactNode } from "react";
import { cn } from "@sombrey/shared";

/** Root container for a full screen — safe-area aware, scrollable body. */
export function Screen({
  children,
  className,
  scroll = true,
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-dvh flex-col bg-background text-foreground",
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className={cn(scroll && "flex-1 overflow-y-auto", "px-4", className)}>
        {children}
      </div>
    </div>
  );
}
