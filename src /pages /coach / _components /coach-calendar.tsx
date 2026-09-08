import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  ChevronLeft, ChevronRight, Plus, Dumbbell, Users,
  CheckCircle, X, SkipForward, Trash2, Layers, Calendar,
  Edit, Activity, Footprints, Timer, Zap, Copy, AlertTriangle,
} from "lucide-react";
import CalendarWorkoutEditorDialog from "./calendar-workout-editor-dialog.tsx";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, isToday,
  addMonths, subMonths, parseISO, isAfter, isBefore, startOfDay,
} from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { motion, AnimatePresence } from "motion/react";

// ─── Types ─────────────────────────────────────────────────────────────────

type WorkoutEntry = {
  _id: Id<"scheduledWorkouts">;
  activityType: "weight_training";
  clientId: Id<"users">;
  workoutId: Id<"workouts">;
  scheduledDate: string;
  notes?: string;
  status: "scheduled" | "completed" | "skipped" | "rest";
  label: string; // workout name
  programName?: string;
  completedAt?: number;
};

type CardioEntry = {
  _id: Id<"scheduledCardio">;
  activityType: "cardio";
  clientId: Id<"users">;
  scheduledDate: string;
  notes?: string;
  status: "scheduled" | "completed" | "skipped";
  label: string; // cardioType
  targetDurationMinutes: number;
  intensity?: "low" | "moderate" | "high" | "max";
  clientName: string;
};

type StepEntry = {
  _id: Id<"scheduledStepGoals">;
  activityType: "step_goal";
  clientId: Id<"users">;
  scheduledDate: string;
  notes?: string;
  status: "scheduled" | "completed" | "skipped";
  label: string; // "Step Goal"
  targetSteps: number;
  stepLog?: { actualSteps: number } | null;
  completionPct?: number | null;
  clientName: string;
};

type AnyEntry = WorkoutEntry | CardioEntry | StepEntry;

// ─── Activity type config ───────────────────────────────────────────────────

const ACTIVITY_CONFIG = {
  weight_training: {
    icon: <Dumbbell className="w-3 h-3" />,
    label: "Weight Training",
    color: "bg-primary/20 text-primary border-primary/30",
    dotColor: "bg-primary",
  },
  cardio: {
    icon: <Activity className="w-3 h-3" />,
    label: "Cardio",
    color: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    dotColor: "bg-orange-500",
  },
  step_goal: {
    icon: <Footprints className="w-3 h-3" />,
    label: "Step Goal",
    color: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    dotColor: "bg-teal-400",
  },
} as const;

const STATUS_OVERLAY: Record<string, string> = {
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  skipped: "bg-destructive/20 text-destructive border-destructive/30",
  rest: "bg-muted text-muted-foreground border-border",
};

function entryColorClass(entry: AnyEntry) {
  if (entry.status === "completed") return STATUS_OVERLAY.completed;
  if (entry.status === "skipped") return STATUS_OVERLAY.skipped;
  if ("status" in entry && entry.status === "rest") return STATUS_OVERLAY.rest;
  return ACTIVITY_CONFIG[entry.activityType].color;
}

const CARDIO_TYPES = [
  "Treadmill", "Stair Climber", "Outdoor Run", "Cycling", "Rowing",
  "Elliptical", "Swimming", "Jump Rope", "HIIT", "Other",
];

// ─── Schedule Workout Dialog ───────────────────────────────────────────────
function ScheduleWorkoutDialog({
  clientId, date, open, onOpenChange,
}: {
  clientId: Id<"users">; date: Date; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [workoutId, setWorkoutId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Only show this client's own workouts — never show other clients' workouts
  const clientWorkouts = useQuery(api.workouts.listByClientAndProgram, { clientId });
  const schedule = useMutation(api.calendar.scheduleWorkout);

  const handleSave = async () => {
    if (!workoutId) { toast.error("Select a workout"); return; }
    setSaving(true);
    try {
      await schedule({ clientId, workoutId: workoutId as Id<"workouts">, scheduledDate: format(date, "yyyy-MM-dd"), notes: notes || undefined });
      toast.success("Workout scheduled!");
      onOpenChange(false);
      setWorkoutId(""); setNotes("");
    } catch { toast.error("Failed to schedule workout"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Dumbbell className="w-4 h-4 text-primary" />Schedule Weight Training</DialogTitle>
          <DialogDescription>{format(date, "EEEE, MMMM d, yyyy")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Workout</Label>
            <Select value={workoutId} onValueChange={setWorkoutId}>
              <SelectTrigger><SelectValue placeholder="Select workout…" /></SelectTrigger>
              <SelectContent>{clientWorkouts?.map(w => <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="resize-none text-sm" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !workoutId} className="flex-1 cursor-pointer">{saving ? "Scheduling…" : "Schedule"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule Cardio Dialog ────────────────────────────────────────────────
function ScheduleCardioDialog({
  clientId, date, open, onOpenChange, editEntry,
}: {
  clientId: Id<"users">; date: Date; open: boolean; onOpenChange: (v: boolean) => void;
  editEntry?: CardioEntry | null;
}) {
  const [cardioType, setCardioType] = useState(editEntry?.label ?? "Treadmill");
  const [duration, setDuration] = useState(editEntry ? String(editEntry.targetDurationMinutes) : "");
  const [distance, setDistance] = useState("");
  const [pace, setPace] = useState("");
  const [speed, setSpeed] = useState("");
  const [incline, setIncline] = useState("");
  const [resistance, setResistance] = useState("");
  const [intensity, setIntensity] = useState<"low" | "moderate" | "high" | "max" | "">(editEntry?.intensity ?? "");
  const [notes, setNotes] = useState(editEntry?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const create = useMutation(api.activities.cardio.scheduleCardio);
  const update = useMutation(api.activities.cardio.updateScheduledCardio);

  const handleSave = async () => {
    if (!cardioType || !duration) { toast.error("Cardio type and duration are required"); return; }
    setSaving(true);
    try {
      if (editEntry) {
        await update({
          id: editEntry._id,
          cardioType,
          targetDurationMinutes: Number(duration),
          targetDistanceKm: distance ? Number(distance) : undefined,
          targetPace: pace || undefined,
          targetSpeed: speed ? Number(speed) : undefined,
          targetIncline: incline ? Number(incline) : undefined,
          targetResistance: resistance ? Number(resistance) : undefined,
          intensity: intensity || undefined,
          notes: notes || undefined,
        });
        toast.success("Cardio session updated!");
      } else {
        await create({
          clientId,
          scheduledDate: format(date, "yyyy-MM-dd"),
          cardioType,
          targetDurationMinutes: Number(duration),
          targetDistanceKm: distance ? Number(distance) : undefined,
          targetPace: pace || undefined,
          targetSpeed: speed ? Number(speed) : undefined,
          targetIncline: incline ? Number(incline) : undefined,
          targetResistance: resistance ? Number(resistance) : undefined,
          intensity: intensity || undefined,
          notes: notes || undefined,
        });
        toast.success("Cardio session scheduled!");
      }
      onOpenChange(false);
    } catch { toast.error("Failed to save cardio session"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Activity className="w-4 h-4 text-orange-400" />{editEntry ? "Edit Cardio Session" : "Schedule Cardio"}</DialogTitle>
          <DialogDescription>{format(date, "EEEE, MMMM d, yyyy")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Cardio Type <span className="text-destructive">*</span></Label>
            <Select value={cardioType} onValueChange={setCardioType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CARDIO_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target Duration (min) <span className="text-destructive">*</span></Label>
              <Input type="number" min={1} placeholder="e.g. 30" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Target Distance (km)</Label>
              <Input type="number" min={0} step={0.1} placeholder="optional" value={distance} onChange={e => setDistance(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target Pace (e.g. 5:30 /km)</Label>
              <Input placeholder="optional" value={pace} onChange={e => setPace(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Target Speed (km/h)</Label>
              <Input type="number" min={0} step={0.1} placeholder="optional" value={speed} onChange={e => setSpeed(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Incline (%)</Label>
              <Input type="number" min={0} step={0.5} placeholder="optional" value={incline} onChange={e => setIncline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Resistance Level</Label>
              <Input type="number" min={0} placeholder="optional" value={resistance} onChange={e => setResistance(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Intensity</Label>
            <Select value={intensity || "none"} onValueChange={v => setIntensity(v === "none" ? "" : v as "low" | "moderate" | "high" | "max")}>
              <SelectTrigger><SelectValue placeholder="Select intensity…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="max">Max</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="resize-none text-sm" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !cardioType || !duration} className="flex-1 cursor-pointer">
              {saving ? "Saving…" : editEntry ? "Save Changes" : "Schedule Cardio"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule Step Goal Dialog ─────────────────────────────────────────────
function ScheduleStepGoalDialog({
  clientId, date, open, onOpenChange, editEntry,
}: {
  clientId: Id<"users">; date: Date; open: boolean; onOpenChange: (v: boolean) => void;
  editEntry?: StepEntry | null;
}) {
  const [targetSteps, setTargetSteps] = useState(editEntry ? String(editEntry.targetSteps) : "");
  const [targetDate, setTargetDate] = useState(editEntry ? "" : "");
  const [notes, setNotes] = useState(editEntry?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const create = useMutation(api.activities.steps.scheduleStepGoal);
  const update = useMutation(api.activities.steps.updateStepGoal);

  const handleSave = async () => {
    if (!targetSteps) { toast.error("Target steps is required"); return; }
    setSaving(true);
    try {
      if (editEntry) {
        await update({
          id: editEntry._id,
          targetSteps: Number(targetSteps),
          targetCompletionDate: targetDate || undefined,
          notes: notes || undefined,
        });
        toast.success("Step goal updated!");
      } else {
        await create({
          clientId,
          scheduledDate: format(date, "yyyy-MM-dd"),
          targetSteps: Number(targetSteps),
          targetCompletionDate: targetDate || undefined,
          notes: notes || undefined,
        });
        toast.success("Step goal scheduled!");
      }
      onOpenChange(false);
    } catch { toast.error("Failed to save step goal"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Footprints className="w-4 h-4 text-teal-400" />{editEntry ? "Edit Step Goal" : "Assign Step Goal"}</DialogTitle>
          <DialogDescription>{format(date, "EEEE, MMMM d, yyyy")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target Steps <span className="text-destructive">*</span></Label>
            <Input type="number" min={1} placeholder="e.g. 10000" value={targetSteps} onChange={e => setTargetSteps(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Target Completion Date (optional)</Label>
            <Input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="resize-none text-sm" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !targetSteps} className="flex-1 cursor-pointer">
              {saving ? "Saving…" : editEntry ? "Save Changes" : "Assign Goal"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule Program Dialog ───────────────────────────────────────────────
function ScheduleProgramDialog({
  clientId, open, onOpenChange,
}: {
  clientId: Id<"users">; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [programId, setProgramId] = useState("");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const programs = useQuery(api.programs.list, {});
  const scheduleProgram = useMutation(api.calendar.scheduleProgramForClient);

  const handleSave = async () => {
    if (!programId) { toast.error("Select a program"); return; }
    setSaving(true);
    try {
      const result = await scheduleProgram({ clientId, programId: programId as Id<"programs">, startDate, notes: notes || undefined });
      toast.success(`${result.count} workouts scheduled to calendar!`);
      onOpenChange(false);
      setProgramId(""); setNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule program");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule Program to Calendar</DialogTitle>
          <DialogDescription>All workouts in the program will be placed on specific dates starting from the date you choose.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Program</Label>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger><SelectValue placeholder="Select program…" /></SelectTrigger>
              <SelectContent>{programs?.map(p => <SelectItem key={p._id} value={p._id}>{p.name} — {p.durationWeeks}w</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="resize-none text-sm" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !programId} className="flex-1 cursor-pointer">{saving ? "Scheduling…" : "Schedule Program"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Activity Menu ─────────────────────────────────────────────────────
type ActivityDialogType = "workout" | "cardio" | "step_goal" | "program" | null;

function AddActivityMenu({
  onSelect,
}: {
  onSelect: (type: ActivityDialogType) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <Button size="sm" onClick={() => onSelect("workout")} className="cursor-pointer text-xs h-8">
        <Dumbbell className="w-3 h-3 mr-1" />Workout
      </Button>
      <Button size="sm" onClick={() => onSelect("cardio")} className="cursor-pointer text-xs h-8 bg-orange-600 hover:bg-orange-700 text-white">
        <Activity className="w-3 h-3 mr-1" />Cardio
      </Button>
      <Button size="sm" onClick={() => onSelect("step_goal")} className="cursor-pointer text-xs h-8 bg-teal-600 hover:bg-teal-700 text-white">
        <Footprints className="w-3 h-3 mr-1" />Step Goal
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onSelect("program")} className="cursor-pointer text-xs h-8">
        <Layers className="w-3 h-3 mr-1" />Program
      </Button>
    </div>
  );
}

// ─── Copy Workout Dialog ───────────────────────────────────────────────────
function CopyWorkoutDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: WorkoutEntry;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [destinationDate, setDestinationDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const copyWorkout = useMutation(api.calendar.copyScheduledWorkout);

  const handleCopy = async () => {
    if (!destinationDate) { toast.error("Select a destination date"); return; }
    setSaving(true);
    try {
      const result = await copyWorkout({
        scheduledWorkoutId: entry._id,
        destinationDate,
      });
      if (result.conflictCount > 0) {
        toast.success(
          `"${entry.label}" copied to ${format(parseISO(destinationDate), "MMMM d")}. Note: ${result.conflictCount} workout${result.conflictCount > 1 ? "s" : ""} already on that date.`,
          { duration: 5000 }
        );
      } else {
        toast.success(`"${entry.label}" copied to ${format(parseISO(destinationDate), "MMMM d")}!`);
      }
      onOpenChange(false);
    } catch {
      toast.error("Failed to copy workout");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-primary" />
            Copy Workout
          </DialogTitle>
          <DialogDescription>
            Copy <strong>{entry.label}</strong> to another date. The copy will be fully independent — editing it won't affect the original.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Destination Date</Label>
            <Input
              type="date"
              value={destinationDate}
              onChange={(e) => setDestinationDate(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer flex-1">
              Cancel
            </Button>
            <Button onClick={handleCopy} disabled={saving || !destinationDate} className="flex-1 cursor-pointer">
              {saving ? "Copying…" : "Copy Workout"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Workout Dialog ───────────────────────────────────────────────────
/**
 * Inline workout editor for the coach calendar.
 * Loads the workout's exercises and lets the coach edit sets/reps/rest/notes.
 * Calls workouts.update to save. Original workout remains unchanged since
 * copyScheduledWorkout already created an independent copy.
 */
// ─── Day Detail Panel ──────────────────────────────────────────────────────
function DayDetailPanel({
  date, clientId, entries, onClose,
  onAddActivity,
}: {
  date: Date;
  clientId: Id<"users">;
  entries: AnyEntry[];
  onClose: () => void;
  onAddActivity: (type: ActivityDialogType) => void;
}) {
  const delWorkout = useMutation(api.calendar.deleteScheduledWorkout);
  const updateWorkout = useMutation(api.calendar.updateScheduledWorkout);
  const delCardio = useMutation(api.activities.cardio.deleteScheduledCardio);
  const updateCardio = useMutation(api.activities.cardio.updateScheduledCardio);
  const delStep = useMutation(api.activities.steps.deleteStepGoal);
  const updateStep = useMutation(api.activities.steps.updateStepGoal);

  const [editCardioEntry, setEditCardioEntry] = useState<CardioEntry | null>(null);
  const [editStepEntry, setEditStepEntry] = useState<StepEntry | null>(null);
  const [copyWorkoutEntry, setCopyWorkoutEntry] = useState<WorkoutEntry | null>(null);
  const [editWorkoutEntry, setEditWorkoutEntry] = useState<WorkoutEntry | null>(null);

  const handleDelete = async (entry: AnyEntry) => {
    try {
      if (entry.activityType === "weight_training") await delWorkout({ id: entry._id });
      else if (entry.activityType === "cardio") await delCardio({ id: entry._id });
      else await delStep({ id: entry._id });
      toast.success("Removed");
    } catch { toast.error("Failed to remove"); }
  };

  const handleMarkDone = async (entry: AnyEntry) => {
    try {
      if (entry.activityType === "weight_training") {
        await updateWorkout({ id: entry._id as Id<"scheduledWorkouts">, status: "completed" });
      } else if (entry.activityType === "cardio") {
        await updateCardio({ id: entry._id as Id<"scheduledCardio">, status: "completed" });
      } else {
        await updateStep({ id: entry._id as Id<"scheduledStepGoals">, status: "completed" });
      }
      toast.success("Marked as done");
    } catch { toast.error("Failed to update status"); }
  };

  const handleSkip = async (entry: AnyEntry) => {
    try {
      if (entry.activityType === "weight_training") {
        await updateWorkout({ id: entry._id as Id<"scheduledWorkouts">, status: "skipped" });
      } else if (entry.activityType === "cardio") {
        await updateCardio({ id: entry._id as Id<"scheduledCardio">, status: "skipped" });
      } else {
        await updateStep({ id: entry._id as Id<"scheduledStepGoals">, status: "skipped" });
      }
      toast.success("Skipped");
    } catch { toast.error("Failed to skip"); }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="bg-card border-border shadow-2xl">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{format(date, "EEEE, MMMM d")}</CardTitle>
              <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7 cursor-pointer">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <AddActivityMenu onSelect={onAddActivity} />
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No activities scheduled for this day.</p>
            ) : (
              <div className="space-y-3">
                {entries.map(entry => {
                  const cfg = ACTIVITY_CONFIG[entry.activityType];
                  const colorCls = entryColorClass(entry);
                  return (
                    <div key={entry._id} className={cn("rounded-lg p-3 border space-y-2", colorCls)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {cfg.icon}
                            <p className="font-semibold text-sm truncate">{entry.label}</p>
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                              {cfg.label}
                            </Badge>
                          </div>
                          {/* Activity-specific details */}
                          {entry.activityType === "cardio" && (
                            <div className="flex gap-2 text-xs opacity-70 flex-wrap mt-1">
                              <span className="flex items-center gap-0.5"><Timer className="w-3 h-3" />{entry.targetDurationMinutes} min</span>
                              {entry.intensity && <span className="flex items-center gap-0.5"><Zap className="w-3 h-3" />{entry.intensity}</span>}
                            </div>
                          )}
                          {entry.activityType === "step_goal" && (
                            <div className="flex gap-2 text-xs opacity-70 flex-wrap mt-1">
                              <span className="flex items-center gap-0.5"><Footprints className="w-3 h-3" />{entry.targetSteps.toLocaleString()} steps</span>
                              {entry.completionPct != null && (
                                <span className="text-teal-400 font-semibold">{entry.completionPct}% done</span>
                              )}
                            </div>
                          )}
                          {entry.notes && <p className="text-xs opacity-70 mt-1 italic">{entry.notes}</p>}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {entry.activityType === "weight_training" && (
                            <>
                              <Button size="icon" variant="ghost" onClick={() => setCopyWorkoutEntry(entry as WorkoutEntry)}
                                className="h-6 w-6 cursor-pointer text-muted-foreground" title="Copy to another date">
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setEditWorkoutEntry(entry as WorkoutEntry)}
                                className="h-6 w-6 cursor-pointer text-muted-foreground" title="Edit workout">
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {entry.activityType === "cardio" && (
                            <Button size="icon" variant="ghost" onClick={() => setEditCardioEntry(entry as CardioEntry)}
                              className="h-6 w-6 cursor-pointer text-muted-foreground" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {entry.activityType === "step_goal" && (
                            <Button size="icon" variant="ghost" onClick={() => setEditStepEntry(entry as StepEntry)}
                              className="h-6 w-6 cursor-pointer text-muted-foreground" title="Edit">
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => handleDelete(entry)}
                            className="h-6 w-6 cursor-pointer text-destructive" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      {entry.status === "scheduled" && (
                        <div className="flex gap-1.5">
                          <Button size="sm" className="flex-1 h-7 text-xs cursor-pointer bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleMarkDone(entry)}>
                            <CheckCircle className="w-3 h-3 mr-1" />Mark Done
                          </Button>
                          <Button size="sm" variant="secondary" className="h-7 text-xs cursor-pointer"
                            onClick={() => handleSkip(entry)}>
                            <X className="w-3 h-3 mr-1" />Skip
                          </Button>
                        </div>
                      )}
                      {entry.status !== "scheduled" && (
                        <Badge variant="secondary" className="text-xs capitalize">{entry.status}</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Edit dialogs */}
      {editCardioEntry && (
        <ScheduleCardioDialog
          clientId={clientId}
          date={date}
          open={!!editCardioEntry}
          onOpenChange={v => { if (!v) setEditCardioEntry(null); }}
          editEntry={editCardioEntry}
        />
      )}
      {editStepEntry && (
        <ScheduleStepGoalDialog
          clientId={clientId}
          date={date}
          open={!!editStepEntry}
          onOpenChange={v => { if (!v) setEditStepEntry(null); }}
          editEntry={editStepEntry}
        />
      )}
      {copyWorkoutEntry && (
        <CopyWorkoutDialog
          entry={copyWorkoutEntry}
          open={!!copyWorkoutEntry}
          onOpenChange={v => { if (!v) setCopyWorkoutEntry(null); }}
        />
      )}
      {editWorkoutEntry && (
        <CalendarWorkoutEditorDialog
          entry={editWorkoutEntry}
          open={!!editWorkoutEntry}
          onOpenChange={v => { if (!v) setEditWorkoutEntry(null); }}
        />
      )}
    </>
  );
}

// ─── Main Coach Calendar ────────────────────────────────────────────────────
export default function CoachCalendar({ filterClientId }: { filterClientId?: Id<"users"> }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [activityDialog, setActivityDialog] = useState<ActivityDialogType>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>(filterClientId ?? "");

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const clients = useQuery(api.calendar.getCoachClients, {});

  const dateRange = selectedClientId
    ? { clientId: selectedClientId as Id<"users">, startDate: format(calStart, "yyyy-MM-dd"), endDate: format(calEnd, "yyyy-MM-dd") }
    : "skip" as const;

  const workoutData = useQuery(api.calendar.getClientCalendarForCoach, dateRange);
  const cardioData = useQuery(api.activities.cardio.getCoachCardioCalendar, selectedClientId ? { clientId: selectedClientId as Id<"users">, startDate: format(calStart, "yyyy-MM-dd"), endDate: format(calEnd, "yyyy-MM-dd") } : "skip");
  const stepData = useQuery(api.activities.steps.getCoachStepGoalCalendar, selectedClientId ? { clientId: selectedClientId as Id<"users">, startDate: format(calStart, "yyyy-MM-dd"), endDate: format(calEnd, "yyyy-MM-dd") } : "skip");

  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // Merge all entries into a unified map
  const allEntriesByDate = useMemo(() => {
    const map: Record<string, AnyEntry[]> = {};

    for (const sw of workoutData ?? []) {
      const key = sw.scheduledDate;
      if (!map[key]) map[key] = [];
      map[key].push({ ...sw, activityType: "weight_training" as const, label: sw.workoutName });
    }
    for (const c of cardioData ?? []) {
      const key = c.scheduledDate;
      if (!map[key]) map[key] = [];
      map[key].push({ ...c, activityType: "cardio" as const, label: c.cardioType });
    }
    for (const s of stepData ?? []) {
      const key = s.scheduledDate;
      if (!map[key]) map[key] = [];
      map[key].push({ ...s, activityType: "step_goal" as const, label: "Step Goal" });
    }

    return map;
  }, [workoutData, cardioData, stepData]);

  const selectedDateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const selectedEntries = selectedDateKey ? (allEntriesByDate[selectedDateKey] ?? []) : [];

  const selectedClient = clients?.find(c => c._id === selectedClientId);

  // Month stats
  const monthStart_str = format(monthStart, "yyyy-MM-dd");
  const monthEnd_str = format(monthEnd, "yyyy-MM-dd");
  const monthAllEntries = Object.values(allEntriesByDate).flat().filter(e =>
    e.scheduledDate >= monthStart_str && e.scheduledDate <= monthEnd_str,
  );
  const completedCount = monthAllEntries.filter(e => e.status === "completed").length;
  const scheduledCount = monthAllEntries.filter(e => e.status === "scheduled").length;
  const skippedCount = monthAllEntries.filter(e => e.status === "skipped").length;

  const isLoading = selectedClientId && (workoutData === undefined || cardioData === undefined || stepData === undefined);

  const handleAddActivity = (type: ActivityDialogType) => setActivityDialog(type);
  const dialogDate = selectedDate ?? new Date();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-bold min-w-[160px] text-center">{format(currentMonth, "MMMM yyyy")}</h2>
          <Button size="icon" variant="ghost" onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCurrentMonth(new Date())}
            className="cursor-pointer text-xs h-8 ml-1"
          >
            Today
          </Button>
        </div>

        {/* Client selector (hidden when filterClientId is provided) */}
        {!filterClientId && (
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="h-9 w-48 text-sm">
                <Users className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Select a client…" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map(c => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {selectedClientId && <AddActivityMenu onSelect={handleAddActivity} />}
          </div>
        )}

        {/* When embedded in client dashboard, show add buttons directly */}
        {filterClientId && (
          <AddActivityMenu onSelect={handleAddActivity} />
        )}
      </div>

      {/* No client prompt */}
      {!selectedClientId && !filterClientId && (
        <Card className="bg-card/50 border-border">
          <CardContent className="py-16 text-center space-y-3">
            <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto">
              <Calendar className="w-8 h-8 text-primary" />
            </div>
            <p className="text-muted-foreground text-sm">Select a client above to view and manage their training calendar.</p>
          </CardContent>
        </Card>
      )}

      {selectedClientId && (
        <>
          {/* Client info + stats */}
          {selectedClient && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                  {selectedClient.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-sm">{selectedClient.name}</p>
                  {selectedClient.email && <p className="text-xs text-muted-foreground">{selectedClient.email}</p>}
                </div>
              </div>
              {monthAllEntries.length > 0 && (
                <div className="flex gap-3 text-xs">
                  <span className="text-green-400">{completedCount} done</span>
                  <span className="text-primary">{scheduledCount} upcoming</span>
                  {skippedCount > 0 && <span className="text-destructive">{skippedCount} skipped</span>}
                </div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="flex gap-2 flex-wrap text-xs">
            {(Object.entries(ACTIVITY_CONFIG) as Array<[keyof typeof ACTIVITY_CONFIG, typeof ACTIVITY_CONFIG[keyof typeof ACTIVITY_CONFIG]]>).map(([type, cfg]) => (
              <div key={type} className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full border", cfg.color)}>
                {cfg.icon}<span>{cfg.label}</span>
              </div>
            ))}
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
                  <div key={i} className="h-20 border-b border-r border-border/30">
                    <Skeleton className="h-4 w-4 m-2 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayEntries = allEntriesByDate[key] ?? [];
                  const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                  const isCurrentMonth = isSameMonth(day, currentMonth);

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDate(isSelected ? null : day)}
                      className={cn(
                        "min-h-[72px] p-1.5 border-b border-r border-border/30 text-left transition-colors cursor-pointer",
                        "hover:bg-muted/40",
                        !isCurrentMonth && "opacity-30",
                        isSelected && "bg-primary/5 ring-1 ring-inset ring-primary",
                        isToday(day) && "bg-accent/5",
                      )}
                    >
                      <p className={cn(
                        "text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full",
                        isToday(day) && "bg-primary text-primary-foreground",
                      )}>
                        {format(day, "d")}
                      </p>
                      <div className="space-y-0.5">
                        {dayEntries.slice(0, 2).map(entry => {
                          const cfg = ACTIVITY_CONFIG[entry.activityType];
                          return (
                            <div key={entry._id} className={cn("text-[9px] px-1 py-0.5 rounded truncate border flex items-center gap-0.5", entryColorClass(entry))}>
                              {cfg.icon}<span className="truncate">{entry.label}</span>
                            </div>
                          );
                        })}
                        {dayEntries.length > 2 && (
                          <div className="text-[9px] text-muted-foreground px-1">+{dayEntries.length - 2} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Day detail panel */}
          <AnimatePresence>
            {selectedDate && (
              <DayDetailPanel
                date={selectedDate}
                clientId={selectedClientId as Id<"users">}
                entries={selectedEntries}
                onClose={() => setSelectedDate(null)}
                onAddActivity={handleAddActivity}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Scheduling dialogs */}
      {activityDialog === "workout" && selectedClientId && (
        <ScheduleWorkoutDialog
          clientId={selectedClientId as Id<"users">}
          date={dialogDate}
          open={activityDialog === "workout"}
          onOpenChange={v => { if (!v) setActivityDialog(null); }}
        />
      )}
      {activityDialog === "cardio" && selectedClientId && (
        <ScheduleCardioDialog
          clientId={selectedClientId as Id<"users">}
          date={dialogDate}
          open={activityDialog === "cardio"}
          onOpenChange={v => { if (!v) setActivityDialog(null); }}
        />
      )}
      {activityDialog === "step_goal" && selectedClientId && (
        <ScheduleStepGoalDialog
          clientId={selectedClientId as Id<"users">}
          date={dialogDate}
          open={activityDialog === "step_goal"}
          onOpenChange={v => { if (!v) setActivityDialog(null); }}
        />
      )}
      {activityDialog === "program" && selectedClientId && (
        <ScheduleProgramDialog
          clientId={selectedClientId as Id<"users">}
          open={activityDialog === "program"}
          onOpenChange={v => { if (!v) setActivityDialog(null); }}
        />
      )}
    </div>
  );
}
