import type { Doc } from "../_generated/dataModel.d.ts";

export type AppRole =
  | "client"
  | "coach"
  | "assistant_coach"
  | "store_manager"
  | "admin"
  | "owner";

export type SubscriptionTier =
  | "free"
  | "premium"
  | "coaching_client"
  // Legacy tiers (treated as premium or coaching_client)
  | "self_guided"
  | "semi_guided"
  | "full_guided";

/**
 * Returns the effective set of roles for a user.
 * Uses `roles` array when present, falls back to legacy `role` string.
 */
export function getUserRoles(user: Doc<"users">): AppRole[] {
  if (user.roles && user.roles.length > 0) {
    return user.roles as AppRole[];
  }
  if (user.role) {
    return [user.role as AppRole];
  }
  return ["client"];
}

/**
 * Returns true if the user has ANY of the given roles.
 * Owner always returns true (super user).
 */
export function hasRole(user: Doc<"users">, ...required: AppRole[]): boolean {
  const effective = getUserRoles(user);
  if (effective.includes("owner")) return true;
  return required.some((r) => effective.includes(r));
}

/**
 * Returns a display string for primary/highest role.
 */
export function primaryRole(user: Doc<"users">): AppRole {
  const order: AppRole[] = ["owner", "admin", "coach", "assistant_coach", "store_manager", "client"];
  const effective = getUserRoles(user);
  for (const r of order) {
    if (effective.includes(r)) return r;
  }
  return "client";
}

/**
 * Returns true if the user has access to premium/tracking features.
 * Covers: admin-granted, premium, coaching_client, and legacy paid tiers.
 * Coaches, admins, and owners always have access.
 */
export function hasPremiumAccess(user: Doc<"users">): boolean {
  if (hasRole(user, "coach", "admin", "owner", "assistant_coach")) return true;
  if (user.adminGrantedPremium === true) return true;
  const tier = user.subscriptionTier as SubscriptionTier;
  return tier === "premium"
    || tier === "coaching_client"
    || tier === "self_guided"
    || tier === "semi_guided"
    || tier === "full_guided";
}
