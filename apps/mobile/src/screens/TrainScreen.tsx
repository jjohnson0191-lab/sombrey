import { Screen, Section } from "@/ui/index.ts";
import { EmptyState } from "@/ui/StateViews.tsx";

export function TrainScreen() {
  return (
    <Screen className="gap-6 pt-4">
      <h1 className="text-xl font-semibold">Train</h1>
      <Section>
        <EmptyState
          title="Workouts coming soon"
          description="AI workout generation, your plan, and the exercise library will live here."
        />
      </Section>
    </Screen>
  );
}
