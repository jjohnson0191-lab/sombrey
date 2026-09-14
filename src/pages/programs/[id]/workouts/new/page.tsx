import { Authenticated } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel.js";
import { useParams, useSearchParams } from "react-router-dom";
import WorkoutBuilderForm from "../_components/workout-builder-form.tsx";

export default function NewWorkoutPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const week = Number(searchParams.get("week") ?? "1");
  // Pre-select a client when navigating from a client's profile
  const clientId = searchParams.get("clientId") ?? undefined;

  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        {id && (
          <WorkoutBuilderForm
            programId={id as Id<"programs">}
            week={week}
            preselectedClientId={clientId as Id<"users"> | undefined}
          />
        )}
      </div>
    </Authenticated>
  );
}
