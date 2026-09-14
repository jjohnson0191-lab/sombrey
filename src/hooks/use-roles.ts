import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

export type AppRole =
  | "client"
  | "coach"
  | "assistant_coach"
  | "store_manager"
  | "admin"
  | "owner";

/**
 * Returns helpers for checking the current user's roles.
 * Uses the multi-role `effectiveRoles` array when available.
 */
export function useRoles() {
  const currentUser = useQuery(api.users.getCurrentUser, {});

  const effectiveRoles: AppRole[] =
    (currentUser?.effectiveRoles as AppRole[] | undefined) ?? [];

  const hasRole = (...required: AppRole[]): boolean => {
    if (effectiveRoles.includes("owner")) return true;
    return required.some((r) => effectiveRoles.includes(r));
  };

  const primaryRole: AppRole =
    (currentUser?.primaryRole as AppRole | undefined) ?? "client";

  return {
    currentUser,
    effectiveRoles,
    primaryRole,
    hasRole,
    isOwner: effectiveRoles.includes("owner"),
    isAdmin: hasRole("admin"),
    isCoach: hasRole("coach", "assistant_coach"),
    isStoreManager: hasRole("store_manager"),
    isLoading: currentUser === undefined,
  };
}
