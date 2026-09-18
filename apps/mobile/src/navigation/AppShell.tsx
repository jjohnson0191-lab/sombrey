import { Outlet } from "react-router-dom";

/**
 * Thin route-group wrapper for the authenticated tree. Renders no
 * chrome of its own — navigation now lives inside each screen's own
 * Environment (see ui/Screen.tsx and ui/NavTicks.tsx), not as a shared
 * fixed bar with a separate background.
 */
export function AppShell() {
  return <Outlet />;
}
