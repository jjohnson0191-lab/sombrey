import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Scale, Activity, Dumbbell, CheckCircle,
  Calendar, Target, Sparkles, ArrowLeft, Camera, Minus,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { motion } from "motion/react";
import { format, subWeeks, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "4w" | "8w" | "12w";

type AnalyticsData = NonNullable<
  Awaited<ReturnType<typeof useQuery<typeof api.progressAnalytics.getMyAnalytics>>>
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_WEEKS: Record<Period, number> = { "4w": 4, "8w": 8, "12w": 12 };

function filterByPeriod<T extends { completedAt?: string; checkInDate?: string }>(
  items: T[],
  period: Period
): T[] {
  const cutoff = subWeeks(new Date(), PERIOD_WEEKS[period]);
  return items.filter((item) => {
    const date = item.completedAt ?? item.checkInDate ?? "";
    return date >= cutoff.toISOString().slice(0, 10);
  });
}

function changeColor(val: number | null, invertPositive = false) {
  if (val === null) return "text-muted-foreground";
  if (val === 0) return "text-muted-foreground";
  const positive = invertPositive ? val < 0 : val > 0;
  return positive ? "text-green-400" : "text-red-400";
}

function ChangeIcon({ val, invertPositive = false }: { val: number | null; invertPositive?: boolean }) {
  if (val === null || val === 0) return <Minus className="w-3 h-3" />;
  const goingUp = val > 0;
  const isGood = invertPositive ? !goingUp : goingUp;
  return isGood
    ? <TrendingUp className="w-3 h-3 text-green-400" />
    : <TrendingDown className="w-3 h-3 text-red-400" />;
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: AnalyticsData }) {
  const cards = [
    {
      label: "Starting Weight",
      value: data.startingWeightKg ? `${data.startingWeightKg} kg` : "—",
      icon: <Scale className="w-4 h-4" />, bg: "bg-muted/50",
    },
    {
      label: "Current Weight",
      value: data.currentWeightKg ? `${data.currentWeightKg} kg` : "—",
      change: data.totalWeightChange,
      invertPositive: true, // losing weight = good for fat loss
      icon: <Scale className="w-4 h-4" />, bg: "bg-primary/10",
    },
    {
      label: "Starting Body Fat",
      value: data.startingBodyFatPct ? `${data.startingBodyFatPct}%` : "—",
      icon: <Target className="w-4 h-4" />, bg: "bg-muted/50",
    },
    {
      label: "Current Body Fat",
      value: data.currentBodyFatPct ? `${data.currentBodyFatPct}%` : "—",
      change: data.totalBodyFatChange,
      invertPositive: true,
      icon: <Target className="w-4 h-4" />, bg: "bg-blue-500/10",
    },
    {
      label: "Total Workouts",
      value: data.totalWorkoutsCompleted,
      icon: <Dumbbell className="w-4 h-4" />, bg: "bg-accent/10",
    },
    {
      label: "Total Check-ins",
      value: data.totalCheckIns,
      icon: <CheckCircle className="w-4 h-4" />, bg: "bg-green-500/10",
    },
    {
      label: "Current Week",
      value: data.currentPlanWeek ? `Week ${data.currentPlanWeek} / 12` : "—",
      icon: <Calendar className="w-4 h-4" />, bg: "bg-yellow-500/10",
    },
    {
      label: "This Week",
      value: `${data.workoutsThisWeek} workouts`,
      icon: <Activity className="w-4 h-4" />, bg: "bg-purple-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <Card className={cn("border-border", c.bg)}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{c.label}</p>
                <span className="text-muted-foreground">{c.icon}</span>
              </div>
              <p className="text-lg font-black">{c.value}</p>
              {"change" in c && c.change !== undefined && c.change !== null && (
                <p className={cn("text-xs flex items-center gap-0.5 mt-0.5", changeColor(c.change, c.invertPositive))}>
                  <ChangeIcon val={c.change} invertPositive={c.invertPositive} />
                  {c.change > 0 ? "+" : ""}{c.change} kg total
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Weight Chart ─────────────────────────────────────────────────────────────

function WeightChart({ data, period }: { data: AnalyticsData; period: Period }) {
  const filtered = filterByPeriod(data.checkInSeries, period);
  const chartData = filtered.map((ci) => ({
    date: format(parseISO(ci.checkInDate), "MMM d"),
    weight: ci.weightKg,
    week: `Week ${ci.weekNumber}`,
  }));

  if (chartData.length < 2) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Scale /></EmptyMedia>
          <EmptyTitle>Not enough data</EmptyTitle>
          <EmptyDescription>Complete 2+ check-ins to see your weight trend</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const minVal = Math.min(...chartData.map((d) => d.weight)) - 1;
  const maxVal = Math.max(...chartData.map((d) => d.weight)) + 1;

  // Trend direction
  const first = chartData[0].weight;
  const last = chartData[chartData.length - 1].weight;
  const trend = last - first;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge variant={trend <= 0 ? "default" : "secondary"} className={cn("text-xs", trend <= 0 ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30")}>
          {trend <= 0 ? <TrendingDown className="w-3 h-3 mr-1 inline" /> : <TrendingUp className="w-3 h-3 mr-1 inline" />}
          {trend > 0 ? "+" : ""}{Math.round(trend * 10) / 10} kg over period
        </Badge>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis domain={[minVal, maxVal]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
            formatter={(val: number) => [`${val} kg`, "Weight"]}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.week ?? label}
          />
          <Line
            type="monotone"
            dataKey="weight"
            name="Weight"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Body Fat Chart ───────────────────────────────────────────────────────────

function BodyFatChart({ data, period }: { data: AnalyticsData; period: Period }) {
  const filtered = filterByPeriod(data.checkInSeries, period).filter((ci) => ci.estimatedBodyFatPct !== null);
  const chartData = filtered.map((ci) => ({
    date: format(parseISO(ci.checkInDate), "MMM d"),
    bodyFat: ci.estimatedBodyFatPct,
    week: `Week ${ci.weekNumber}`,
  }));

  if (chartData.length < 2) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Target /></EmptyMedia>
          <EmptyTitle>No body fat data</EmptyTitle>
          <EmptyDescription>Body fat estimates appear after check-in AI assessments</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const trend = (chartData[chartData.length - 1].bodyFat ?? 0) - (chartData[0].bodyFat ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge className={cn("text-xs border", trend <= 0 ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30")}>
          {trend <= 0 ? <TrendingDown className="w-3 h-3 mr-1 inline" /> : <TrendingUp className="w-3 h-3 mr-1 inline" />}
          {trend > 0 ? "+" : ""}{Math.round(trend * 10) / 10}% over period
        </Badge>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
            formatter={(val: number) => [`${val}%`, "Body Fat"]}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.week ?? label}
          />
          <Line
            type="monotone"
            dataKey="bodyFat"
            name="Body Fat %"
            stroke="#f59e0b"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Workout Adherence Chart ──────────────────────────────────────────────────

function WorkoutAdherenceChart({ data, period }: { data: AnalyticsData; period: Period }) {
  const periodWeeks = PERIOD_WEEKS[period];
  const cutoff = subWeeks(new Date(), periodWeeks);
  const filtered = data.weeklyWorkoutCounts.filter((w) => w.week >= cutoff.toISOString().slice(0, 10));

  if (filtered.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Dumbbell /></EmptyMedia>
          <EmptyTitle>No workout data</EmptyTitle>
          <EmptyDescription>Complete workouts to see your adherence chart</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const chartData = filtered.map((w) => ({
    week: format(parseISO(w.week), "MMM d"),
    workouts: w.count,
  }));

  const avgWorkouts = filtered.reduce((s, w) => s + w.count, 0) / Math.max(filtered.length, 1);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Avg {Math.round(avgWorkouts * 10) / 10} workouts/week</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
            formatter={(val: number) => [val, "Workouts"]}
          />
          <Bar dataKey="workouts" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.workouts >= 3 ? "hsl(var(--primary))" : entry.workouts >= 2 ? "#f59e0b" : "#ef4444"}
                opacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary inline-block" />3+ workouts</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-400 inline-block" />2 workouts</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />0-1 workouts</span>
      </div>
    </div>
  );
}

// ─── Photo Comparison ─────────────────────────────────────────────────────────

function PhotoComparison({ data }: { data: AnalyticsData }) {
  const { photoComparison } = data;
  const slots = [
    { label: "Starting", entry: photoComparison.start, accent: "border-muted-foreground/40" },
    { label: "Previous", entry: photoComparison.previous, accent: "border-yellow-500/50" },
    { label: "Latest", entry: photoComparison.latest, accent: "border-primary/60" },
  ];

  const hasAny = slots.some((s) => s.entry?.url);

  if (!hasAny) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Camera /></EmptyMedia>
          <EmptyTitle>No progress photos</EmptyTitle>
          <EmptyDescription>Photos are added automatically from your weekly check-ins</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {slots.map(({ label, entry, accent }) => (
        <div key={label} className="space-y-1.5">
          <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wide">{label}</p>
          <div className={cn("rounded-xl overflow-hidden border-2 aspect-[3/4] bg-muted/30", accent)}>
            {entry?.url ? (
              <img src={entry.url} alt={`${label} check-in`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/40">
                <Camera className="w-8 h-8" />
                <p className="text-[10px]">No photo</p>
              </div>
            )}
          </div>
          {entry && (
            <div className="text-center space-y-0.5">
              <p className="text-xs text-muted-foreground">{format(parseISO(entry.date), "MMM d, yyyy")}</p>
              {entry.weightKg && <p className="text-xs font-bold">{entry.weightKg} kg</p>}
              {entry.bodyFatPct && <p className="text-[10px] text-muted-foreground">{entry.bodyFatPct}% BF</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Coach Insights Panel ─────────────────────────────────────────────────────

function CoachInsightsPanel({ data }: { data: AnalyticsData }) {
  // Calculate adherence metrics
  const targetWorkoutsPerWeek = 4; // assumed target
  const totalWeeks = data.currentPlanWeek ?? 1;

  // Workout completion rate: actual workouts vs expected
  const expectedWorkouts = totalWeeks * targetWorkoutsPerWeek;
  const workoutCompletionRate = expectedWorkouts > 0
    ? Math.min(100, Math.round((data.totalWorkoutsCompleted / expectedWorkouts) * 100))
    : 0;

  // Check-in completion rate: actual check-ins vs expected (1/week)
  const checkInRate = totalWeeks > 0
    ? Math.min(100, Math.round((data.checkInsTotal / totalWeeks) * 100))
    : 0;

  // Weekly adherence: weeks with 3+ workouts / total weeks with data
  const weeksWithData = data.weeklyWorkoutCounts.length;
  const adherentWeeks = data.weeklyWorkoutCounts.filter((w) => w.count >= 3).length;
  const adherencePct = weeksWithData > 0 ? Math.round((adherentWeeks / weeksWithData) * 100) : 0;

  const metrics = [
    {
      label: "Workout Adherence",
      value: `${adherencePct}%`,
      desc: `${adherentWeeks}/${weeksWithData} weeks with 3+ workouts`,
      color: adherencePct >= 75 ? "text-green-400" : adherencePct >= 50 ? "text-yellow-400" : "text-red-400",
      progress: adherencePct,
    },
    {
      label: "Workout Completion",
      value: `${workoutCompletionRate}%`,
      desc: `${data.totalWorkoutsCompleted} of ~${expectedWorkouts} expected`,
      color: workoutCompletionRate >= 75 ? "text-green-400" : workoutCompletionRate >= 50 ? "text-yellow-400" : "text-red-400",
      progress: workoutCompletionRate,
    },
    {
      label: "Check-in Rate",
      value: `${checkInRate}%`,
      desc: `${data.checkInsTotal} of ${totalWeeks} weeks checked in`,
      color: checkInRate >= 75 ? "text-green-400" : checkInRate >= 50 ? "text-yellow-400" : "text-red-400",
      progress: checkInRate,
    },
  ];

  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-yellow-400" />
          <CardTitle className="text-sm">Coach Insights</CardTitle>
        </div>
        <CardDescription>Client adherence and completion rates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics.map((m) => (
          <div key={m.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{m.label}</span>
              <span className={cn("text-sm font-bold", m.color)}>{m.value}</span>
            </div>
            <Progress value={m.progress} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground">{m.desc}</p>
          </div>
        ))}

        {/* Quick summary */}
        <div className="border-t border-border/50 pt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Total Workouts", value: data.totalWorkoutsCompleted },
            { label: "Check-ins", value: data.checkInsTotal },
            { label: "This Week", value: `${data.workoutsThisWeek}` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-muted/30 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="font-bold text-sm">{value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Plan Progress Bar ────────────────────────────────────────────────────────

function PlanProgressBar({ data }: { data: AnalyticsData }) {
  if (!data.currentPlanWeek) return null;
  const pct = Math.round((data.currentPlanWeek / data.totalPlanWeeks) * 100);
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">12-Week Plan Progress</span>
          </div>
          <Badge variant="secondary" className="text-xs">{pct}% complete</Badge>
        </div>
        {data.planGoal && (
          <p className="text-xs text-muted-foreground mb-2 capitalize">{data.planGoal.replace(/_/g, " ")}</p>
        )}
        <Progress value={pct} className="h-2.5" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
          <span>Week {data.currentPlanWeek}</span>
          <span>Week {data.totalPlanWeeks}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── AI Insights ──────────────────────────────────────────────────────────────

function AiInsights({ data }: { data: AnalyticsData }) {
  const [insights, setInsights] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generateInsights = useAction(api.ai.progressInsights.generateInsights);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const recentWeights = data.checkInSeries
        .filter((ci) => !ci.isInitialCheckIn)
        .slice(-5)
        .map((ci) => ci.weightKg);

      const result = await generateInsights({
        weightChange: data.totalWeightChange ?? undefined,
        bodyFatChange: data.totalBodyFatChange ?? undefined,
        totalWorkouts: data.totalWorkoutsCompleted,
        totalCheckIns: data.totalCheckIns,
        currentWeek: data.currentPlanWeek ?? undefined,
        planGoal: data.planGoal ?? undefined,
        recentWeights,
        workoutsThisWeek: data.workoutsThisWeek,
      });
      setInsights(result.insights);
    } catch {
      toast.error("Failed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm">AI Progress Insights</CardTitle>
          </div>
          <Button
            size="sm"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className="cursor-pointer h-7 text-xs"
          >
            {loading ? "Analyzing…" : insights ? "Refresh" : "Analyze"}
          </Button>
        </div>
        <CardDescription>AI-powered analysis of your progress trends</CardDescription>
      </CardHeader>
      <CardContent>
        {insights ? (
          <p className="text-sm leading-relaxed">{insights}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click Analyze to get personalized AI insights based on your weight trends, workout adherence, and check-in consistency.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Analytics Component ─────────────────────────────────────────────────

type AnalyticsContentProps = {
  /** If provided, shows coach view of this client */
  clientId?: Id<"users">;
  /** Back URL override */
  backTo?: string;
  clientName?: string;
};

export function AnalyticsContent({ clientId, backTo, clientName }: AnalyticsContentProps) {
  const [period, setPeriod] = useState<Period>("12w");

  // Use the right query depending on context
  const myData = useQuery(
    api.progressAnalytics.getMyAnalytics,
    clientId ? "skip" : {}
  );
  const clientData = useQuery(
    api.progressAnalytics.getClientAnalytics,
    clientId ? { clientId } : "skip"
  );

  const data = clientId ? clientData : myData;

  if (data === undefined) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4,5,6,7,8].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Activity /></EmptyMedia>
          <EmptyTitle>No analytics data yet</EmptyTitle>
          <EmptyDescription>Complete your onboarding, baseline check-in, and first workout to start seeing analytics</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const title = clientName ? `${clientName}'s Analytics` : "Progress Analytics";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {backTo && (
            <Button variant="ghost" size="icon" asChild className="cursor-pointer shrink-0">
              <Link to={backTo}><ArrowLeft className="w-5 h-5" /></Link>
            </Button>
          )}
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-widest mb-0.5">GOAT WALK</p>
            <h1 className="text-2xl font-black tracking-tight">{title}</h1>
          </div>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="4w">4 Weeks</SelectItem>
            <SelectItem value="8w">8 Weeks</SelectItem>
            <SelectItem value="12w">12 Weeks</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Plan progress bar */}
      <PlanProgressBar data={data} />

      {/* Summary cards */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Progress Summary</h2>
        <SummaryCards data={data} />
      </div>

      {/* Weight chart */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm">Weight Progress</CardTitle>
          </div>
          <CardDescription>From your weekly check-ins</CardDescription>
        </CardHeader>
        <CardContent>
          <WeightChart data={data} period={period} />
        </CardContent>
      </Card>

      {/* Body fat chart */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-yellow-400" />
            <CardTitle className="text-sm">Body Fat % Progress</CardTitle>
          </div>
          <CardDescription>AI-estimated from check-in photos</CardDescription>
        </CardHeader>
        <CardContent>
          <BodyFatChart data={data} period={period} />
        </CardContent>
      </Card>

      {/* Workout adherence */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-4 h-4 text-accent" />
            <CardTitle className="text-sm">Workout Adherence</CardTitle>
          </div>
          <CardDescription>Workouts completed per week</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkoutAdherenceChart data={data} period={period} />
        </CardContent>
      </Card>

      {/* Photo comparison */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-purple-400" />
            <CardTitle className="text-sm">Photo Comparison</CardTitle>
          </div>
          <CardDescription>Start · Previous · Latest from your check-ins</CardDescription>
        </CardHeader>
        <CardContent>
          <PhotoComparison data={data} />
        </CardContent>
      </Card>

      {/* AI insights (only for own analytics — not coach view) */}
      {!clientId && <AiInsights data={data} />}

      {/* Coach Insights — only in coach view */}
      {clientId && <CoachInsightsPanel data={data} />}
    </motion.div>
  );
}

// ─── Standalone page ──────────────────────────────────────────────────────────

function ProgressAnalyticsContent() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
      <AnalyticsContent backTo="/progress" />
    </div>
  );
}

export default function ProgressAnalyticsPage() {
  return (
    <Authenticated>
      <ProgressAnalyticsContent />
    </Authenticated>
  );
}

// ─── Coach view (used inside client profile) ──────────────────────────────────

export function ClientAnalyticsTab({ clientId, clientName }: { clientId: Id<"users">; clientName?: string }) {
  return <AnalyticsContent clientId={clientId} clientName={clientName} backTo={`/coach/clients/${clientId}`} />;
}
