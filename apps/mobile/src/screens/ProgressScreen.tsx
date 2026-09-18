import { Screen, Section } from "@/ui/index.ts";
import { EmptyState } from "@/ui/StateViews.tsx";

export function ProgressScreen() {
  return (
    <Screen className="gap-6 pt-4">
      <h1 className="text-xl font-semibold">Progress</h1>
      <Section>
        <EmptyState
          title="Progress tracking coming soon"
          description="Measurements, guided progress photos, and trends will live here."
        />
      </Section>
    </Screen>
  );
}
