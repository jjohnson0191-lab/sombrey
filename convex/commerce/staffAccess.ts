// Sombrey commerce — Phase 6F: who may run staff fulfilment/return operations (pure).
//
// The existing staff convention (storeOrders.ts / store.ts): roles from the
// users table, owner always passes. Fulfilment and returns: owner, admin,
// store_manager. Money (cancelling a paid order, approving/issuing refunds):
// owner, admin. Phase 6G device administration (activate for a customer,
// deactivate, retire, reissue codes, see full hardware identifiers): owner,
// admin — store managers register and assign units only.
// Tested in tests/commerce/fulfillment.test.ts and devices.test.ts.

import type { Doc } from "../_generated/dataModel";
import { hasRole } from "../lib/roles.ts";

export type StaffLevel = "fulfillment" | "money" | "device_admin";

export function staffMay(user: Doc<"users"> | null | undefined, level: StaffLevel): boolean {
  if (!user) return false;
  return level === "fulfillment" ? hasRole(user, "owner", "admin", "store_manager") : hasRole(user, "owner", "admin");
}
