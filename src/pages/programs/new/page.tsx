import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge.tsx";

function CreateProgramForm() {
  const navigate = useNavigate();
  const createProgram = useMutation(api.programs.create);
  const currentUser = useQuery(api.users.getCurrentUser);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<string>("");
  const [durationWeeks, setDurationWeeks] = useState<string>("12");
  const [difficulty, setDifficulty] = useState<string>("");
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isCoachOrAdmin = currentUser?.effectiveRoles?.includes("coach") || currentUser?.effectiveRoles?.includes("admin") || currentUser?.effectiveRoles?.includes("owner") || false;

  if (!isCoachOrAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Only coaches and admins can create programs</p>
        <Button asChild className="mt-4">
          <Link to="/programs">Back to Programs</Link>
        </Button>
      </div>
    );
  }

  const addGoal = () => {
    if (goalInput.trim() && !goals.includes(goalInput.trim())) {
      setGoals([...goals, goalInput.trim()]);
      setGoalInput("");
    }
  };

  const removeGoal = (index: number) => {
    setGoals(goals.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phase) {
      toast.error("Please select a program phase");
      return;
    }

    if (!difficulty) {
      toast.error("Please select a difficulty level");
      return;
    }

    const weeks = parseInt(durationWeeks);
    if (isNaN(weeks) || weeks < 1 || weeks > 52) {
      toast.error("Duration must be between 1 and 52 weeks");
      return;
    }

    setIsSubmitting(true);

    try {
      type ProgramPhase = "metabolic_rewire" | "anabolic_surge" | "body_recode";
      type Difficulty = "beginner" | "intermediate" | "advanced";

      const programId = await createProgram({
        name,
        description,
        phase: phase as ProgramPhase,
        durationWeeks: weeks,
        difficulty: difficulty as Difficulty,
        goals,
      });

      toast.success("Program created successfully!");
      navigate(`/programs/${programId}`);
    } catch (error) {
      toast.error("Failed to create program");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Essential details about the training program</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Program Name *</Label>
            <Input
              id="name"
              placeholder="12-Week Hypertrophy Blast"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="A comprehensive 12-week program designed to maximize muscle hypertrophy through progressive overload..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              required
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phase">Program Phase *</Label>
              <Select value={phase} onValueChange={setPhase}>
                <SelectTrigger id="phase">
                  <SelectValue placeholder="Select phase" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="metabolic_rewire">Metabolic Rewire™</SelectItem>
                  <SelectItem value="anabolic_surge">Anabolic Surge Protocol™</SelectItem>
                  <SelectItem value="body_recode">Body Recode™</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="difficulty">Difficulty Level *</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger id="difficulty">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (Weeks) *</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                max="52"
                placeholder="12"
                value={durationWeeks}
                onChange={(e) => setDurationWeeks(e.target.value)}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Program Goals</CardTitle>
          <CardDescription>Define the target outcomes and benefits</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goals">Add Goals</Label>
            <div className="flex gap-2">
              <Input
                id="goals"
                placeholder="Increase muscle mass, Improve strength..."
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGoal();
                  }
                }}
              />
              <Button type="button" onClick={addGoal}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Press Enter or click + to add each goal
            </p>
          </div>

          {goals.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Goals ({goals.length}):</p>
              <div className="flex flex-wrap gap-2">
                {goals.map((goal, index) => (
                  <Badge key={index} variant="outline" className="gap-2 pr-1">
                    {goal}
                    <button
                      type="button"
                      onClick={() => removeGoal(index)}
                      className="ml-1 hover:text-destructive rounded-full hover:bg-destructive/10 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="text-primary">Next Steps</CardTitle>
          <CardDescription>
            After creating the program, you'll be able to add workouts for each week
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex gap-4">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Program"}
        </Button>
        <Button type="button" variant="outline" size="lg" asChild>
          <Link to="/programs">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

export default function NewProgramPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Create New Program
          </h1>
          <p className="text-muted-foreground text-lg">
            Build a multi-phase training program for maximum results
          </p>
        </div>

        <CreateProgramForm />
      </div>
    </Authenticated>
  );
}
