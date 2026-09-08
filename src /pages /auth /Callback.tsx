import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth.ts";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Authenticated, AuthLoading } from "convex/react";
import { Spinner } from "@/components/ui/spinner.tsx";

function CallbackInner() {
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.getCurrentUser, {});

  useEffect(() => {
    if (currentUser === undefined) return; // still loading

    if (currentUser === null) {
      // Not in DB yet — go home to let onboarding create them
      navigate("/", { replace: true });
      return;
    }

    // Active paid member → go straight to dashboard
    if (
      currentUser.onboardingCompleted &&
      currentUser.subscriptionTier &&
      currentUser.subscriptionTier !== "free"
    ) {
      navigate("/dashboard", { replace: true });
      return;
    }

    // Staff (coach/admin/owner) → dashboard
    if (
      currentUser.onboardingCompleted &&
      currentUser.role &&
      currentUser.role !== "client"
    ) {
      navigate("/dashboard", { replace: true });
      return;
    }

    // Not onboarded → complete profile
    if (!currentUser.onboardingCompleted) {
      navigate("/complete-profile", { replace: true });
      return;
    }

    // Free/default → home
    navigate("/", { replace: true });
  }, [currentUser, navigate]);

  return (
    <div className="flex items-center justify-center h-[100svh]">
      <Spinner className="size-8" />
    </div>
  );
}

export default function AuthCallback() {
  const { isLoading, error } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && error) {
      console.error("Authentication error:", error);
      navigate("/", { replace: true });
    }
  }, [isLoading, error, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[100svh]">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <Authenticated>
      <CallbackInner />
    </Authenticated>
  );
}
