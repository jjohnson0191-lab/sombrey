import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Screen, Card, Button } from "@/ui/index.ts";
import { useAccountDeletion } from "@/features/account/accountDeletionService.ts";

/**
 * Delete account — real, working confirmation wired to the actual
 * Convex mutation (users.deleteSelfAccount). Deliberately does not
 * mention "cancels your subscription" anywhere — because it doesn't.
 * See subscriptionService.ts's manageSubscription() for the separate
 * path this screen must eventually link to.
 */
export function DeleteAccountScreen() {
  const navigate = useNavigate();
  const { deleteAccount } = useAccountDeletion();
  const [confirmed, setConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Screen scene="settings" className="pt-14 pb-8">
      <button type="button" onClick={() => navigate(-1)} className="text-[13px] text-ink-soft">
        Back
      </button>
      <h1 className="mt-4 text-[22px] font-semibold text-danger">Delete account</h1>

      <Card className="mt-5 flex flex-col gap-3">
        <p className="text-[13px] text-ink">
          This permanently deletes your Sombrey workouts, nutrition logs, progress photos, measurements,
          AI chat history, and wearable data. This cannot be undone.
        </p>
        <p className="text-[13px] text-ink-soft">
          This does <span className="font-semibold text-ink">not</span> cancel an active Apple
          subscription — manage or cancel that separately from Subscription settings.
        </p>
      </Card>

      <label className="mt-5 flex items-start gap-3 text-[13px] text-ink-soft">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        I understand this cannot be undone.
      </label>

      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

      <div className="mt-6">
        <Button variant="danger" disabled={!confirmed || isDeleting} onClick={() => void handleDelete()}>
          {isDeleting ? "Deleting…" : "Delete my account"}
        </Button>
      </div>
    </Screen>
  );
}
