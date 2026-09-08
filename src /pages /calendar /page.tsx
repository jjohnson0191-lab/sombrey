import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import {
  ChevronLeft, ChevronRight, Dumbbell, Calendar, Utensils,
  CheckCircle, X, SkipForward, Clock, Play, ChevronDown, ChevronUp,
  RotateCcw, Timer, Activity, Footprints, Zap, Link as LinkIcon, AlertCircle,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isToday,
  addMonths, subMonths,
} from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { motion, AnimatePresence } from "motion/react";
import CoachCalendar from "@/pages/coach/_components/coach-calendar.tsx";
import NutritionCalendar from "@/pages/calendar/_components/nutrition-calendar.tsx";
import {
  estimateWorkoutDurationSeconds,
  estimateExerciseDurationSeconds,
  formatDuration,
} from "@/lib/workout-duration.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

type ClientWorkoutEntry = NonNullable<ReturnType<typeof useQuery<typeof api.calendar.getClientCalendar>>>[number];
type ClientCardioEntry = NonNullable<ReturnType<typeof useQuery<typeof api.activities.cardio.getClientCardioCalendar>>>[number];
type ClientStepEntry = NonNullable<ReturnType<typeof useQuery<typeof api.activities.steps.getClientStepGoalCalendar>>>[number];

type UnifiedEntry =
  | ({ activityType: "weight_training" } & ClientWorkoutEntry)
  | ({ activityType: "cardio" } & ClientCardioEntry)
  | ({ activityType: "step_goal" } & ClientStepEntry);

// Extended exercise type
type CalendarExercise = {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  exerciseDescription?: string;
  exerciseMuscleGroup?: string;
  exerciseEquipment?: string;
  exerciseVideoUrl?: string;
  sets: number;
  reps: number | string;
  restSeconds: number;
  tempo?: string;
  suggestedWeightKg?: number;
  rpe?: number;
  isDropSet?: boolean;
  supersetWith?: Id<"exercises">;
  supersetName?: string;
  notes?: string;
  setConfigs?: Array<{
    setNumber: number;
    reps?: number | string;
    weightKg?: number;
    restSeconds?: number;
    intensifierType?: string;
    intensifierValue?: string;
    supersetExerciseName?: string;
    dropSubSets?: Array<{ subSetNumber: number; weightKg?: number; reps?: number; restSeconds?: number }>;
  }>;
};

type SetLog = {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  rpe: string;
  notes: string;
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

// ─── Activity config ────────────────────────────────────────────────────────

const ACTIVITY_CONFIG = {
  weight_training: {
    icon: <Dumbbell className="w-3 h-3" />,
    label: "Weight Training",
    dot: "bg-primary",
  },
  cardio: {
    icon: <Activity className="w-3 h-3" />,
    label: "Cardio",
    dot: "bg-orange-500",
  },
  step_goal: {
    icon: <Footprints className="w-3 h-3" />,
    label: "Step Goal",
    dot: "bg-teal-400",
  },
};

const STATUS_COLORS = {
  scheduled: "bg-primary/20 text-primary border-primary/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  skipped: "bg-destructive/20 text-destructive border-destructive/30",
  rest: "bg-muted text-muted-foreground border-border",
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
    <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
      <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin shrink-0" />
      <span className="font-mono font-bold">{mins}:{String(secs).padStart(2, "0")} rest</span>
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${pct}%` }} />
      </div>
      <button onClick={onDone} className="text-muted-foreground hover:text-foreground cursor-pointer ml-1" title="Skip rest">
        <RotateCcw className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Small intensifier badge ────────────────────────────────────────────────

function IntensifierBadge({ type, value }: { type: string; value?: string }) {
  const map: Record<string, string> = {
    dropset: "Drop",
    superset: "SS",
    tempo: value ? `T:${value}` : "Tempo",
    rpe: value ? `RPE${value}` : "RPE",
    suggested_weight: value ? `${value}kg` : "Sug",
  };
  const label = map[type] ?? type;
  const colors: Record<string, string> = {
    dropset: "bg-orange-500/20 text-orange-400",
    superset: "bg-yellow-500/20 text-yellow-400",
    tempo: "bg-blue-500/20 text-blue-400",
    rpe: "bg-purple-500/20 text-purple-400",
    suggested_weight: "bg-green-500/20 text-green-400",
  };
  return (
    <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium", colors[type] ?? "bg-muted text-muted-foreground")}>
      {label}
    </span>
  );
}

// ─── Log Cardio Dialog ─────────────────────────────────────────────────────

function LogCardioDialog({
  entry, open, onOpenChange,
}: {
  entry: ClientCardioEntry; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const logCardio = useMutation(api.activities.cardio.logCardio);
  const [duration, setDuration] = useState(String(entry.targetDurationMinutes));
  const [distance, setDistance] = useState(entry.targetDistanceKm ? String(entry.targetDistanceKm) : "");
  const [pace, setPace] = useState(entry.targetPace ?? "");
  const [speed, setSpeed] = useState(entry.targetSpeed ? String(entry.targetSpeed) : "");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!duration) { toast.error("Duration is required"); return; }
    setSaving(true);
    try {
      await logCardio({
        scheduledCardioId: entry._id,
        actualDurationMinutes: Number(duration),
        actualDistanceKm: distance ? Number(distance) : undefined,
        actualPace: pace || undefined,
        actualSpeed: speed ? Number(speed) : undefined,
        caloriesBurned: calories ? Number(calories) : undefined,
        notes: notes || undefined,
      });
      toast.success("Cardio logged!");
      onOpenChange(false);
    } catch { toast.error("Failed to log cardio"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-400" />Log Cardio — {entry.cardioType}
          </DialogTitle>
          <DialogDescription>
            Target: {entry.targetDurationMinutes} min
            {entry.targetDistanceKm ? ` · ${entry.targetDistanceKm} km` : ""}
            {entry.intensity ? ` · ${entry.intensity} intensity` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Actual Duration (min) <span className="text-destructive">*</span></Label>
              <Input type="number" min={0} value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Distance (km)</Label>
              <Input type="number" min={0} step={0.1} placeholder="optional" value={distance} onChange={e => setDistance(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Pace</Label>
              <Input placeholder="e.g. 5:30 /km" value={pace} onChange={e => setPace(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Speed (km/h)</Label>
              <Input type="number" min={0} step={0.1} placeholder="optional" value={speed} onChange={e => setSpeed(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Calories Burned</Label>
            <Input type="number" min={0} placeholder="optional" value={calories} onChange={e => setCalories(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="resize-none text-sm" placeholder="How did it go?" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !duration} className="flex-1 cursor-pointer bg-orange-600 hover:bg-orange-700 text-white">
              {saving ? "Saving…" : "Log Cardio"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Log Steps Dialog ──────────────────────────────────────────────────────

function LogStepsDialog({
  entry, open, onOpenChange,
}: {
  entry: ClientStepEntry; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const logSteps = useMutation(api.activities.steps.logSteps);
  const [steps, setSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!steps) { toast.error("Step count is required"); return; }
    setSaving(true);
    try {
      await logSteps({
        scheduledStepGoalId: entry._id,
        actualSteps: Number(steps),
        notes: notes || undefined,
      });
      toast.success("Steps logged!");
      onOpenChange(false);
    } catch { toast.error("Failed to log steps"); }
    finally { setSaving(false); }
  };

  const completionPct = steps ? Math.min(100, Math.round((Number(steps) / entry.targetSteps) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Footprints className="w-4 h-4 text-teal-400" />Log Daily Steps
          </DialogTitle>
          <DialogDescription>
            Target: {entry.targetSteps.toLocaleString()} steps
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Actual Steps <span className="text-destructive">*</span></Label>
            <Input type="number" min={0} placeholder="e.g. 9500" value={steps} onChange={e => setSteps(e.target.value)} />
          </div>
          {steps && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{Number(steps).toLocaleString()} / {entry.targetSteps.toLocaleString()} steps</span>
                <span className={cn("font-bold", completionPct >= 100 ? "text-green-400" : "text-primary")}>{completionPct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", completionPct >= 100 ? "bg-green-500" : "bg-teal-500")}
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="resize-none text-sm" placeholder="Optional notes" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !steps} className="flex-1 cursor-pointer bg-teal-600 hover:bg-teal-700 text-white">
              {saving ? "Saving…" : "Log Steps"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Start Workout Dialog ──────────────────────────────────────────────────

function ExerciseDetailCard({ ex, exIdx, exLog, onUpdate, activeRest, setActiveRest, isCompleted }: {
  ex: CalendarExercise;
  exIdx: number;
  exLog: ExerciseLog;
  onUpdate: (exIdx: number, setIdx: number, key: keyof SetLog, value: string | boolean) => void;
  activeRest: { exIdx: number; setIdx: number; secs: number } | null;
  setActiveRest: (v: { exIdx: number; setIdx: number; secs: number } | null) => void;
  isCompleted: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showVideo, setShowVideo] = useState(false);

  const markSetDone = (setIdx: number) => {
    if (isCompleted) return;
    const s = exLog.sets[setIdx];
    const nowDone = !s.completed;
    onUpdate(exIdx, setIdx, "completed", nowDone);
    if (nowDone && s.prescribedRest && s.prescribedRest > 0) {
      setActiveRest({ exIdx, setIdx, secs: s.prescribedRest });
    }
  };

  const setCount = exLog.sets.length;
  const doneCount = exLog.sets.filter(s => s.completed).length;

  const intensifierColors: Record<string, string> = {
    dropset: "bg-orange-500/20 text-orange-400",
    superset: "bg-yellow-500/20 text-yellow-400",
    tempo: "bg-blue-500/20 text-blue-400",
    rpe: "bg-purple-500/20 text-purple-400",
    suggested_weight: "bg-green-500/20 text-green-400",
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Exercise header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-semibold text-sm">{exLog.exerciseName}</p>
              {ex.exerciseMuscleGroup && (
                <Badge variant="secondary" className="text-[10px] capitalize">{ex.exerciseMuscleGroup}</Badge>
              )}
              {ex.isDropSet && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">Drop Set</span>}
              {ex.supersetWith && <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">Superset</span>}
            </div>
            {ex.exerciseEquipment && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{ex.exerciseEquipment}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground font-medium">{doneCount}/{setCount}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 py-3 space-y-3">
          {/* Description / Instructions */}
          {ex.exerciseDescription && (
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-2.5 py-2 leading-relaxed">
              {ex.exerciseDescription}
            </p>
          )}

          {/* Superset pair info */}
          {ex.supersetWith && ex.supersetName && (
            <div className="flex items-center gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-md px-2.5 py-1.5">
              <LinkIcon className="w-3 h-3 text-yellow-400 shrink-0" />
              <span className="text-yellow-300">Superset with <strong>{ex.supersetName}</strong> — perform back-to-back before resting</span>
            </div>
          )}

          {/* Video button */}
          {ex.exerciseVideoUrl && (
            <div>
              {!showVideo ? (
                <button
                  onClick={() => setShowVideo(true)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
                >
                  <Play className="w-3 h-3" />Watch demonstration video
                </button>
              ) : (
                <div className="rounded-lg overflow-hidden border border-border">
                  <video
                    src={ex.exerciseVideoUrl}
                    controls
                    className="w-full max-h-48 object-contain bg-black"
                  />
                </div>
              )}
            </div>
          )}

          {/* Exercise-level global intensifiers */}
          {(ex.tempo || ex.suggestedWeightKg != null || ex.rpe != null) && (
            <div className="flex flex-wrap gap-1.5">
              {ex.tempo && <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-500/20 text-blue-400 border-blue-500/30">Tempo: {ex.tempo}</span>}
              {ex.suggestedWeightKg != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-green-500/20 text-green-400 border-green-500/30">{ex.suggestedWeightKg}kg suggested</span>}
              {ex.rpe != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-purple-500/20 text-purple-400 border-purple-500/30">RPE {ex.rpe}</span>}
            </div>
          )}

          {/* Coach notes for this exercise */}
          {ex.notes && (
            <p className="text-xs text-muted-foreground italic bg-muted/20 rounded px-2 py-1.5">
              Coach note: {ex.notes}
            </p>
          )}

          {/* Sets table header */}
          <div className={cn(
            "grid gap-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1",
            isCompleted
              ? "grid-cols-[2rem_1fr_1fr_1fr_1.5rem]"
              : "grid-cols-[2rem_1fr_1fr_1fr_1fr_1.5rem]"
          )}>
            <span>Set</span>
            <span>Prescribed</span>
            <span>{isCompleted ? "Weight" : "Weight"}</span>
            <span>{isCompleted ? "Reps" : "Reps"}</span>
            {!isCompleted && <span>RPE</span>}
            <span className="text-center">✓</span>
          </div>

          {exLog.sets.map((s, setIdx) => {
            const sc = ex.setConfigs?.[setIdx];
            return (
              <div key={setIdx} className={cn(
                "rounded-md overflow-hidden transition-colors",
                s.completed ? "bg-green-500/5 border border-green-500/20" : "border border-border/30"
              )}>
                <div className={cn(
                  "grid gap-1 items-center px-2 py-1.5",
                  isCompleted
                    ? "grid-cols-[2rem_1fr_1fr_1fr_1.5rem]"
                    : "grid-cols-[2rem_1fr_1fr_1fr_1fr_1.5rem]"
                )}>
                  <span className="text-xs font-bold text-primary text-center">{s.setNumber}</span>

                  {/* Prescribed column */}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {s.prescribedReps ?? "—"}r
                      {s.prescribedWeightKg ? ` @${s.prescribedWeightKg}kg` : ""}
                      {s.prescribedRest ? ` · ${s.prescribedRest}s` : ""}
                    </span>
                    {s.intensifierType && (
                      <span className={cn("text-[9px] px-1 py-0.5 rounded font-medium w-fit", intensifierColors[s.intensifierType] ?? "bg-muted text-muted-foreground")}>
                        {s.intensifierType === "dropset" ? "Drop" :
                         s.intensifierType === "superset" ? "SS" :
                         s.intensifierType === "tempo" ? (s.intensifierValue ? `T:${s.intensifierValue}` : "Tempo") :
                         s.intensifierType === "rpe" ? (s.intensifierValue ? `RPE${s.intensifierValue}` : "RPE") :
                         s.intensifierType === "suggested_weight" ? (s.intensifierValue ? `${s.intensifierValue}kg` : "Sug") :
                         s.intensifierType}
                      </span>
                    )}
                    {/* Superset partner name from setConfig */}
                    {sc?.supersetExerciseName && (
                      <span className="text-[9px] text-yellow-400 truncate">SS: {sc.supersetExerciseName}</span>
                    )}
                  </div>

                  {/* Actual weight input */}
                  {isCompleted ? (
                    <span className="text-xs font-medium">{s.weight || "—"}{s.weight ? "kg" : ""}</span>
                  ) : (
                    <Input
                      type="number" min={0} placeholder="kg"
                      value={s.weight}
                      onChange={(e) => onUpdate(exIdx, setIdx, "weight", e.target.value)}
                      className="h-7 text-xs px-1.5"
                    />
                  )}

                  {/* Actual reps input */}
                  {isCompleted ? (
                    <span className="text-xs font-medium">{s.reps || "—"}</span>
                  ) : (
                    <Input
                      type="number" min={0} placeholder="reps"
                      value={s.reps}
                      onChange={(e) => onUpdate(exIdx, setIdx, "reps", e.target.value)}
                      className="h-7 text-xs px-1.5"
                    />
                  )}

                  {/* RPE input */}
                  {!isCompleted && (
                    <Input
                      type="number" min={1} max={10} placeholder="RPE"
                      value={s.rpe}
                      onChange={(e) => onUpdate(exIdx, setIdx, "rpe", e.target.value)}
                      className="h-7 text-xs px-1.5"
                    />
                  )}

                  {/* Complete toggle */}
                  <button
                    disabled={isCompleted}
                    onClick={() => markSetDone(setIdx)}
                    className={cn(
                      "h-7 w-7 mx-auto rounded-full border-2 flex items-center justify-center transition-all",
                      s.completed
                        ? "bg-green-500 border-green-500 text-white scale-110"
                        : isCompleted
                        ? "border-muted/30 cursor-not-allowed opacity-50"
                        : "border-muted-foreground/40 hover:border-green-500 hover:scale-105 cursor-pointer"
                    )}
                  >
                    {s.completed && <CheckCircle className="w-4 h-4" />}
                  </button>
                </div>

                {/* Rest timer trigger */}
                {!isCompleted && s.completed && s.prescribedRest && s.prescribedRest > 0 && (
                  <button
                    onClick={() => setActiveRest({ exIdx, setIdx, secs: s.prescribedRest! })}
                    className="flex items-center gap-1 text-[10px] text-primary hover:underline cursor-pointer px-2 pb-1"
                  >
                    <Timer className="w-3 h-3" />Restart {s.prescribedRest}s rest
                  </button>
                )}

                {/* Drop substeps */}
                {sc?.dropSubSets && sc.dropSubSets.length > 0 && (
                  <div className="px-2 pb-2 space-y-1">
                    {sc.dropSubSets.map((ds, di) => (
                      <div key={di} className="flex items-center gap-2 text-xs text-muted-foreground bg-orange-500/5 rounded px-2 py-1">
                        <span className="text-orange-400 font-medium">Drop {ds.subSetNumber}</span>
                        {ds.weightKg != null && <span>{ds.weightKg}kg</span>}
                        <span>×</span>
                        <span>{ds.reps ?? "?"} reps</span>
                        {ds.restSeconds != null && <span>· {ds.restSeconds}s rest</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StartWorkoutDialog({
  entry, open, onOpenChange,
}: {
  entry: ClientWorkoutEntry; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const logWorkout = useMutation(api.performanceLogs.logPerformance);
  const markStatus = useMutation(api.calendar.markWorkoutStatus);
  const [saving, setSaving] = useState(false);
  const [sessionNotes, setSessionNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [activeRest, setActiveRest] = useState<{ exIdx: number; setIdx: number; secs: number } | null>(null);

  const isCompleted = entry.status === "completed";
  const exercisesWithDetails = (entry.workout?.exercisesWithDetails ?? []) as CalendarExercise[];

  // #18 — If the referenced workout document no longer exists (e.g., it was deleted
  // by the coach), show an explicit unavailable state rather than silently rendering
  // an empty workout.  The `entry.workout` field is null in this case because
  // `getClientCalendar` returns `workout: null` when ctx.db.get(row.workoutId) fails
  // to find the document.
  const workoutMissing = entry.workout === null;

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
            completed: isCompleted,
            rpe: "",
            notes: "",
            prescribedReps: sc?.reps != null ? String(sc.reps) : String(ex.reps),
            prescribedWeightKg: sc?.weightKg != null ? String(sc.weightKg) : ex.suggestedWeightKg != null ? String(ex.suggestedWeightKg) : undefined,
            prescribedRest: sc?.restSeconds ?? ex.restSeconds,
            intensifierType: sc?.intensifierType,
            intensifierValue: sc?.intensifierValue,
          };
        }),
      };
    }),
  );

  const totalSets = exerciseLogs.reduce((s, ex) => s + ex.sets.length, 0);
  const completedSets = exerciseLogs.reduce((s, ex) => s + ex.sets.filter(set => set.completed).length, 0);
  const progressPct = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;

  const updateSet = (exIdx: number, setIdx: number, key: keyof SetLog, value: string | boolean) => {
    if (isCompleted) return;
    setExerciseLogs((prev) => {
      const logs = [...prev];
      const sets = [...logs[exIdx].sets];
      sets[setIdx] = { ...sets[setIdx], [key]: value };
      logs[exIdx] = { ...logs[exIdx], sets };
      return logs;
    });
  };

  const onDoneCallback = useCallback(() => setActiveRest(null), []);

  const handleComplete = async () => {
    setSaving(true);
    try {
      await logWorkout({
        workoutId: entry.workoutId,
        scheduledWorkoutId: entry._id,
        loggedDate: entry.scheduledDate,
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
        notes: sessionNotes.trim() || undefined,
        durationMinutes: duration.trim() ? Number(duration) : undefined,
      });
      toast.success("Workout completed!");
      onOpenChange(false);
    } catch {
      toast.error("Failed to complete workout");
    } finally { setSaving(false); }
  };

  const handleSkip = async () => {
    try {
      await markStatus({ id: entry._id, status: "skipped" });
      toast.success("Workout skipped");
      onOpenChange(false);
    } catch { toast.error("Failed to update status"); }
  };

  const totalEstSecs = estimateWorkoutDurationSeconds(
    exercisesWithDetails.map(ex => ({
      sets: ex.setConfigs ? ex.setConfigs.length : ex.sets,
      reps: ex.reps,
      restSeconds: ex.restSeconds,
      isDropSet: ex.isDropSet,
      supersetWith: ex.supersetWith,
      setConfigs: ex.setConfigs,
    }))
  );

  const workoutNotes = entry.notes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {isCompleted
              ? <CheckCircle className="w-4 h-4 text-green-400" />
              : <Play className="w-4 h-4 text-primary" />
            }
            {entry.workoutName}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                <span>{format(new Date(entry.scheduledDate + "T00:00:00"), "EEEE, MMMM d")}</span>
                {!workoutMissing && totalEstSecs > 0 && (
                  <span className="flex items-center gap-1 text-primary font-medium text-xs">
                    <Clock className="w-3 h-3" />{formatDuration(totalEstSecs)} est.
                  </span>
                )}
                {!workoutMissing && <span className="text-xs text-muted-foreground">{exercisesWithDetails.length} exercises · {totalSets} sets total</span>}
              </span>
              {workoutNotes && (
                <span className="text-xs text-muted-foreground italic bg-muted/30 rounded px-2 py-1">
                  Coach: {workoutNotes}
                </span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Status badge for completed */}
        {isCompleted && (
          <div className="shrink-0">
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 w-fit">
              <CheckCircle className="w-3 h-3 mr-1" />Completed
            </Badge>
          </div>
        )}

        {/* Progress bar */}
        {!isCompleted && !workoutMissing && (
          <div className="shrink-0 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{completedSets}/{totalSets} sets completed</span>
              <span className="font-bold text-primary">{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Rest timer */}
        {activeRest && (
          <div className="shrink-0">
            <RestTimer key={`${activeRest.exIdx}-${activeRest.setIdx}`} seconds={activeRest.secs} onDone={onDoneCallback} />
          </div>
        )}

        {/* Exercise list */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
          {/* #18 — Show an explicit unavailable state when the workout document has
              been deleted so users never see an empty workout masquerading as valid. */}
          {workoutMissing ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <AlertCircle className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">Workout unavailable</p>
              <p className="text-xs text-muted-foreground/70 max-w-xs">
                The workout assigned to this session has been removed by your coach.
                Contact your coach to get a replacement scheduled.
              </p>
            </div>
          ) : (
            <>
              {exerciseLogs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No exercises in this workout.</p>
              )}
              {exerciseLogs.map((exLog, exIdx) => (
                <ExerciseDetailCard
                  key={exIdx}
                  ex={exercisesWithDetails[exIdx]}
                  exIdx={exIdx}
                  exLog={exLog}
                  onUpdate={updateSet}
                  activeRest={activeRest}
                  setActiveRest={setActiveRest}
                  isCompleted={isCompleted}
                />
              ))}

          {/* Duration + notes inputs — only show if not completed */}
          {!isCompleted && (
            <>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Duration (min)</Label>
                  <Input type="number" min={0} placeholder="e.g. 45" value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Session Notes</Label>
                <Input placeholder="How did it feel?" value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} className="h-8 text-sm" />
              </div>
            </>
          )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 flex gap-2 pt-3 border-t border-border">
          {isCompleted || workoutMissing ? (
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Close</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={handleSkip} className="cursor-pointer">
                <SkipForward className="w-4 h-4 mr-1" />Skip
              </Button>
              <Button onClick={handleComplete} disabled={saving} className="flex-1 cursor-pointer bg-green-600 hover:bg-green-700 text-white">
                <CheckCircle className="w-4 h-4 mr-2" />{saving ? "Saving…" : `Complete (${progressPct}%)`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Client Calendar ───────────────────────────────────────────────────────

function ClientCalendarContent() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedEntry, setSelectedEntry] = useState<UnifiedEntry | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const startDate = format(calStart, "yyyy-MM-dd");
  const endDate = format(calEnd, "yyyy-MM-dd");

  const workoutData = useQuery(api.calendar.getClientCalendar, { startDate, endDate });
  const cardioData = useQuery(api.activities.cardio.getClientCardioCalendar, { startDate, endDate });
  const stepData = useQuery(api.activities.steps.getClientStepGoalCalendar, { startDate, endDate });

  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const allEntriesByDate = useMemo(() => {
    const map: Record<string, UnifiedEntry[]> = {};
    const addEntry = (key: string, entry: UnifiedEntry) => {
      if (!map[key]) map[key] = [];
      map[key].push(entry);
    };
    for (const e of workoutData ?? []) addEntry(e.scheduledDate, { activityType: "weight_training", ...e });
    for (const e of cardioData ?? []) addEntry(e.scheduledDate, { activityType: "cardio", ...e });
    for (const e of stepData ?? []) addEntry(e.scheduledDate, { activityType: "step_goal", ...e });
    return map;
  }, [workoutData, cardioData, stepData]);

  const monthStart_str = format(monthStart, "yyyy-MM-dd");
  const monthEnd_str = format(monthEnd, "yyyy-MM-dd");
  const monthEntries = Object.values(allEntriesByDate).flat().filter(
    e => e.scheduledDate >= monthStart_str && e.scheduledDate <= monthEnd_str,
  );
  const completedCount = monthEntries.filter(e => e.status === "completed").length;
  const adherenceRate = monthEntries.length > 0 ? Math.round((completedCount / monthEntries.length) * 100) : 0;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayScheduled = allEntriesByDate[todayStr]?.filter(e => e.status === "scheduled") ?? [];

  const isLoading = workoutData === undefined || cardioData === undefined || stepData === undefined;

  const getEntryLabel = (e: UnifiedEntry) => {
    if (e.activityType === "weight_training") return e.workoutName;
    if (e.activityType === "cardio") return e.cardioType;
    return "Step Goal";
  };

  return (
    <div className="space-y-4">
      {/* Today's activities prompt */}
      {todayScheduled.length > 0 && (
        <div className="space-y-2">
          {todayScheduled.map(entry => {
            const cfg = ACTIVITY_CONFIG[entry.activityType];
            return (
              <motion.div
                key={entry._id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex items-center justify-between p-3 border rounded-xl",
                  entry.activityType === "cardio"
                    ? "bg-orange-500/10 border-orange-500/30"
                    : entry.activityType === "step_goal"
                    ? "bg-teal-500/10 border-teal-500/30"
                    : "bg-primary/10 border-primary/30",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {cfg.icon}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{getEntryLabel(entry)}</p>
                    <p className="text-xs text-muted-foreground">Today's {cfg.label}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setSelectedEntry(entry)}
                  className={cn("cursor-pointer shrink-0",
                    entry.activityType === "cardio" ? "bg-orange-600 hover:bg-orange-700 text-white" :
                    entry.activityType === "step_goal" ? "bg-teal-600 hover:bg-teal-700 text-white" : ""
                  )}
                >
                  <Play className="w-3.5 h-3.5 mr-1" />Start
                </Button>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-bold min-w-[160px] text-center">{format(currentMonth, "MMMM yyyy")}</h2>
          <Button size="icon" variant="ghost" onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Adherence</p>
          <p className="text-lg font-bold text-primary">{adherenceRate}%</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-2 flex-wrap text-xs">
        {(Object.entries(ACTIVITY_CONFIG) as Array<[keyof typeof ACTIVITY_CONFIG, typeof ACTIVITY_CONFIG[keyof typeof ACTIVITY_CONFIG]]>).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1 text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
            <span>{cfg.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 text-green-400"><div className="w-2 h-2 rounded-full bg-green-500" /><span>Completed</span></div>
        <div className="flex items-center gap-1 text-destructive"><div className="w-2 h-2 rounded-full bg-destructive" /><span>Skipped</span></div>
      </div>

      {/* Calendar grid */}
      <Card className="bg-card/50 border-border overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-2">{d}</div>
          ))}
        </div>
        {isLoading ? (
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-16 border-b border-r border-border/30"><Skeleton className="h-4 w-4 m-2 rounded" /></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEntries = allEntriesByDate[key] ?? [];
              const isCurrentMonth = isSameMonth(day, currentMonth);

              return (
                <button
                  key={key}
                  onClick={() => {
                    if (dayEntries.length === 0) return;
                    setSelectedEntry(dayEntries[0]);
                  }}
                  className={cn(
                    "min-h-[60px] p-1.5 border-b border-r border-border/30 text-left transition-colors",
                    !isCurrentMonth && "opacity-30",
                    dayEntries.length > 0 && "cursor-pointer hover:bg-muted/40",
                    isToday(day) && "bg-accent/5",
                  )}
                >
                  <p className={cn(
                    "text-xs font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full",
                    isToday(day) && "bg-primary text-primary-foreground",
                  )}>
                    {format(day, "d")}
                  </p>
                  {dayEntries.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                      {dayEntries.map((e, i) => {
                        const dotColor = e.status === "completed"
                          ? "bg-green-500"
                          : e.status === "skipped"
                          ? "bg-destructive"
                          : ACTIVITY_CONFIG[e.activityType].dot;
                        return <div key={i} className={cn("w-2 h-2 rounded-full", dotColor)} />;
                      })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Activity logging dialogs */}
      <AnimatePresence>
        {selectedEntry && selectedEntry.activityType === "weight_training" && (
          <StartWorkoutDialog
            entry={selectedEntry}
            open={!!selectedEntry}
            onOpenChange={v => { if (!v) setSelectedEntry(null); }}
          />
        )}
        {selectedEntry && selectedEntry.activityType === "cardio" && (
          selectedEntry.cardioLog ? (
            // Already logged — show summary dialog
            <Dialog open={true} onOpenChange={v => { if (!v) setSelectedEntry(null); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-orange-400" />{selectedEntry.cardioType}
                  </DialogTitle>
                  <DialogDescription>{format(new Date(selectedEntry.scheduledDate + "T00:00:00"), "EEEE, MMMM d")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-muted/40 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Duration</p>
                      <p className="font-bold">{selectedEntry.cardioLog.actualDurationMinutes} min</p>
                    </div>
                    {selectedEntry.cardioLog.actualDistanceKm && (
                      <div className="bg-muted/40 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">Distance</p>
                        <p className="font-bold">{selectedEntry.cardioLog.actualDistanceKm} km</p>
                      </div>
                    )}
                    {selectedEntry.cardioLog.caloriesBurned && (
                      <div className="bg-muted/40 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">Calories</p>
                        <p className="font-bold">{selectedEntry.cardioLog.caloriesBurned} kcal</p>
                      </div>
                    )}
                  </div>
                  {selectedEntry.cardioLog.notes && <p className="text-sm text-muted-foreground italic">{selectedEntry.cardioLog.notes}</p>}
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <LogCardioDialog
              entry={selectedEntry}
              open={!!selectedEntry}
              onOpenChange={v => { if (!v) setSelectedEntry(null); }}
            />
          )
        )}
        {selectedEntry && selectedEntry.activityType === "step_goal" && (
          selectedEntry.stepLog ? (
            // Already logged — show summary
            <Dialog open={true} onOpenChange={v => { if (!v) setSelectedEntry(null); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Footprints className="w-4 h-4 text-teal-400" />Step Goal
                  </DialogTitle>
                  <DialogDescription>{format(new Date(selectedEntry.scheduledDate + "T00:00:00"), "EEEE, MMMM d")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Logged</Badge>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{selectedEntry.stepLog.actualSteps.toLocaleString()} steps logged</span>
                      <span className="font-bold text-teal-400">{selectedEntry.completionPct ?? 0}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", (selectedEntry.completionPct ?? 0) >= 100 ? "bg-green-500" : "bg-teal-500")}
                        style={{ width: `${selectedEntry.completionPct ?? 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Target: {selectedEntry.targetSteps.toLocaleString()} steps</p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <LogStepsDialog
              entry={selectedEntry}
              open={!!selectedEntry}
              onOpenChange={v => { if (!v) setSelectedEntry(null); }}
            />
          )
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

function CalendarContent() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "nutrition" ? "nutrition" : "training";
  const currentUser = useQuery(api.users.getCurrentUser, {});
  // Owners and admins always use the personal calendar — even if they also hold
  // a "coach" role — because they manage clients via Management → Coaching Panel.
  // We check both effectiveRoles AND coachingType/legacy role field, because the
  // owner's `roles` array may only contain ["coach"] while the legacy `role`
  // field and `coachingType` correctly identify them as owner.
  const roles = currentUser?.effectiveRoles ?? [];
  const legacyRole = currentUser?.role as string | undefined;
  const coachingType = currentUser?.coachingType as string | undefined;
  const isOwnerOrAdmin =
    roles.some(r => (["owner", "admin"] as string[]).includes(r)) ||
    legacyRole === "owner" ||
    legacyRole === "admin" ||
    coachingType === "owner" ||
    coachingType === "admin";
  const isCoach = !isOwnerOrAdmin && roles.some(r => (["coach", "assistant_coach"] as string[]).includes(r));

  if (currentUser === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Calendar className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Training Calendar</h1>
          <p className="text-muted-foreground text-sm">
            {isCoach ? "Schedule and track client activities" : "Your private training schedule"}
          </p>
        </div>
      </div>

      {isCoach ? <CoachCalendar /> : (
        <Tabs defaultValue={initialTab}>
          <TabsList className="w-full mb-4">
            <TabsTrigger value="training" className="flex-1 cursor-pointer flex items-center gap-1.5">
              <Dumbbell className="w-3.5 h-3.5" />Training
            </TabsTrigger>
            <TabsTrigger value="nutrition" className="flex-1 cursor-pointer flex items-center gap-1.5">
              <Utensils className="w-3.5 h-3.5" />Nutrition
            </TabsTrigger>
          </TabsList>
          <TabsContent value="training">
            <ClientCalendarContent />
          </TabsContent>
          <TabsContent value="nutrition">
            <NutritionCalendar />
          </TabsContent>
        </Tabs>
      )}
    </motion.div>
  );
}

export default function CalendarPage() {
  return (
    <Authenticated>
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">
        <CalendarContent />
      </div>
    </Authenticated>
  );
}
