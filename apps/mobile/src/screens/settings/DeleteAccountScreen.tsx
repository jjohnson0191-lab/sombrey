import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Screen, Row, Card, Button } from "@/ui/index.ts";
import { useAccountDeletion } from "@/features/account/accountDeletionService.ts";

/**
 * Architectural foundation for Profile -> Settings -> Delete Account,
 * per the Phase 3 requirement. This is NOT the polished, final
 * production UI (no legal-reviewed copy, no App Store-review-ready
 * confirmation language) — it is a real, working confirmation step
 * wired to the actual Phase 2 Convex mutation, so the eventual real
 * screen is a copy/design pass, not a re-architecture.
 *
 * Deliberately does not mention "cancels your subscription" anywhere —
 * because it doesn't. See subscriptionService.ts's manageSubscription()
 * for the separate path this screen must eventually link to.
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
      // Real navigation-to-signed-out-state happens once Clerk sign-out
      // is wired here too — foundation only for now.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Screen className="gap-6 pt-4">
      <Row gap={2}>
        <button type="button" onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft className="h-5 w-5 text-foreground-muted" />
        </button>
        <h1 className="text-xl font-semibold text-danger">Delete Account</h1>
      </Row>

      <Card className="flex flex-col gap-3">
        <p className="text-sm text-foreground">
          This permanently deletes your Sombrey workouts, nutrition logs,
          progress photos, measurements, AI chat history, and wearable
          data. This cannot be undone.
        </p>
        <p className="text-sm text-foreground-muted">
          This does <span className="font-semibold text-foreground">not</span> cancel
          an active Apple subscription — manage or cancel that separately
          from Subscription settings.
        </p>
      </Card>

      <label className="flex items-start gap-3 text-sm text-foreground-muted">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        I understand this cannot be undone.
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button variant="danger" disabled={!confirmed || isDeleting} onClick={() => void handleDelete()}>
        {isDeleting ? "Deleting…" : "Delete my account"}
      </Button>
    </Screen>
  );
}
