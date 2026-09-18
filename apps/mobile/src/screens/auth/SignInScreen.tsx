import { SignIn } from "@clerk/clerk-react";
import { Screen } from "@/ui/index.ts";

/**
 * Uses Clerk's prebuilt <SignIn /> (renders whichever methods are
 * enabled on the Clerk instance — Apple, Google, Email per the product
 * spec) rather than hand-building forms. Sign-in method selection is
 * dashboard configuration, not something to duplicate in code.
 *
 * Note for the mobile-foundation follow-up: Apple/Google OAuth redirect
 * behavior inside a Capacitor WebView (vs. a normal browser tab) needs
 * verification on a real device — not something this environment can
 * test. Flagged, not assumed working.
 */
export function SignInScreen() {
  return (
    <Screen className="items-center justify-center pt-16" scroll={false}>
      <div className="flex w-full flex-col items-center gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sombrey</h1>
        <SignIn routing="virtual" />
      </div>
    </Screen>
  );
}
