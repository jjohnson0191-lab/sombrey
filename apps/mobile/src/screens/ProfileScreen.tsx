import { useNavigate } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import { Screen, Section, Card, Row } from "@/ui/index.ts";
import { useSombreyAuth } from "@/features/auth/useSombreyAuth.ts";

const SETTINGS_ROWS = [
  { label: "Account", to: "/profile/settings" },
  { label: "Device & wearable", to: "/profile/settings" },
  { label: "Notifications", to: "/profile/settings" },
  { label: "Subscription", to: "/profile/settings" },
  { label: "Privacy & terms", to: "/profile/settings" },
  { label: "Support", to: "/profile/settings" },
] as const;

export function ProfileScreen() {
  const { displayName, email, signOut } = useSombreyAuth();
  const navigate = useNavigate();

  return (
    <Screen className="gap-6 pt-4">
      <div>
        <h1 className="text-xl font-semibold">{displayName ?? "Profile"}</h1>
        {email && <p className="text-sm text-foreground-muted">{email}</p>}
      </div>

      <Section title="Settings">
        <Card className="divide-y divide-border-subtle p-0">
          {SETTINGS_ROWS.map((row) => (
            <button
              key={row.label}
              type="button"
              onClick={() => navigate(row.to)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
            >
              {row.label}
              <ChevronRight className="h-4 w-4 text-foreground-faint" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => navigate("/profile/settings/delete-account")}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-danger"
          >
            Delete Account
            <ChevronRight className="h-4 w-4 text-danger/60" />
          </button>
        </Card>
      </Section>

      <Row className="justify-center pt-2">
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-2 text-sm text-foreground-muted"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </Row>
    </Screen>
  );
}
