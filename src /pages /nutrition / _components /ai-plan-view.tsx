/**
 * AiPlanNutritionView — Displays the AI-generated plan in Nutrition → My Plan tab
 * when no coach-assigned mealPlan exists.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Sparkles, Target, UtensilsCrossed, ChevronDown, ChevronUp,
  Crown, ArrowRight, Zap, Apple,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import { motion } from "motion/react";

const GOAL_LABELS: Record<string, string> = {
  build_muscle: "Build Muscle",
  lose_fat: "Lose Fat",
  recomp: "Body Recomposition",
};

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
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className={cn("font-semibold", color)}>{label}</span>
        <span className="text-muted-foreground font-medium">
          {target}g target
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", color.replace("text-", "bg-"))}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

export default function AiPlanNutritionView() {
  const aiPlan = useQuery(api.premiumOnboarding.getAiPlanMeals, {});
  const [expandedMeal, setExpandedMeal] = useState<number | null>(null);

  if (aiPlan === undefined) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!aiPlan) {
    return (
      <div className="border border-dashed border-primary/20 rounded-2xl p-10 text-center bg-primary/3">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-7 h-7 text-primary" />
        </div>
        <h3 className="font-bold text-lg mb-2">No AI Plan Yet</h3>
        <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
          Complete your premium onboarding to get a fully personalised
          nutrition &amp; training plan powered by AI.
        </p>
        <Button asChild className="cursor-pointer gap-2">
          <Link to="/onboarding">
            Get Your AI Plan <ArrowRight className="w-4 h-4" />
          </Link>
        </Button>
      </div>
    );
  }

  const { macroTargets, meals, primaryGoal, coachNotes } = aiPlan;

  return (
    <div className="space-y-6">
      {/* Plan header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="font-bold text-xl">AI Nutrition Plan</h2>
            <Badge className="bg-primary/15 text-primary border-primary/25 text-[10px] px-2.5 py-0.5 font-bold rounded-full flex items-center gap-1">
              <Crown className="w-2.5 h-2.5" />
              PREMIUM
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Goal: <span className="text-foreground font-medium">{GOAL_LABELS[primaryGoal] ?? primaryGoal}</span>
            &nbsp;·&nbsp;{meals.length} meals/day
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild className="cursor-pointer text-primary shrink-0">
          <Link to="/ai-plan">Edit plan <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
        </Button>
      </div>

      {/* Daily macro targets */}
      <Card className="border-border bg-card overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-primary" />
            Daily Targets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Macro grid */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Calories", value: macroTargets.calories, unit: "kcal", color: "text-primary", bg: "bg-primary/10" },
              { label: "Protein", value: macroTargets.protein, unit: "g", color: "text-chart-2", bg: "bg-chart-2/10" },
              { label: "Carbs", value: macroTargets.carbs, unit: "g", color: "text-chart-3", bg: "bg-chart-3/10" },
              { label: "Fats", value: macroTargets.fats, unit: "g", color: "text-chart-4", bg: "bg-chart-4/10" },
            ].map(({ label, value, unit, color, bg }) => (
              <div key={label} className={cn("rounded-xl p-3 text-center", bg)}>
                <p className={cn("text-xl font-black", color)}>{value}<span className="text-xs font-medium ml-0.5">{unit}</span></p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Macro bars */}
          <div className="space-y-2.5">
            <MacroBar label="Protein" value={0} target={macroTargets.protein} color="text-chart-2" />
            <MacroBar label="Carbs" value={0} target={macroTargets.carbs} color="text-chart-3" />
            <MacroBar label="Fats" value={0} target={macroTargets.fats} color="text-chart-4" />
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Track your daily food in the <span className="text-foreground font-medium">Tracker</span> tab to see progress vs targets
          </p>
        </CardContent>
      </Card>

      {/* Meal plan */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
          <UtensilsCrossed className="w-3.5 h-3.5" />
          Daily Meal Schedule
        </h3>
        <div className="space-y-2">
          {meals.map((meal, i) => (
            <Card key={i} className="border-border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedMeal(expandedMeal === i ? null : i)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/15 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-black text-primary">{i + 1}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{meal.name}</p>
                    {meal.time && (
                      <p className="text-[10px] text-muted-foreground">{meal.time}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {meal.calories != null && (
                    <span className="text-xs font-bold text-primary">{meal.calories} kcal</span>
                  )}
                  {expandedMeal === i
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  }
                </div>
              </button>

              {expandedMeal === i && meal.suggestions.length > 0 && (
                <div className="border-t border-border/50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Food Suggestions
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {meal.suggestions.map((s, j) => (
                      <div
                        key={j}
                        className="flex items-center gap-1.5 bg-muted/30 rounded-lg px-2.5 py-1.5"
                      >
                        <Apple className="w-3 h-3 text-chart-3 shrink-0" />
                        <span className="text-xs text-foreground/90">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Coach notes / AI notes */}
      {coachNotes && (
        <Card className="border-primary/20 bg-primary/4">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">AI Coach Notes</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{coachNotes}</p>
          </CardContent>
        </Card>
      )}

      {/* Link to full AI plan */}
      <Link to="/ai-plan" className="block cursor-pointer group">
        <Card className="border-primary/25 bg-primary/5 hover:border-primary/50 transition-all hover:-translate-y-0.5">
          <CardContent className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <div>
                <p className="font-bold text-sm">View Full AI Plan</p>
                <p className="text-xs text-muted-foreground">Workout split, weekly schedule, goal updates</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-0.5 transition-transform" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
