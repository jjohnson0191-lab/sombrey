import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { Dumbbell, Plus, Calendar, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge.tsx";

const programPhases = [
  { value: "all", label: "All Phases" },
  { value: "metabolic_rewire", label: "Metabolic Rewire™" },
  { value: "anabolic_surge", label: "Anabolic Surge Protocol™" },
  { value: "body_recode", label: "Body Recode™" },
] as const;

const difficulties = [
  { value: "all", label: "All Levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

function ProgramsContent() {
  const [selectedPhase, setSelectedPhase] = useState<string>("all");
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("all");

  type ProgramPhase = "metabolic_rewire" | "anabolic_surge" | "body_recode";
  type Difficulty = "beginner" | "intermediate" | "advanced";

  const programs = useQuery(api.programs.list, {
    phase: selectedPhase !== "all" ? selectedPhase as ProgramPhase : undefined,
    difficulty: selectedDifficulty !== "all" ? selectedDifficulty as Difficulty : undefined,
  });

  const currentUser = useQuery(api.users.getCurrentUser);
  const isCoachOrAdmin = currentUser?.effectiveRoles?.includes("coach") || 
    currentUser?.effectiveRoles?.includes("admin") || 
    currentUser?.effectiveRoles?.includes("owner") || false;

  if (programs === undefined) {
    return (
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      </div>
    );
  }

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
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
        <div className="space-y-4 flex-1">
          {/* Phase Filters */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Program Phase</h3>
            <div className="flex flex-wrap gap-2">
              {programPhases.map((phase) => (
                <Button
                  key={phase.value}
                  variant={selectedPhase === phase.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedPhase(phase.value)}
                >
                  {phase.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Difficulty Filters */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Difficulty</h3>
            <div className="flex flex-wrap gap-2">
              {difficulties.map((diff) => (
                <Button
                  key={diff.value}
                  variant={selectedDifficulty === diff.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDifficulty(diff.value)}
                >
                  {diff.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {isCoachOrAdmin && (
          <Button asChild size="lg">
            <Link to="/programs/new">
              <Plus className="w-4 h-4 mr-2" />
              Create Program
            </Link>
          </Button>
        )}
      </div>

      {/* Programs Grid */}
      {programs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TrendingUp />
            </EmptyMedia>
            <EmptyTitle>No programs found</EmptyTitle>
            <EmptyDescription>
              {isCoachOrAdmin 
                ? "Start building your training programs by creating your first program"
                : "No programs match your current filters"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {programs.map((program) => (
            <Link key={program._id} to={`/programs/${program._id}`}>
              <Card className="h-full bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all cursor-pointer group">
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <Badge className={getPhaseColor(program.phase)}>
                      {program.phase.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </Badge>
                    <Badge variant="secondary" className={getDifficultyColor(program.difficulty)}>
                      {program.difficulty.charAt(0).toUpperCase() + program.difficulty.slice(1)}
                    </Badge>
                  </div>
                  <CardTitle className="text-xl line-clamp-2 group-hover:text-primary transition-colors">
                    {program.name}
                  </CardTitle>
                  <CardDescription className="line-clamp-3">{program.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      <span>{program.durationWeeks} weeks</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Dumbbell className="w-4 h-4" />
                      <span>Multi-phase</span>
                    </div>
                  </div>
                  
                  {program.goals.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Goals:</p>
                      <div className="flex flex-wrap gap-1">
                        {program.goals.slice(0, 3).map((goal, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {goal}
                          </Badge>
                        ))}
                        {program.goals.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{program.goals.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                    Created by {program.creatorName}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProgramsPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Training Programs
          </h1>
          <p className="text-muted-foreground text-lg">
            Multi-phase workout programs designed for maximum hypertrophy
          </p>
        </div>

        <ProgramsContent />
      </div>
    </Authenticated>
  );
}
