import { Authenticated } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import WorkoutBuilderForm from "@/pages/programs/[id]/workouts/_components/workout-builder-form.tsx";
import { backendExerciseToEntry } from "@/pages/programs/[id]/workouts/_components/exercise-entry-utils.ts";

function EditWorkoutContent({ workoutId }: { workoutId: Id<"workouts"> }) {
  const workout = useQuery(api.workouts.get, { id: workoutId });

  if (workout === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const initial = {
    workoutId: workout._id,
    name: workout.name,
    day: workout.day,
    week: workout.week,
    exercises: workout.exercisesWithDetails.map(backendExerciseToEntry),
  };

  return (
    <WorkoutBuilderForm
      programId={workout.programId}
      week={workout.week}
      initial={initial}
    />
  );
}

export default function EditWorkoutPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        {id && <EditWorkoutContent workoutId={id as Id<"workouts">} />}
      </div>
    </Authenticated>
  );
}
