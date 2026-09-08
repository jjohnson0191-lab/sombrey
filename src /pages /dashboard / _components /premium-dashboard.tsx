/**
 * PremiumDashboardContent — unified client dashboard
 *
 * Layout:
 *   Header (greeting + avatar)
 *   [Live coaching banner — 1-on-1 clients only]
 *   ── TOP SUMMARY CARDS (always visible) ──────────────────────────────
 *   1. TodayWorkoutCard   2. NutritionProgressCard
 *   3. PlanProgressCard   4. CheckInWidget (countdown)
 *   ────────────────────────────────────────────────────────────────────
 *   Tab bar: Today | Workout | Nutrition | AI
 *   Tab content
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Sparkles,
  Dumbbell,
  UtensilsCrossed,
  Camera,
  Activity,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Flame,
  Target,
  Crown,
  ArrowRight,
  Home,
  Zap,
  BookOpen,
  Lock,
  Scale,
  TrendingUp,
  CheckCircle2,
  Play,
  AlertTriangle,
  Trophy,
  Apple,
  Users,
  MessageSquare,
  Plus,
  LayoutGrid,
  ScanLine,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth.ts";
import { cn } from "@/lib/utils.ts";
import { computeTargetReps, nextTargetReps, formatTargetReps } from "@/lib/progression.ts";
import { toast } from "sonner";
import CameraAIDialog from "./camera-ai-dialog.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "today" | "workout" | "nutrition" | "ai";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "today", label: "Today", icon: <Home className="w-3.5 h-3.5" /> },
  { id: "workout", label: "Workout", icon: <Dumbbell className="w-3.5 h-3.5" /> },
  { id: "nutrition", label: "Nutrition", icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
  { id: "ai", label: "AI", icon: <Sparkles className="w-3.5 h-3.5" /> },
];

const PHASE_LABELS: Record<string, string> = {
  metabolic_rewire: "Metabolic Rewire",
  anabolic_surge: "Anabolic Surge",
  body_recode: "Body Recode",
};

// ─── Macro Bar ─────────────────────────────────────────────────────────────────

function MacroBar({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
}) {
  const pct = Math.min(Math.round((value / Math.max(target, 1)) * 100), 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">
          {Math.round(value)}<span className="text-muted-foreground font-normal">/{target}g</span>
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", color)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

// ─── Quick Action Button ───────────────────────────────────────────────────────

function QuickAction({
  icon,
  label,
  desc,
  to,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  to?: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <Card className={cn(
      "border-border bg-card transition-all duration-200 h-full hover:-translate-y-0.5 hover:shadow-lg",
      accent
        ? "border-primary/35 bg-gradient-to-br from-primary/8 to-primary/3 hover:border-primary/60 hover:shadow-primary/15"
        : "hover:border-border/80 hover:bg-muted/15"
    )}>
      <CardContent className="p-4 flex flex-col gap-3 min-h-[110px]">
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200",
          accent
            ? "bg-primary/20 text-primary group-hover:bg-primary/30"
            : "bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10"
        )}>
          {icon}
        </div>
        <div>
          <p className={cn("font-bold text-sm", accent ? "text-primary" : "group-hover:text-foreground")}>{label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (onClick) {
    return (
      <button onClick={onClick} className="cursor-pointer block group w-full text-left">
        {inner}
      </button>
    );
  }

  return (
    <Link to={to ?? "/"} className="cursor-pointer block group">
      {inner}
    </Link>
  );
}

// ─── Today's Workout Card ─────────────────────────────────────────────────────

export function TodayWorkoutCard({ compact }: { compact?: boolean }) {
  const todayWorkout = useQuery(api.aiWorkouts.getTodayWorkout, {});

  if (todayWorkout === undefined) return <Skeleton className="h-24 w-full" />;
  if (!todayWorkout) return null;

  if (todayWorkout.isRestDay) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rest Day</p>
            <p className="text-sm font-semibold">Week {todayWorkout.currentWeek} · Recovery</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const exerciseCount = todayWorkout.exercises.length;
  const allLogged = todayWorkout.loggedToday;
  const hasBaseline = todayWorkout.exercises.some((e) => e.isBaseline);
  const hasPlateaus = todayWorkout.exercises.some((e) => e.hasPlateaued);

  return (
    <Link to="/ai-workout" className="cursor-pointer block group">
      <Card className={cn(
        "border-border bg-card overflow-hidden relative transition-all hover:-translate-y-0.5",
        allLogged
          ? "border-primary/25 bg-primary/3"
          : "border-primary/40 bg-gradient-to-br from-primary/8 to-primary/3 hover:border-primary/60"
      )}>
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                {allLogged
                  ? <CheckCircle2 className="w-5 h-5 text-primary" />
                  : <Play className="w-5 h-5 text-primary" />
                }
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  {allLogged ? "Workout Done" : "Today's Workout"}
                </p>
                <p className="font-black text-base leading-tight">{todayWorkout.workoutDayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasBaseline && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Baseline</Badge>
              )}
              {hasPlateaus && (
                <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-[9px] px-1.5 py-0 gap-0.5">
                  <AlertTriangle className="w-2.5 h-2.5" />Plateau
                </Badge>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {!compact && (
            <div className="space-y-1.5 mb-3">
              {todayWorkout.exercises.slice(0, 3).map((ex) => (
                <div key={ex.exerciseName} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground truncate flex-1">{ex.exerciseName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {ex.currentWeightKg && (
                      <span className="font-bold text-foreground">{ex.currentWeightKg}kg</span>
                    )}
                    <span className="text-[10px] text-primary/70 font-medium">
                      {formatTargetReps(ex.targetReps)}
                    </span>
                  </div>
                </div>
              ))}
              {exerciseCount > 3 && (
                <p className="text-[10px] text-muted-foreground">+{exerciseCount - 3} more exercises</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Week {todayWorkout.currentWeek} · {exerciseCount} exercises</span>
            <div className={cn(
              "flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg",
              allLogged
                ? "bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground"
            )}>
              {allLogged ? <><CheckCircle2 className="w-3.5 h-3.5" /> Logged</> : <><Play className="w-3.5 h-3.5" /> Start Workout</>}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Plan Progress Card ───────────────────────────────────────────────────────

export function PlanProgressCard({ compact }: { compact?: boolean }) {
  const progress = useQuery(api.weeklyCheckIns.getPlanProgress, {});

  if (!progress) return null;

  const { currentWeek, totalWeeks, startDate, endDate, primaryGoal } = progress;
  const progressPct = Math.round(((currentWeek - 1) / totalWeeks) * 100);
  const weeksCompleted = currentWeek - 1;
  const weeksRemaining = totalWeeks - (currentWeek - 1);
  const goalLabel = primaryGoal ? primaryGoal.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "12-Week Plan";

  return (
    <Link to="/ai-plan" className="cursor-pointer block group">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/8 to-primary/3 overflow-hidden relative transition-all hover:-translate-y-0.5 hover:border-primary/50">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary/80 to-primary/0" />
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                <Crown className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Current Plan Progress</p>
                <p className="font-black text-base leading-tight mt-0.5">{goalLabel}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>

          <div className="space-y-1.5 mb-3">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-primary font-bold">Week {currentWeek} / {totalWeeks}</span>
              <span className="text-muted-foreground">{progressPct}% complete</span>
            </div>
            <div className="h-2.5 bg-muted/60 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>

          {!compact && (
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center">
                <p className="text-base font-black text-primary">{weeksCompleted}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Done</p>
              </div>
              <div className="text-center">
                <p className="text-base font-black">{weeksRemaining}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Left</p>
              </div>
              <div className="text-center">
                {startDate ? (
                  <>
                    <p className="text-[11px] font-bold">{new Date(startDate).toLocaleDateString("en", { month: "short", day: "numeric" })}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Start</p>
                  </>
                ) : <p className="text-[10px] text-muted-foreground">—</p>}
              </div>
              <div className="text-center">
                {endDate ? (
                  <>
                    <p className="text-[11px] font-bold">{new Date(endDate).toLocaleDateString("en", { month: "short", day: "numeric" })}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">End</p>
                  </>
                ) : <p className="text-[10px] text-muted-foreground">—</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Latest Check-In Summary Card ─────────────────────────────────────────────

export function LatestCheckInCard() {
  const latest = useQuery(api.weeklyCheckIns.getLatestCheckIn, {});

  if (latest === undefined) return null;
  if (!latest) return null;

  const photoUrl = latest.frontPhotoUrl ?? latest.sidePhotoUrl ?? latest.backPhotoUrl;
  const dateStr = new Date(latest.submittedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
  const isBaseline = latest.isInitialCheckIn === true;
  const weekLabel = isBaseline ? "Baseline" : `Week ${latest.weekNumber}`;

  return (
    <Link to="/check-in" className="cursor-pointer block group">
      <Card className="border-border bg-card overflow-hidden transition-all hover:-translate-y-0.5 hover:border-border/80">
        <CardContent className="p-0">
          <div className="flex items-stretch gap-0">
            {photoUrl ? (
              <div className="w-24 shrink-0 relative overflow-hidden rounded-l-xl">
                <img src={photoUrl} alt="Progress" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-card/20" />
              </div>
            ) : (
              <div className="w-24 shrink-0 bg-muted/40 flex items-center justify-center rounded-l-xl">
                <Camera className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}

            <div className="flex-1 p-3 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Latest Check-In</span>
                </div>
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{weekLabel}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">{dateStr}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {latest.weightKg != null && (
                  <div>
                    <p className="text-xs font-black">{latest.weightKg}kg</p>
                    <p className="text-[9px] text-muted-foreground">Weight</p>
                  </div>
                )}
                {latest.estimatedBodyFatPct != null && (
                  <div>
                    <p className="text-xs font-black">~{latest.estimatedBodyFatPct}%</p>
                    <p className="text-[9px] text-muted-foreground">Body Fat</p>
                  </div>
                )}
                {latest.estimatedBMI != null && (
                  <div>
                    <p className="text-xs font-black">{latest.estimatedBMI}</p>
                    <p className="text-[9px] text-muted-foreground">BMI</p>
                  </div>
                )}
              </div>
              {(latest.waistCm != null || latest.chestCm != null) && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {latest.waistCm != null && (
                    <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">Waist {latest.waistCm}cm</span>
                  )}
                  {latest.chestCm != null && (
                    <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">Chest {latest.chestCm}cm</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Check-In Countdown Widget ────────────────────────────────────────────────

export function CheckInWidget() {
  const progress = useQuery(api.weeklyCheckIns.getPlanProgress, {});

  if (progress === undefined || !progress) return null;

  const { currentWeek, totalWeeks, daysUntilCheckIn, checkInDue, isLocked } = progress;
  const progressPct = Math.round((currentWeek / totalWeeks) * 100);
  const isUrgent = checkInDue || isLocked;

  return (
    <Link to="/check-in" className="cursor-pointer block group">
      <Card className={cn(
        "border-border bg-card overflow-hidden relative transition-all hover:-translate-y-0.5",
        isLocked ? "border-destructive/30 bg-destructive/5"
          : checkInDue ? "border-primary/40 bg-primary/5"
          : "border-border"
      )}>
        {isLocked && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-destructive/0 via-destructive/60 to-destructive/0" />}
        {checkInDue && !isLocked && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />}
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center",
                isLocked ? "bg-destructive/15" : checkInDue ? "bg-primary/20" : "bg-muted"
              )}>
                {isLocked
                  ? <Lock className="w-4 h-4 text-destructive" />
                  : <Target className={cn("w-4 h-4", checkInDue ? "text-primary" : "text-muted-foreground")} />
                }
              </div>
              <div>
                <p className={cn("text-xs font-bold uppercase tracking-wider",
                  isLocked ? "text-destructive"
                  : checkInDue ? "text-primary"
                  : "text-muted-foreground"
                )}>
                  {isLocked ? "Check-In Required" : checkInDue ? "Check-In Due Today" : "Next Check-In"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isLocked
                    ? "Submit to unlock this week's plan"
                    : daysUntilCheckIn === 0
                    ? "Submit your weekly progress"
                    : `In ${daysUntilCheckIn} day${daysUntilCheckIn !== 1 ? "s" : ""}`
                  }
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-muted-foreground">Week {currentWeek} of {totalWeeks}</span>
              <span className={cn(isUrgent ? (isLocked ? "text-destructive" : "text-primary") : "text-muted-foreground")}>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className={cn("h-1.5",
              isLocked ? "[&>div]:bg-destructive/60"
              : checkInDue ? "[&>div]:bg-primary"
              : ""
            )} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Nutrition Progress Card ──────────────────────────────────────────────────

export function NutritionProgressCard({ onLogMeal }: { onLogMeal?: () => void }) {
  const progress = useQuery(api.nutritionLogs.getTodayProgress, {
    localDate: new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
  });

  if (progress === undefined) return <Skeleton className="h-28 w-full" />;
  if (!progress) return null;

  const {
    caloriesConsumed, caloriesTarget,
    proteinConsumed, proteinTarget,
    mealsCompleted, totalMealsToday,
  } = progress;

  const calPct = Math.min(Math.round((caloriesConsumed / Math.max(caloriesTarget, 1)) * 100), 100);
  const mealPct = totalMealsToday > 0 ? Math.min(Math.round((mealsCompleted / totalMealsToday) * 100), 100) : 0;

  return (
    <Card className="border-border bg-card overflow-hidden relative transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <Link to="/nutrition" className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer group">
            <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Apple className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Meal Progress</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalMealsToday > 0
                  ? `${mealsCompleted} of ${totalMealsToday} meals completed`
                  : "Track your meals today"}
              </p>
            </div>
          </Link>
          {onLogMeal && (
            <button
              onClick={onLogMeal}
              className="cursor-pointer flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors px-2.5 py-1.5 rounded-lg shrink-0"
            >
              <Plus className="w-3 h-3" /> Log
            </button>
          )}
        </div>

        {totalMealsToday > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Meals</span>
              <span className="font-semibold">{mealsCompleted}<span className="text-muted-foreground font-normal">/{totalMealsToday}</span></span>
            </div>
            <div className="h-2 bg-muted/60 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70"
                initial={{ width: 0 }}
                animate={{ width: `${mealPct}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground flex items-center gap-1"><Flame className="w-3 h-3" />Calories</span>
              <span className="font-semibold text-primary">{caloriesConsumed}<span className="text-muted-foreground font-normal">/{caloriesTarget}</span></span>
            </div>
            <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${calPct}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Protein</span>
              <span className="font-semibold">{proteinConsumed}g<span className="text-muted-foreground font-normal">/{proteinTarget}g</span></span>
            </div>
            <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-chart-2"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(Math.round((proteinConsumed / Math.max(proteinTarget, 1)) * 100), 100)}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Today Tab ────────────────────────────────────────────────────────────────

function TodayTab({ onOpenCameraAI }: { onOpenCameraAI: () => void }) {
  const stats = useQuery(api.users.getClientStats, {});
  const aiPlan = useQuery(api.premiumOnboarding.getMyAiPlan, {});
  const recentLogs = useQuery(api.workoutLogs.listByUser, { limit: 3 });

  const proteinToday = Math.round(stats?.proteinToday ?? 0);

  return (
    <div className="space-y-5">
      {/* Stats strip */}
      <Card className="border-border bg-card">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-around">
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-black">{stats?.workoutsThisWeek ?? 0}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">This Week</span>
            </div>
            <div className="w-px h-7 bg-border" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-black">{stats?.streak ?? 0} 🔥</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Streak</span>
            </div>
            <div className="w-px h-7 bg-border" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-black">{proteinToday}g</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Protein</span>
            </div>
            <div className="w-px h-7 bg-border" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-black">{stats?.totalWorkouts ?? 0}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Quick Actions</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction icon={<UtensilsCrossed className="w-5 h-5" />} label="Log Meal" desc="Track your nutrition calendar" to="/nutrition" />
          <QuickAction icon={<Dumbbell className="w-5 h-5" />} label="Start Workout" desc="AI progressive overload" to="/ai-workout" />
          <QuickAction icon={<ScanLine className="w-5 h-5" />} label="AI Macro Calculator" desc="Photo → instant macros" onClick={onOpenCameraAI} accent />
          <QuickAction icon={<Camera className="w-5 h-5" />} label="Check-In" desc="Weekly progress photo" to="/check-in" />
          <QuickAction icon={<BarChart3 className="w-5 h-5" />} label="Progress" desc="Photos & metrics" to="/progress" />
          <QuickAction icon={<BarChart3 className="w-5 h-5" />} label="Analytics" desc="Charts & insights" to="/progress/analytics" />
          <QuickAction icon={<Sparkles className="w-5 h-5" />} label="AI Coach" desc="Ask your AI coach anything" to="/ai-coach" />
        </div>
      </div>

      {/* AI Plan meals preview */}
      {aiPlan?.status === "ready" && aiPlan.meals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Today's Meals</h3>
            <Link to="/nutrition" className="text-xs text-primary hover:underline cursor-pointer">View all</Link>
          </div>
          <div className="space-y-2">
            {aiPlan.meals.slice(0, 3).map((meal, i) => (
              <Link key={i} to="/nutrition" className="cursor-pointer block">
                <Card className="border-border bg-card hover:bg-muted/20 transition-colors">
                  <CardContent className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <UtensilsCrossed className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{meal.name}</p>
                        {meal.time && <p className="text-[10px] text-muted-foreground">{meal.time}</p>}
                      </div>
                    </div>
                    {meal.calories && (
                      <span className="text-xs font-bold shrink-0 text-muted-foreground">{meal.calories} kcal</span>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent workouts */}
      {recentLogs && recentLogs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent Workouts</h3>
            <Link to="/programs" className="text-xs text-primary hover:underline cursor-pointer">View all</Link>
          </div>
          <div className="space-y-2">
            {recentLogs.map((log) => (
              <Card key={log._id} className="border-border bg-card">
                <CardContent className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Dumbbell className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{log.workoutName}</p>
                      <p className="text-[10px] text-muted-foreground">{format(new Date(log.completedAt), "EEE MMM d")}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{Math.round(log.duration / 60)}m</p>
                    <p className="text-[10px] text-muted-foreground">{log.exercises.length} ex</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workout Tab ──────────────────────────────────────────────────────────────

function WorkoutTab() {
  const aiPlan = useQuery(api.premiumOnboarding.getMyAiPlan, {});
  const stats = useQuery(api.users.getClientStats, {});
  const navigate = useNavigate();

  const todayName = new Date().toLocaleDateString("en", { weekday: "long" });
  const todaySchedule = aiPlan?.weeklySchedule?.find((s) =>
    s.day.toLowerCase().startsWith(todayName.toLowerCase().slice(0, 3))
  );
  const todayWorkout = aiPlan?.workoutDays?.find((w) =>
    todaySchedule && w.dayName.toLowerCase().includes(todaySchedule.type.toLowerCase().slice(0, 4))
  );

  return (
    <div className="space-y-5">
      {aiPlan?.status === "ready" && todayWorkout ? (
        <Card className="border-primary/40 bg-primary/5 overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Today — {todaySchedule?.type}</span>
            </div>
            <h2 className="text-xl font-black mb-1">{todayWorkout.dayName}</h2>
            {todaySchedule?.focus && <p className="text-sm text-muted-foreground mb-4">{todaySchedule.focus}</p>}
            <div className="space-y-2 mb-4">
              {todayWorkout.exercises.slice(0, 5).map((ex, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{ex.name}</p>
                    {ex.notes && <p className="text-[10px] text-muted-foreground truncate">{ex.notes}</p>}
                  </div>
                  <span className="text-xs font-bold shrink-0 text-muted-foreground">
                    {ex.sets}×{ex.reps}
                  </span>
                </div>
              ))}
              {todayWorkout.exercises.length > 5 && (
                <p className="text-xs text-muted-foreground">+{todayWorkout.exercises.length - 5} more exercises</p>
              )}
            </div>
            <Button className="w-full cursor-pointer" onClick={() => navigate("/ai-workout")}>
              Start Workout <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      ) : aiPlan?.status === "ready" && todaySchedule?.type === "Rest" ? (
        <Card className="border-border bg-card">
          <CardContent className="p-5 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Activity className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-bold">Rest Day</h3>
            <p className="text-sm text-muted-foreground mt-1">Recovery is training. Get your sleep and nutrition right.</p>
          </CardContent>
        </Card>
      ) : null}

      {aiPlan?.status === "ready" && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">This Week</h3>
          <div className="grid grid-cols-7 gap-1">
            {aiPlan.weeklySchedule.map((s, i) => {
              const isToday = s.day.toLowerCase().startsWith(todayName.toLowerCase().slice(0, 3));
              const isRest = s.type.toLowerCase() === "rest";
              return (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg py-2 px-1 text-center transition-colors",
                    isToday ? "bg-primary/20 border border-primary/40" : "bg-muted/30"
                  )}
                >
                  <span className="text-[9px] font-bold uppercase text-muted-foreground">{s.day.slice(0, 2)}</span>
                  <div className={cn("w-5 h-5 rounded-full flex items-center justify-center", isRest ? "bg-muted" : "bg-primary/20")}>
                    {isRest ? (
                      <span className="text-[8px] text-muted-foreground">R</span>
                    ) : (
                      <Dumbbell className="w-2.5 h-2.5 text-primary" />
                    )}
                  </div>
                  <span className={cn("text-[8px] font-medium leading-tight", isToday ? "text-primary" : "text-muted-foreground")}>
                    {s.type.slice(0, 4)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!aiPlan && stats?.activeProgram && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Active Program</span>
            </div>
            <h3 className="font-bold">{stats.activeProgram.programName}</h3>
            <Badge variant="secondary" className="text-[10px] mt-1">
              {PHASE_LABELS[stats.activeProgram.programPhase ?? ""] || "Active"}
            </Badge>
            <div className="mt-3 space-y-1">
              <Progress
                value={Math.round(((stats.activeProgram.currentWeek - 1) / (stats.activeProgram.programDuration || 1)) * 100)}
                className="h-1.5"
              />
              <p className="text-[10px] text-muted-foreground">Week {stats.activeProgram.currentWeek}/{stats.activeProgram.programDuration}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <QuickAction icon={<BookOpen className="w-5 h-5" />} label="Exercise Library" desc="Browse all exercises" to="/exercises" />
        <QuickAction icon={<CalendarDays className="w-5 h-5" />} label="Calendar" desc="Schedule & sessions" to="/calendar" />
        <QuickAction icon={<Activity className="w-5 h-5" />} label="Programs" desc="Browse programs" to="/programs" />
        <QuickAction icon={<BarChart3 className="w-5 h-5" />} label="Progress" desc="Photos & metrics" to="/progress" />
      </div>
    </div>
  );
}

// ─── Nutrition Tab ─────────────────────────────────────────────────────────────

function NutritionTab({ onOpenCameraAI }: { onOpenCameraAI: () => void }) {
  const stats = useQuery(api.users.getClientStats, {});
  const aiPlanMeals = useQuery(api.premiumOnboarding.getAiPlanMeals, {});
  const activeMealPlan = useQuery(api.mealPlans.listByUser, {});

  const activePlan = activeMealPlan?.find((p) => p.isActive);
  const targets = aiPlanMeals?.macroTargets ?? {
    calories: activePlan?.targetCalories ?? 2500,
    protein: activePlan?.targetProtein ?? 180,
    carbs: activePlan?.targetCarbs ?? 250,
    fats: activePlan?.targetFats ?? 70,
  };

  const calToday = Math.round(stats?.caloriesToday ?? 0);
  const proteinToday = Math.round(stats?.proteinToday ?? 0);
  const carbsToday = Math.round(stats?.carbsToday ?? 0);
  const fatsToday = Math.round(stats?.fatsToday ?? 0);
  const calPercent = Math.min(Math.round((calToday / targets.calories) * 100), 100);

  return (
    <div className="space-y-5">
      {/* Calorie ring */}
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="relative w-20 h-20 shrink-0">
              <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/40" />
                <circle
                  cx="40" cy="40" r="32" fill="none"
                  stroke="currentColor" strokeWidth="6"
                  strokeDasharray={`${(calPercent / 100) * 201} 201`}
                  strokeLinecap="round"
                  className="text-primary transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-black">{calPercent}%</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold mb-0.5">Daily Calories</p>
              <p className="text-2xl font-black">{calToday}</p>
              <p className="text-xs text-muted-foreground">of {targets.calories} kcal target</p>
              <p className="text-xs text-muted-foreground mt-1">{targets.calories - calToday > 0 ? `${targets.calories - calToday} kcal remaining` : "Target hit!"}</p>
            </div>
          </div>

          <div className="space-y-3">
            <MacroBar label="Protein" value={proteinToday} target={targets.protein} color="bg-chart-1" />
            <MacroBar label="Carbs" value={carbsToday} target={targets.carbs} color="bg-chart-2" />
            <MacroBar label="Fats" value={fatsToday} target={targets.fats} color="bg-chart-3" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <QuickAction
          icon={<UtensilsCrossed className="w-5 h-5" />}
          label="Log Meal"
          desc="Track your nutrition calendar"
          to="/nutrition"
        />
        <QuickAction
          icon={<UtensilsCrossed className="w-5 h-5" />}
          label="Nutrition Log"
          desc="Manual food logging"
          to="/nutrition"
        />
        <QuickAction
          icon={<ScanLine className="w-5 h-5" />}
          label="Camera AI"
          desc="Photo macro calculator"
          onClick={onOpenCameraAI}
          accent
        />
      </div>

      {aiPlanMeals && aiPlanMeals.meals.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Crown className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">AI Meal Plan</h3>
            </div>
            <Link to="/ai-plan" className="text-xs text-primary hover:underline cursor-pointer">Manage plan</Link>
          </div>

          <div className="space-y-2">
            {aiPlanMeals.meals.map((meal, i) => (
              <Card key={i} className="border-border bg-card">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-bold text-sm">{meal.name}</p>
                      {meal.time && <p className="text-[10px] text-muted-foreground">{meal.time}</p>}
                    </div>
                    {meal.calories && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">{meal.calories} kcal</Badge>
                    )}
                  </div>
                  {meal.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {meal.suggestions.slice(0, 4).map((s, j) => (
                        <span key={j} className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{s}</span>
                      ))}
                      {meal.suggestions.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">+{meal.suggestions.length - 4} more</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {aiPlanMeals.coachNotes && (
            <Card className="border-primary/20 bg-primary/5 mt-3">
              <CardContent className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Coach Notes</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{aiPlanMeals.coachNotes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card className="border-border bg-card">
          <CardContent className="p-5 text-center">
            <UtensilsCrossed className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-bold text-sm mb-1">No AI Meal Plan Yet</h3>
            <p className="text-xs text-muted-foreground mb-3">Complete your profile to get a personalized meal plan.</p>
            <Button size="sm" asChild className="cursor-pointer">
              <Link to="/onboarding">Set up AI plan</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── AI Tab ───────────────────────────────────────────────────────────────────

function AiTab() {
  const aiPlan = useQuery(api.premiumOnboarding.getMyAiPlan, {});
  const onboarding = useQuery(api.premiumOnboarding.getMyOnboarding, {});

  return (
    <div className="space-y-5">
      {/* AI Coach CTA */}
      <Link to="/ai-coach" className="cursor-pointer block group">
        <Card className="border-primary/40 bg-primary/5 overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-black text-base">AI Coach</span>
                  <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0">
                    <Zap className="w-2.5 h-2.5 mr-0.5" />
                    GPT-5
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Ask me to update your plan, swap exercises, adjust macros</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {["Replace an exercise", "Swap a meal", "Adjust my macros", "Change my split"].map((p) => (
                <div key={p} className="text-[11px] bg-background/50 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground">
                  "{p}"
                </div>
              ))}
            </div>
            <Button className="w-full cursor-pointer gap-2">
              Open AI Coach <ArrowRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </Link>

      {/* Log Meal */}
      <QuickAction
        icon={<UtensilsCrossed className="w-5 h-5" />}
        label="Log Meal"
        desc="Track your meals on the nutrition calendar"
        to="/nutrition"
      />

      {/* AI Plan status */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Your AI Plan</h3>
        {!onboarding ? (
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-sm">No plan generated yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Answer a few questions to get started</p>
              </div>
              <Button size="sm" asChild className="cursor-pointer shrink-0">
                <Link to="/onboarding">Setup — 2 min</Link>
              </Button>
            </CardContent>
          </Card>
        ) : aiPlan?.status === "generating" ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                  <Sparkles className="w-4 h-4 text-primary" />
                </motion.div>
              </div>
              <div>
                <p className="font-bold text-sm">Generating your plan...</p>
                <p className="text-xs text-muted-foreground">~15-30 seconds</p>
              </div>
            </CardContent>
          </Card>
        ) : aiPlan?.status === "ready" ? (
          <Link to="/ai-plan" className="cursor-pointer block">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">Plan Active</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Split</p>
                    <p className="font-bold text-sm">{aiPlan.workoutSplit}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Daily Calories</p>
                    <p className="font-bold text-sm">{aiPlan.macroTargets.calories} kcal</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Goal</p>
                    <p className="font-bold text-sm capitalize">{aiPlan.primaryGoal.replace(/_/g, " ")}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Protein</p>
                    <p className="font-bold text-sm">{aiPlan.macroTargets.protein}g/day</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
      </div>

      <QuickAction
        icon={<BookOpen className="w-5 h-5" />}
        label="Exercise Library"
        desc="HD demos, muscle groups, instructions"
        to="/exercises"
      />
    </div>
  );
}

// ─── Dashboard Top Cards (shared across ALL dashboard types) ─────────────────
// Drop this block at the TOP of any dashboard to show the 4 summary cards.

export function DashboardTopCards() {
  return (
    <>
      <div className="space-y-3">
        <TodayWorkoutCard compact />
        <NutritionProgressCard />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PlanProgressCard compact />
          <CheckInWidget />
        </div>
      </div>
    </>
  );
}

// ─── Premium Dashboard ────────────────────────────────────────────────────────

export default function PremiumDashboardContent({
  coachingType = "ai_coaching_client",
  coachName,
  showManagement = false,
}: {
  coachingType?: "ai_coaching_client" | "live_1to1_coaching_client";
  coachName?: string;
  showManagement?: boolean;
}) {
  const { user } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [cameraAIOpen, setCameraAIOpen] = useState(false);

  const displayName = currentUser?.name || user?.profile.name || "Athlete";
  const firstName = displayName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  if (currentUser === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-6">
      {/* Header */}
      <div className="relative px-4 pt-6 pb-5 overflow-hidden">
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-primary/8 blur-3xl pointer-events-none" />
        <div className="flex items-center justify-between gap-3 relative">
          <div className="min-w-0">
            <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-1 font-medium">
              {format(new Date(), "EEE, MMM d")} · {greeting}
            </p>
            <h1 className="text-4xl font-black tracking-tight" style={{ fontFamily: "Rajdhani, Inter, sans-serif", letterSpacing: "-0.02em" }}>
              {firstName}
              <span className="text-primary">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {coachingType === "live_1to1_coaching_client" ? (
              <Badge className="bg-green-500/15 text-green-400 border border-green-500/25 text-[10px] px-2.5 py-1 font-bold hidden sm:flex items-center gap-1 rounded-full">
                <Users className="w-2.5 h-2.5" />
                LIVE COACHING
              </Badge>
            ) : (
              <Badge className="bg-primary/15 text-primary border border-primary/25 text-[10px] px-2.5 py-1 font-bold hidden sm:flex items-center gap-1 rounded-full">
                <Crown className="w-2.5 h-2.5" />
                AI COACHING
              </Badge>
            )}
            <Link to="/profile" className="cursor-pointer">
              {currentUser?.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt={displayName} className="w-11 h-11 rounded-full object-cover ring-2 ring-primary/50 hover:ring-primary transition-all duration-200" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-primary/15 ring-2 ring-primary/40 flex items-center justify-center hover:ring-primary transition-all duration-200">
                  <span className="text-sm font-black text-primary">{displayName[0]?.toUpperCase() ?? "?"}</span>
                </div>
              )}
            </Link>
          </div>
        </div>
      </div>

      {/* Live coaching banner */}
      {coachingType === "live_1to1_coaching_client" && (
        <div className="px-4 mb-4">
          <Link to="/messages" className="cursor-pointer block group">
            <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/25 rounded-xl transition-all hover:border-green-500/40">
              <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-green-400 uppercase tracking-wider">Live 1-on-1 Coaching</p>
                <p className="text-sm text-muted-foreground truncate">
                  {coachName ? `Your coach: ${coachName}` : "You have an assigned coach"}
                </p>
              </div>
              <MessageSquare className="w-4 h-4 text-green-400/70 shrink-0 group-hover:text-green-400 transition-colors" />
            </div>
          </Link>
        </div>
      )}

      {/* ── TOP SUMMARY CARDS (always visible, above tabs) ─────────────────── */}
      <div className="px-4 mb-5 space-y-3">
        {/* Row 1: Workout + Meal Progress side by side on wide screens, stacked on mobile */}
        <div className="grid grid-cols-1 gap-3">
          <TodayWorkoutCard compact />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <NutritionProgressCard />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PlanProgressCard compact />
          <CheckInWidget />
        </div>
      </div>

      {/* Management speed key — owner/admin only */}
      {showManagement && (
        <div className="px-4 mb-4">
          <Link to="/management" className="cursor-pointer block group">
            <div className="flex items-center gap-3 p-3 bg-yellow-500/10 border border-yellow-500/25 rounded-xl transition-all hover:border-yellow-500/40">
              <div className="w-9 h-9 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                <LayoutGrid className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider">Management</p>
                <p className="text-sm text-muted-foreground">Coaching, store, analytics & admin</p>
              </div>
              <ChevronRight className="w-4 h-4 text-yellow-400/70 shrink-0 group-hover:text-yellow-400 transition-colors" />
            </div>
          </Link>
        </div>
      )}

      {/* Tab bar */}
      <div className="px-4 mb-5">
        <div className="relative flex gap-0 p-1 bg-card rounded-xl border border-border overflow-hidden">
          <div
            className="absolute top-1 bottom-1 rounded-lg bg-primary transition-all duration-300 ease-out pointer-events-none"
            style={{
              width: `calc(${100 / TABS.length}% - 8px / ${TABS.length})`,
              left: `calc(${TABS.findIndex((t) => t.id === activeTab)} * (100% / ${TABS.length}) + 4px)`,
            }}
          />
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer z-10",
                activeTab === tab.id
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {activeTab === "today" && <TodayTab onOpenCameraAI={() => setCameraAIOpen(true)} />}
            {activeTab === "workout" && <WorkoutTab />}
            {activeTab === "nutrition" && <NutritionTab onOpenCameraAI={() => setCameraAIOpen(true)} />}
            {activeTab === "ai" && <AiTab />}
          </motion.div>
        </AnimatePresence>
      </div>

      <CameraAIDialog open={cameraAIOpen} onOpenChange={setCameraAIOpen} />
    </div>
  );
}
