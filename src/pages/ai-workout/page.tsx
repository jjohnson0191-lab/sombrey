/**
 * AI Workout Logger — log today's AI plan workout with progressive overload tracking
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dumbbell,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Trophy,
  Clock,
  Zap,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { computeTargetReps, isRepCeiling } from "@/lib/progression.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type SetEntry = {
  setNumber: number;
  targetReps: number;
  actualReps: string;
  weightKg: string;
  completed: boolean;
  notes: string;
};

type ExerciseEntry = {
  exerciseName: string;
  targetReps: number[];
  currentWeightKg: number | null;
  isBaseline: boolean;
  hasPlateaued: boolean;
  plateauIntensifier: string | null;
  sets: SetEntry[];
  expanded: boolean;
};

// ─── Rest Timer ───────────────────────────────────────────────────────────────

function RestTimer({ onDone }: { onDone: () => void }) {
  const [seconds, setSeconds] = useState(90);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          if (ref.current) clearInterval(ref.current);
          onDone();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [onDone]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const pct = ((90 - seconds) / 90) * 100;

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 bg-primary/10 rounded-lg border border-primary/20">
      <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs font-bold text-primary">
        {mins}:{String(secs).padStart(2, "0")}
      </span>
      <button onClick={onDone} className="text-muted-foreground hover:text-foreground cursor-pointer">
        <RotateCcw className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Plateau Badge ────────────────────────────────────────────────────────────

const INTENSIFIER_LABELS: Record<string, string> = {
  drop_set: "Drop Set",
  tempo: "Tempo Control",
  shorter_rest: "Shorter Rest",
  rest_pause: "Rest-Pause",
  superset: "Superset",
  extra_volume: "+Volume",
};

function PlateauBadge({ intensifier }: { intensifier: string | null }) {
  if (!intensifier) return null;
  return (
    <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-[10px] gap-1">
      <AlertTriangle className="w-2.5 h-2.5" />
      Plateau: {INTENSIFIER_LABELS[intensifier] ?? intensifier}
    </Badge>
  );
}

// ─── Exercise Card ────────────────────────────────────────────────────────────

function ExerciseCard({
  ex,
  onChange,
  onSetComplete,
}: {
  ex: ExerciseEntry;
  onChange: (updated: ExerciseEntry) => void;
  onSetComplete: () => void;
}) {
  const [showTimer, setShowTimer] = useState(false);
  const completedCount = ex.sets.filter((s) => s.completed).length;
  const atCeiling = isRepCeiling(ex.targetReps);

  const updateSet = (setIdx: number, field: keyof SetEntry, value: string | boolean) => {
    const sets = ex.sets.map((s, i) =>
      i === setIdx ? { ...s, [field]: value } : s
    );
    onChange({ ...ex, sets });
  };

  const markComplete = (setIdx: number) => {
    const sets = ex.sets.map((s, i) =>
      i === setIdx ? { ...s, completed: true } : s
    );
    onChange({ ...ex, sets });
    setShowTimer(true);
    onSetComplete();
  };

  // When weight is entered for set 1 in baseline, auto-fill all sets
  const handleWeightChange = (setIdx: number, val: string) => {
    if (ex.isBaseline && setIdx === 0 && val) {
      const sets = ex.sets.map((s) => ({ ...s, weightKg: val }));
      onChange({ ...ex, sets });
    } else {
      updateSet(setIdx, "weightKg", val);
    }
  };

  return (
    <Card className={cn(
      "border-border bg-card overflow-hidden transition-all",
      completedCount === ex.sets.length ? "border-primary/30 bg-primary/3" : ""
    )}>
      <CardContent className="p-0">
        {/* Header */}
        <button
          onClick={() => onChange({ ...ex, expanded: !ex.expanded })}
          className="w-full flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-muted/10 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-black",
              completedCount === ex.sets.length
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
            )}>
              {completedCount === ex.sets.length
                ? <CheckCircle2 className="w-4 h-4" />
                : `${completedCount}/${ex.sets.length}`
              }
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{ex.exerciseName}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground">
                  Target: {ex.targetReps.join(" / ")} reps
                </span>
                {atCeiling && (
                  <Badge className="bg-primary/15 text-primary border-primary/30 text-[9px] px-1 py-0 gap-0.5">
                    <Trophy className="w-2 h-2" />
                    Max reps!
                  </Badge>
                )}
                {ex.isBaseline && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">
                    Baseline
                  </Badge>
                )}
                {ex.hasPlateaued && (
                  <PlateauBadge intensifier={ex.plateauIntensifier} />
                )}
              </div>
            </div>
          </div>
          {ex.expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </button>

        {/* Last performance + current weight */}
        {!ex.isBaseline && ex.currentWeightKg && (
          <div className="px-4 pb-2 flex items-center gap-3">
            <div className="text-[10px] text-muted-foreground">
              Current weight: <span className="font-bold text-foreground">{ex.currentWeightKg}kg</span>
            </div>
            <TrendingUp className="w-3 h-3 text-primary" />
            <div className="text-[10px] text-muted-foreground">
              Progressive overload active
            </div>
          </div>
        )}

        {ex.isBaseline && (
          <div className="px-4 pb-2">
            <p className="text-[10px] text-primary/80 font-medium">
              Week 1 — Enter your starting weights to begin progressive overload tracking
            </p>
          </div>
        )}

        {/* Rest timer */}
        <AnimatePresence>
          {showTimer && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 pb-2"
            >
              <RestTimer onDone={() => setShowTimer(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded set entries */}
        <AnimatePresence>
          {ex.expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="border-t border-border"
            >
              {/* Column headers */}
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr_2.5rem] gap-2 px-4 py-2 text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
                <span>Set</span>
                <span>Target</span>
                <span>Weight (kg)</span>
                <span>Actual Reps</span>
                <span></span>
              </div>

              {ex.sets.map((set, i) => (
                <div
                  key={set.setNumber}
                  className={cn(
                    "grid grid-cols-[2rem_1fr_1fr_1fr_2.5rem] gap-2 items-center px-4 py-2 border-t border-border/50",
                    set.completed && "bg-primary/5"
                  )}
                >
                  {/* Set number */}
                  <span className={cn(
                    "text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center",
                    set.completed ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {set.setNumber}
                  </span>

                  {/* Target reps */}
                  <span className="text-xs text-muted-foreground font-medium">{set.targetReps}</span>

                  {/* Weight input */}
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={ex.currentWeightKg ? String(ex.currentWeightKg) : "kg"}
                    value={set.weightKg}
                    onChange={(e) => handleWeightChange(i, e.target.value)}
                    className="h-8 text-xs px-2 w-full"
                    disabled={set.completed}
                  />

                  {/* Actual reps input */}
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder={String(set.targetReps)}
                    value={set.actualReps}
                    onChange={(e) => updateSet(i, "actualReps", e.target.value)}
                    className="h-8 text-xs px-2 w-full"
                    disabled={set.completed}
                  />

                  {/* Done button */}
                  <button
                    onClick={() => {
                      if (!set.weightKg) {
                        toast.error("Enter weight before completing set");
                        return;
                      }
                      markComplete(i);
                    }}
                    disabled={set.completed}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer",
                      set.completed
                        ? "bg-primary/20 text-primary"
                        : "bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground"
                    )}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {/* Plateau guidance */}
              {ex.hasPlateaued && ex.plateauIntensifier && (
                <div className="px-4 py-2.5 border-t border-border/50 bg-yellow-500/5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-yellow-400/80 leading-snug">
                      Plateau detected. Try <strong>{INTENSIFIER_LABELS[ex.plateauIntensifier]}</strong> this session to break through.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AiWorkoutContent() {
  const navigate = useNavigate();
  const todayWorkout = useQuery(api.aiWorkouts.getTodayWorkout, {});
  const logWorkout = useMutation(api.aiWorkouts.logAiWorkout);
  const [exercises, setExercises] = useState<ExerciseEntry[] | null>(null);
  const [startTime] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  // Initialize exercise entries when data loads
  useEffect(() => {
    if (!todayWorkout || todayWorkout.isRestDay || exercises !== null) return;

    const entries: ExerciseEntry[] = todayWorkout.exercises.map((ex, i) => ({
      exerciseName: ex.exerciseName,
      targetReps: ex.targetReps,
      currentWeightKg: ex.currentWeightKg,
      isBaseline: ex.isBaseline,
      hasPlateaued: ex.hasPlateaued,
      plateauIntensifier: ex.plateauIntensifier,
      expanded: i === 0,
      sets: ex.targetReps.map((tr, setIdx) => ({
        setNumber: setIdx + 1,
        targetReps: tr,
        actualReps: String(tr), // pre-fill with target
        weightKg: ex.currentWeightKg ? String(ex.currentWeightKg) : "",
        completed: false,
        notes: "",
      })),
    }));
    setExercises(entries);
  }, [todayWorkout, exercises]);

  const updateExercise = (idx: number, updated: ExerciseEntry) => {
    setExercises((prev) => prev ? prev.map((ex, i) => i === idx ? updated : ex) : prev);
  };

  const totalSets = exercises?.reduce((sum, ex) => sum + ex.sets.length, 0) ?? 0;
  const doneSets = exercises?.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0) ?? 0;
  const progressPct = totalSets > 0 ? Math.round((doneSets / totalSets) * 100) : 0;

  const handleSubmit = async () => {
    if (!exercises || !todayWorkout || todayWorkout.isRestDay) return;

    // Validate all exercises have weights
    const missingWeight = exercises.find((ex) =>
      ex.sets.some((s) => !s.weightKg || s.weightKg === "0")
    );
    if (missingWeight) {
      toast.error(`Enter weight for "${missingWeight.exerciseName}" before finishing`);
      return;
    }

    setSubmitting(true);
    try {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      await logWorkout({
        planId: todayWorkout.planId,
        weekNumber: todayWorkout.currentWeek,
        workoutDayName: todayWorkout.workoutDayName,
        durationSeconds,
        exercises: exercises.map((ex) => ({
          exerciseName: ex.exerciseName,
          targetReps: ex.targetReps,
          sets: ex.sets.map((s) => ({
            setNumber: s.setNumber,
            targetReps: s.targetReps,
            actualReps: parseInt(s.actualReps) || s.targetReps,
            weightKg: parseFloat(s.weightKg) || 0,
            completed: s.completed,
            notes: s.notes || undefined,
          })),
        })),
      });
      toast.success("Workout logged! Progression updated.");
      navigate("/dashboard");
    } catch (e) {
      toast.error("Failed to save workout");
    } finally {
      setSubmitting(false);
    }
  };

  if (todayWorkout === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!todayWorkout) {
    return (
      <div className="px-4 pt-12 text-center">
        <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-bold">No AI plan active</p>
        <p className="text-sm text-muted-foreground mt-1">Complete the onboarding to get your personalized plan.</p>
        <Button asChild className="mt-4 cursor-pointer">
          <Link to="/onboarding">Get My Plan</Link>
        </Button>
      </div>
    );
  }

  if (todayWorkout.isRestDay) {
    return (
      <div className="px-4 pt-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-4">
          <Zap className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-black mb-1">Rest Day</h2>
        <p className="text-sm text-muted-foreground">Week {todayWorkout.currentWeek} · Recovery is training. Come back tomorrow stronger.</p>
        <Button asChild variant="secondary" className="mt-6 cursor-pointer">
          <Link to="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  if (todayWorkout.loggedToday && exercises === null) {
    return (
      <div className="px-4 pt-12 text-center">
        <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-4" />
        <h2 className="text-xl font-black mb-1">Workout Done!</h2>
        <p className="text-sm text-muted-foreground">You already logged today's workout. Great work.</p>
        <Button asChild className="mt-4 cursor-pointer">
          <Link to="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/dashboard" className="cursor-pointer text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Week {todayWorkout.currentWeek} · {todayWorkout.scheduleType}
            </p>
            <h1 className="font-black text-lg leading-tight truncate">{todayWorkout.workoutDayName}</h1>
          </div>
          <Badge className={cn(
            "text-[10px] font-bold shrink-0",
            progressPct === 100 ? "bg-primary/20 text-primary border-primary/30" : "bg-muted text-muted-foreground"
          )}>
            {doneSets}/{totalSets} sets
          </Badge>
        </div>
        <Progress value={progressPct} className="h-1.5" />
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Workout target summary */}
        {exercises && exercises.length > 0 && exercises[0].isBaseline && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-primary/90 font-medium leading-snug">
                  Week 1 Baseline — Enter the weight you use for each exercise. This sets your progressive overload starting point for the full 12-week program.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Exercise list */}
        {exercises?.map((ex, i) => (
          <motion.div
            key={ex.exerciseName}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.04 }}
          >
            <ExerciseCard
              ex={ex}
              onChange={(updated) => updateExercise(i, updated)}
              onSetComplete={() => setCompletedCount((c) => c + 1)}
            />
          </motion.div>
        ))}

        {/* Finish button */}
        {exercises && exercises.length > 0 && (
          <div className="pt-2">
            <Button
              className="w-full cursor-pointer gap-2 h-12 text-base font-bold"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <>Saving...</>
              ) : progressPct === 100 ? (
                <><Trophy className="w-5 h-5" /> Finish Workout</>
              ) : (
                <>Finish & Save <ArrowRight className="w-4 h-4" /></>
              )}
            </Button>
            {progressPct < 100 && (
              <p className="text-[11px] text-center text-muted-foreground mt-2">
                {totalSets - doneSets} sets remaining — you can finish early
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AiWorkoutPage() {
  return (
    <Authenticated>
      <AiWorkoutContent />
    </Authenticated>
  );
}
