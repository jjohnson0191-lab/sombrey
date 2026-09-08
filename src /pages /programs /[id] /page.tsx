import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dumbbell, ArrowLeft, Edit, Plus, Copy, Calendar, Target } from "lucide-react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge.tsx";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";

function ProgramDetailContent({ programId }: { programId: Id<"programs"> }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // clientId forwarded from the client profile — used to pre-select client in "Add Workout"
  const clientId = searchParams.get("clientId") ?? undefined;
  const program = useQuery(api.programs.get, { id: programId });
  const workouts = useQuery(api.workouts.listByProgram, { programId });
  const currentUser = useQuery(api.users.getCurrentUser);
  const duplicateProgram = useMutation(api.programs.duplicate);

  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const isCoachOrAdmin = currentUser?.effectiveRoles?.includes("coach") || currentUser?.effectiveRoles?.includes("admin") || currentUser?.effectiveRoles?.includes("owner") || false;

  if (program === undefined || workouts === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const weeks = Array.from({ length: program.durationWeeks }, (_, i) => i + 1);
  const weekWorkouts = workouts.filter(w => w.week === selectedWeek);

  const handleDuplicate = async () => {
    setIsDuplicating(true);
    try {
      const newProgramId = await duplicateProgram({ id: programId });
      toast.success("Program duplicated successfully!");
      navigate(`/programs/${newProgramId}`);
    } catch (error) {
      toast.error("Failed to duplicate program");
      console.error(error);
    } finally {
      setIsDuplicating(false);
    }
  };

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case "metabolic_rewire": return "bg-primary/10 text-primary border-primary/30";
      case "anabolic_surge": return "bg-accent/10 text-accent border-accent/30";
      case "body_recode": return "bg-chart-3/10 text-chart-3 border-chart-3/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "beginner": return "bg-chart-4/10 text-chart-4";
      case "intermediate": return "bg-accent/10 text-accent";
      case "advanced": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-8">
      {/* Program Header */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <div className="flex flex-col lg:flex-row justify-between items-start gap-4">
            <div className="space-y-3 flex-1">
              <div className="flex flex-wrap gap-2">
                <Badge className={getPhaseColor(program.phase)}>
                  {program.phase.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </Badge>
                <Badge variant="secondary" className={getDifficultyColor(program.difficulty)}>
                  {program.difficulty.charAt(0).toUpperCase() + program.difficulty.slice(1)}
                </Badge>
              </div>
              <div>
                <CardTitle className="text-3xl mb-2">{program.name}</CardTitle>
                <CardDescription className="text-base">{program.description}</CardDescription>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>{program.durationWeeks} weeks</span>
                </div>
                <div className="text-muted-foreground">
                  Created by {program.creatorName}
                </div>
              </div>
            </div>
            
            {isCoachOrAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleDuplicate} disabled={isDuplicating}>
                  <Copy className="w-4 h-4 mr-2" />
                  {isDuplicating ? "Duplicating..." : "Duplicate"}
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/programs/${programId}/edit`}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        
        {program.goals.length > 0 && (
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Target className="w-4 h-4 text-primary" />
                <span>Program Goals</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {program.goals.map((goal, index) => (
                  <Badge key={index} variant="outline">
                    {goal}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Week Selector */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Select Week</h3>
        <div className="flex flex-wrap gap-2">
          {weeks.map((week) => (
            <Button
              key={week}
              variant={selectedWeek === week ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedWeek(week)}
            >
              Week {week}
            </Button>
          ))}
        </div>
      </div>

      {/* Workouts */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">
            Week {selectedWeek} Workouts
          </h2>
          {isCoachOrAdmin && (
            <Button asChild size="sm">
              <Link to={`/programs/${programId}/workouts/new?week=${selectedWeek}${clientId ? `&clientId=${clientId}` : ""}`}>
                <Plus className="w-4 h-4 mr-2" />
                Add Workout
              </Link>
            </Button>
          )}
        </div>

        {weekWorkouts.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Dumbbell />
              </EmptyMedia>
              <EmptyTitle>No workouts for Week {selectedWeek}</EmptyTitle>
              <EmptyDescription>
                {isCoachOrAdmin 
                  ? "Add workouts to build out this week of the program"
                  : "This week doesn't have any workouts yet"}
              </EmptyDescription>
            </EmptyHeader>
            {isCoachOrAdmin && (
              <EmptyContent>
                <Button asChild>
                  <Link to={`/programs/${programId}/workouts/new?week=${selectedWeek}${clientId ? `&clientId=${clientId}` : ""}`}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Workout
                  </Link>
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {weekWorkouts
              .sort((a, b) => a.day - b.day)
              .map((workout) => (
                <Link key={workout._id} to={`/workouts/${workout._id}`}>
                  <Card className="h-full bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all cursor-pointer group">
                    <CardHeader>
                      <div className="flex justify-between items-start mb-2">
                        <Badge variant="secondary">Day {workout.day}</Badge>
                        <Badge variant="outline">{workout.exercises.length} exercises</Badge>
                      </div>
                      <CardTitle className="text-lg group-hover:text-primary transition-colors">
                        {workout.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {workout.exercisesWithDetails.slice(0, 3).map((ex, index) => (
                          <div key={index} className="text-sm text-muted-foreground flex justify-between">
                            <span className="truncate flex-1">{ex.exerciseName}</span>
                            <span className="ml-2 flex-shrink-0">
                              {ex.sets}x{typeof ex.reps === 'number' ? ex.reps : ex.reps}
                            </span>
                          </div>
                        ))}
                        {workout.exercises.length > 3 && (
                          <div className="text-sm text-muted-foreground italic">
                            +{workout.exercises.length - 3} more exercises
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProgramDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        {id && <ProgramDetailContent programId={id as Id<"programs">} />}
      </div>
    </Authenticated>
  );
}
