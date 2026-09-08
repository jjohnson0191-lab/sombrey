import { useState, useRef } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Plus, Trash2, Camera, TrendingUp, Scale, Upload, Image, X, Target,
  Ruler, Calendar, Edit3, Check, ChevronDown, ChevronUp, Dumbbell, Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { format, differenceInYears, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import ActivityAnalytics from "@/components/activity-analytics.tsx";
import { Link } from "react-router-dom";
import { BarChart2 } from "lucide-react";

// ─── Unit helpers ─────────────────────────────────────────────────────────────

const kgToLbs = (kg: number) => +(kg * 2.20462).toFixed(1);
const lbsToKg = (lbs: number) => +(lbs / 2.20462).toFixed(1);
const cmToFtIn = (cm: number) => {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn % 12);
  return `${ft}'${inches}"`;
};
const cmToDisplay = (cm: number, unit: "cm" | "ft") =>
  unit === "cm" ? `${cm} cm` : cmToFtIn(cm);
const kgToDisplay = (kg: number, unit: "kg" | "lbs") =>
  unit === "kg" ? `${kg} kg` : `${kgToLbs(kg)} lbs`;

// ─── Types ────────────────────────────────────────────────────────────────────

type MeasurementFields = {
  weight?: number;
  bodyFat?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  arms?: number;
  thighs?: number;
  calves?: number;
};

type MeasurementForm = MeasurementFields & { date: string; notes: string };

const MEASUREMENT_FIELDS: { key: keyof MeasurementFields; label: string; unit: string }[] = [
  { key: "weight", label: "Weight", unit: "kg" },
  { key: "bodyFat", label: "Body Fat", unit: "%" },
  { key: "chest", label: "Chest", unit: "cm" },
  { key: "waist", label: "Waist", unit: "cm" },
  { key: "hips", label: "Hips", unit: "cm" },
  { key: "arms", label: "Arms", unit: "cm" },
  { key: "thighs", label: "Thighs", unit: "cm" },
  { key: "calves", label: "Calves", unit: "cm" },
];

const CHART_COLORS: Record<string, string> = {
  weight: "#3b82f6", bodyFat: "#f59e0b", chest: "#10b981",
  waist: "#ef4444", hips: "#8b5cf6", arms: "#06b6d4",
  thighs: "#f97316", calves: "#ec4899",
};

// ─── Goal Banner ──────────────────────────────────────────────────────────────

const GOAL_SUGGESTIONS = [
  "Lose 10 kg", "Build Muscle", "Get Lean", "Prepare for Competition",
  "Improve Athletic Performance", "Maintain Weight", "Bulk Up", "Lean Bulk",
];

function GoalBanner({ weightKg, startingWeightKg, goalWeightKg }: {
  weightKg?: number;
  startingWeightKg?: number;
  goalWeightKg?: number;
}) {
  const goal = useQuery(api.goals.getActiveGoal, {});
  const setGoal = useMutation(api.goals.setGoal);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    primaryGoal: "",
    targetWeightKg: "",
    targetBodyFatPct: "",
    targetDate: "",
  });

  const handleSave = async () => {
    if (!form.primaryGoal.trim()) { toast.error("Enter a goal"); return; }
    try {
      await setGoal({
        primaryGoal: form.primaryGoal.trim(),
        targetWeightKg: form.targetWeightKg ? parseFloat(form.targetWeightKg) : undefined,
        targetBodyFatPct: form.targetBodyFatPct ? parseFloat(form.targetBodyFatPct) : undefined,
        targetDate: form.targetDate || undefined,
      });
      toast.success("Goal saved!");
      setEditing(false);
    } catch { toast.error("Failed to save goal"); }
  };

  // Progress calculation
  let progressPct = 0;
  if (startingWeightKg && weightKg && goalWeightKg && startingWeightKg !== goalWeightKg) {
    const total = Math.abs(goalWeightKg - startingWeightKg);
    const done = Math.abs(weightKg - startingWeightKg);
    progressPct = Math.min(Math.round((done / total) * 100), 100);
  }

  const openEdit = () => {
    setForm({
      primaryGoal: goal?.primaryGoal ?? "",
      targetWeightKg: goal?.targetWeightKg?.toString() ?? "",
      targetBodyFatPct: goal?.targetBodyFatPct?.toString() ?? "",
      targetDate: goal?.targetDate ?? "",
    });
    setEditing(true);
  };

  return (
    <Card className="border-border bg-card overflow-hidden">
      <CardContent className="p-5">
        {/* Goal text row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Current Goal</p>
              <p className="font-black text-lg leading-tight">
                {goal?.primaryGoal ?? <span className="text-muted-foreground font-normal italic">No goal set yet</span>}
              </p>
              {goal?.targetDate && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Target: {format(parseISO(goal.targetDate), "MMM d, yyyy")}
                </p>
              )}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="cursor-pointer shrink-0" onClick={openEdit}>
            <Edit3 className="w-4 h-4" />
          </Button>
        </div>

        {/* Weight stats row */}
        {(startingWeightKg ?? weightKg ?? goalWeightKg) && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: "Starting", value: startingWeightKg, unit: "kg" },
              { label: "Current", value: weightKg, unit: "kg" },
              { label: "Goal", value: goalWeightKg, unit: "kg" },
            ].map(({ label, value, unit }) => (
              <div key={label} className="rounded-xl bg-muted/40 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                <p className="font-black text-base">{value ? `${value} ${unit}` : "—"}</p>
              </div>
            ))}
          </div>
        )}

        {/* Progress bar */}
        {progressPct > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress to goal</span>
              <span className="font-semibold text-foreground">{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        )}
      </CardContent>

      {/* Goal edit dialog */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Your Goal</DialogTitle>
            <DialogDescription>Define what you're training toward</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Primary Goal *</Label>
              <Input
                value={form.primaryGoal}
                onChange={(e) => setForm({ ...form, primaryGoal: e.target.value })}
                placeholder="e.g. Lose 10 kg, Build Muscle"
              />
              <div className="flex flex-wrap gap-1.5 mt-1">
                {GOAL_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setForm({ ...form, primaryGoal: s })}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors",
                      form.primaryGoal === s
                        ? "bg-foreground text-background border-foreground"
                        : "bg-muted/40 text-muted-foreground border-border hover:border-foreground/50"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Target Weight (kg)</Label>
                <Input type="number" step="0.5" placeholder="e.g. 75" value={form.targetWeightKg}
                  onChange={(e) => setForm({ ...form, targetWeightKg: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Target Body Fat %</Label>
                <Input type="number" step="0.5" placeholder="e.g. 15" value={form.targetBodyFatPct}
                  onChange={(e) => setForm({ ...form, targetBodyFatPct: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Target Date (optional)</Label>
              <Input type="date" value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
            </div>
            <Button onClick={() => void handleSave()} className="w-full cursor-pointer">
              <Check className="w-4 h-4 mr-2" /> Save Goal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Body Stats Card ──────────────────────────────────────────────────────────

function BodyStatsCard() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const updateExtended = useMutation(api.users.updateExtendedProfile);
  const [editing, setEditing] = useState(false);
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [heightUnit, setHeightUnit] = useState<"cm" | "ft">("cm");
  const [form, setForm] = useState({
    dateOfBirth: "", heightCm: "", weightKg: "", goalWeightKg: "",
    heightFt: "", heightIn: "",
  });

  if (currentUser === undefined) return <Skeleton className="h-40 w-full" />;
  if (!currentUser) return null;

  const age = currentUser.dateOfBirth
    ? differenceInYears(new Date(), parseISO(currentUser.dateOfBirth))
    : null;

  const openEdit = () => {
    const htFt = currentUser.heightCm ? Math.floor(currentUser.heightCm / 2.54 / 12) : "";
    const htIn = currentUser.heightCm ? Math.round((currentUser.heightCm / 2.54) % 12) : "";
    setForm({
      dateOfBirth: currentUser.dateOfBirth ?? "",
      heightCm: currentUser.heightCm?.toString() ?? "",
      weightKg: currentUser.weightKg?.toString() ?? "",
      goalWeightKg: currentUser.goalWeightKg?.toString() ?? "",
      heightFt: htFt.toString(),
      heightIn: htIn.toString(),
    });
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      let heightCm: number | undefined;
      if (heightUnit === "cm" && form.heightCm) {
        heightCm = parseFloat(form.heightCm);
      } else if (heightUnit === "ft" && form.heightFt) {
        const ft = parseFloat(form.heightFt);
        const inches = parseFloat(form.heightIn) || 0;
        heightCm = Math.round((ft * 12 + inches) * 2.54);
      }
      let weightKg: number | undefined = form.weightKg ? parseFloat(form.weightKg) : undefined;
      let goalWeightKg: number | undefined = form.goalWeightKg ? parseFloat(form.goalWeightKg) : undefined;
      if (weightUnit === "lbs") {
        if (weightKg) weightKg = lbsToKg(weightKg);
        if (goalWeightKg) goalWeightKg = lbsToKg(goalWeightKg);
      }
      await updateExtended({
        dateOfBirth: form.dateOfBirth || undefined,
        heightCm,
        weightKg,
        goalWeightKg,
      });
      toast.success("Stats updated!");
      setEditing(false);
    } catch { toast.error("Failed to save stats"); }
  };

  const stats = [
    { label: "Age", value: age !== null ? `${age} yrs` : "—", icon: <Calendar className="w-4 h-4" /> },
    { label: "Height", value: currentUser.heightCm ? cmToDisplay(currentUser.heightCm, heightUnit) : "—", icon: <Ruler className="w-4 h-4" /> },
    { label: "Weight", value: currentUser.weightKg ? kgToDisplay(currentUser.weightKg, weightUnit) : "—", icon: <Scale className="w-4 h-4" /> },
    { label: "Goal Wt", value: currentUser.goalWeightKg ? kgToDisplay(currentUser.goalWeightKg, weightUnit) : "—", icon: <Target className="w-4 h-4" /> },
  ];

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Body Stats</CardTitle>
              <div className="flex gap-1">
                <button
                  onClick={() => setWeightUnit((u) => u === "kg" ? "lbs" : "kg")}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  {weightUnit === "kg" ? "→ lbs" : "→ kg"}
                </button>
                <button
                  onClick={() => setHeightUnit((u) => u === "cm" ? "ft" : "cm")}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  {heightUnit === "cm" ? "→ ft" : "→ cm"}
                </button>
              </div>
            </div>
            <Button size="sm" variant="ghost" className="cursor-pointer h-7 px-2" onClick={openEdit}>
              <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2">
            {stats.map(({ label, value, icon }) => (
              <div key={label} className="rounded-xl bg-muted/40 px-2 py-3 text-center">
                <div className="flex justify-center text-muted-foreground mb-1">{icon}</div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                <p className="font-black text-sm mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Body Stats</DialogTitle>
            <DialogDescription>Update your personal measurements</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Date of Birth</Label>
              <Input type="date" value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </div>
            {/* Height */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Height</Label>
                <div className="flex gap-1">
                  {(["cm", "ft"] as const).map((u) => (
                    <button key={u} onClick={() => setHeightUnit(u)}
                      className={cn("text-xs px-2 py-0.5 rounded cursor-pointer", heightUnit === u ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              {heightUnit === "cm" ? (
                <Input type="number" placeholder="e.g. 178" value={form.heightCm}
                  onChange={(e) => setForm({ ...form, heightCm: e.target.value })} />
              ) : (
                <div className="flex gap-2">
                  <Input type="number" placeholder="ft" value={form.heightFt}
                    onChange={(e) => setForm({ ...form, heightFt: e.target.value })} />
                  <Input type="number" placeholder="in" value={form.heightIn}
                    onChange={(e) => setForm({ ...form, heightIn: e.target.value })} />
                </div>
              )}
            </div>
            {/* Weight */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Current Weight</Label>
                <div className="flex gap-1">
                  {(["kg", "lbs"] as const).map((u) => (
                    <button key={u} onClick={() => setWeightUnit(u)}
                      className={cn("text-xs px-2 py-0.5 rounded cursor-pointer", weightUnit === u ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <Input type="number" step="0.1" placeholder={weightUnit === "kg" ? "e.g. 80" : "e.g. 176"}
                value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Goal Weight ({weightUnit})</Label>
              <Input type="number" step="0.1" placeholder={weightUnit === "kg" ? "e.g. 72" : "e.g. 158"}
                value={form.goalWeightKg} onChange={(e) => setForm({ ...form, goalWeightKg: e.target.value })} />
            </div>
            <Button onClick={() => void handleSave()} className="w-full cursor-pointer">
              <Check className="w-4 h-4 mr-2" /> Save Stats
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Measurements Tab ─────────────────────────────────────────────────────────

function MeasurementsTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeMetric, setActiveMetric] = useState<keyof MeasurementFields>("weight");
  const [form, setForm] = useState<MeasurementForm>({
    date: format(new Date(), "yyyy-MM-dd"),
    notes: "",
  });

  const measurements = useQuery(api.measurements.list, {});
  const createMeasurement = useMutation(api.measurements.create);
  const removeMeasurement = useMutation(api.measurements.remove);

  const handleSubmit = async () => {
    const hasValue = MEASUREMENT_FIELDS.some((f) => form[f.key] !== undefined && form[f.key] !== null);
    if (!hasValue) { toast.error("Enter at least one measurement"); return; }
    try {
      const numericFields: MeasurementFields = {};
      for (const f of MEASUREMENT_FIELDS) {
        const raw = form[f.key];
        if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
          numericFields[f.key] = parseFloat(String(raw));
        }
      }
      await createMeasurement({
        date: new Date(form.date).setHours(12, 0, 0, 0),
        notes: form.notes || undefined,
        ...numericFields,
      });
      toast.success("Measurement logged!");
      setIsOpen(false);
      setForm({ date: format(new Date(), "yyyy-MM-dd"), notes: "" });
    } catch { toast.error("Failed to save measurement"); }
  };

  const handleDelete = async (id: Id<"measurements">) => {
    try {
      await removeMeasurement({ id });
      toast.success("Deleted");
    } catch { toast.error("Failed to delete"); }
  };

  if (measurements === undefined) return <Skeleton className="h-96 w-full" />;

  const chartData = measurements.map((m) => {
    const row: Record<string, number | string> = { date: format(new Date(m.date), "MMM d") };
    for (const f of MEASUREMENT_FIELDS) {
      if (m[f.key] !== undefined) row[f.key] = m[f.key] as number;
    }
    return row;
  });

  const latest = measurements[measurements.length - 1];
  const prev = measurements[measurements.length - 2];
  const delta = (key: keyof MeasurementFields) => {
    if (!latest || !prev || latest[key] === undefined || prev[key] === undefined) return null;
    return (latest[key] as number) - (prev[key] as number);
  };

  return (
    <div className="space-y-6">
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {MEASUREMENT_FIELDS.filter((f) => latest[f.key] !== undefined).slice(0, 4).map((f) => {
            const d = delta(f.key);
            return (
              <Card key={f.key} className="bg-card/50 backdrop-blur border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground font-medium">{f.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{latest[f.key]}{f.unit}</div>
                  {d !== null && (
                    <p className={`text-xs mt-1 ${d < 0 ? "text-green-400" : d > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {d > 0 ? "+" : ""}{d.toFixed(1)}{f.unit} since last
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {measurements.length >= 2 && (
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle>Progress Chart</CardTitle>
                <CardDescription>Trend over time</CardDescription>
              </div>
              <Select value={activeMetric} onValueChange={(v) => setActiveMetric(v as keyof MeasurementFields)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEASUREMENT_FIELDS.map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
                <Legend />
                <Line type="monotone" dataKey={activeMetric} stroke={CHART_COLORS[activeMetric] ?? "#3b82f6"} strokeWidth={2}
                  dot={{ r: 4, fill: CHART_COLORS[activeMetric] ?? "#3b82f6" }} activeDot={{ r: 6 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">History</h3>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="cursor-pointer"><Plus className="w-4 h-4 mr-2" />Log Measurement</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Log Measurements</DialogTitle>
              <DialogDescription>Record your body measurements. Fill in only what you measured.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {MEASUREMENT_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-sm">{f.label} ({f.unit})</Label>
                    <Input type="number" step="0.1" placeholder="—"
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "" ? undefined : parseFloat(e.target.value) })} />
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea placeholder="How are you feeling?" value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
              <Button onClick={() => void handleSubmit()} className="w-full cursor-pointer">Save Measurement</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {measurements.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Scale /></EmptyMedia>
            <EmptyTitle>No measurements yet</EmptyTitle>
            <EmptyDescription>Start logging to track your body composition over time</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setIsOpen(true)} className="cursor-pointer">
              <Plus className="w-4 h-4 mr-2" />Log First Measurement
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-3">
          {[...measurements].reverse().map((m) => (
            <Card key={m._id} className="bg-card/50 backdrop-blur border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{format(new Date(m.date), "EEEE, MMMM d, yyyy")}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => void handleDelete(m._id)}
                    className="text-destructive hover:text-destructive cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {MEASUREMENT_FIELDS.filter((f) => m[f.key] !== undefined).map((f) => (
                    <Badge key={f.key} variant="secondary" className="text-sm">
                      {f.label}: {m[f.key]}{f.unit}
                    </Badge>
                  ))}
                </div>
                {m.notes && <p className="text-sm text-muted-foreground mt-2">{m.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Photos Tab ───────────────────────────────────────────────────────────────

function PhotosTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"front" | "back" | "side">("front");
  const [weight, setWeight] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photos = useQuery(api.progressPhotos.list, {});
  const generateUploadUrl = useMutation(api.progressPhotos.generateUploadUrl);
  const createPhoto = useMutation(api.progressPhotos.create);
  const removePhoto = useMutation(api.progressPhotos.remove);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleUpload = async () => {
    if (!file) { toast.error("Please select a photo"); return; }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!result.ok) throw new Error("Upload failed");
      const { storageId } = await result.json() as { storageId: Id<"_storage"> };
      await createPhoto({ storageId, date: new Date(date).setHours(12, 0, 0, 0), view, weight: weight ? parseFloat(weight) : undefined, notes: notes || undefined });
      toast.success("Progress photo saved!");
      setIsOpen(false); setFile(null); setPreview(null); setWeight(""); setNotes("");
    } catch { toast.error("Failed to upload photo"); }
    finally { setUploading(false); }
  };

  const handleDelete = async (id: Id<"progressPhotos">) => {
    try { await removePhoto({ id }); toast.success("Photo deleted"); }
    catch { toast.error("Failed to delete photo"); }
  };

  if (photos === undefined) return <Skeleton className="h-96 w-full" />;

  const grouped: Record<string, typeof photos> = {};
  for (const p of photos) {
    const key = format(new Date(p.date), "yyyy-MM-dd");
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  }
  const VIEW_LABEL: Record<string, string> = { front: "Front", back: "Back", side: "Side" };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">Progress Photos</h3>
        <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) { setPreview(null); setFile(null); } }}>
          <DialogTrigger asChild>
            <Button className="cursor-pointer"><Camera className="w-4 h-4 mr-2" />Upload Photo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Progress Photo</DialogTitle>
              <DialogDescription>Upload a front, back, or side photo to track your transformation</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                {preview ? (
                  <div className="relative">
                    <img src={preview} alt="Preview" className="max-h-48 mx-auto rounded-lg object-cover" />
                    <button className="absolute top-1 right-1 bg-background/80 rounded-full p-1 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); setPreview(null); setFile(null); }}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 text-muted-foreground">
                    <Upload className="w-10 h-10 mx-auto opacity-40" />
                    <p className="text-sm">Click to select a photo</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>View</Label>
                  <Select value={view} onValueChange={(v) => setView(v as "front" | "back" | "side")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="front">Front</SelectItem>
                      <SelectItem value="back">Back</SelectItem>
                      <SelectItem value="side">Side</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Weight (kg, optional)</Label>
                  <Input type="number" step="0.1" placeholder="e.g. 82.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea placeholder="How are you feeling?" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              <Button onClick={() => void handleUpload()} disabled={uploading} className="w-full cursor-pointer">
                {uploading ? "Uploading…" : "Save Photo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {photos.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Image /></EmptyMedia>
            <EmptyTitle>No progress photos yet</EmptyTitle>
            <EmptyDescription>Upload your first photo to start tracking your visual transformation</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setIsOpen(true)} className="cursor-pointer">
              <Camera className="w-4 h-4 mr-2" />Upload First Photo
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)).map(([dateKey, dayPhotos]) => (
            <div key={dateKey}>
              <h4 className="font-semibold text-muted-foreground mb-3">
                {format(new Date(dateKey + "T12:00:00"), "EEEE, MMMM d, yyyy")}
                {dayPhotos[0].weight && <span className="ml-2 text-sm font-normal text-foreground">· {dayPhotos[0].weight} kg</span>}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {dayPhotos.map((photo) => (
                  <div key={photo._id} className="relative group rounded-xl overflow-hidden aspect-[3/4] bg-muted">
                    {photo.url ? (
                      <img src={photo.url} alt={`${photo.view} view`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Image className="w-8 h-8 opacity-40" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
                        <Badge variant="secondary" className="text-xs">{VIEW_LABEL[photo.view]}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => void handleDelete(photo._id)}
                          className="h-7 w-7 p-0 text-white hover:text-red-400 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="absolute top-2 left-2">
                      <Badge className="text-xs bg-black/50 text-white border-0">{VIEW_LABEL[photo.view]}</Badge>
                    </div>
                  </div>
                ))}
              </div>
              {dayPhotos[0].notes && <p className="text-sm text-muted-foreground mt-2">{dayPhotos[0].notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Workout History Tab ──────────────────────────────────────────────────────

function WorkoutHistoryTab() {
  const logs = useQuery(api.workoutLogs.listByUser, { limit: 30 });
  if (logs === undefined) return <Skeleton className="h-64 w-full" />;

  const weeklyCounts: Record<string, number> = {};
  for (const log of logs) {
    const d = new Date(log.completedAt);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = format(monday, "MMM d");
    weeklyCounts[key] = (weeklyCounts[key] ?? 0) + 1;
  }
  const weeklyChartData = Object.entries(weeklyCounts)
    .sort(([a], [b]) => new Date(a + " 2025").getTime() - new Date(b + " 2025").getTime())
    .map(([week, count]) => ({ week, count }));

  return (
    <div className="space-y-6">
      {logs.length >= 2 && (
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle>Workouts Per Week</CardTitle>
            <CardDescription>Your training frequency over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={weeklyChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
                <Line type="monotone" dataKey="count" name="Workouts" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: "#3b82f6" }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      {logs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Dumbbell /></EmptyMedia>
            <EmptyTitle>No workouts logged yet</EmptyTitle>
            <EmptyDescription>Complete workouts to see your training history here</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <Card key={log._id} className="bg-card/50 backdrop-blur border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-semibold">{log.workoutName}</p>
                    <p className="text-sm text-muted-foreground">{format(new Date(log.completedAt), "EEEE, MMM d · h:mm a")}</p>
                  </div>
                  <div className="flex gap-3 text-sm text-muted-foreground">
                    <span>{Math.round(log.duration / 60)} min</span>
                    <span>·</span>
                    <span>{log.exercises.length} exercises</span>
                  </div>
                </div>
                {log.notes && <p className="text-sm text-muted-foreground mt-2 italic">{log.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProgressContent() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const [showStats, setShowStats] = useState(true);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mb-0.5">GOAT WALK</p>
          <h1 className="text-3xl font-black tracking-tight">Progress</h1>
        </div>
        <Button asChild variant="secondary" size="sm" className="cursor-pointer gap-1.5">
          <Link to="/progress/analytics">
            <BarChart2 className="w-4 h-4" /> Analytics
          </Link>
        </Button>
      </div>

      {/* Goal Banner */}
      <GoalBanner
        weightKg={currentUser?.weightKg}
        startingWeightKg={currentUser?.startingWeightKg}
        goalWeightKg={currentUser?.goalWeightKg}
      />

      {/* Body Stats */}
      <div>
        <button
          onClick={() => setShowStats((s) => !s)}
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer mb-3"
        >
          {showStats ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Body Stats
        </button>
        <AnimatePresence>
          {showStats && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <BodyStatsCard />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="measurements">
        <TabsList className="mb-6">
          <TabsTrigger value="measurements" className="cursor-pointer">
            <Scale className="w-4 h-4 mr-2" />Measurements
          </TabsTrigger>
          <TabsTrigger value="photos" className="cursor-pointer">
            <Camera className="w-4 h-4 mr-2" />Photos
          </TabsTrigger>
          <TabsTrigger value="workouts" className="cursor-pointer">
            <TrendingUp className="w-4 h-4 mr-2" />Workouts
          </TabsTrigger>
          <TabsTrigger value="cardio_steps" className="cursor-pointer">
            <Activity className="w-4 h-4 mr-2" />Cardio & Steps
          </TabsTrigger>
        </TabsList>
        <TabsContent value="measurements"><MeasurementsTab /></TabsContent>
        <TabsContent value="photos"><PhotosTab /></TabsContent>
        <TabsContent value="workouts"><WorkoutHistoryTab /></TabsContent>
        <TabsContent value="cardio_steps"><ActivityAnalytics /></TabsContent>
      </Tabs>
    </motion.div>
  );
}

export default function ProgressPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <ProgressContent />
      </div>
    </Authenticated>
  );
}
