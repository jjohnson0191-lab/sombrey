import { useNavigate } from "react-router-dom";
import { Screen } from "@/ui/index.ts";
import { EmptyState } from "@/ui/StateViews.tsx";
import { Button } from "@/ui/Button.tsx";

/** Reached from Home's nutrition row, not a tab — see the approved IA
 * decision in NavTicks.tsx. Content unchanged from the earlier
 * foundation; only the container is restyled. */
export function NutritionScreen() {
  const navigate = useNavigate();
  return (
    <Screen scene="trainOverview" nav={false} className="pt-14">
      <button type="button" onClick={() => navigate(-1)} className="text-[13px] text-ink-soft">
        Back
      </button>
      <h1 className="mt-4 text-[22px] font-semibold text-ink">Nutrition</h1>
      <EmptyState
        title="Nutrition tracking coming soon"
        description="Meal logging, macro targets, and the camera macro calculator will live here."
        action={
          <Button variant="secondary" onClick={() => navigate("/home")}>
            Back to Home
          </Button>
        }
      />
    </Screen>
  );
}
