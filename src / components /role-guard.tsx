import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useRoles, type AppRole } from "@/hooks/use-roles.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";

/**
 * RoleGuard — renders children only when the current user has one of the
 * required roles. While loading, shows a skeleton. When the user lacks the
 * required role, redirects to /dashboard.
 */
export default function RoleGuard({
  roles,
  children,
}: {
  roles: AppRole[];
  children: React.ReactNode;
}) {
  const { hasRole, isLoading } = useRoles();
  const navigate = useNavigate();
  const allowed = hasRole(...roles);

  useEffect(() => {
    if (!isLoading && !allowed) {
      navigate("/dashboard", { replace: true });
    }
  }, [isLoading, allowed, navigate]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 pt-8 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
