/**
 * Activity Analytics — Cardio trends, Step goal adherence, and summary stats.
 * Used in both the client's Progress page and the coach's Client Dashboard.
 */
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Activity, Footprints, Timer, Flame, TrendingUp, Target, CheckCircle } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils.ts";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type Props = {
  /** Pass clientId when viewing from coach dashboard. Omit when viewing own data. */
  userId?: Id<"users">;
};

export default function ActivityAnalytics({ userId }: Props) {
  const endDate = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), 29), "yyyy-MM-dd");

  const cardioAnalytics = useQuery(api.activities.cardio.getCardioAnalytics, { userId, startDate, endDate });
  const stepAnalytics = useQuery(api.activities.steps.getStepAnalytics, { userId, startDate, endDate });

  if (cardioAnalytics === undefined || stepAnalytics === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // ── Cardio chart data ───────────────────────────────────────────────────
  const cardioChartData = cardioAnalytics.logs.map(l => ({
    date: format(new Date(l.loggedDate + "T00:00:00"), "MMM d"),
    minutes: l.actualDurationMinutes,
    km: l.actualDistanceKm ?? 0,
  }));

  // ── Step chart data ─────────────────────────────────────────────────────
  const stepChartData = stepAnalytics.logs.map(l => ({
    date: format(new Date(l.loggedDate + "T00:00:00"), "MMM d"),
    steps: l.actualSteps,
  }));

  const hasCardio = cardioAnalytics.totalSessions > 0;
  const hasSteps = stepAnalytics.logs.length > 0;

  return (
    <div className="space-y-6">
      {/* ── Cardio Section ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-orange-400" />
          <h3 className="font-semibold">Cardio (Last 30 Days)</h3>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Sessions"
            value={String(cardioAnalytics.totalSessions)}
            icon={<Activity className="w-4 h-4 text-orange-400" />}
            color="border-orange-500/20"
          />
          <StatCard
            label="Total Time"
            value={cardioAnalytics.totalMinutes >= 60
              ? `${Math.floor(cardioAnalytics.totalMinutes / 60)}h ${cardioAnalytics.totalMinutes % 60}m`
              : `${cardioAnalytics.totalMinutes}m`
            }
            icon={<Timer className="w-4 h-4 text-orange-400" />}
            color="border-orange-500/20"
          />
          <StatCard
            label="Distance"
            value={cardioAnalytics.totalDistanceKm > 0 ? `${cardioAnalytics.totalDistanceKm.toFixed(1)} km` : "—"}
            icon={<TrendingUp className="w-4 h-4 text-orange-400" />}
            color="border-orange-500/20"
          />
        </div>

        {hasCardio && cardioChartData.length > 1 && (
          <Card className="bg-card/50 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cardio Duration (min)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={cardioChartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  />
                  <Bar dataKey="minutes" name="Minutes" fill="#f97316" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {!hasCardio && (
          <EmptyState icon={<Activity className="w-6 h-6 text-orange-400/40" />} text="No cardio sessions logged yet." />
        )}
      </div>

      {/* ── Step Goals Section ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Footprints className="w-4 h-4 text-teal-400" />
          <h3 className="font-semibold">Step Goals (Last 30 Days)</h3>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Avg Daily Steps"
            value={stepAnalytics.avgDailySteps > 0 ? stepAnalytics.avgDailySteps.toLocaleString() : "—"}
            icon={<Footprints className="w-4 h-4 text-teal-400" />}
            color="border-teal-500/20"
          />
          <StatCard
            label="Adherence"
            value={stepAnalytics.totalGoals > 0 ? `${stepAnalytics.adherencePct}%` : "—"}
            icon={<Target className="w-4 h-4 text-teal-400" />}
            color="border-teal-500/20"
          />
        </div>

        {stepAnalytics.totalGoals > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{stepAnalytics.goalsCompleted} / {stepAnalytics.totalGoals} goals met</span>
              <span className={cn("font-bold", stepAnalytics.adherencePct >= 80 ? "text-green-400" : "text-primary")}>
                {stepAnalytics.adherencePct}% adherence
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", stepAnalytics.adherencePct >= 80 ? "bg-green-500" : "bg-teal-500")}
                style={{ width: `${stepAnalytics.adherencePct}%` }}
              />
            </div>
          </div>
        )}

        {hasSteps && stepChartData.length > 1 && (
          <Card className="bg-card/50 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Daily Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={stepChartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => [v.toLocaleString(), "Steps"]}
                  />
                  <Line type="monotone" dataKey="steps" stroke="#2dd4bf" strokeWidth={2} dot={{ fill: "#2dd4bf", r: 3 }} name="Steps" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {!hasSteps && (
          <EmptyState icon={<Footprints className="w-6 h-6 text-teal-400/40" />} text="No steps logged yet." />
        )}
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className={cn("rounded-xl border p-3 bg-card/50 space-y-1", color)}>
      <div className="flex items-center gap-1 text-muted-foreground">{icon}<p className="text-[10px] uppercase tracking-wide">{label}</p></div>
      <p className="font-bold text-sm">{value}</p>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
