import { useState } from "react";
import { Authenticated, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dumbbell,
  Utensils,
  Target,
  Calendar,
  Sparkles,
  RotateCcw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Crown,
  Lock,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { Link } from "react-router-dom";

type Goal = "build_muscle" | "lose_fat" | "recomp";

const GOAL_LABELS: Record<Goal, string> = {
  build_muscle: "Build Muscle",
  lose_fat: "Lose Fat",
  recomp: "Body Recomposition",
};

const DAY_COLORS: Record<string, string> = {
  rest: "text-muted-foreground",
  push: "text-blue-400",
  pull: "text-purple-400",
  legs: "text-green-400",
  upper: "text-yellow-400",
  lower: "text-chart-3",
  cardio: "text-red-400",
  full: "text-primary",
};

function getDayColor(type: string) {
  const key = type.toLowerCase().split(" ")[0] ?? "";
  return DAY_COLORS[key] ?? "text-foreground";
}

// ─── Goal Update Card ─────────────────────────────────────────────────────────

function GoalUpdateCard({ currentGoal }: { currentGoal: string }) {
  const [selectedGoal, setSelectedGoal] = useState<Goal>(currentGoal as Goal);
  const [updating, setUpdating] = useState(false);
  const updateGoal = useMutation(api.premiumOnboarding.updateGoalAndRegenerate);

  const handleUpdate = async () => {
    if (selectedGoal === currentGoal) return;
    setUpdating(true);
    try {
      await updateGoal({ primaryGoal: selectedGoal });
      toast.success("Goal updated! Regenerating your AI plan...");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update goal");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Update Goal
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <Select value={selectedGoal} onValueChange={(v) => setSelectedGoal(v as Goal)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="build_muscle">Build Muscle</SelectItem>
            <SelectItem value="lose_fat">Lose Fat</SelectItem>
            <SelectItem value="recomp">Body Recomposition</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={handleUpdate}
          disabled={selectedGoal === currentGoal || updating}
          className="w-full cursor-pointer gap-1.5"
        >
          {updating ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Regenerating...</>
          ) : (
            <><RotateCcw className="w-3.5 h-3.5" /> Update & Regenerate</>
          )}
        </Button>
        {selectedGoal !== currentGoal && (
          <p className="text-xs text-muted-foreground text-center">
            Your workout plan and macro targets will be recalculated
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Workout Day Card ─────────────────────────────────────────────────────────

function WorkoutDayCard({ day }: { day: { dayName: string; exercises: { name: string; sets: number; reps: string; rest?: string; notes?: string }[] } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="border-border bg-card">
      <button
        type="button"
        className="w-full cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm">{day.dayName}</span>
              <Badge variant="secondary" className="text-[10px]">{day.exercises.length} exercises</Badge>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </CardContent>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 pb-4">
          <div className="space-y-2 pt-3">
            {day.exercises.map((ex, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{ex.name}</p>
                  {ex.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{ex.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-primary">{ex.sets} × {ex.reps}</p>
                  {ex.rest && <p className="text-[11px] text-muted-foreground">{ex.rest} rest</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Page Content ─────────────────────────────────────────────────────────────

function AiPlanContent() {
  const aiPlan = useQuery(api.premiumOnboarding.getMyAiPlan, {});
  const onboarding = useQuery(api.premiumOnboarding.getMyOnboarding, {});
  const planProgress = useQuery(api.weeklyCheckIns.getPlanProgress, {});
  const onboardingStatus = useQuery(api.weeklyCheckIns.getOnboardingStatus, {});

  if (aiPlan === undefined || onboarding === undefined || planProgress === undefined || onboardingStatus === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!onboarding) {
    return (
      <div className="text-center py-16 space-y-4">
        <Sparkles className="w-12 h-12 text-primary mx-auto" />
        <h2 className="text-xl font-bold">No AI plan yet</h2>
        <p className="text-muted-foreground text-sm">Complete your onboarding questionnaire to generate your personalized plan.</p>
        <Link to="/onboarding">
          <Button className="cursor-pointer">Set Up My Plan</Button>
        </Link>
      </div>
    );
  }

  if (!aiPlan || aiPlan.status === "generating") {
    return (
      <div className="text-center py-16 space-y-4">
        <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
        <h2 className="text-xl font-bold">Generating your plan...</h2>
        <p className="text-muted-foreground text-sm">This takes about 15–30 seconds. Refresh to check progress.</p>
      </div>
    );
  }

  if (aiPlan.status === "error") {
    return (
      <div className="text-center py-16 space-y-4">
        <h2 className="text-xl font-bold">Generation failed</h2>
        <p className="text-muted-foreground text-sm">Something went wrong. Try updating your goal to retry.</p>
      </div>
    );
  }

  // Weekly gate: require check-in before showing next week's content
  if (planProgress?.isLocked) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-12 space-y-6 text-center">
        <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mx-auto">
          <Lock className="w-10 h-10 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2">Week {planProgress.currentWeek} Locked</h2>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto leading-relaxed">
            Complete your Week {(planProgress.lastCheckInWeek ?? 0) + 1} check-in to unlock this week's plan. Your AI coach needs your progress data before adjusting the program.
          </p>
        </div>
        <Link to="/check-in">
          <Button className="cursor-pointer gap-2">
            Submit Check-In <ChevronUp className="w-4 h-4" />
          </Button>
        </Link>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-1">
          <Crown className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-black">Your AI Plan</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {GOAL_LABELS[aiPlan.primaryGoal as Goal] ?? aiPlan.primaryGoal} · {aiPlan.workoutSplit}
        </p>
        {aiPlan.coachNotes && (
          <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
            <p className="text-sm italic text-muted-foreground">{aiPlan.coachNotes}</p>
          </div>
        )}
      </motion.div>

      {/* Update goal */}
      <GoalUpdateCard currentGoal={aiPlan.primaryGoal} />

      {/* Weekly Schedule */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Weekly Schedule
        </h2>
        <div className="grid grid-cols-7 gap-1">
          {aiPlan.weeklySchedule.map((s) => (
            <div key={s.day} className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase mb-1">{s.day.slice(0, 3)}</p>
              <div className={cn(
                "rounded-lg py-2 px-1 text-[10px] font-bold leading-tight min-h-[48px] flex items-center justify-center",
                s.type.toLowerCase() === "rest" ? "bg-muted/30 text-muted-foreground" : "bg-primary/10"
              )}>
                <span className={getDayColor(s.type)}>{s.type}</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Macro targets */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Target className="w-4 h-4" />
          Daily Macro Targets
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Calories", value: aiPlan.macroTargets.calories, unit: "kcal", color: "text-primary" },
            { label: "Protein", value: aiPlan.macroTargets.protein, unit: "g", color: "text-blue-400" },
            { label: "Carbs", value: aiPlan.macroTargets.carbs, unit: "g", color: "text-yellow-400" },
            { label: "Fats", value: aiPlan.macroTargets.fats, unit: "g", color: "text-chart-3" },
          ].map((m) => (
            <Card key={m.label} className="bg-card border-border">
              <CardContent className="p-3 text-center">
                <p className={cn("text-lg font-black", m.color)}>{m.value}</p>
                <p className="text-[10px] text-muted-foreground">{m.unit}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* Workouts */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Dumbbell className="w-4 h-4" />
          Workout Program
        </h2>
        <div className="space-y-2">
          {aiPlan.workoutDays.map((day, i) => (
            <WorkoutDayCard key={i} day={day} />
          ))}
        </div>
      </motion.div>

      {/* Meals */}
      {aiPlan.meals.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Utensils className="w-4 h-4" />
            Meal Structure
          </h2>
          <div className="space-y-2">
            {aiPlan.meals.map((meal, i) => (
              <Card key={i} className="border-border bg-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm">{meal.name}</p>
                      {meal.time && <span className="text-xs text-muted-foreground">{meal.time}</span>}
                    </div>
                    {meal.calories && (
                      <Badge variant="secondary" className="text-[10px]">~{meal.calories} kcal</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {meal.suggestions.map((s, j) => (
                      <span key={j} className="text-xs bg-muted/40 px-2 py-0.5 rounded-full text-muted-foreground">{s}</span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      )}

      {/* AI Coach CTA */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Ask your AI Coach to adjust this plan</p>
              <p className="text-xs text-muted-foreground">Swap exercises, change meals, ask for substitutions</p>
            </div>
            <Link to="/ai-coach">
              <Button size="sm" className="cursor-pointer shrink-0">Chat</Button>
            </Link>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

export default function AiPlanPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
        <AiPlanContent />
      </div>
    </Authenticated>
  );
}
