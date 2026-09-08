import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Utensils, ChevronDown, ChevronUp, Droplets, Apple, Clock,
  CheckCircle, Target, Flame, Info,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";

// ─── Macro bar ────────────────────────────────────────────────────────────────

function MacroBar({ label, current, target, color, unit = "g" }: {
  label: string; current: number; target: number; color: string; unit?: string;
}) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const over = target > 0 && current > target;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className={cn("font-semibold", color)}>{label}</span>
        <span className={cn(over ? "text-destructive" : "text-muted-foreground")}>
          {Math.round(current)}{unit} / {target}{unit}
        </span>
      </div>
      <Progress value={pct} className={cn("h-2", over ? "[&>div]:bg-destructive" : "")} />
      <p className="text-[10px] text-muted-foreground text-right">{Math.round(pct)}% of target</p>
    </div>
  );
}

// ─── Client Assigned Plan View ────────────────────────────────────────────────

export default function ClientAssignedPlanView({ userId }: { userId?: string }) {
  // Use new query that checks coach assignment first, then falls back to own active plan
  const activePlan = useQuery(
    api.mealPlans.getAssignedClientPlan,
    userId ? { userId: userId as import("@/convex/_generated/dataModel.js").Id<"users"> } : {}
  );
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);

  if (activePlan === undefined) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!activePlan) {
    return (
      <div className="border border-dashed border-border rounded-xl p-10 text-center">
        <Utensils className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="font-semibold mb-1">No Meal Plan Assigned</p>
        <p className="text-sm text-muted-foreground">
          Your coach hasn't assigned a meal plan yet. Check back soon.
        </p>
      </div>
    );
  }

  const d = activePlan.dailyTotals;

  return (
    <div className="space-y-6">
      {/* Plan header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-lg">{activePlan.name}</h2>
            <Badge className="bg-green-400/20 text-green-400 border-0 text-[10px]">
              <CheckCircle className="w-2.5 h-2.5 mr-1" />Active Plan
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{activePlan.mealsWithFoodDetails.length} meals planned</p>
        </div>
      </div>

      {/* Daily macro targets */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-primary" />Daily Targets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
            {[
              { label: "Calories", value: activePlan.targetCalories, color: "text-orange-400", bg: "bg-orange-400/10", unit: "" },
              { label: "Protein", value: activePlan.targetProtein, color: "text-blue-400", bg: "bg-blue-400/10", unit: "g" },
              { label: "Carbs", value: activePlan.targetCarbs, color: "text-yellow-400", bg: "bg-yellow-400/10", unit: "g" },
              { label: "Fats", value: activePlan.targetFats, color: "text-red-400", bg: "bg-red-400/10", unit: "g" },
            ].map(({ label, value, color, bg, unit }) => (
              <div key={label} className={cn("rounded-xl p-3", bg)}>
                <p className={cn("text-2xl font-bold", color)}>{value}{unit}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {(activePlan.targetFiber || activePlan.targetWaterMl) && (
            <div className="flex gap-4 text-sm border-t border-border/50 pt-3">
              {activePlan.targetFiber && (
                <div className="flex items-center gap-1.5">
                  <Apple className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-muted-foreground">Fiber:</span>
                  <span className="font-semibold">{activePlan.targetFiber}g</span>
                </div>
              )}
              {activePlan.targetWaterMl && (
                <div className="flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-muted-foreground">Water:</span>
                  <span className="font-semibold">{activePlan.targetWaterMl}ml</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan totals vs targets */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-orange-400" />Plan Macros Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <MacroBar label="Calories" current={d.calories} target={activePlan.targetCalories} color="text-orange-400" unit="" />
          <MacroBar label="Protein" current={d.protein} target={activePlan.targetProtein} color="text-blue-400" />
          <MacroBar label="Carbs" current={d.carbs} target={activePlan.targetCarbs} color="text-yellow-400" />
          <MacroBar label="Fats" current={d.fats} target={activePlan.targetFats} color="text-red-400" />
          {d.calories !== activePlan.targetCalories && (
            <div className="flex items-start gap-1.5 mt-2 p-2 bg-muted/30 rounded-lg">
              <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                The plan's actual macros may differ slightly from your targets. Follow the meal times and portions your coach has set.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meal list */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <Utensils className="w-4 h-4 text-green-400" /> Meals
        </h3>

        {activePlan.mealsWithFoodDetails
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((meal) => (
            <Card key={meal.id} className="bg-card/50 border-border overflow-hidden">
              <button
                onClick={() => setExpandedMeal(prev => prev === meal.id ? null : meal.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-green-400/10 flex items-center justify-center shrink-0">
                    <Utensils className="w-4 h-4 text-green-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{meal.name}</p>
                    {meal.time && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />{meal.time}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-orange-400">{Math.round(meal.totals.calories)} kcal</p>
                    <p className="text-[10px] text-muted-foreground">
                      P:{Math.round(meal.totals.protein)}g C:{Math.round(meal.totals.carbs)}g F:{Math.round(meal.totals.fats)}g
                    </p>
                  </div>
                  {expandedMeal === meal.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {expandedMeal === meal.id && (
                <div className="border-t border-border/50">
                  {meal.foodsWithDetails.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No foods listed for this meal</p>
                  ) : (
                    <div className="divide-y divide-border/30">
                      {meal.foodsWithDetails.map((food) => {
                        // Use effectiveMacros (grams-based calculation when quantityInGrams is set)
                        const macros = food.effectiveMacros;
                        const servingLabel = food.quantityInGrams != null && food.quantityInGrams > 0
                          ? `${food.quantityInGrams} g`
                          : `${food.servings} × ${food.servingSize}${food.servingUnit}`;
                        return (
                          <div key={food.foodId} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/10">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{food.foodName}</p>
                              <p className="text-[10px] text-muted-foreground">{servingLabel}</p>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <p className="text-sm font-semibold text-orange-400">{Math.round(macros.calories)} kcal</p>
                              <p className="text-[10px] text-muted-foreground">
                                P:{Math.round(macros.protein)}g · C:{Math.round(macros.carbs)}g · F:{Math.round(macros.fats)}g
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Meal total footer */}
                  <div className="px-4 py-2.5 bg-muted/10 border-t border-border/30 flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">Meal Total</p>
                    <div className="flex gap-3 text-xs font-semibold">
                      <span className="text-orange-400">{Math.round(meal.totals.calories)} kcal</span>
                      <span className="text-blue-400">P:{Math.round(meal.totals.protein)}g</span>
                      <span className="text-yellow-400">C:{Math.round(meal.totals.carbs)}g</span>
                      <span className="text-red-400">F:{Math.round(meal.totals.fats)}g</span>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
      </div>

      {(activePlan.notes || activePlan.assignmentNotes) && (
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-4 space-y-3">
            {activePlan.assignmentNotes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Coach Notes</p>
                <p className="text-sm">{activePlan.assignmentNotes}</p>
              </div>
            )}
            {activePlan.notes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Plan Notes</p>
                <p className="text-sm">{activePlan.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
