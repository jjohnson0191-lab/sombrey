import { useAuth as useClerkAuth, useUser as useClerkUser } from "@clerk/clerk-react";

/**
 * The Sombrey authentication boundary. Every screen/component uses this
 * hook, never `@clerk/clerk-react`'s `useAuth`/`useUser` directly — so
 * swapping identity providers later (see the Phase 2 architecture report)
 * touches this one file, not every screen that needs to know who's
 * signed in.
 */
export interface SombreyAuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  signOut: () => Promise<void>;
}

export function useSombreyAuth(): SombreyAuthState {
  const { isLoaded, isSignedIn, userId, signOut } = useClerkAuth();
  const { user } = useClerkUser();

  return {
    isLoaded,
    isSignedIn: isSignedIn ?? false,
    userId: userId ?? null,
    displayName: user?.fullName ?? user?.firstName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    signOut: async () => {
      await signOut();
    },
  };
}
