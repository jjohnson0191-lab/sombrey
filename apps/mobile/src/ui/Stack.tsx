import type { ReactNode } from "react";
import { cn } from "@sombrey/shared";

export function Stack({
  children,
  gap = 4,
  className,
}: {
  children: ReactNode;
  gap?: 2 | 3 | 4 | 6 | 8;
  className?: string;
}) {
  const gapClass = { 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" }[gap];
  return <div className={cn("flex flex-col", gapClass, className)}>{children}</div>;
}

export function Row({
  children,
  gap = 3,
  className,
}: {
  children: ReactNode;
  gap?: 2 | 3 | 4 | 6;
  className?: string;
}) {
  const gapClass = { 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6" }[gap];
  return <div className={cn("flex flex-row items-center", gapClass, className)}>{children}</div>;
}
