import React, { useMemo } from "react";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  ArrowLeft, Plus, Trash2, Search, Dumbbell, ChevronDown, ChevronUp,
  Zap, Weight, Timer, Activity, Link as LinkIcon, Copy, Settings2, X, Clock,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import {
  estimateExerciseDurationSeconds,
  estimateWorkoutDurationSeconds,
  formatDuration,
} from "@/lib/workout-duration.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

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
  // Legacy flat fields (for backward compat)
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
  // New per-set configuration
  setConfigs: SetConfig[];
  showExerciseSettings: boolean;
  useSetLevel: boolean; // true = per-set mode, false = legacy flat mode
};

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

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  programId: Id<"programs">;
  week: number;
  /** Pre-selected client for workout ownership (Live Coaching). Optional. */
  preselectedClientId?: Id<"users">;
  initial?: {
    workoutId: Id<"workouts">;
    name: string;
    day: number;
    week: number;
    exercises: ExerciseEntry[];
  };
};

// ─── Intensifier label helper ─────────────────────────────────────────────

const INTENSIFIER_OPTIONS: { value: IntensifierType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "suggested_weight", label: "Suggested Weight", icon: <Weight className="w-3 h-3" />, color: "bg-green-500/20 text-green-400" },
  { value: "rpe", label: "RPE", icon: <Activity className="w-3 h-3" />, color: "bg-purple-500/20 text-purple-400" },
  { value: "tempo", label: "Tempo", icon: <Timer className="w-3 h-3" />, color: "bg-blue-500/20 text-blue-400" },
  { value: "dropset", label: "Drop Set", icon: <Copy className="w-3 h-3" />, color: "bg-primary/15 text-primary" },
  { value: "superset", label: "Superset", icon: <LinkIcon className="w-3 h-3" />, color: "bg-yellow-500/20 text-yellow-400" },
];

// ─── Set Config Row ───────────────────────────────────────────────────────

function SetConfigRow({
  sc,
  index,
  exIndex,
  allExercises,
  onUpdate,
  onRemove,
}: {
  sc: SetConfig;
  index: number;
  exIndex: number;
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
        {/* Reps */}
        <div className="flex-1 min-w-0">
          <Input
            type="text"
            placeholder="Reps"
            value={sc.reps}
            onChange={(e) => onUpdate("reps", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        {/* Weight */}
        <div className="flex-1 min-w-0">
          <Input
            type="number" min={0} step={0.5}
            placeholder="kg"
            value={sc.weightKg}
            onChange={(e) => onUpdate("weightKg", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        {/* Rest */}
        <div className="flex-1 min-w-0">
          <Input
            type="number" min={0}
            placeholder="rest s"
            value={sc.restSeconds}
            onChange={(e) => onUpdate("restSeconds", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        {/* Intensifier badge / expand */}
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
        {/* Remove */}
        <button
          onClick={onRemove}
          className="h-7 w-7 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
          title="Remove set"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Column labels (only on first row, handled by parent) */}

      {/* Expanded details */}
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
                    sc.intensifierType === opt.value ? opt.color + " border-current" : "bg-muted/40 text-muted-foreground border-border/60 hover:border-primary/40"
                  )}
                >
                  {opt.icon}{opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Intensifier value input */}
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
                step={sc.intensifierType === "rpe" ? 0.5 : 0.5}
                placeholder={
                  sc.intensifierType === "rpe" ? "e.g. 8" :
                  sc.intensifierType === "tempo" ? "e.g. 3-1-2-0" :
                  "e.g. 60"
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

          {/* Drop set sub-sets */}
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
                  <Input
                    type="number" min={0} step={0.5} placeholder="kg"
                    value={ds.weightKg}
                    onChange={(e) => updateDropSubSet(di, "weightKg", e.target.value)}
                    className="h-6 text-xs flex-1"
                  />
                  <Input
                    type="number" min={0} placeholder="reps"
                    value={ds.reps}
                    onChange={(e) => updateDropSubSet(di, "reps", e.target.value)}
                    className="h-6 text-xs flex-1"
                  />
                  <button
                    onClick={() => removeDropSubSet(di)}
                    className="text-destructive hover:text-destructive/80 cursor-pointer"
                  >
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

          {/* Show active intensifier summary */}
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkoutBuilderForm({ programId, week, preselectedClientId, initial }: Props) {
  const navigate = useNavigate();
  const program = useQuery(api.programs.get, { id: programId });
  const exercises = useQuery(api.exercises.list, {});
  const currentUser = useQuery(api.users.getCurrentUser);
  const createWorkout = useMutation(api.workouts.create);
  const updateWorkout = useMutation(api.workouts.update);

  // Live Coaching: load clients for the "Assign to Client" dropdown
  const clients = useQuery(api.calendar.getCoachClients, {});

  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [day, setDay] = useState<string>(String(initial?.day ?? "1"));
  const [selectedWeek, setSelectedWeek] = useState<string>(String(initial?.week ?? week));
  const [exerciseEntries, setExerciseEntries] = useState<ExerciseEntry[]>(initial?.exercises ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  // Client assignment — pre-select if navigated from a client's profile
  const [assignedClientId, setAssignedClientId] = useState<string>(preselectedClientId ?? "");

  const isCoachOrAdmin =
    currentUser?.effectiveRoles?.includes("coach") ||
    currentUser?.effectiveRoles?.includes("admin") ||
    currentUser?.effectiveRoles?.includes("owner") ||
    false;

  if (program === undefined || exercises === undefined || currentUser === undefined || clients === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isCoachOrAdmin) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Only coaches and admins can manage workouts.</p>
      </div>
    );
  }

  const filteredExercises = (exercises ?? []).filter((e) =>
    e.name.toLowerCase().includes(exerciseSearch.toLowerCase()),
  );

  const addExercise = (ex: { _id: Id<"exercises">; name: string }) => {
    setExerciseEntries((prev) => [
      ...prev,
      { ...EMPTY_ENTRY(), exerciseId: ex._id, exerciseName: ex.name },
    ]);
    setShowExercisePicker(false);
    setExerciseSearch("");
  };

  const removeExercise = (index: number) => {
    setExerciseEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const updateEntry = <K extends keyof ExerciseEntry>(index: number, key: K, value: ExerciseEntry[K]) => {
    setExerciseEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [key]: value } : e)));
  };

  // Set-level operations
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

  const buildSetConfigPayload = (sc: SetConfig) => ({
    setNumber: sc.setNumber,
    reps: sc.reps.trim() ? (isNaN(Number(sc.reps)) ? sc.reps : Number(sc.reps)) : undefined,
    weightKg: sc.weightKg.trim() ? Number(sc.weightKg) : undefined,
    restSeconds: sc.restSeconds.trim() ? Number(sc.restSeconds) : undefined,
    intensifierType: sc.intensifierType || undefined,
    intensifierValue: sc.intensifierValue.trim() || undefined,
    dropSubSets: sc.dropSubSets.length > 0 ? sc.dropSubSets.map((ds) => ({
      subSetNumber: ds.subSetNumber,
      weightKg: ds.weightKg.trim() ? Number(ds.weightKg) : undefined,
      reps: ds.reps.trim() ? Number(ds.reps) : undefined,
      restSeconds: ds.restSeconds.trim() ? Number(ds.restSeconds) : undefined,
    })) : undefined,
    supersetExerciseId: sc.supersetExerciseId || undefined,
    notes: sc.notes.trim() || undefined,
  });

  const buildExercisePayload = (e: ExerciseEntry) => ({
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
  });

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Workout name is required"); return; }
    if (exerciseEntries.length === 0) { toast.error("Add at least one exercise"); return; }
    // Client must be assigned for new workouts (Live Coaching requirement)
    if (!isEdit && !assignedClientId) { toast.error("Please assign this workout to a client"); return; }
    setIsSubmitting(true);
    try {
      const exercisesPayload = exerciseEntries.map(buildExercisePayload);
      if (isEdit && initial) {
        await updateWorkout({
          id: initial.workoutId,
          name: name.trim(),
          day: Number(day),
          week: Number(selectedWeek),
          exercises: exercisesPayload,
        });
        toast.success("Workout updated!");
        navigate(`/workouts/${initial.workoutId}`);
      } else {
        await createWorkout({
          programId,
          clientId: assignedClientId as Id<"users">,
          name: name.trim(),
          day: Number(day),
          week: Number(selectedWeek),
          exercises: exercisesPayload,
        });
        toast.success("Workout created!");
        navigate(`/programs/${programId}?week=${selectedWeek}`);
      }
    } catch {
      toast.error(isEdit ? "Failed to update workout" : "Failed to create workout");
    } finally {
      setIsSubmitting(false);
    }
  };

  const weeks = program ? Array.from({ length: program.durationWeeks }, (_, i) => i + 1) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={isEdit && initial ? `/workouts/${initial.workoutId}` : `/programs/${programId}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? "Edit Workout" : "Add Workout"}</h1>
          <p className="text-muted-foreground text-sm">{program?.name}</p>
        </div>
      </div>

      {/* Workout details */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="text-base">Workout Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Assign to Client — required for new workouts (Live Coaching) */}
          {!isEdit && (
            <div className="space-y-2">
              <Label>Assign to Client <span className="text-destructive">*</span></Label>
              <Select value={assignedClientId} onValueChange={setAssignedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client…" />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                      {c.email ? ` — ${c.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(clients ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No active clients found.</p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>Workout Name *</Label>
            <Input placeholder="e.g. Upper Body Push A" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Week</Label>
              <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {weeks.map((w) => (
                    <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Day</Label>
              <Select value={day} onValueChange={setDay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6,7].map((d) => (
                    <SelectItem key={d} value={String(d)}>Day {d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exercises */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Exercises ({exerciseEntries.length})</CardTitle>
              {exerciseEntries.length > 0 && (
                <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                  <Clock className="w-3.5 h-3.5" />
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
        </CardHeader>
        <CardContent className="space-y-5">
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
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredExercises.slice(0, 30).map((ex) => (
                  <button
                    key={ex._id}
                    onClick={() => addExercise(ex)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-primary/10 text-sm flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <Dumbbell className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{ex.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{ex.muscleGroup}</Badge>
                  </button>
                ))}
                {filteredExercises.length === 0 && (
                  <p className="text-center py-3 text-sm text-muted-foreground">No exercises found</p>
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

          {exerciseEntries.length === 0 && !showExercisePicker ? (
            <div className="text-center py-8 text-muted-foreground">
              <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No exercises added yet. Click "Add Exercise" above.</p>
            </div>
          ) : (
            <div className="space-y-5">
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
                          title="Exercise settings"
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

                    {/* Exercise-level settings (notes, legacy fallback) */}
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
                      {/* Column headers */}
                      {entry.setConfigs.length > 0 && (
                        <div className="grid gap-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-3 py-1"
                          style={{ gridTemplateColumns: "3rem 1fr 1fr 1fr 1.75rem 1.75rem" }}
                        >
                          <span>Set</span>
                          <span>Reps</span>
                          <span>Weight</span>
                          <span>Rest (s)</span>
                          <span title="Intensifier"><Zap className="w-3 h-3" /></span>
                          <span></span>
                        </div>
                      )}

                      {entry.setConfigs.map((sc, setIndex) => (
                        <SetConfigRow
                          key={setIndex}
                          sc={sc}
                          index={setIndex}
                          exIndex={exIndex}
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
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex gap-3 pb-6">
        <Button variant="secondary" asChild className="cursor-pointer">
          <Link to={isEdit && initial ? `/workouts/${initial.workoutId}` : `/programs/${programId}`}>Cancel</Link>
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !name.trim() || exerciseEntries.length === 0}
          className="flex-1 cursor-pointer"
        >
          {isSubmitting ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save Changes" : "Save Workout")}
        </Button>
      </div>
    </div>
  );
}
