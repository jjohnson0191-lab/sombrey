import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Screen, Section, Card, Row } from "@/ui/index.ts";

/** Foundation settings screen — a single list; sub-screens (device,
 * notifications, subscription, privacy, support) are stubs pointing back
 * here for now. Delete Account is the one fully-linked destination,
 * per the Phase 3 requirement. */
export function SettingsScreen() {
  const navigate = useNavigate();

  return (
    <Screen className="gap-6 pt-4">
      <Row gap={2}>
        <button type="button" onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft className="h-5 w-5 text-foreground-muted" />
        </button>
        <h1 className="text-xl font-semibold">Settings</h1>
      </Row>

      <Section title="Account">
        <Card className="divide-y divide-border-subtle p-0">
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
    </Screen>
  );
}
