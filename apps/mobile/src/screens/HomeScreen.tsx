import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api.js";
import { Screen, Section, Card, Row, Metric } from "@/ui/index.ts";
import { ReadinessIndicator } from "@/ui/ReadinessIndicator.tsx";
import { WearableStatusBadge } from "@/ui/WearableStatusBadge.tsx";
import { LoadingState } from "@/ui/StateViews.tsx";
import { useReadiness } from "@/features/readiness/useReadiness.ts";
import { useWearable } from "@/features/wearable/useWearable.ts";

/**
 * Foundation Home screen — proves the shell (auth, Convex query, design
 * system, wearable/readiness boundaries) works end to end. Deliberately
 * not the full dashboard from the product spec (today's workout card,
 * nutrition summary, AI nudge, etc.) — those are later phases.
 */
export function HomeScreen() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const { result: readiness } = useReadiness();
  const { status: wearableStatus } = useWearable();

  if (currentUser === undefined) {
    return (
      <Screen>
        <LoadingState label="Loading your data…" />
      </Screen>
    );
  }

  return (
    <Screen className="gap-6 pb-6 pt-4">
      <Row className="justify-between">
        <h1 className="text-xl font-semibold">
          {currentUser?.name ? `Hi, ${currentUser.name.split(" ")[0]}` : "Sombrey"}
        </h1>
        <WearableStatusBadge state={wearableStatus?.connectionState ?? "disconnected"} />
      </Row>

      <Section title="Readiness">
        <Card>
          <ReadinessIndicator result={readiness} />
        </Card>
      </Section>

      <Section title="Today">
        <Row gap={3}>
          <Card className="flex-1">
            <Metric label="Steps" value="—" />
          </Card>
          <Card className="flex-1">
            <Metric label="Active cal" value="—" />
          </Card>
          <Card className="flex-1">
            <Metric label="Heart rate" value="—" unit="bpm" />
          </Card>
        </Row>
      </Section>
    </Screen>
  );
}
