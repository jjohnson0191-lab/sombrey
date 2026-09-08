/**
 * CalendarWorkoutEditorDialog
 *
 * Full workout editor opened directly from the coach calendar.
 * Reuses:
 *   - backendExerciseToEntry (exercise-entry-utils) to hydrate form state
 *   - api.workouts.update mutation to save
 *   - All per-set / intensifier editing UI (SetConfigRow) identical to workout-builder-form
 *
 * Permissions: coach/admin only (same guard as workouts.update backend mutation).
 */

import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  Plus, Trash2, Search, Dumbbell, Zap, Weight, Timer, Activity,
  Link as LinkIcon, Copy, Settings2, X, Clock, Edit,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { backendExerciseToEntry } from "@/pages/programs/[id]/workouts/_components/exercise-entry-utils.ts";
import {
  estimateExerciseDurationSeconds,
  estimateWorkoutDurationSeconds,
  formatDuration,
} from "@/lib/workout-duration.ts";

// ─── Types (mirrors workout-builder-form.tsx exactly) ───────────────────────

type IntensifierType = "superset" | "dropset" | "tempo" | "rpe" | "suggested_weight";

type DropSubSet = {
  subSetNumber: number;
  weightKg: string;
  reps: string;
  restSeconds: string;
};

type SetConfig = {
  setNumber: number;
  reps: string;
  weightKg: string;
  restSeconds: string;
  intensifierType: IntensifierType | "";
  intensifierValue: string;
  supersetExerciseId: Id<"exercises"> | "";
  dropSubSets: DropSubSet[];
  notes: string;
  showDetails: boolean;
};

type ExerciseEntry = {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
  isDropSet: boolean;
  tempo: string;
  suggestedWeightKg: string;
  rpe: string;
  supersetWith: Id<"exercises"> | "";
  supersetName: string;
  setConfigs: SetConfig[];
  showExerciseSettings: boolean;
  useSetLevel: boolean;
};

type WorkoutEntry = {
  _id: Id<"scheduledWorkouts">;
  workoutId: Id<"workouts">;
  scheduledDate: string;
  label: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INTENSIFIER_OPTIONS: { value: IntensifierType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "suggested_weight", label: "Suggested Weight", icon: <Weight className="w-3 h-3" />, color: "bg-green-500/20 text-green-400" },
  { value: "rpe", label: "RPE", icon: <Activity className="w-3 h-3" />, color: "bg-purple-500/20 text-purple-400" },
  { value: "tempo", label: "Tempo", icon: <Timer className="w-3 h-3" />, color: "bg-blue-500/20 text-blue-400" },
  { value: "dropset", label: "Drop Set", icon: <Copy className="w-3 h-3" />, color: "bg-primary/15 text-primary" },
  { value: "superset", label: "Superset", icon: <LinkIcon className="w-3 h-3" />, color: "bg-yellow-500/20 text-yellow-400" },
];

const newSetConfig = (setNumber: number): SetConfig => ({
  setNumber,
  reps: "10",
  weightKg: "",
  restSeconds: "60",
  intensifierType: "",
  intensifierValue: "",
  supersetExerciseId: "",
  dropSubSets: [],
  notes: "",
  showDetails: false,
});

const EMPTY_ENTRY = (): ExerciseEntry => ({
  exerciseId: "" as Id<"exercises">,
  exerciseName: "",
  sets: 3,
  reps: "10",
  restSeconds: 60,
  notes: "",
  isDropSet: false,
  tempo: "",
  suggestedWeightKg: "",
  rpe: "",
  supersetWith: "",
  supersetName: "",
  setConfigs: [newSetConfig(1), newSetConfig(2), newSetConfig(3)],
  showExerciseSettings: false,
  useSetLevel: true,
});

// ─── SetConfigRow ─────────────────────────────────────────────────────────────
// Identical to the component in workout-builder-form.tsx

function SetConfigRow({
  sc,
  index,
  allExercises,
  onUpdate,
  onRemove,
}: {
  sc: SetConfig;
  index: number;
  allExercises: Array<{ _id: Id<"exercises">; name: string }>;
  onUpdate: (key: keyof SetConfig, value: SetConfig[keyof SetConfig]) => void;
  onRemove: () => void;
}) {
  const intensifierOpt = INTENSIFIER_OPTIONS.find(o => o.value === sc.intensifierType);

  const addDropSubSet = () => {
    const updated: DropSubSet[] = [
      ...sc.dropSubSets,
      { subSetNumber: sc.dropSubSets.length + 1, weightKg: "", reps: "", restSeconds: "" },
    ];
    onUpdate("dropSubSets", updated);
  };

  const updateDropSubSet = (i: number, key: keyof DropSubSet, val: string) => {
    const updated = sc.dropSubSets.map((ds, di) => di === i ? { ...ds, [key]: val } : ds);
    onUpdate("dropSubSets", updated);
  };

  const removeDropSubSet = (i: number) => {
    const updated = sc.dropSubSets
      .filter((_, di) => di !== i)
      .map((ds, di) => ({ ...ds, subSetNumber: di + 1 }));
    onUpdate("dropSubSets", updated);
  };

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      {/* Set header row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <span className="text-xs font-bold text-primary w-12 shrink-0">Set {sc.setNumber}</span>
        <div className="flex-1 min-w-0">
          <Input
            type="text" placeholder="Reps"
            value={sc.reps}
            onChange={(e) => onUpdate("reps", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Input
            type="number" min={0} step={0.5} placeholder="kg"
            value={sc.weightKg}
            onChange={(e) => onUpdate("weightKg", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Input
            type="number" min={0} placeholder="rest s"
            value={sc.restSeconds}
            onChange={(e) => onUpdate("restSeconds", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <button
          onClick={() => onUpdate("showDetails", !sc.showDetails)}
          className={cn(
            "h-7 w-7 flex items-center justify-center rounded-md border transition-colors cursor-pointer shrink-0",
            sc.intensifierType
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 hover:border-primary/40 text-muted-foreground"
          )}
          title="Set intensifier / details"
        >
          <Zap className="w-3 h-3" />
        </button>
        <button
          onClick={onRemove}
          className="h-7 w-7 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
          title="Remove set"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Expanded intensifier/details panel */}
      {sc.showDetails && (
        <div className="px-3 py-3 space-y-3 border-t border-border/40 bg-primary/5">
          {/* Intensifier selector */}
          <div className="space-y-1">
            <Label className="text-[11px]">Intensifier (optional)</Label>
            <div className="flex flex-wrap gap-1.5">
              {INTENSIFIER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onUpdate("intensifierType", sc.intensifierType === opt.value ? "" : opt.value as IntensifierType)}
                  className={cn(
                    "flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border font-medium transition-colors cursor-pointer",
                    sc.intensifierType === opt.value
                      ? opt.color + " border-current"
                      : "bg-muted/40 text-muted-foreground border-border/60 hover:border-primary/40"
                  )}
                >
                  {opt.icon}{opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Intensifier value */}
          {sc.intensifierType && sc.intensifierType !== "dropset" && sc.intensifierType !== "superset" && (
            <div className="space-y-1">
              <Label className="text-[11px]">
                {sc.intensifierType === "rpe" && "RPE (1–10)"}
                {sc.intensifierType === "tempo" && "Tempo (e.g. 3-1-2-0)"}
                {sc.intensifierType === "suggested_weight" && "Suggested Weight (kg)"}
              </Label>
              <Input
                type={sc.intensifierType === "tempo" ? "text" : "number"}
                min={sc.intensifierType === "rpe" ? 1 : 0}
                max={sc.intensifierType === "rpe" ? 10 : undefined}
                step={0.5}
                placeholder={
                  sc.intensifierType === "rpe" ? "e.g. 8" :
                  sc.intensifierType === "tempo" ? "e.g. 3-1-2-0" : "e.g. 60"
                }
                value={sc.intensifierValue}
                onChange={(e) => onUpdate("intensifierValue", e.target.value)}
                className={cn("h-7 text-xs", sc.intensifierType === "tempo" && "font-mono")}
              />
            </div>
          )}

          {/* Superset exercise selector */}
          {sc.intensifierType === "superset" && (
            <div className="space-y-1">
              <Label className="text-[11px] flex items-center gap-1"><LinkIcon className="w-3 h-3" />Superset With</Label>
              <Select
                value={sc.supersetExerciseId || "none"}
                onValueChange={(v) => onUpdate("supersetExerciseId", v === "none" ? "" : v as Id<"exercises">)}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select exercise" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {allExercises.map((e) => (
                    <SelectItem key={e._id} value={e._id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Drop sub-sets */}
          {sc.intensifierType === "dropset" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] flex items-center gap-1"><Copy className="w-3 h-3" />Drop Sub-Sets</Label>
                <Button size="sm" variant="ghost" onClick={addDropSubSet} className="h-6 text-[11px] cursor-pointer px-2">
                  <Plus className="w-3 h-3 mr-1" />Add Drop
                </Button>
              </div>
              {sc.dropSubSets.map((ds, di) => (
                <div key={di} className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-md px-2 py-1.5">
                  <span className="text-[11px] text-muted-foreground w-14 shrink-0">Drop {ds.subSetNumber}</span>
                  <Input type="number" min={0} step={0.5} placeholder="kg"
                    value={ds.weightKg} onChange={(e) => updateDropSubSet(di, "weightKg", e.target.value)}
                    className="h-6 text-xs flex-1" />
                  <Input type="number" min={0} placeholder="reps"
                    value={ds.reps} onChange={(e) => updateDropSubSet(di, "reps", e.target.value)}
                    className="h-6 text-xs flex-1" />
                  <button onClick={() => removeDropSubSet(di)} className="text-destructive hover:text-destructive/80 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {sc.dropSubSets.length === 0 && (
                <p className="text-[11px] text-muted-foreground">Click "Add Drop" to add sub-sets.</p>
              )}
            </div>
          )}

          {/* Per-set notes */}
          <div className="space-y-1">
            <Label className="text-[11px]">Set Notes (optional)</Label>
            <Input
              placeholder="e.g. Slow eccentric, pause at bottom…"
              value={sc.notes}
              onChange={(e) => onUpdate("notes", e.target.value)}
              className="h-7 text-xs"
            />
          </div>

          {intensifierOpt && (
            <div className={cn("flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full w-fit", intensifierOpt.color)}>
              {intensifierOpt.icon}
              <span>{intensifierOpt.label}{sc.intensifierValue ? `: ${sc.intensifierValue}` : ""}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Payload builders (mirrors workout-builder-form.tsx) ─────────────────────

function buildSetConfigPayload(sc: SetConfig) {
  return {
    setNumber: sc.setNumber,
    reps: sc.reps.trim() ? (isNaN(Number(sc.reps)) ? sc.reps : Number(sc.reps)) : undefined,
    weightKg: sc.weightKg.trim() ? Number(sc.weightKg) : undefined,
    restSeconds: sc.restSeconds.trim() ? Number(sc.restSeconds) : undefined,
    intensifierType: sc.intensifierType || undefined,
    intensifierValue: sc.intensifierValue.trim() || undefined,
    dropSubSets: sc.dropSubSets.length > 0
      ? sc.dropSubSets.map((ds) => ({
          subSetNumber: ds.subSetNumber,
          weightKg: ds.weightKg.trim() ? Number(ds.weightKg) : undefined,
          reps: ds.reps.trim() ? Number(ds.reps) : undefined,
          restSeconds: ds.restSeconds.trim() ? Number(ds.restSeconds) : undefined,
        }))
      : undefined,
    supersetExerciseId: sc.supersetExerciseId || undefined,
    notes: sc.notes.trim() || undefined,
  };
}

function buildExercisePayload(e: ExerciseEntry) {
  return {
    exerciseId: e.exerciseId,
    sets: e.setConfigs.length || e.sets,
    reps: isNaN(Number(e.reps)) ? e.reps : Number(e.reps),
    restSeconds: e.restSeconds,
    notes: e.notes.trim() || undefined,
    isDropSet: e.isDropSet || undefined,
    tempo: e.tempo.trim() || undefined,
    suggestedWeightKg: e.suggestedWeightKg.trim() ? Number(e.suggestedWeightKg) : undefined,
    rpe: e.rpe.trim() ? Number(e.rpe) : undefined,
    supersetWith: e.supersetWith ? e.supersetWith : undefined,
    setConfigs: e.useSetLevel && e.setConfigs.length > 0
      ? e.setConfigs.map(buildSetConfigPayload)
      : undefined,
  };
}

// ─── Inner editor (rendered once workout data is loaded) ─────────────────────

function WorkoutEditorInner({
  workoutId,
  scheduledDate,
  initialName,
  initialExercises,
  onSave,
  onCancel,
}: {
  workoutId: Id<"workouts">;
  scheduledDate: string;
  initialName: string;
  initialExercises: ExerciseEntry[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const updateWorkout = useMutation(api.workouts.update);
  const exercises = useQuery(api.exercises.list, {});

  const [name, setName] = useState(initialName);
  const [exerciseEntries, setExerciseEntries] = useState<ExerciseEntry[]>(initialExercises);
  const [saving, setSaving] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [showExercisePicker, setShowExercisePicker] = useState(false);

  const filteredExercises = (exercises ?? []).filter((e) =>
    e.name.toLowerCase().includes(exerciseSearch.toLowerCase()),
  );

  const addExercise = (ex: { _id: Id<"exercises">; name: string }) => {
    setExerciseEntries((prev) => [...prev, { ...EMPTY_ENTRY(), exerciseId: ex._id, exerciseName: ex.name }]);
    setShowExercisePicker(false);
    setExerciseSearch("");
  };

  const removeExercise = (index: number) => {
    setExerciseEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const updateEntry = <K extends keyof ExerciseEntry>(index: number, key: K, value: ExerciseEntry[K]) => {
    setExerciseEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [key]: value } : e)));
  };

  const addSetToExercise = (exIndex: number) => {
    setExerciseEntries((prev) => prev.map((e, i) => {
      if (i !== exIndex) return e;
      const nextNum = e.setConfigs.length + 1;
      return { ...e, setConfigs: [...e.setConfigs, newSetConfig(nextNum)], sets: nextNum };
    }));
  };

  const removeSetFromExercise = (exIndex: number, setIndex: number) => {
    setExerciseEntries((prev) => prev.map((e, i) => {
      if (i !== exIndex) return e;
      const updated = e.setConfigs
        .filter((_, si) => si !== setIndex)
        .map((sc, si) => ({ ...sc, setNumber: si + 1 }));
      return { ...e, setConfigs: updated, sets: Math.max(updated.length, 1) };
    }));
  };

  const updateSetConfig = (exIndex: number, setIndex: number, key: keyof SetConfig, value: SetConfig[keyof SetConfig]) => {
    setExerciseEntries((prev) => prev.map((e, i) => {
      if (i !== exIndex) return e;
      const setConfigs = e.setConfigs.map((sc, si) => si === setIndex ? { ...sc, [key]: value } : sc);
      return { ...e, setConfigs };
    }));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Workout name is required"); return; }
    if (exerciseEntries.length === 0) { toast.error("Add at least one exercise"); return; }
    setSaving(true);
    try {
      await updateWorkout({
        id: workoutId,
        name: name.trim(),
        exercises: exerciseEntries.map(buildExercisePayload),
      });
      toast.success("Workout saved!");
      onSave();
    } catch {
      toast.error("Failed to save workout");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Workout name */}
      <div className="space-y-1.5">
        <Label>Workout Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Push Day A"
        />
      </div>

      {/* Exercises section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-semibold">Exercises ({exerciseEntries.length})</Label>
            {exerciseEntries.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs font-semibold text-primary">
                <Clock className="w-3 h-3" />
                {formatDuration(estimateWorkoutDurationSeconds(exerciseEntries.map(e => ({
                  sets: e.setConfigs.length || e.sets,
                  reps: e.reps,
                  restSeconds: e.restSeconds,
                  isDropSet: e.isDropSet,
                  supersetWith: e.supersetWith || undefined,
                  setConfigs: e.setConfigs.map(sc => ({
                    reps: sc.reps,
                    weightKg: sc.weightKg ? Number(sc.weightKg) : undefined,
                    restSeconds: sc.restSeconds ? Number(sc.restSeconds) : undefined,
                    intensifierType: sc.intensifierType || undefined,
                    intensifierValue: sc.intensifierValue || undefined,
                    dropSubSets: sc.dropSubSets.map(ds => ({
                      subSetNumber: ds.subSetNumber,
                      reps: ds.reps ? Number(ds.reps) : undefined,
                      restSeconds: ds.restSeconds ? Number(ds.restSeconds) : undefined,
                    })),
                  })),
                }))))}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => setShowExercisePicker(true)} className="cursor-pointer">
            <Plus className="w-4 h-4 mr-1" />Add Exercise
          </Button>
        </div>

        {/* Exercise picker */}
        {showExercisePicker && (
          <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search exercises…"
                className="pl-9"
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {exercises === undefined ? (
                <p className="text-sm text-muted-foreground text-center py-2">Loading…</p>
              ) : filteredExercises.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">No exercises found</p>
              ) : (
                filteredExercises.slice(0, 30).map((ex) => (
                  <button
                    key={ex._id}
                    onClick={() => addExercise(ex)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-primary/10 text-sm flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <Dumbbell className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{ex.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{ex.muscleGroup}</Badge>
                  </button>
                ))
              )}
            </div>
            <Button
              variant="ghost" size="sm"
              onClick={() => { setShowExercisePicker(false); setExerciseSearch(""); }}
              className="w-full cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Empty state */}
        {exerciseEntries.length === 0 && !showExercisePicker && (
          <div className="text-center py-6 text-muted-foreground border border-dashed border-border/50 rounded-lg">
            <Dumbbell className="w-7 h-7 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No exercises. Click "Add Exercise" above.</p>
          </div>
        )}

        {/* Exercise list */}
        {exerciseEntries.map((entry, exIndex) => {
          const hasIntensifiers = entry.setConfigs.some(sc => sc.intensifierType);
          const intensifierCount = entry.setConfigs.filter(sc => sc.intensifierType).length;
          const exEstSecs = estimateExerciseDurationSeconds({
            sets: entry.setConfigs.length || entry.sets,
            reps: entry.reps,
            restSeconds: entry.restSeconds,
            isDropSet: entry.isDropSet,
            supersetWith: entry.supersetWith || undefined,
            setConfigs: entry.setConfigs.map(sc => ({
              reps: sc.reps,
              weightKg: sc.weightKg ? Number(sc.weightKg) : undefined,
              restSeconds: sc.restSeconds ? Number(sc.restSeconds) : undefined,
              intensifierType: sc.intensifierType || undefined,
              intensifierValue: sc.intensifierValue || undefined,
              dropSubSets: sc.dropSubSets.map(ds => ({
                subSetNumber: ds.subSetNumber,
                reps: ds.reps ? Number(ds.reps) : undefined,
                restSeconds: ds.restSeconds ? Number(ds.restSeconds) : undefined,
              })),
            })),
          });

          return (
            <div key={exIndex} className="border border-border rounded-xl overflow-hidden bg-muted/20">
              {/* Exercise header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-xs text-muted-foreground font-mono shrink-0">{exIndex + 1}</span>
                  <p className="font-semibold text-sm truncate">{entry.exerciseName}</p>
                  {hasIntensifiers && (
                    <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30 shrink-0">
                      {intensifierCount} set intensifier{intensifierCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0 ml-auto mr-1">
                    <Clock className="w-3 h-3" />{formatDuration(exEstSecs)}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => updateEntry(exIndex, "showExerciseSettings", !entry.showExerciseSettings)}
                    className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted cursor-pointer transition-colors text-muted-foreground"
                    title="Exercise notes"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeExercise(exIndex)}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
                    title="Remove exercise"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Exercise-level notes */}
              {entry.showExerciseSettings && (
                <div className="px-4 py-3 border-b border-border/40 bg-muted/10 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Exercise Notes (optional)</Label>
                    <Textarea
                      value={entry.notes}
                      onChange={(e) => updateEntry(exIndex, "notes", e.target.value)}
                      placeholder="Coaching cues, technique notes…"
                      rows={2}
                      className="text-sm resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Set-level rows */}
              <div className="px-4 py-3 space-y-2">
                {entry.setConfigs.length > 0 && (
                  <div
                    className="grid gap-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-3 py-1"
                    style={{ gridTemplateColumns: "3rem 1fr 1fr 1fr 1.75rem 1.75rem" }}
                  >
                    <span>Set</span><span>Reps</span><span>Weight</span><span>Rest (s)</span>
                    <span title="Intensifier"><Zap className="w-3 h-3" /></span>
                    <span />
                  </div>
                )}

                {entry.setConfigs.map((sc, setIndex) => (
                  <SetConfigRow
                    key={setIndex}
                    sc={sc}
                    index={setIndex}
                    allExercises={exercises ?? []}
                    onUpdate={(key, value) => updateSetConfig(exIndex, setIndex, key, value)}
                    onRemove={() => removeSetFromExercise(exIndex, setIndex)}
                  />
                ))}

                <Button
                  size="sm" variant="ghost"
                  onClick={() => addSetToExercise(exIndex)}
                  className="cursor-pointer w-full text-xs gap-1.5 text-muted-foreground hover:text-foreground mt-1"
                >
                  <Plus className="w-3 h-3" />Add Set
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="flex gap-2 pt-1 border-t border-border">
        <Button variant="secondary" onClick={onCancel} className="cursor-pointer flex-1">
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !name.trim() || exerciseEntries.length === 0}
          className="flex-1 cursor-pointer"
        >
          {saving ? "Saving…" : "Save Workout"}
        </Button>
      </div>
    </div>
  );
}

// ─── Public dialog component ──────────────────────────────────────────────────

export default function CalendarWorkoutEditorDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: WorkoutEntry;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const workout = useQuery(api.workouts.get, open ? { id: entry.workoutId } : "skip");

  // Derived initial exercises — computed once when workout loads.
  // Stored in state so editing doesn't re-derive on every render.
  const [initialised, setInitialised] = useState(false);
  const [initialExercises, setInitialExercises] = useState<ExerciseEntry[]>([]);
  const [initialName, setInitialName] = useState("");

  // Reset when dialog opens (new entry or re-open)
  useEffect(() => {
    if (!open) {
      setInitialised(false);
      setInitialExercises([]);
      setInitialName("");
    }
  }, [open]);

  // Hydrate once workout data arrives
  useEffect(() => {
    if (workout && !initialised) {
      setInitialName(workout.name);
      setInitialExercises(
        workout.exercisesWithDetails.map(backendExerciseToEntry),
      );
      setInitialised(true);
    }
  }, [workout, initialised]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-4 h-4 text-primary" />
            Edit Workout
          </DialogTitle>
          <DialogDescription>
            {format(parseISO(entry.scheduledDate), "EEEE, MMMM d, yyyy")}
          </DialogDescription>
        </DialogHeader>

        {!initialised ? (
          <div className="space-y-3 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <WorkoutEditorInner
            workoutId={entry.workoutId}
            scheduledDate={entry.scheduledDate}
            initialName={initialName}
            initialExercises={initialExercises}
            onSave={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
