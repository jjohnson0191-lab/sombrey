import { useQuery } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner.tsx";

// Routes that don't need the onboarding gate
const EXEMPT_PATHS = ["/complete-profile", "/auth/callback", "/invite/accept", "/"];

/**
 * Wraps children and redirects authenticated users with incomplete profiles
 * to /complete-profile before they can access any app route.
 */
function OnboardingGateInner({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useQuery(api.users.getCurrentUser, {});

  const isExempt = EXEMPT_PATHS.some(
    (p) => location.pathname === p || location.pathname.startsWith(p + "/") && p !== "/"
  );

  useEffect(() => {
    if (isExempt) return;
    if (currentUser === undefined) return; // still loading
    if (currentUser === null) return; // not in db yet
    if (!currentUser.onboardingCompleted) {
      navigate("/complete-profile", { replace: true });
    }
  }, [currentUser, navigate, isExempt]);

  // Show spinner while checking onboarding status on a non-exempt route
  if (!isExempt && currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <Spinner className="size-8" />
      </div>
    );
  }

  // Block render until onboarding is confirmed complete
  if (!isExempt && currentUser !== undefined && currentUser !== null && !currentUser.onboardingCompleted) {
    return null;
  }

  return <>{children}</>;
}

export default function OnboardingGate({ children }: { children: React.ReactNode }) {
  return (
    <Authenticated>
      <OnboardingGateInner>{children}</OnboardingGateInner>
    </Authenticated>
  );
}
