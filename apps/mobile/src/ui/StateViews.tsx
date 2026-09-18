import type { ReactNode } from "react";
import { Button } from "./Button.tsx";

/**
 * Reusable state patterns. Loading/empty/error stay quiet on purpose —
 * no red alert boxes, no spinners for "not enough data yet" (that's a
 * calm, wordless placeholder; see ReadinessIndicator) — a plain
 * sentence and, where relevant, a plain text retry action.
 */

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-ink-soft">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink/15 border-t-accent-ink" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-soft">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="text-sm font-semibold text-danger">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-soft">{description}</p>}
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Shown when a screen needs auth state and none is present — should be
 * rare in practice since routing gates unauthenticated access, but
 * screens that can be reached in edge cases (deep links, stale state)
 * need a graceful fallback rather than a blank/broken render. */
export function UnauthenticatedState() {
  return <EmptyState title="Sign in required" description="Please sign in to continue." />;
}

export function InsufficientWearableDataState() {
  return (
    <EmptyState
      title="Still collecting data"
      description="Sombrey needs a few more days of band data before this is meaningful. Check back soon."
    />
  );
}

export function WearableDisconnectedState({ onReconnect }: { onReconnect?: () => void }) {
  return (
    <EmptyState
      title="Band not connected"
      description="Connect your Sombrey band to see this."
      action={
        onReconnect && (
          <Button variant="secondary" onClick={onReconnect}>
            Reconnect
          </Button>
        )
      }
    />
  );
}

export function AiUnavailableState({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Sombrey couldn't check your data just now"
      description="Try again in a moment."
      onRetry={onRetry}
    />
  );
}
