import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api.js";

/**
 * Account deletion boundary — calls the real Convex mutation built in
 * Phase 2 (convex/users.ts::deleteSelfAccount), which already implements
 * the full cascade (personal data deleted, financial/legal records
 * retained, ownership derived only from the authenticated session — see
 * that mutation's doc comment for the complete, audited behavior).
 *
 * This hook is what the future Profile -> Settings -> Delete Account
 * screen calls, with its own confirmation step (not built in Phase 3 —
 * see src/screens/settings/DeleteAccountScreen.tsx for the placeholder
 * and why a real confirmation UI isn't here yet).
 *
 * Deleting a Sombrey account and cancelling an Apple subscription are
 * two different operations — this hook does not touch subscription
 * state (it can't; the backend mutation deliberately doesn't either).
 * The Delete Account screen must never claim or imply that deleting the
 * account also cancels billing — see
 * features/subscription/subscriptionService.ts's manageSubscription()
 * for the separate, required path to Apple's subscription management.
 */
export function useAccountDeletion() {
  const deleteSelfAccount = useMutation(api.users.deleteSelfAccount);

  return {
    deleteAccount: async () => {
      await deleteSelfAccount({});
    },
  };
}
