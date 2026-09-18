import { Screen, Section } from "@/ui/index.ts";
import { EmptyState } from "@/ui/StateViews.tsx";

export function NutritionScreen() {
  return (
    <Screen className="gap-6 pt-4">
      <h1 className="text-xl font-semibold">Nutrition</h1>
      <Section>
        <EmptyState
          title="Nutrition tracking coming soon"
          description="Meal logging, macro targets, and the camera macro calculator will live here."
        />
      </Section>
    </Screen>
  );
}
