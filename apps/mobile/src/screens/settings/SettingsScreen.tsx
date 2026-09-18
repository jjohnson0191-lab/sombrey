import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Screen, Button } from "@/ui/index.ts";
import { WearableStatusBadge } from "@/ui/WearableStatusBadge.tsx";
import { useSombreyAuth } from "@/features/auth/useSombreyAuth.ts";
import { useWearable } from "@/features/wearable/useWearable.ts";

/**
 * Settings — absorbs the old ProfileScreen (account identity, sign out)
 * into one screen, per the approved IA: Profile is no longer its own
 * tab. Subscription and notifications rows call the real boundary
 * services (subscriptionService.ts, notificationService.ts); both
 * currently reject/return "unimplemented" as documented there, so
 * their rows show that honestly rather than pretending to work.
 */
export function SettingsScreen() {
  const navigate = useNavigate();
  const { displayName, email, signOut } = useSombreyAuth();
  const { status } = useWearable();

  return (
    <Screen scene="settings" className="pt-14 pb-8">
      <h1 className="text-[24px] font-semibold text-ink">Settings</h1>
      {(displayName || email) && (
        <p className="mt-1 text-[13px] text-ink-soft">{displayName ?? email}</p>
      )}

      <SectionLabel>Account</SectionLabel>
      <Row label="Profile" />
      <Row label="Subscription" hint="Not connected yet" />

      <SectionLabel>Wearable</SectionLabel>
      <Row label="Sombrey Band" hint={<WearableStatusBadge state={status?.connectionState ?? "disconnected"} />} />
      <Row label="Notifications" />

      <SectionLabel>Privacy &amp; data</SectionLabel>
      <Row label="Privacy policy" />
      <Row label="Export my data" />

      <div className="mt-8 border-t border-ink/12 pt-4">
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>

      <div className="mt-10 border-t border-danger/20 pt-4">
        <Button variant="danger" onClick={() => navigate("/settings/delete-account")}>
          Delete account
        </Button>
      </div>
    </Screen>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mt-7 mb-1 text-[11px] tracking-[0.08em] text-ink-soft uppercase">{children}</p>
  );
}

function Row({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-ink/12 py-3.5">
      <span className="text-[15px] text-ink">{label}</span>
      {typeof hint === "string" ? <span className="text-xs text-ink-soft">{hint}</span> : hint}
    </div>
  );
}
