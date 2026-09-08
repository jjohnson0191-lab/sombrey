import { useState, useEffect } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import {
  ArrowLeft, User, Dumbbell, Utensils, Pill, TrendingUp, Activity, FileText,
  Plus, Trash2, Save, Calendar, Target, Weight, Ruler, Trophy, CheckCircle,
  Camera, Edit, Clock, AlertCircle, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow, differenceInYears, parseISO, startOfDay } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { motion } from "motion/react";
import CoachCalendarForClient from "@/pages/coach/_components/coach-calendar-for-client.tsx";
import NutritionCalendar from "@/pages/calendar/_components/nutrition-calendar.tsx";
import ActivityAnalytics from "@/components/activity-analytics.tsx";
import CoachNutritionTab from "./_components/coach-nutrition-tab.tsx";
import { ClientAnalyticsTab } from "@/pages/progress/analytics/page.tsx";

// ─── Tier / Phase helpers ──────────────────────────────────────────────────
const TIER_LABELS: Record<string, string> = {
  free: "Free", self_guided: "Self-Guided",
  semi_guided: "Semi-Guided", full_guided: "Full-Guided",
};
const TIER_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  self_guided: "bg-accent/20 text-accent",
  semi_guided: "bg-primary/20 text-primary",
  full_guided: "bg-yellow-400/20 text-yellow-400",
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  workout_completed: <Dumbbell className="w-4 h-4 text-primary" />,
  progress_photo: <Camera className="w-4 h-4 text-purple-400" />,
  measurement: <Ruler className="w-4 h-4 text-blue-400" />,
  check_in: <CheckCircle className="w-4 h-4 text-green-400" />,
};

// ─── Overview Tab ──────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: NonNullable<ReturnType<typeof useClientDashboard>> }) {
  const client = data.client;
  const age = client.dateOfBirth ? differenceInYears(new Date(), parseISO(client.dateOfBirth)) : null;

  const statsGrid = [
    { label: "Weight", value: client.weightKg ? `${client.weightKg} kg` : "—", icon: <Weight className="w-4 h-4" /> },
    { label: "Height", value: client.heightCm ? `${client.heightCm} cm` : "—", icon: <Ruler className="w-4 h-4" /> },
    { label: "Goal Weight", value: client.goalWeightKg ? `${client.goalWeightKg} kg` : "—", icon: <Target className="w-4 h-4" /> },
    { label: "Workouts/wk", value: data.workoutsThisWeek, icon: <Trophy className="w-4 h-4" /> },
    { label: "Total Workouts", value: data.totalWorkouts, icon: <Dumbbell className="w-4 h-4" /> },
    { label: "Check-ins", value: data.checkIns.length, icon: <CheckCircle className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <Card className="bg-card/50 border-border">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center shrink-0">
              {client.avatarUrl ? (
                <img src={client.avatarUrl} alt={client.name ?? ""} className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">{client.name}</h2>
                {age && <span className="text-muted-foreground text-sm">{age} yrs</span>}
                <Badge className={TIER_COLORS[client.subscriptionTier]}>
                  {TIER_LABELS[client.subscriptionTier]}
                </Badge>
              </div>
              {client.email && <p className="text-sm text-muted-foreground">{client.email}</p>}
              {data.goal?.primaryGoal && (
                <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
                  <Target className="w-3.5 h-3.5 shrink-0" />
                  {data.goal.primaryGoal}
                </p>
              )}
              {data.activePhase && (
                <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="w-3.5 h-3.5 shrink-0" />
                  Phase: <span className="font-medium text-foreground">{data.activePhase.name}</span>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {statsGrid.map(({ label, value, icon }) => (
          <div key={label} className="bg-muted/30 rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              {icon} {label}
            </div>
            <p className="font-bold text-lg">{value}</p>
          </div>
        ))}
      </div>

      {/* Active program */}
      {data.activeProgram && (
        <ActiveProgramCard
          assignmentId={data.activeProgram.assignmentId}
          programName={data.activeProgram.name}
          programId={data.activeProgram._id}
          currentWeek={data.activeProgram.currentWeek}
          durationWeeks={data.activeProgram.durationWeeks ?? 0}
        />
      )}
    </div>
  );
}

// ─── Active Program Card (uses real completion progress) ──────────────────────

function ActiveProgramCard({
  assignmentId,
  programName,
  programId,
  currentWeek,
  durationWeeks,
}: {
  assignmentId: Id<"assignedPrograms">;
  programName: string;
  programId: Id<"programs">;
  currentWeek: number;
  durationWeeks: number;
}) {
  // #10 — Use actual completed scheduledWorkouts count, not week position.
  const progress = useQuery(api.assignedPrograms.getProgramProgress, { assignmentId });

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm">Active Program</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">{programName}</p>
            <p className="text-xs text-muted-foreground">
              Week {currentWeek} of {durationWeeks}
            </p>
            {progress && (
              <p className="text-xs text-muted-foreground">
                {progress.completed}/{progress.total} workouts completed
              </p>
            )}
          </div>
          <Link to={`/programs/${programId}`}>
            <Button size="sm" variant="secondary" className="cursor-pointer">View</Button>
          </Link>
        </div>
        <Progress
          value={progress?.completionPct ?? 0}
          className="mt-3 h-2"
        />
      </CardContent>
    </Card>
  );
}

// ─── Workout Exercise Editor ───────────────────────────────────────────────────

type EditableExercise = {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  sets: number;
  reps: string | number;
  restSeconds: number;
  notes?: string;
  tempo?: string;
  suggestedWeightKg?: number;
  rpe?: number;
};

function WorkoutEditorPanel({ workoutId, workoutName }: { workoutId: Id<"workouts">; workoutName: string }) {
  const workout = useQuery(api.workouts.get, { id: workoutId });
  const versions = useQuery(api.workouts.getVersionHistory, { workoutId });
  const updateConfig = useMutation(api.workouts.updateExerciseConfig);

  const [editing, setEditing] = useState(false);
  const [exercises, setExercises] = useState<EditableExercise[]>([]);
  const [changeSummary, setChangeSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const startEdit = () => {
    if (!workout) return;
    setExercises(workout.exercisesWithDetails.map(ex => ({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      sets: ex.sets,
      reps: ex.reps,
      restSeconds: ex.restSeconds,
      notes: ex.notes,
      tempo: ex.tempo,
      suggestedWeightKg: ex.suggestedWeightKg,
      rpe: ex.rpe,
    })));
    setChangeSummary("");
    setEditing(true);
  };

  const updateEx = <K extends keyof EditableExercise>(idx: number, key: K, value: EditableExercise[K]) => {
    setExercises(prev => prev.map((e, i) => i === idx ? { ...e, [key]: value } : e));
  };

  const handleSave = async () => {
    if (!workout) return;
    setSaving(true);
    try {
      // Build exercises payload — preserve all existing setConfigs and advanced fields
      const payload = exercises.map((e, idx) => {
        const orig = workout.exercisesWithDetails[idx];
        return {
          exerciseId: e.exerciseId,
          sets: e.sets,
          reps: e.reps,
          restSeconds: e.restSeconds,
          notes: e.notes,
          tempo: e.tempo,
          suggestedWeightKg: e.suggestedWeightKg,
          rpe: e.rpe,
          supersetWith: orig?.supersetWith,
          isDropSet: orig?.isDropSet,
          setConfigs: orig?.setConfigs?.map(sc => ({
            setNumber: sc.setNumber,
            reps: sc.reps,
            weightKg: sc.weightKg,
            restSeconds: sc.restSeconds,
            intensifierType: sc.intensifierType,
            intensifierValue: sc.intensifierValue,
            dropSubSets: sc.dropSubSets,
            supersetExerciseId: sc.supersetExerciseId,
            notes: sc.notes,
          })),
        };
      });
      // Build auto change summary if none provided
      const summary = changeSummary.trim() || (() => {
        const changes: string[] = [];
        exercises.forEach((e, i) => {
          const orig = workout.exercisesWithDetails[i];
          if (!orig) return;
          if (e.sets !== orig.sets) changes.push(`${e.exerciseName}: sets ${orig.sets}→${e.sets}`);
          if (String(e.reps) !== String(orig.reps)) changes.push(`${e.exerciseName}: reps ${orig.reps}→${e.reps}`);
          if (e.restSeconds !== orig.restSeconds) changes.push(`${e.exerciseName}: rest ${orig.restSeconds}s→${e.restSeconds}s`);
          if (e.suggestedWeightKg !== orig.suggestedWeightKg) changes.push(`${e.exerciseName}: weight ${orig.suggestedWeightKg ?? "—"}→${e.suggestedWeightKg ?? "—"}kg`);
        });
        return changes.length > 0 ? changes.join("; ") : "Exercise configuration updated";
      })();
      await updateConfig({ workoutId, exercises: payload, changeSummary: summary });
      toast.success("Workout updated! Version saved.");
      setEditing(false);
    } catch { toast.error("Failed to update workout"); }
    finally { setSaving(false); }
  };

  if (workout === undefined) return <Skeleton className="h-32 w-full" />;
  if (!workout) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/20 border-b border-border/50">
        <p className="text-sm font-semibold">{workoutName}</p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" className="h-7 text-xs cursor-pointer" onClick={() => setShowHistory(v => !v)}>
            <Clock className="w-3 h-3 mr-1" /> History
          </Button>
          {!editing && (
            <Button size="sm" className="h-7 text-xs cursor-pointer" onClick={startEdit}>
              <Edit className="w-3 h-3 mr-1" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Version history */}
      {showHistory && (
        <div className="border-b border-border/50 bg-muted/10 px-3 py-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Version History</p>
          {!versions || versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No version history yet. Edits will be recorded here.</p>
          ) : (
            <div className="space-y-1">
              {versions.map((v) => (
                <div key={v._id} className="flex items-start justify-between gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                  <div>
                    <span className="font-medium">v{v.planVersion}</span>
                    <span className="text-muted-foreground ml-2">{v.changeSummary}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0">{format(parseISO(v.effectiveDate), "MMM d, yyyy")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Exercise list / editor */}
      {editing ? (
        <div className="p-3 space-y-4">
          {exercises.map((ex, i) => (
            <div key={ex.exerciseId} className="border border-border/50 rounded-lg p-3 space-y-3 bg-muted/10">
              <p className="text-sm font-semibold">{ex.exerciseName}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Sets</Label>
                  <Input type="number" min={1} value={ex.sets} onChange={e => updateEx(i, "sets", Number(e.target.value))} className="h-7 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reps</Label>
                  <Input value={String(ex.reps)} onChange={e => updateEx(i, "reps", e.target.value)} className="h-7 text-xs" placeholder="e.g. 10 or 8-12" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rest (sec)</Label>
                  <Input type="number" min={0} value={ex.restSeconds} onChange={e => updateEx(i, "restSeconds", Number(e.target.value))} className="h-7 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Target Weight (kg)</Label>
                  <Input type="number" min={0} step={0.5} value={ex.suggestedWeightKg ?? ""} onChange={e => updateEx(i, "suggestedWeightKg", e.target.value ? Number(e.target.value) : undefined)} className="h-7 text-xs" placeholder="optional" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tempo</Label>
                  <Input value={ex.tempo ?? ""} onChange={e => updateEx(i, "tempo", e.target.value || undefined)} className="h-7 text-xs" placeholder="e.g. 3-1-1" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">RPE / RIR</Label>
                  <Input type="number" min={1} max={10} step={0.5} value={ex.rpe ?? ""} onChange={e => updateEx(i, "rpe", e.target.value ? Number(e.target.value) : undefined)} className="h-7 text-xs" placeholder="1-10" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Exercise Notes</Label>
                <Input value={ex.notes ?? ""} onChange={e => updateEx(i, "notes", e.target.value || undefined)} className="h-7 text-xs" placeholder="Optional coaching notes" />
              </div>
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Change Summary (optional)</Label>
            <Input value={changeSummary} onChange={e => setChangeSummary(e.target.value)} className="h-7 text-xs" placeholder="e.g. Increased reps for progression" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} className="cursor-pointer">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1 cursor-pointer">
              <Save className="w-3 h-3 mr-1" /> {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {workout.exercisesWithDetails.map((ex) => (
            <div key={ex.exerciseId} className="px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{ex.exerciseName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {ex.sets} × {ex.reps} reps · {ex.restSeconds}s rest
                  {ex.suggestedWeightKg ? ` · ${ex.suggestedWeightKg}kg` : ""}
                  {ex.tempo ? ` · ${ex.tempo}` : ""}
                  {ex.rpe != null ? ` · RPE ${ex.rpe}` : ""}
                </p>
                {ex.notes && <p className="text-[10px] text-muted-foreground italic">{ex.notes}</p>}
              </div>
              <Badge variant="secondary" className="text-[10px] shrink-0">{ex.sets}×{ex.reps}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function TrainingTab({ data, clientId }: { data: NonNullable<ReturnType<typeof useClientDashboard>>; clientId: Id<"users"> }) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const programs = useQuery(api.programs.list, {});
  const assign = useMutation(api.assignedPrograms.assign);
  const [selectedProgram, setSelectedProgram] = useState("");
  const perfLogs = useQuery(api.performanceLogs.getUserLogs, { userId: clientId, limit: 20 });

  // Load workouts for the active program so coach can edit them
  // Pass clientId so we get client-specific workouts (not shared templates)
  const programWorkouts = useQuery(
    api.workouts.listByProgram,
    data.activeProgram ? { programId: data.activeProgram._id, clientId } : "skip"
  );

  // Ensure client-specific workouts exist for existing assignments (backfill)
  const ensureClientWorkouts = useMutation(api.workouts.ensureClientWorkouts);

  // Backfill: ensure client workouts exist once the active program is known
  useEffect(() => {
    if (data.activeProgram) {
      ensureClientWorkouts({ clientId, programId: data.activeProgram._id }).catch(() => {
        // Silently ignore — the workout list will fall back to template workouts
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.activeProgram?._id, clientId]);

  const handleAssign = async () => {
    if (!selectedProgram) return;
    try {
      await assign({ userId: clientId, programId: selectedProgram as Id<"programs">, startDate: Date.now() });
      toast.success("Program assigned!");
      setAssignOpen(false);
      setSelectedProgram("");
    } catch { toast.error("Failed to assign program"); }
  };

  return (
    <div className="space-y-6">
      {/* Assign/active program */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-primary" /> Assigned Program
            </CardTitle>
            <Button size="sm" onClick={() => setAssignOpen(true)} className="cursor-pointer">
              <Plus className="w-3 h-3 mr-1" /> Assign
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data.activeProgram ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{data.activeProgram.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.activeProgram.phase.replace(/_/g, " ")} · {data.activeProgram.durationWeeks} weeks
                    · Week {data.activeProgram.currentWeek}
                  </p>
                </div>
                <Link to={`/programs/${data.activeProgram._id}?clientId=${clientId}`}>
                  <Button size="sm" variant="secondary" className="cursor-pointer">View</Button>
                </Link>
              </div>
              <Progress value={(data.activeProgram.currentWeek / data.activeProgram.durationWeeks) * 100} className="h-2" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No program assigned.</p>
          )}
        </CardContent>
      </Card>

      {/* Editable workout assignments */}
      {data.activeProgram && programWorkouts && programWorkouts.length > 0 && (
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Edit className="w-4 h-4 text-primary" /> Edit Workout Assignments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Edit reps, sets, rest time, tempo, RPE, and target weight for each workout.
              Changes are versioned — no duplicate workouts are created.
            </p>
            {programWorkouts
              .slice()
              .sort((a, b) => a.week - b.week || a.day - b.day)
              .map(w => (
                <WorkoutEditorPanel key={w._id} workoutId={w._id} workoutName={`W${w.week}D${w.day}: ${w.name}`} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Performance log history */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" /> Performance History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {perfLogs === undefined && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          )}
          {perfLogs !== undefined && perfLogs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No workouts logged yet.</p>
          )}
          {perfLogs !== undefined && perfLogs.length > 0 && (
            <div className="space-y-2">
              {perfLogs.map((log) => {
                const isExpanded = expandedLog === log._id;
                const totalSets = log.exercises.reduce((s, ex) => s + ex.sets.length, 0);
                const completedSets = log.exercises.reduce((s, ex) => s + ex.sets.filter(set => set.completed).length, 0);
                const totalVolume = log.exercises.reduce((vol, ex) =>
                  vol + ex.sets.reduce((sv, s) => sv + (s.completed ? (s.weight ?? 0) * (s.reps ?? 0) : 0), 0), 0
                );
                const maxWeight = log.exercises.reduce((maxW, ex) =>
                  Math.max(maxW, ...ex.sets.map(s => s.weight ?? 0)), 0
                );

                return (
                  <div key={log._id} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedLog(isExpanded ? null : log._id)}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{log.workoutName}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{format(new Date(log.loggedDate + "T00:00:00"), "MMM d, yyyy")}</span>
                            {log.durationMinutes && (
                              <span className="flex items-center gap-0.5">
                                <Clock className="w-3 h-3" />{log.durationMinutes}min actual
                              </span>
                            )}
                            <span className="text-primary">{completedSets}/{totalSets} sets</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {totalVolume > 0 && (
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-muted-foreground">Volume</p>
                            <p className="text-xs font-bold">{totalVolume.toLocaleString()}kg</p>
                          </div>
                        )}
                        {maxWeight > 0 && (
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-muted-foreground">Top weight</p>
                            <p className="text-xs font-bold">{maxWeight}kg</p>
                          </div>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        }
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/40 divide-y divide-border/30">
                        {log.exercises.map((ex, ei) => (
                          <div key={ei} className="px-3 py-2 bg-muted/10">
                            <p className="text-xs font-semibold mb-1.5">{ex.exerciseName}</p>
                            <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1 mb-1">
                              <span>Set</span><span>Weight</span><span>Reps</span><span>RPE</span><span>Done</span>
                            </div>
                            {ex.sets.map((s, si) => (
                              <div key={si} className={cn(
                                "grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-1 items-center px-1 py-0.5 rounded text-xs",
                                s.completed ? "text-foreground" : "text-muted-foreground opacity-60"
                              )}>
                                <span className="font-mono text-center">{s.setNumber}</span>
                                <span>{s.weight != null ? `${s.weight}kg` : "—"}</span>
                                <span>{s.reps ?? "—"}</span>
                                <span>{s.rpe != null ? `${s.rpe}` : "—"}</span>
                                <span>{s.completed
                                  ? <CheckCircle className="w-3 h-3 text-green-400" />
                                  : <X className="w-3 h-3 text-muted-foreground" />
                                }</span>
                              </div>
                            ))}
                          </div>
                        ))}
                        {log.notes && (
                          <div className="px-3 py-2 text-xs text-muted-foreground italic">
                            "{log.notes}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI workout logs */}
      {(data.aiWorkoutLogs ?? []).length > 0 && (
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-accent" /> AI Plan Workout History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.aiWorkoutLogs ?? []).slice(0, 10).map((log) => {
                const totalSets = log.exercises.reduce((s: number, ex: { sets: unknown[] }) => s + ex.sets.length, 0);
                const completedSets = log.exercises.reduce(
                  (s: number, ex: { sets: { completed: boolean }[] }) => s + ex.sets.filter(set => set.completed).length,
                  0
                );
                return (
                  <div key={log._id} className="border border-border/50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{log.workoutDayName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Week {log.weekNumber} · {format(parseISO(log.completedAt), "MMM d, yyyy")}
                          {log.durationSeconds ? ` · ${Math.round(log.durationSeconds / 60)} min` : ""}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{completedSets}/{totalSets} sets</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assign program dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Training Program</DialogTitle>
            <DialogDescription>Select a program to assign to this client</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={selectedProgram} onValueChange={setSelectedProgram}>
              <SelectTrigger><SelectValue placeholder="Choose a program…" /></SelectTrigger>
              <SelectContent>
                {programs?.map(p => (
                  <SelectItem key={p._id} value={p._id}>{p.name} — {p.durationWeeks}w</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAssign} disabled={!selectedProgram} className="w-full cursor-pointer">
              Assign Program
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Nutrition Tab ──────────────────────────────────────────────────────────
function NutritionTab({ clientId }: { clientId: Id<"users"> }) {
  const assignment = useQuery(api.coachClient.getNutritionAssignment, { clientId });
  const upsert = useMutation(api.coachClient.upsertNutritionAssignment);
  const todayMs = startOfDay(new Date()).getTime();
  const mealLogs = useQuery(api.mealLogs.getMealLogsForDate, { userId: clientId, date: todayMs });
  const dailySummary = useQuery(api.mealLogs.getDailyNutritionSummary, {
    userId: clientId,
    date: todayMs,
  });

  const [editing, setEditing] = useState(false);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fats, setFats] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setCalories(String(assignment?.targetCalories ?? ""));
    setProtein(String(assignment?.targetProtein ?? ""));
    setCarbs(String(assignment?.targetCarbs ?? ""));
    setFats(String(assignment?.targetFats ?? ""));
    setNotes(assignment?.customNotes ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await upsert({
        clientId,
        targetCalories: calories ? Number(calories) : undefined,
        targetProtein: protein ? Number(protein) : undefined,
        targetCarbs: carbs ? Number(carbs) : undefined,
        targetFats: fats ? Number(fats) : undefined,
        customNotes: notes || undefined,
      });
      toast.success("Nutrition assignment saved!");
      setEditing(false);
    } catch { toast.error("Failed to save nutrition assignment"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Utensils className="w-4 h-4 text-green-400" /> Nutrition Targets
            </CardTitle>
            {!editing && (
              <Button size="sm" variant="secondary" onClick={startEdit} className="cursor-pointer">
                <Edit className="w-3 h-3 mr-1" /> {assignment ? "Edit" : "Set Targets"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Calories", val: calories, set: setCalories },
                  { label: "Protein (g)", val: protein, set: setProtein },
                  { label: "Carbs (g)", val: carbs, set: setCarbs },
                  { label: "Fats (g)", val: fats, set: setFats },
                ].map(({ label, val, set }) => (
                  <div key={label} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input type="number" min={0} value={val} onChange={e => set(e.target.value)} className="h-8 text-sm" />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Custom Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Meal timing, food preferences, restrictions…" className="text-sm resize-none" />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} className="cursor-pointer">Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving} className="cursor-pointer">
                  <Save className="w-3 h-3 mr-1" /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : assignment ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Calories", value: assignment.targetCalories },
                  { label: "Protein", value: assignment.targetProtein ? `${assignment.targetProtein}g` : null },
                  { label: "Carbs", value: assignment.targetCarbs ? `${assignment.targetCarbs}g` : null },
                  { label: "Fats", value: assignment.targetFats ? `${assignment.targetFats}g` : null },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-bold text-base mt-1">{value ?? "—"}</p>
                  </div>
                ))}
              </div>
              {assignment.customNotes && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Coach Notes</p>
                  <p className="text-sm">{assignment.customNotes}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No nutrition targets assigned yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Today's meal summary */}
      {dailySummary && dailySummary.mealsCompleted > 0 && (
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="w-4 h-4 text-green-400" />Today's Meals ({dailySummary.mealsCompleted}/{dailySummary.totalMeals})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Cal", value: Math.round(dailySummary.consumedCalories), color: "bg-primary/10 text-primary" },
                { label: "Pro", value: `${Math.round(dailySummary.consumedProtein)}g`, color: "bg-blue-400/10 text-blue-400" },
                { label: "Carbs", value: `${Math.round(dailySummary.consumedCarbs)}g`, color: "bg-yellow-400/10 text-yellow-400" },
                { label: "Fats", value: `${Math.round(dailySummary.consumedFats)}g`, color: "bg-red-400/10 text-red-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className={cn("rounded-lg p-2", color)}>
                  <p className="text-[10px] opacity-70 uppercase">{label}</p>
                  <p className="font-bold text-sm">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent meal photo logs */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Utensils className="w-4 h-4 text-accent" />Recent Meal Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mealLogs === undefined ? (
            <Skeleton className="h-20 w-full" />
          ) : mealLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No meal photos logged yet.</p>
          ) : (
            <div className="space-y-3">
              {mealLogs.slice(0, 5).map((log) => (
                <div key={log._id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  {log.imageUrl ? (
                    <img src={log.imageUrl} alt="meal" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Camera className="w-5 h-5 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] capitalize">{log.mealId}</Badge>
                      {log.isCompleted && (
                        <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                          <CheckCircle className="w-2.5 h-2.5" />Done
                        </span>
                      )}
                    </div>
                    {(log.clientMacros ?? log.aiMacros) && (
                      <p className="text-xs text-muted-foreground">
                        {(log.clientMacros ?? log.aiMacros)!.calories} kcal · P:{(log.clientMacros ?? log.aiMacros)!.protein}g C:{(log.clientMacros ?? log.aiMacros)!.carbs}g F:{(log.clientMacros ?? log.aiMacros)!.fats}g
                      </p>
                    )}
                    {log.completedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(log.completedAt), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Supplements Tab ───────────────────────────────────────────────────────
type Supplement = { name: string; dosage: string; timing: string; duration?: string; notes?: string };

function SupplementsTab({ clientId }: { clientId: Id<"users"> }) {
  const protocol = useQuery(api.coachClient.getSupplementProtocol, { clientId });
  const upsert = useMutation(api.coachClient.upsertSupplementProtocol);

  const [editing, setEditing] = useState(false);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [generalNotes, setGeneralNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setSupplements(protocol?.supplements ?? []);
    setGeneralNotes(protocol?.generalNotes ?? "");
    setEditing(true);
  };

  const addSupplement = () => {
    setSupplements(prev => [...prev, { name: "", dosage: "", timing: "" }]);
  };

  const updateSupplement = <K extends keyof Supplement>(index: number, key: K, value: Supplement[K]) => {
    setSupplements(prev => prev.map((s, i) => i === index ? { ...s, [key]: value } : s));
  };

  const removeSupplement = (index: number) => {
    setSupplements(prev => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    const valid = supplements.filter(s => s.name && s.dosage && s.timing);
    setSaving(true);
    try {
      await upsert({ clientId, supplements: valid, generalNotes: generalNotes || undefined });
      toast.success("Supplement protocol saved!");
      setEditing(false);
    } catch { toast.error("Failed to save supplements"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Pill className="w-4 h-4 text-yellow-400" /> Supplement Protocol
            </CardTitle>
            {!editing && (
              <Button size="sm" variant="secondary" onClick={startEdit} className="cursor-pointer">
                <Edit className="w-3 h-3 mr-1" /> {protocol ? "Edit" : "Add Protocol"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-4">
              {supplements.map((s, index) => (
                <div key={index} className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">Supplement {index + 1}</p>
                    <Button size="icon" variant="ghost" onClick={() => removeSupplement(index)} className="h-6 w-6 cursor-pointer text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Name *</Label>
                      <Input value={s.name} onChange={e => updateSupplement(index, "name", e.target.value)} placeholder="e.g. Creatine Monohydrate" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Dosage *</Label>
                      <Input value={s.dosage} onChange={e => updateSupplement(index, "dosage", e.target.value)} placeholder="e.g. 5g" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Timing *</Label>
                      <Input value={s.timing} onChange={e => updateSupplement(index, "timing", e.target.value)} placeholder="e.g. Post-workout" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Duration</Label>
                      <Input value={s.duration ?? ""} onChange={e => updateSupplement(index, "duration", e.target.value)} placeholder="e.g. 8 weeks" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Input value={s.notes ?? ""} onChange={e => updateSupplement(index, "notes", e.target.value)} placeholder="Optional" className="h-8 text-sm" />
                    </div>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={addSupplement} className="w-full cursor-pointer">
                <Plus className="w-3 h-3 mr-1" /> Add Supplement
              </Button>
              <div className="space-y-1">
                <Label className="text-xs">General Notes</Label>
                <Textarea value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} rows={2} className="text-sm resize-none" />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} className="cursor-pointer">Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving} className="cursor-pointer">
                  <Save className="w-3 h-3 mr-1" /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : protocol && protocol.supplements.length > 0 ? (
            <div className="space-y-3">
              {protocol.supplements.map((s, i) => (
                <div key={i} className="bg-muted/30 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">{s.name}</p>
                    <Badge variant="secondary" className="text-xs">{s.dosage}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <Clock className="inline w-3 h-3 mr-1" />{s.timing}
                    {s.duration && ` · ${s.duration}`}
                  </p>
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                </div>
              ))}
              {protocol.generalNotes && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">General Notes</p>
                  <p className="text-sm">{protocol.generalNotes}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No supplement protocol assigned yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Progress Tab ───────────────────────────────────────────────────────────
function ProgressTab({ data }: { data: NonNullable<ReturnType<typeof useClientDashboard>> }) {
  return (
    <div className="space-y-6">
      {/* Goal progress */}
      {data.goal && (
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Goal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-semibold">{data.goal.primaryGoal}</p>
            {data.goal.targetWeightKg && data.client.weightKg && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Current: {data.client.weightKg}kg</span>
                  <span>Goal: {data.goal.targetWeightKg}kg</span>
                </div>
                <Progress
                  value={Math.min(100, Math.max(0, ((data.client.startingWeightKg ?? data.client.weightKg) - data.client.weightKg) / ((data.client.startingWeightKg ?? data.client.weightKg) - data.goal.targetWeightKg) * 100))}
                  className="h-2"
                />
              </div>
            )}
            {data.goal.targetDate && (
              <p className="text-xs text-muted-foreground">
                <Calendar className="inline w-3 h-3 mr-1" />
                Target: {format(parseISO(data.goal.targetDate), "MMM d, yyyy")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Measurements */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Ruler className="w-4 h-4 text-blue-400" /> Recent Measurements
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.measurements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No measurements logged yet.</p>
          ) : (
            <div className="space-y-2">
              {data.measurements.slice(0, 5).map((m) => (
                <div key={m._id} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0">
                  <p className="text-xs text-muted-foreground">{format(new Date(m.date), "MMM d, yyyy")}</p>
                  <div className="flex gap-3 text-xs">
                    {m.weight && <span className="font-medium">{m.weight}kg</span>}
                    {m.bodyFat && <span className="text-muted-foreground">{m.bodyFat}% BF</span>}
                    {m.waist && <span className="text-muted-foreground">W:{m.waist}cm</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress photos */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="w-4 h-4 text-purple-400" /> Progress Photos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.progressPhotos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No progress photos uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {data.progressPhotos.slice(0, 9).map((photo) => (
                <div key={photo._id} className="aspect-square rounded-lg overflow-hidden bg-muted relative">
                  {photo.url ? (
                    <img src={photo.url} alt={`${photo.view} view`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-5 h-5 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                    {photo.view}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Check-ins — AI weekly system */}
      {(data.weeklyCheckIns ?? []).length > 0 && (
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-primary" /> Weekly Check-in History (AI Plan)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.weeklyCheckIns ?? []).slice(0, 8).map((ci) => (
                <div key={ci._id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {ci.isInitialCheckIn ? "Baseline" : `Week ${ci.weekNumber}`}
                    </Badge>
                    <span className="text-xs font-medium">{ci.weightKg} kg</span>
                    {ci.estimatedBodyFatPct && (
                      <span className="text-[10px] text-muted-foreground">{ci.estimatedBodyFatPct}% BF</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{format(parseISO(ci.checkInDate), "MMM d, yyyy")}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Check-ins — coach check-in system */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" /> Check-in History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.checkIns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No check-ins submitted yet.</p>
          ) : (
            <div className="space-y-2">
              {data.checkIns.slice(0, 5).map((ci) => (
                <div key={ci._id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={ci.status === "reviewed" ? "default" : "secondary"} className="text-xs">
                      {ci.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground capitalize">{ci.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{format(new Date(ci.date), "MMM d")}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Activity Tab ───────────────────────────────────────────────────────────
function ActivityTab({ clientId }: { clientId: Id<"users"> }) {
  const activity = useQuery(api.coachClient.getClientActivity, { clientId, limit: 30 });

  if (activity === undefined) {
    return <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" /> Client Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No activity recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((event) => (
              <div key={event.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                  {ACTIVITY_ICONS[event.type] ?? <Activity className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{event.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Notes Tab ──────────────────────────────────────────────────────────────
function NotesTab({ clientId }: { clientId: Id<"users"> }) {
  const notes = useQuery(api.coachClient.getNotes, { clientId });
  const addNote = useMutation(api.coachClient.addNote);
  const deleteNote = useMutation(api.coachClient.deleteNote);

  const [newNote, setNewNote] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      await addNote({ clientId, note: newNote.trim(), category });
      setNewNote("");
      toast.success("Note added");
    } catch { toast.error("Failed to add note"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (noteId: Id<"coachClientNotes">) => {
    try {
      await deleteNote({ noteId });
      toast.success("Note deleted");
    } catch { toast.error("Failed to delete note"); }
  };

  const CATEGORIES = ["general", "motivation", "technique", "injury", "feedback", "upcoming"];
  const CATEGORY_COLORS: Record<string, string> = {
    general: "bg-muted text-muted-foreground",
    motivation: "bg-yellow-400/20 text-yellow-400",
    technique: "bg-blue-400/20 text-blue-400",
    injury: "bg-destructive/20 text-destructive",
    feedback: "bg-green-400/20 text-green-400",
    upcoming: "bg-purple-400/20 text-purple-400",
  };

  return (
    <div className="space-y-6">
      {/* Add note */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" /> Add Private Note
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            placeholder="Add a private note about this client…"
            rows={3}
            className="resize-none text-sm"
          />
          <Button size="sm" onClick={handleAdd} disabled={saving || !newNote.trim()} className="cursor-pointer">
            <Plus className="w-3 h-3 mr-1" /> {saving ? "Adding…" : "Add Note"}
          </Button>
        </CardContent>
      </Card>

      {/* Note list */}
      <div className="space-y-3">
        {notes === undefined ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No notes yet. Notes are private to you.</p>
        ) : (
          notes.map(note => (
            <Card key={note._id} className="bg-card/50 border-border">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Badge className={cn("text-xs capitalize", CATEGORY_COLORS[note.category ?? "general"])}>
                      {note.category ?? "general"}
                    </Badge>
                    <p className="text-sm">{note.note}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(parseISO(note.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(note._id)}
                    className="h-7 w-7 cursor-pointer text-destructive shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────
function useClientDashboard(clientId: Id<"users">) {
  return useQuery(api.coachClient.getClientDashboard, { clientId });
}

// ─── Main component ────────────────────────────────────────────────────────
function ClientDashboardContent({ clientId }: { clientId: Id<"users"> }) {
  const data = useClientDashboard(clientId);

  if (data === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/coach"><ArrowLeft className="w-5 h-5" /></Link>
        </Button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center shrink-0">
            {data.client.avatarUrl ? (
              <img src={data.client.avatarUrl} alt={data.client.name ?? ""} className="w-full h-full object-cover" />
            ) : (
              <User className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-xl truncate">{data.client.name}</h1>
            <p className="text-xs text-muted-foreground truncate">{data.client.email}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full overflow-x-auto flex flex-nowrap justify-start h-auto p-1 gap-1 bg-muted/50 rounded-lg">
          {[
            { value: "overview", label: "Overview", icon: <User className="w-3.5 h-3.5" /> },
            { value: "calendar", label: "Calendar", icon: <Calendar className="w-3.5 h-3.5" /> },
            { value: "training", label: "Training", icon: <Dumbbell className="w-3.5 h-3.5" /> },
            { value: "nutrition", label: "Nutrition", icon: <Utensils className="w-3.5 h-3.5" /> },
            { value: "nutrition-calendar", label: "Meal Calendar", icon: <Utensils className="w-3.5 h-3.5" /> },
            { value: "supplements", label: "Supps", icon: <Pill className="w-3.5 h-3.5" /> },
            { value: "progress", label: "Progress", icon: <TrendingUp className="w-3.5 h-3.5" /> },
            { value: "analytics", label: "Analytics", icon: <TrendingUp className="w-3.5 h-3.5" /> },
            { value: "cardio", label: "Cardio", icon: <Activity className="w-3.5 h-3.5" /> },
            { value: "notes", label: "Notes", icon: <FileText className="w-3.5 h-3.5" /> },
          ].map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 cursor-pointer flex-shrink-0">
              {tab.icon} {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="calendar" className="mt-4">
          <CoachCalendarForClient clientId={clientId} />
        </TabsContent>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} />
        </TabsContent>
        <TabsContent value="training" className="mt-4">
          <TrainingTab data={data} clientId={clientId} />
        </TabsContent>
        <TabsContent value="nutrition" className="mt-4">
          <CoachNutritionTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="nutrition-calendar" className="mt-4">
          <NutritionCalendar userId={clientId} readOnly={true} />
        </TabsContent>
        <TabsContent value="supplements" className="mt-4">
          <SupplementsTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="progress" className="mt-4">
          <ProgressTab data={data} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <ClientAnalyticsTab clientId={clientId} clientName={data.client.name ?? undefined} />
        </TabsContent>
        <TabsContent value="cardio" className="mt-4">
          <ActivityAnalytics userId={clientId} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesTab clientId={clientId} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

export default function ClientDashboardPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        {id && <ClientDashboardContent clientId={id as Id<"users">} />}
      </div>
    </Authenticated>
  );
}
