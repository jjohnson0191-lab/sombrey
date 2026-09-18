import { Outlet } from "react-router-dom";
import { TabBar } from "./TabBar.tsx";

/** Wraps the five primary tabs with the bottom nav. Sits inside the
 * authenticated route group — see App.tsx. */
export function AppShell() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="flex-1 overflow-hidden pb-16">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}
