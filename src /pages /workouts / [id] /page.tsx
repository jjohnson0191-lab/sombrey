import { useState, useEffect, useRef } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import {
  ArrowLeft, Dumbbell, Timer, Edit, Trash2, Copy, Activity, Weight, Link as LinkIcon,
  Zap, CheckCircle, ChevronDown, ChevronUp, Plus, RotateCcw, Clock,
} from "lucide-react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils.ts";
import { motion } from "motion/react";
import {
  estimateExerciseDurationSeconds,
  estimateWorkoutDurationSeconds,
  formatDuration,
} from "@/lib/workout-duration.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

type SetLog = {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  rpe: string;
  notes: string;
  // prescribed values for reference
  prescribedReps?: string;
  prescribedWeightKg?: string;
  prescribedRest?: number;
  intensifierType?: string;
  intensifierValue?: string;
};

type ExerciseLog = {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  sets: SetLog[];
  expanded: boolean;
};

// ─── Rest Timer ────────────────────────────────────────────────────────────

function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [remaining, setRemaining] = useState(seconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          onDone();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [onDone]);

  const pct = ((seconds - remaining) / seconds) * 100;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="flex items-center gap-2 text-xs text-primary">
      <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      <span className="font-mono font-bold">{mins}:{String(secs).padStart(2, "0")}</span>
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${pct}%` }} />
      </div>
      <button onClick={onDone} className="text-muted-foreground hover:text-foreground cursor-pointer">
        <RotateCcw className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Intensifier Chip helpers ──────────────────────────────────────────────

type IntensifierChipSource = {
  intensifierType?: string;
  intensifierValue?: string;
};

function SetIntensifierChip({ sc }: { sc: IntensifierChipSource }) {
  if (!sc.intensifierType) return null;
  const map: Record<string, { label: string; color: string }> = {
    dropset: { label: "Drop Set", color: "bg-primary/15 text-primary border-primary/30" },
    superset: { label: "Superset", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    tempo: { label: `Tempo ${sc.intensifierValue ?? ""}`, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    rpe: { label: `RPE ${sc.intensifierValue ?? ""}`, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
    suggested_weight: { label: `${sc.intensifierValue ?? ""}kg suggested`, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  };
  const chip = map[sc.intensifierType];
  if (!chip) return null;
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", chip.color)}>
      {chip.label}
    </span>
  );
}

function IntensifierChips({ ex }: {
  ex: {
    isDropSet?: boolean;
    tempo?: string;
    suggestedWeightKg?: number;
    rpe?: number;
    supersetWith?: Id<"exercises">;
    supersetName?: string;
  };
}) {
  const chips: { label: string; icon: React.ReactNode; color: string }[] = [];
  if (ex.isDropSet) chips.push({ label: "Drop Set", icon: <Copy className="w-2.5 h-2.5" />, color: "bg-primary/15 text-primary border-primary/30" });
  if (ex.tempo) chips.push({ label: `Tempo ${ex.tempo}`, icon: <Timer className="w-2.5 h-2.5" />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" });
  if (ex.suggestedWeightKg) chips.push({ label: `${ex.suggestedWeightKg}kg suggested`, icon: <Weight className="w-2.5 h-2.5" />, color: "bg-green-500/20 text-green-400 border-green-500/30" });
  if (ex.rpe) chips.push({ label: `RPE ${ex.rpe}`, icon: <Activity className="w-2.5 h-2.5" />, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" });
  if (ex.supersetWith) chips.push({ label: `Superset: ${ex.supersetName ?? ""}`, icon: <LinkIcon className="w-2.5 h-2.5" />, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map((chip) => (
        <span key={chip.label} className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium", chip.color)}>
          {chip.icon}{chip.label}
        </span>
      ))}
    </div>
  );
}

// ─── Performance Log Form ──────────────────────────────────────────────────

type ExerciseWithDetails = {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  sets: number;
  reps: number | string;
  restSeconds: number;
  isDropSet?: boolean;
  supersetWith?: Id<"exercises">;
  setConfigs?: Array<{
    setNumber: number;
    reps?: number | string;
    weightKg?: number;
    restSeconds?: number;
    intensifierType?: string;
    intensifierValue?: string;
    supersetExerciseName?: string;
    dropSubSets?: Array<{ subSetNumber: number; weightKg?: number; reps?: number }>;
  }>;
};

function PerformanceLogForm({
  workoutId,
  scheduledWorkoutId,
  exercisesWithDetails,
  onClose,
}: {
  workoutId: Id<"workouts">;
  scheduledWorkoutId?: Id<"scheduledWorkouts">;
  exercisesWithDetails: ExerciseWithDetails[];
  onClose: () => void;
}) {
  const logWorkout = useMutation(api.performanceLogs.logPerformance);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [activeRestTimer, setActiveRestTimer] = useState<{ exIdx: number; setIdx: number; seconds: number } | null>(null);

  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>(() =>
    exercisesWithDetails.map((ex) => {
      const setCount = ex.setConfigs ? ex.setConfigs.length : ex.sets;
      return {
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        expanded: true,
        sets: Array.from({ length: setCount }, (_, i) => {
          const sc = ex.setConfigs?.[i];
          return {
            setNumber: i + 1,
            weight: sc?.weightKg != null ? String(sc.weightKg) : "",
            reps: sc?.reps != null ? String(sc.reps) : String(ex.reps),
            completed: false,
            rpe: "",
            notes: "",
            prescribedReps: sc?.reps != null ? String(sc.reps) : String(ex.reps),
            prescribedWeightKg: sc?.weightKg != null ? String(sc.weightKg) : undefined,
            prescribedRest: sc?.restSeconds,
            intensifierType: sc?.intensifierType,
            intensifierValue: sc?.intensifierValue,
          };
        }),
      };
    }),
  );

  const updateSet = (exIdx: number, setIdx: number, key: keyof SetLog, value: string | boolean) => {
    setExerciseLogs((prev) => {
      const logs = [...prev];
      const sets = [...logs[exIdx].sets];
      sets[setIdx] = { ...sets[setIdx], [key]: value };
      logs[exIdx] = { ...logs[exIdx], sets };
      return logs;
    });
  };

  const toggleExpand = (exIdx: number) => {
    setExerciseLogs((prev) => prev.map((e, i) => i === exIdx ? { ...e, expanded: !e.expanded } : e));
  };

  const markSetDone = (exIdx: number, setIdx: number) => {
    const set = exerciseLogs[exIdx].sets[setIdx];
    const newCompleted = !set.completed;
    updateSet(exIdx, setIdx, "completed", newCompleted);
    // Start rest timer if prescribedRest is set and set just completed
    if (newCompleted && set.prescribedRest && set.prescribedRest > 0) {
      setActiveRestTimer({ exIdx, setIdx, seconds: set.prescribedRest });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await logWorkout({
        workoutId,
        scheduledWorkoutId,
        loggedDate: format(new Date(), "yyyy-MM-dd"),
        exercises: exerciseLogs.map((ex) => ({
          exerciseId: ex.exerciseId,
          exerciseName: ex.exerciseName,
          sets: ex.sets.map((s) => ({
            setNumber: s.setNumber,
            weight: s.weight.trim() ? Number(s.weight) : undefined,
            reps: s.reps.trim() ? Number(s.reps) : undefined,
            completed: s.completed,
            rpe: s.rpe.trim() ? Number(s.rpe) : undefined,
            notes: s.notes.trim() || undefined,
          })),
        })),
        notes: notes.trim() || undefined,
        durationMinutes: duration.trim() ? Number(duration) : undefined,
      });
      toast.success("Workout logged!");
      onClose();
    } catch { toast.error("Failed to log workout"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      {/* Rest timer overlay */}
      {activeRestTimer && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
          <p className="text-xs text-muted-foreground mb-1">Rest Timer — Set {activeRestTimer.setIdx + 1}</p>
          <RestTimer
            seconds={activeRestTimer.seconds}
            onDone={() => setActiveRestTimer(null)}
          />
        </div>
      )}

      {exerciseLogs.map((ex, exIdx) => (
        <div key={exIdx} className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleExpand(exIdx)}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
          >
            <p className="font-semibold text-sm">{ex.exerciseName}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {ex.sets.filter(s => s.completed).length}/{ex.sets.length} done
              </span>
              {ex.expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>
          {ex.expanded && (
            <div className="px-3 py-2 space-y-2">
              {/* Header */}
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_1.5rem] gap-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                <span>Set</span>
                <span>Prescribed</span>
                <span>Weight</span>
                <span>Reps</span>
                <span>RPE</span>
                <span className="text-center">✓</span>
              </div>
              {ex.sets.map((s, setIdx) => (
                <div key={setIdx} className={cn(
                  "rounded-md transition-colors",
                  s.completed ? "bg-green-500/5 border border-green-500/20" : "bg-muted/10"
                )}>
                  <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_1.5rem] gap-1 items-center px-1 py-1">
                    <span className="text-xs text-muted-foreground text-center font-bold">{s.setNumber}</span>
                    {/* Prescribed */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {s.prescribedReps ?? "—"} reps
                        {s.prescribedWeightKg ? ` @ ${s.prescribedWeightKg}kg` : ""}
                      </span>
                      {s.intensifierType && (
                        <SetIntensifierChip sc={s} />
                      )}
                    </div>
                    <Input
                      type="number" min={0} placeholder="kg"
                      value={s.weight}
                      onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)}
                      className="h-7 text-xs"
                    />
                    <Input
                      type="number" min={0} placeholder="reps"
                      value={s.reps}
                      onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                      className="h-7 text-xs"
                    />
                    <Input
                      type="number" min={1} max={10} placeholder="RPE"
                      value={s.rpe}
                      onChange={(e) => updateSet(exIdx, setIdx, "rpe", e.target.value)}
                      className="h-7 text-xs"
                    />
                    <button
                      onClick={() => markSetDone(exIdx, setIdx)}
                      className={cn(
                        "h-7 w-7 mx-auto rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors",
                        s.completed ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground/40 hover:border-green-500"
                      )}
                    >
                      {s.completed && <CheckCircle className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Rest timer badge */}
                  {s.prescribedRest && s.completed && (
                    <div className="px-2 pb-1">
                      <button
                        onClick={() => setActiveRestTimer({ exIdx, setIdx, seconds: s.prescribedRest! })}
                        className="flex items-center gap-1 text-[10px] text-primary hover:underline cursor-pointer"
                      >
                        <Timer className="w-3 h-3" />Restart {s.prescribedRest}s rest
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Duration (min)</Label>
          <Input type="number" min={0} placeholder="e.g. 45" value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 text-sm" />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Session Notes</Label>
        <Input placeholder="How did it feel?" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-sm" />
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" onClick={onClose} className="cursor-pointer flex-1">Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="flex-1 cursor-pointer">
          {saving ? "Saving…" : "Log Workout"}
        </Button>
      </div>
    </div>
  );
}

// ─── Delete Confirm Dialog ─────────────────────────────────────────────────

function DeleteConfirmDialog({
  workoutId,
  workoutName,
  programId,
  open,
  onOpenChange,
}: {
  workoutId: Id<"workouts">;
  workoutName: string;
  programId: Id<"programs">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const removeWorkout = useMutation(api.workouts.remove);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await removeWorkout({ id: workoutId });
      toast.success("Workout deleted");
      navigate(`/programs/${programId}`);
    } catch { toast.error("Failed to delete workout"); setDeleting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Workout</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{workoutName}</strong>? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="cursor-pointer flex-1">
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Exercise Card ─────────────────────────────────────────────────────────

function ExerciseCard({ ex, index }: { ex: ExerciseWithDetails & {
  exerciseMuscleGroup?: string;
  isDropSet?: boolean;
  tempo?: string;
  suggestedWeightKg?: number;
  rpe?: number;
  supersetWith?: Id<"exercises">;
  supersetName?: string;
  notes?: string;
}; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasSetConfigs = ex.setConfigs && ex.setConfigs.length > 0;

  const estimatedSecs = estimateExerciseDurationSeconds(ex);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/20">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold">{index + 1}. {ex.exerciseName}</p>
            {ex.exerciseMuscleGroup && (
              <Badge variant="secondary" className="text-[10px]">{ex.exerciseMuscleGroup}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            {!hasSetConfigs && <IntensifierChips ex={ex} />}
            {hasSetConfigs && (
              <p className="text-xs text-muted-foreground">
                {ex.setConfigs!.length} sets · tap to view per-set detail
              </p>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />{formatDuration(estimatedSecs)}
            </span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
      </button>

      {!expanded && !hasSetConfigs && (
        <div className="grid grid-cols-3 gap-3 text-center px-4 pb-4">
          <div className="bg-muted/40 rounded-lg py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sets</p>
            <p className="font-bold text-lg">{ex.sets}</p>
          </div>
          <div className="bg-muted/40 rounded-lg py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Reps</p>
            <p className="font-bold text-lg">{ex.reps}</p>
          </div>
          <div className="bg-muted/40 rounded-lg py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rest</p>
            <p className="font-bold text-lg flex items-center justify-center gap-1">
              {/* legacy restSeconds not on ExerciseWithDetails type - handled by setConfigs */}
              <span className="text-xs font-normal text-muted-foreground">see sets</span>
            </p>
          </div>
        </div>
      )}

      {expanded && hasSetConfigs && (
        <div className="px-4 pb-4 space-y-2">
          <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
            <span>Set</span><span>Reps</span><span>Weight</span><span>Rest</span>
          </div>
          {ex.setConfigs!.map((sc, i) => (
            <div key={i} className="border border-border/50 rounded-md overflow-hidden">
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 items-center px-3 py-2 bg-muted/30">
                <span className="text-xs font-bold text-primary">{sc.setNumber}</span>
                <span className="text-sm">{sc.reps ?? "—"}</span>
                <span className="text-sm">{sc.weightKg != null ? `${sc.weightKg}kg` : "—"}</span>
                <span className="text-sm">{sc.restSeconds != null ? `${sc.restSeconds}s` : "—"}</span>
              </div>
              {(sc.intensifierType || (sc.dropSubSets && sc.dropSubSets.length > 0)) && (
                <div className="px-3 py-2 space-y-2 bg-primary/5 border-t border-border/30">
                  {sc.intensifierType && (
                    <SetIntensifierChip sc={sc} />
                  )}
                  {sc.dropSubSets && sc.dropSubSets.length > 0 && (
                    <div className="space-y-1">
                      {sc.dropSubSets.map((ds, di) => (
                        <div key={di} className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 rounded px-2 py-1">
                          <span className="text-primary font-medium">Drop {ds.subSetNumber}</span>
                          <span>{ds.weightKg != null ? `${ds.weightKg}kg` : ""}</span>
                          <span>×</span>
                          <span>{ds.reps ?? "?"} reps</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ex.notes && (
        <p className="mx-4 mb-4 text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
          {ex.notes}
        </p>
      )}
    </div>
  );
}

// ─── Main Content ──────────────────────────────────────────────────────────

function WorkoutDetailContent({ workoutId }: { workoutId: Id<"workouts"> }) {
  const navigate = useNavigate();
  const workout = useQuery(api.workouts.get, { id: workoutId });
  const currentUser = useQuery(api.users.getCurrentUser);
  const duplicateWorkout = useMutation(api.workouts.duplicate);
  const [showLogForm, setShowLogForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  if (workout === undefined || currentUser === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isCoach = currentUser?.effectiveRoles?.some(r => ["coach", "admin", "owner"].includes(r)) ?? false;
  const isClient = !isCoach;

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const newId = await duplicateWorkout({ id: workoutId });
      toast.success("Workout duplicated!");
      navigate(`/workouts/${newId}`);
    } catch { toast.error("Failed to duplicate workout"); }
    finally { setDuplicating(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/programs/${workout.programId}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{workout.name}</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-muted-foreground text-sm">Week {workout.week} · Day {workout.day}</p>
            <span className="flex items-center gap-1 text-sm font-semibold text-primary">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(estimateWorkoutDurationSeconds(workout.exercises))}
            </span>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex gap-2 flex-wrap">
        {isClient && (
          <Button onClick={() => setShowLogForm(true)} className="cursor-pointer flex-1 sm:flex-none">
            <Plus className="w-4 h-4 mr-1" />Log Performance
          </Button>
        )}
        {isCoach && (
          <>
            <Button variant="secondary" asChild className="cursor-pointer">
              <Link to={`/workouts/${workoutId}/edit`}>
                <Edit className="w-4 h-4 mr-1.5" />Edit
              </Link>
            </Button>
            <Button variant="secondary" onClick={handleDuplicate} disabled={duplicating} className="cursor-pointer">
              <Copy className="w-4 h-4 mr-1.5" />{duplicating ? "Copying…" : "Duplicate"}
            </Button>
            <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} className="cursor-pointer">
              <Trash2 className="w-4 h-4 mr-1.5" />Delete
            </Button>
          </>
        )}
      </div>

      {/* Exercises */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">{workout.exercises.length} Exercises</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workout.exercisesWithDetails.map((ex, index) => (
            <ExerciseCard key={index} ex={ex} index={index} />
          ))}
        </CardContent>
      </Card>

      {/* Log Performance Dialog */}
      <Dialog open={showLogForm} onOpenChange={setShowLogForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />Log Performance
            </DialogTitle>
            <DialogDescription>{workout.name} — {format(new Date(), "EEEE, MMMM d")}</DialogDescription>
          </DialogHeader>
          <PerformanceLogForm
            workoutId={workoutId}
            exercisesWithDetails={workout.exercisesWithDetails}
            onClose={() => setShowLogForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <DeleteConfirmDialog
        workoutId={workoutId}
        workoutName={workout.name}
        programId={workout.programId}
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      />

      <Button variant="secondary" asChild className="cursor-pointer w-full">
        <Link to={`/programs/${workout.programId}`}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Program
        </Link>
      </Button>
    </motion.div>
  );
}

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        {id && <WorkoutDetailContent workoutId={id as Id<"workouts">} />}
      </div>
    </Authenticated>
  );
}
