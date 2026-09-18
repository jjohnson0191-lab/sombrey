import { ConvexReactClient } from "convex/react";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!convexUrl) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Copy apps/mobile/.env.local and point it " +
      "at the Sombrey-owned Convex deployment — never the legacy Hercules one.",
  );
}

/**
 * The one Convex client instance for the app. Feature hooks (see
 * features/*\/use*.ts) are the intended call site for `useQuery`/
 * `useMutation`/`useAction` — screens should generally go through those,
 * not call `convex/react` hooks directly, so data-access shape changes
 * don't ripple through every screen.
 */
export const convexClient = new ConvexReactClient(convexUrl);
