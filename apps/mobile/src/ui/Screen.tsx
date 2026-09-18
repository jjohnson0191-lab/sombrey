import type { ReactNode } from "react";
import { cn } from "@sombrey/shared";
import { Environment, type SceneName } from "./Environment.tsx";
import { NavTicks } from "./NavTicks.tsx";

/**
 * Root container for a full screen — a Studio Instrument environment
 * crop, safe-area aware, scrollable body. Navigation lives INSIDE the
 * screen's own environment (not a separate fixed bar with its own
 * background) because the approved design has the nav ticks sitting
 * directly in each screen's gradient — see the Studio Instrument
 * navigation decision. Pass `nav={false}` for screens that intentionally
 * aren't a tab destination (Train's active-set and completion moments).
 */
export function Screen({
  scene,
  children,
  className,
  scroll = true,
  nav = true,
}: {
  scene: SceneName;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  nav?: boolean;
}) {
  return (
    <Environment scene={scene} className="flex h-dvh flex-col">
      <div className={cn("flex flex-col", scroll && "flex-1 overflow-y-auto", "px-6", className)}>
        {children}
      </div>
      {nav && <NavTicks />}
    </Environment>
  );
}
