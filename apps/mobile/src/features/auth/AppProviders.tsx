import type { ReactNode } from "react";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { convexClient } from "../convex/client.ts";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/**
 * Sombrey App
 *   -> Clerk (ClerkProvider)
 *   -> authenticated session
 *   -> Convex (ConvexProviderWithClerk, Convex's documented Clerk pattern)
 *
 * This is the only place Clerk's provider is wired up. Everything else in
 * the app reads auth state through useSombreyAuth(), not Clerk directly.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  if (!clerkPublishableKey) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background px-6 text-center text-foreground-muted">
        <p>
          VITE_CLERK_PUBLISHABLE_KEY is not set in apps/mobile/.env.local.
          Add it from the Clerk dashboard (Configure → API Keys) to run the
          app.
        </p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useClerkAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
