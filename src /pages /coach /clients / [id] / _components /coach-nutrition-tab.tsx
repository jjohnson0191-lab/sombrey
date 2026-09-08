import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import {
  Utensils, Plus, Trash2, Save, Edit, ChevronDown, ChevronUp,
  Search, X, Copy, CheckCircle, Clock, Droplets, Flame,
  Apple, AlertCircle, GripVertical, Star, Camera,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { format, startOfDay } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type FoodItem = {
  _id: Id<"foods">;
  name: string;
  protein: number;
  carbs: number;
  fats: number;
  calories: number;
  servingSize: string;
  servingUnit: string;
  isCustom: boolean;
  createdBy?: Id<"users">;
  caloriesPer100g?: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatsPer100g?: number;
};

type MealFood = {
  foodId: Id<"foods">;
  servings: number;
  quantityInGrams?: number;
  foodName: string;
  protein: number;
  carbs: number;
  fats: number;
  calories: number;
  servingSize: string;
  servingUnit: string;
  caloriesPer100g?: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatsPer100g?: number;
};

type Meal = {
  id: string;
  name: string;
  time?: string;
  displayOrder: number;
  foods: Array<{ foodId: Id<"foods">; servings: number; quantityInGrams?: number }>;
};

type MealWithTotals = Meal & {
  foodsWithDetails: MealFood[];
  totals: { calories: number; protein: number; carbs: number; fats: number };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2);
}

/** Client-side macro recalculation — mirrors the backend calcMacros helper */
function calcFoodMacros(food: Pick<MealFood, "protein" | "carbs" | "fats" | "calories" | "caloriesPer100g" | "proteinPer100g" | "carbsPer100g" | "fatsPer100g">, servings: number, quantityInGrams?: number) {
  const hasGrams = quantityInGrams != null && quantityInGrams > 0
    && food.caloriesPer100g != null && food.proteinPer100g != null
    && food.carbsPer100g != null && food.fatsPer100g != null;
  if (hasGrams) {
    const q = quantityInGrams;
    return {
      calories: (food.caloriesPer100g! * q) / 100,
      protein: (food.proteinPer100g! * q) / 100,
      carbs: (food.carbsPer100g! * q) / 100,
      fats: (food.fatsPer100g! * q) / 100,
    };
  }
  return {
    calories: food.calories * servings,
    protein: food.protein * servings,
    carbs: food.carbs * servings,
    fats: food.fats * servings,
  };
}

const MEAL_PRESETS = [
  "Breakfast", "Lunch", "Dinner", "Morning Snack",
  "Afternoon Snack", "Pre-Workout", "Post-Workout", "Evening Snack",
];

const MACRO_COLORS = {
  calories: "text-primary",
  protein: "text-blue-400",
  carbs: "text-yellow-400",
  fats: "text-red-400",
};

function MacroBar({ label, current, target, color }: {
  label: string; current: number; target: number; color: string;
}) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const over = target > 0 && current > target;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className={cn("font-medium", color)}>{label}</span>
        <span className={cn(over ? "text-destructive" : "text-muted-foreground")}>
          {Math.round(current)}{label === "Calories" ? "" : "g"} / {target}{label === "Calories" ? "" : "g"}
        </span>
      </div>
      <Progress value={pct} className={cn("h-1.5", over ? "[&>div]:bg-destructive" : "")} />
    </div>
  );
}

// ─── Food Search Dialog ───────────────────────────────────────────────────────

function FoodSearchDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (food: FoodItem, servings: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [servings, setServings] = useState<Record<string, string>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFood, setNewFood] = useState({ name: "", calories: "", protein: "", carbs: "", fats: "", servingSize: "100", servingUnit: "g", caloriesPer100g: "", proteinPer100g: "", carbsPer100g: "", fatsPer100g: "" });
  const [creating, setCreating] = useState(false);

  const foods = useQuery(api.foods.list, { searchTerm: search || undefined });
  const createFood = useMutation(api.foods.create);

  const handleAdd = (food: FoodItem) => {
    const s = parseFloat(servings[food._id] || "1");
    if (isNaN(s) || s <= 0) {
      toast.error("Enter a valid serving count");
      return;
    }
    onAdd(food, s);
    setServings(prev => ({ ...prev, [food._id]: "" }));
  };

  const handleCreateFood = async () => {
    if (!newFood.name || !newFood.calories) {
      toast.error("Name and calories are required");
      return;
    }
    setCreating(true);
    try {
      await createFood({
        name: newFood.name,
        calories: parseFloat(newFood.calories) || 0,
        protein: parseFloat(newFood.protein) || 0,
        carbs: parseFloat(newFood.carbs) || 0,
        fats: parseFloat(newFood.fats) || 0,
        servingSize: newFood.servingSize,
        servingUnit: newFood.servingUnit,
        isCustom: true,
        caloriesPer100g: newFood.caloriesPer100g ? parseFloat(newFood.caloriesPer100g) : undefined,
        proteinPer100g: newFood.proteinPer100g ? parseFloat(newFood.proteinPer100g) : undefined,
        carbsPer100g: newFood.carbsPer100g ? parseFloat(newFood.carbsPer100g) : undefined,
        fatsPer100g: newFood.fatsPer100g ? parseFloat(newFood.fatsPer100g) : undefined,
      });
      toast.success("Custom food created!");
      setNewFood({ name: "", calories: "", protein: "", carbs: "", fats: "", servingSize: "100", servingUnit: "g", caloriesPer100g: "", proteinPer100g: "", carbsPer100g: "", fatsPer100g: "" });
      setShowCreateForm(false);
    } catch { toast.error("Failed to create food"); }
    finally { setCreating(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Apple className="w-4 h-4 text-green-400" /> Add Food Item
          </DialogTitle>
          <DialogDescription>Search foods or create a custom item</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search foods…"
              className="pl-8 h-8 text-sm"
            />
          </div>

          {/* Create custom food toggle */}
          <Button
            size="sm"
            variant="secondary"
            className="w-full cursor-pointer"
            onClick={() => setShowCreateForm(v => !v)}
          >
            <Plus className="w-3 h-3 mr-1" />
            {showCreateForm ? "Cancel Custom Food" : "Create Custom Food"}
          </Button>

          {/* Create form */}
          {showCreateForm && (
            <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground">New Custom Food</p>
              <div className="space-y-1">
                <Label className="text-xs">Food Name *</Label>
                <Input
                  value={newFood.name}
                  onChange={e => setNewFood(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Homemade Rice & Curry"
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Serving Size</Label>
                  <Input value={newFood.servingSize} onChange={e => setNewFood(p => ({ ...p, servingSize: e.target.value }))} className="h-8 text-sm" placeholder="100" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unit</Label>
                  <Input value={newFood.servingUnit} onChange={e => setNewFood(p => ({ ...p, servingUnit: e.target.value }))} className="h-8 text-sm" placeholder="g" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Calories *", key: "calories" as const },
                  { label: "Protein (g)", key: "protein" as const },
                  { label: "Carbs (g)", key: "carbs" as const },
                  { label: "Fats (g)", key: "fats" as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={newFood[key]}
                      onChange={e => setNewFood(p => ({ ...p, [key]: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
              {/* Per-100g values for automatic macro recalculation */}
              <div className="border-t border-border/50 pt-2">
                <p className="text-[10px] text-muted-foreground mb-2">
                  Per 100g values (optional) — enables automatic macro recalculation when editing grams
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Cal / 100g", key: "caloriesPer100g" as const },
                    { label: "Protein / 100g", key: "proteinPer100g" as const },
                    { label: "Carbs / 100g", key: "carbsPer100g" as const },
                    { label: "Fats / 100g", key: "fatsPer100g" as const },
                  ].map(({ label, key }) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs">{label}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={newFood[key]}
                        onChange={e => setNewFood(p => ({ ...p, [key]: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder="optional"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <Button size="sm" onClick={handleCreateFood} disabled={creating} className="w-full cursor-pointer">
                <Save className="w-3 h-3 mr-1" /> {creating ? "Saving…" : "Save Custom Food"}
              </Button>
            </div>
          )}

          {/* Food list */}
          <ScrollArea className="h-60">
            {foods === undefined ? (
              <div className="space-y-2 pr-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : foods.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Apple className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No foods found. Try a different search or create a custom food.
              </div>
            ) : (
              <div className="space-y-2 pr-3">
                {foods.map((food) => (
                  <div key={food._id} className="border border-border rounded-lg p-2.5 bg-muted/10 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold truncate">{food.name}</p>
                          {food.isCustom && <Badge variant="secondary" className="text-[10px] shrink-0">Custom</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {food.servingSize}{food.servingUnit} · {food.calories} kcal · P:{food.protein}g C:{food.carbs}g F:{food.fats}g
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={servings[food._id] || ""}
                          onChange={e => setServings(p => ({ ...p, [food._id]: e.target.value }))}
                          placeholder="1"
                          className="h-7 w-14 text-xs"
                        />
                        <Button
                          size="icon"
                          className="h-7 w-7 shrink-0 cursor-pointer"
                          onClick={() => handleAdd(food as FoodItem)}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Meal Editor ──────────────────────────────────────────────────────────────

function MealEditor({
  meal,
  mealFoods,
  mealTotals,
  onUpdateName,
  onUpdateTime,
  onRemoveFood,
  onUpdateServings,
  onUpdateGrams,
  onAddFoodClick,
  onRemoveMeal,
  onDuplicateMeal,
}: {
  meal: Meal;
  mealFoods: MealFood[];
  mealTotals: { calories: number; protein: number; carbs: number; fats: number };
  onUpdateName: (name: string) => void;
  onUpdateTime: (time: string) => void;
  onRemoveFood: (foodId: Id<"foods">) => void;
  onUpdateServings: (foodId: Id<"foods">, servings: number) => void;
  onUpdateGrams: (foodId: Id<"foods">, grams: number) => void;
  onAddFoodClick: () => void;
  onRemoveMeal: () => void;
  onDuplicateMeal: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [localName, setLocalName] = useState(meal.name);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card/30">
      {/* Meal header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 border-b border-border/50">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />

        {editingName ? (
          <Input
            value={localName}
            onChange={e => setLocalName(e.target.value)}
            onBlur={() => { onUpdateName(localName); setEditingName(false); }}
            onKeyDown={e => { if (e.key === "Enter") { onUpdateName(localName); setEditingName(false); } }}
            className="h-7 text-sm font-semibold flex-1"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex-1 text-left text-sm font-semibold hover:text-primary transition-colors cursor-pointer truncate"
          >
            {meal.name}
          </button>
        )}

        <Input
          type="time"
          value={meal.time ?? ""}
          onChange={e => onUpdateTime(e.target.value)}
          className="h-7 w-28 text-xs shrink-0"
          placeholder="Time"
        />

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-bold text-primary">{Math.round(mealTotals.calories)} kcal</span>
          <Button size="icon" variant="ghost" className="h-6 w-6 cursor-pointer" onClick={onDuplicateMeal}>
            <Copy className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 cursor-pointer text-destructive" onClick={onRemoveMeal}>
            <Trash2 className="w-3 h-3" />
          </Button>
          <button onClick={() => setCollapsed(v => !v)} className="cursor-pointer text-muted-foreground hover:text-foreground">
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-2">
          {/* Macro mini-summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Protein", value: Math.round(mealTotals.protein), color: "text-blue-400" },
              { label: "Carbs", value: Math.round(mealTotals.carbs), color: "text-yellow-400" },
              { label: "Fats", value: Math.round(mealTotals.fats), color: "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-muted/20 rounded p-1.5">
                <p className={cn("text-xs font-bold", color)}>{value}g</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Food items */}
          {mealFoods.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No foods added yet</p>
          ) : (
            <div className="space-y-1.5">
              {mealFoods.map((f) => {
                const effective = calcFoodMacros(f, f.servings, f.quantityInGrams);
                const hasPer100g = f.caloriesPer100g != null && f.proteinPer100g != null;
                return (
                  <div key={f.foodId} className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/10 hover:bg-muted/20 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{f.foodName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        P:{Math.round(effective.protein)}g C:{Math.round(effective.carbs)}g F:{Math.round(effective.fats)}g
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-primary font-semibold">{Math.round(effective.calories)} kcal</span>
                      {hasPer100g ? (
                        // Grams-based input (auto-recalculates macros)
                        <>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={f.quantityInGrams ?? ""}
                            onChange={e => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0) onUpdateGrams(f.foodId, v);
                            }}
                            className="h-6 w-16 text-xs"
                            placeholder="g"
                            title="Quantity in grams — macros auto-recalculate"
                          />
                          <span className="text-[10px] text-muted-foreground">g</span>
                        </>
                      ) : (
                        // Legacy servings input
                        <>
                          <Input
                            type="number"
                            min={0.1}
                            step={0.1}
                            value={f.servings}
                            onChange={e => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0) onUpdateServings(f.foodId, v);
                            }}
                            className="h-6 w-14 text-xs"
                          />
                          <span className="text-[10px] text-muted-foreground">srv</span>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 cursor-pointer text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => onRemoveFood(f.foodId)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Button size="sm" variant="secondary" className="w-full cursor-pointer text-xs" onClick={onAddFoodClick}>
            <Plus className="w-3 h-3 mr-1" /> Add Food
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Meal Plan Builder ────────────────────────────────────────────────────────

type EditableMeal = Meal & { foodDetails: Record<string, { name: string; protein: number; carbs: number; fats: number; calories: number; servingSize: string; servingUnit: string; caloriesPer100g?: number; proteinPer100g?: number; carbsPer100g?: number; fatsPer100g?: number }> };

function MealPlanBuilder({
  clientId,
  existingPlan,
  onCancel,
  onSaved,
}: {
  clientId: Id<"users">;
  existingPlan?: NonNullable<ReturnType<typeof useQuery<typeof api.mealPlans.get>>>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const createPlan = useMutation(api.mealPlans.create);
  const updatePlan = useMutation(api.mealPlans.update);

  const [planName, setPlanName] = useState(existingPlan?.name ?? "Meal Plan");
  const [targets, setTargets] = useState({
    calories: String(existingPlan?.targetCalories ?? ""),
    protein: String(existingPlan?.targetProtein ?? ""),
    carbs: String(existingPlan?.targetCarbs ?? ""),
    fats: String(existingPlan?.targetFats ?? ""),
    fiber: String(existingPlan?.targetFiber ?? ""),
    waterMl: String(existingPlan?.targetWaterMl ?? ""),
  });
  const [planNotes, setPlanNotes] = useState(existingPlan?.notes ?? "");
  const [meals, setMeals] = useState<EditableMeal[]>(() => {
    if (existingPlan?.mealsWithFoodDetails) {
      return existingPlan.mealsWithFoodDetails.map(m => ({
        id: m.id,
        name: m.name,
        time: m.time,
        displayOrder: m.displayOrder,
        foods: m.foods,
        foodDetails: Object.fromEntries(
          m.foodsWithDetails.map(f => [f.foodId, {
            name: f.foodName, protein: f.protein, carbs: f.carbs, fats: f.fats, calories: f.calories,
            servingSize: f.servingSize, servingUnit: f.servingUnit,
            caloriesPer100g: (f as { caloriesPer100g?: number }).caloriesPer100g,
            proteinPer100g: (f as { proteinPer100g?: number }).proteinPer100g,
            carbsPer100g: (f as { carbsPer100g?: number }).carbsPer100g,
            fatsPer100g: (f as { fatsPer100g?: number }).fatsPer100g,
          }])
        ),
      }));
    }
    return [];
  });
  const [saving, setSaving] = useState(false);
  const [foodDialogMealId, setFoodDialogMealId] = useState<string | null>(null);

  // Calculated daily totals — uses gram-based formula when per-100g data exists
  const dailyTotals = useMemo(() => meals.reduce((acc, meal) => {
    meal.foods.forEach(f => {
      const fd = meal.foodDetails[f.foodId];
      if (fd) {
        const m = calcFoodMacros(fd, f.servings, f.quantityInGrams);
        acc.calories += m.calories;
        acc.protein += m.protein;
        acc.carbs += m.carbs;
        acc.fats += m.fats;
      }
    });
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fats: 0 }), [meals]);

  const addMeal = (presetName?: string) => {
    const newMeal: EditableMeal = {
      id: generateId(),
      name: presetName ?? "New Meal",
      displayOrder: meals.length,
      foods: [],
      foodDetails: {},
    };
    setMeals(prev => [...prev, newMeal]);
  };

  const updateMealName = (mealId: string, name: string) => {
    setMeals(prev => prev.map(m => m.id === mealId ? { ...m, name } : m));
  };

  const updateMealTime = (mealId: string, time: string) => {
    setMeals(prev => prev.map(m => m.id === mealId ? { ...m, time: time || undefined } : m));
  };

  const removeMeal = (mealId: string) => {
    setMeals(prev => prev.filter(m => m.id !== mealId));
  };

  const duplicateMeal = (mealId: string) => {
    const meal = meals.find(m => m.id === mealId);
    if (!meal) return;
    const dup: EditableMeal = { ...meal, id: generateId(), name: `${meal.name} (Copy)`, displayOrder: meals.length };
    setMeals(prev => [...prev, dup]);
  };

  const addFoodToMeal = (mealId: string, food: FoodItem, servings: number) => {
    setMeals(prev => prev.map(m => {
      if (m.id !== mealId) return m;
      // Update existing or add new
      const existingIdx = m.foods.findIndex(f => f.foodId === food._id);
      // If food has per-100g data, seed quantityInGrams from serving size (default 100g)
      const defaultGrams = food.caloriesPer100g != null ? 100 : undefined;
      const updatedFoods = existingIdx >= 0
        ? m.foods.map((f, i) => i === existingIdx ? { ...f, servings: f.servings + servings } : f)
        : [...m.foods, { foodId: food._id, servings, quantityInGrams: defaultGrams }];
      return {
        ...m,
        foods: updatedFoods,
        foodDetails: {
          ...m.foodDetails,
          [food._id]: {
            name: food.name, protein: food.protein, carbs: food.carbs, fats: food.fats, calories: food.calories,
            servingSize: food.servingSize, servingUnit: food.servingUnit,
            caloriesPer100g: food.caloriesPer100g, proteinPer100g: food.proteinPer100g,
            carbsPer100g: food.carbsPer100g, fatsPer100g: food.fatsPer100g,
          },
        },
      };
    }));
    toast.success(`Added ${food.name}`);
  };

  const removeFoodFromMeal = (mealId: string, foodId: Id<"foods">) => {
    setMeals(prev => prev.map(m => m.id !== mealId ? m : {
      ...m,
      foods: m.foods.filter(f => f.foodId !== foodId),
    }));
  };

  const updateFoodServings = (mealId: string, foodId: Id<"foods">, servings: number) => {
    setMeals(prev => prev.map(m => m.id !== mealId ? m : {
      ...m,
      foods: m.foods.map(f => f.foodId === foodId ? { ...f, servings } : f),
    }));
  };

  // Update grams for a food — triggers live macro recalculation without creating new food items
  const updateFoodGrams = (mealId: string, foodId: Id<"foods">, grams: number) => {
    setMeals(prev => prev.map(m => m.id !== mealId ? m : {
      ...m,
      foods: m.foods.map(f => f.foodId === foodId ? { ...f, quantityInGrams: grams } : f),
    }));
  };

  const handleSave = async (activate: boolean) => {
    if (!targets.calories || !targets.protein || !targets.carbs || !targets.fats) {
      toast.error("Set all four macro targets first");
      return;
    }
    setSaving(true);
    try {
      const mealsPayload = meals.map((m, i) => ({
        id: m.id,
        name: m.name,
        time: m.time,
        displayOrder: i,
        foods: m.foods,
      }));

      if (existingPlan) {
        await updatePlan({
          id: existingPlan._id,
          name: planName,
          targetCalories: Number(targets.calories),
          targetProtein: Number(targets.protein),
          targetCarbs: Number(targets.carbs),
          targetFats: Number(targets.fats),
          targetFiber: targets.fiber ? Number(targets.fiber) : undefined,
          targetWaterMl: targets.waterMl ? Number(targets.waterMl) : undefined,
          meals: mealsPayload,
          isActive: activate,
          notes: planNotes || undefined,
        });
      } else {
        await createPlan({
          userId: clientId,
          name: planName,
          targetCalories: Number(targets.calories),
          targetProtein: Number(targets.protein),
          targetCarbs: Number(targets.carbs),
          targetFats: Number(targets.fats),
          targetFiber: targets.fiber ? Number(targets.fiber) : undefined,
          targetWaterMl: targets.waterMl ? Number(targets.waterMl) : undefined,
          meals: mealsPayload,
          isActive: activate,
          notes: planNotes || undefined,
        });
      }
      toast.success(activate ? "Meal plan saved and assigned!" : "Meal plan saved as draft");
      onSaved();
    } catch { toast.error("Failed to save meal plan"); }
    finally { setSaving(false); }
  };

  const tgtCal = Number(targets.calories) || 0;
  const tgtPro = Number(targets.protein) || 0;
  const tgtCarbs = Number(targets.carbs) || 0;
  const tgtFats = Number(targets.fats) || 0;

  return (
    <div className="space-y-5">
      {/* Plan name */}
      <div className="space-y-1">
        <Label className="text-xs font-semibold">Plan Name</Label>
        <Input value={planName} onChange={e => setPlanName(e.target.value)} className="text-sm h-9" />
      </div>

      {/* Macro targets */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-primary" /> Daily Macro Targets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Calories", key: "calories" as const, suffix: "kcal" },
              { label: "Protein (g)", key: "protein" as const, suffix: "g" },
              { label: "Carbs (g)", key: "carbs" as const, suffix: "g" },
              { label: "Fats (g)", key: "fats" as const, suffix: "g" },
            ].map(({ label, key }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={targets[key]}
                  onChange={e => setTargets(p => ({ ...p, [key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Apple className="w-3 h-3" />Fiber (g) <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="number" min={0} value={targets.fiber} onChange={e => setTargets(p => ({ ...p, fiber: e.target.value }))} className="h-8 text-sm" placeholder="e.g. 30" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Droplets className="w-3 h-3 text-blue-400" />Water (ml) <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="number" min={0} value={targets.waterMl} onChange={e => setTargets(p => ({ ...p, waterMl: e.target.value }))} className="h-8 text-sm" placeholder="e.g. 2500" />
            </div>
          </div>

          {/* Live progress against targets */}
          {tgtCal > 0 && (
            <div className="space-y-2 pt-1 border-t border-border/50">
              <p className="text-xs text-muted-foreground">Current plan vs. targets</p>
              <MacroBar label="Calories" current={dailyTotals.calories} target={tgtCal} color={MACRO_COLORS.calories} />
              <MacroBar label="Protein" current={dailyTotals.protein} target={tgtPro} color={MACRO_COLORS.protein} />
              <MacroBar label="Carbs" current={dailyTotals.carbs} target={tgtCarbs} color={MACRO_COLORS.carbs} />
              <MacroBar label="Fats" current={dailyTotals.fats} target={tgtFats} color={MACRO_COLORS.fats} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meals */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Utensils className="w-3.5 h-3.5 text-green-400" /> Meals ({meals.length})
          </p>
        </div>

        {meals.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-6 text-center">
            <Utensils className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No meals yet. Add your first meal below.</p>
          </div>
        )}

        {meals.map(meal => {
          const mealFoods: MealFood[] = meal.foods.map(f => {
            const fd = meal.foodDetails[f.foodId];
            return {
              foodId: f.foodId,
              servings: f.servings,
              quantityInGrams: f.quantityInGrams,
              foodName: fd?.name ?? "Unknown",
              protein: fd?.protein ?? 0,
              carbs: fd?.carbs ?? 0,
              fats: fd?.fats ?? 0,
              calories: fd?.calories ?? 0,
              servingSize: fd?.servingSize ?? "",
              servingUnit: fd?.servingUnit ?? "",
              caloriesPer100g: fd?.caloriesPer100g,
              proteinPer100g: fd?.proteinPer100g,
              carbsPer100g: fd?.carbsPer100g,
              fatsPer100g: fd?.fatsPer100g,
            };
          });
          const mealTotals = mealFoods.reduce((acc, f) => {
            const m = calcFoodMacros(f, f.servings, f.quantityInGrams);
            return {
              calories: acc.calories + m.calories,
              protein: acc.protein + m.protein,
              carbs: acc.carbs + m.carbs,
              fats: acc.fats + m.fats,
            };
          }, { calories: 0, protein: 0, carbs: 0, fats: 0 });

          return (
            <MealEditor
              key={meal.id}
              meal={meal}
              mealFoods={mealFoods}
              mealTotals={mealTotals}
              onUpdateName={n => updateMealName(meal.id, n)}
              onUpdateTime={t => updateMealTime(meal.id, t)}
              onRemoveFood={fid => removeFoodFromMeal(meal.id, fid)}
              onUpdateServings={(fid, s) => updateFoodServings(meal.id, fid, s)}
              onUpdateGrams={(fid, g) => updateFoodGrams(meal.id, fid, g)}
              onAddFoodClick={() => setFoodDialogMealId(meal.id)}
              onRemoveMeal={() => removeMeal(meal.id)}
              onDuplicateMeal={() => duplicateMeal(meal.id)}
            />
          );
        })}

        {/* Add meal options */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {MEAL_PRESETS.map(preset => (
              <Button
                key={preset}
                size="sm"
                variant="secondary"
                className="h-7 text-xs cursor-pointer"
                onClick={() => addMeal(preset)}
              >
                + {preset}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="w-full cursor-pointer" onClick={() => addMeal()}>
            <Plus className="w-3 h-3 mr-1" /> Add Custom Meal
          </Button>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <Label className="text-xs">Plan Notes (optional)</Label>
        <Textarea
          value={planNotes}
          onChange={e => setPlanNotes(e.target.value)}
          rows={2}
          placeholder="Meal timing recommendations, food preferences, dietary restrictions…"
          className="text-sm resize-none"
        />
      </div>

      {/* Save actions */}
      <div className="flex gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onCancel} className="cursor-pointer">Cancel</Button>
        <Button variant="secondary" size="sm" onClick={() => handleSave(false)} disabled={saving} className="cursor-pointer">
          Save Draft
        </Button>
        <Button size="sm" onClick={() => handleSave(true)} disabled={saving} className="flex-1 cursor-pointer">
          <CheckCircle className="w-3 h-3 mr-1" />
          {saving ? "Saving…" : "Save & Assign to Client"}
        </Button>
      </div>

      {/* Food search dialog */}
      {foodDialogMealId && (
        <FoodSearchDialog
          open={!!foodDialogMealId}
          onClose={() => setFoodDialogMealId(null)}
          onAdd={(food, servings) => addFoodToMeal(foodDialogMealId, food, servings)}
        />
      )}
    </div>
  );
}

// ─── Plan View (read-only summary for coach) ─────────────────────────────────

function PlanView({
  plan,
  onEdit,
  onDuplicate,
  onDelete,
  onDeactivate,
}: {
  plan: NonNullable<ReturnType<typeof useQuery<typeof api.mealPlans.getActivePlan>>>;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDeactivate: () => void;
}) {
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);

  const dailyTotals = plan.dailyTotals;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{plan.name}</h3>
          <p className="text-xs text-muted-foreground">
            {plan.meals.length} meals · Updated {format(new Date(plan._creationTime), "MMM d")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {plan.isActive && <Badge className="bg-green-400/20 text-green-400 border-0 text-[10px]"><CheckCircle className="w-2.5 h-2.5 mr-1" />Active</Badge>}
          <Button size="sm" variant="secondary" className="cursor-pointer h-7 text-xs" onClick={onEdit}>
            <Edit className="w-3 h-3 mr-1" />Edit
          </Button>
          <Button size="sm" variant="secondary" className="cursor-pointer h-7 text-xs" onClick={onDuplicate}>
            <Copy className="w-3 h-3 mr-1" />Copy
          </Button>
        </div>
      </div>

      {/* Daily macro targets */}
      <Card className="bg-card/50 border-border">
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              { label: "Calories", target: plan.targetCalories, actual: dailyTotals.calories, color: "text-primary", bg: "bg-primary/10" },
              { label: "Protein", target: plan.targetProtein, actual: dailyTotals.protein, color: "text-blue-400", bg: "bg-blue-400/10", unit: "g" },
              { label: "Carbs", target: plan.targetCarbs, actual: dailyTotals.carbs, color: "text-yellow-400", bg: "bg-yellow-400/10", unit: "g" },
              { label: "Fats", target: plan.targetFats, actual: dailyTotals.fats, color: "text-red-400", bg: "bg-red-400/10", unit: "g" },
            ].map(({ label, target, actual, color, bg, unit = "" }) => (
              <div key={label} className={cn("rounded-lg p-2.5", bg)}>
                <p className={cn("font-bold text-base", color)}>{Math.round(actual)}{unit}</p>
                <p className="text-[10px] text-muted-foreground">of {target}{unit}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>

          {plan.targetFiber || plan.targetWaterMl ? (
            <div className="flex gap-3 text-xs text-muted-foreground border-t border-border/50 pt-2">
              {plan.targetFiber && <span className="flex items-center gap-1"><Apple className="w-3 h-3" />Fiber: {plan.targetFiber}g</span>}
              {plan.targetWaterMl && <span className="flex items-center gap-1"><Droplets className="w-3 h-3 text-blue-400" />Water: {plan.targetWaterMl}ml</span>}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Meals */}
      <div className="space-y-2">
        {plan.mealsWithFoodDetails
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((meal) => (
            <div key={meal.id} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedMeal(prev => prev === meal.id ? null : meal.id)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer text-left bg-muted/10"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Utensils className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{meal.name}</p>
                    {meal.time && <p className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{meal.time}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-primary">{Math.round(meal.totals.calories)} kcal</span>
                  <span className="text-[10px] text-muted-foreground hidden sm:block">
                    P:{Math.round(meal.totals.protein)}g C:{Math.round(meal.totals.carbs)}g F:{Math.round(meal.totals.fats)}g
                  </span>
                  {expandedMeal === meal.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </button>

              {expandedMeal === meal.id && (
                <div className="divide-y divide-border/30">
                  {meal.foodsWithDetails.map((f) => (
                    <div key={f.foodId} className="flex items-center justify-between px-4 py-2 bg-muted/5 hover:bg-muted/10">
                      <div>
                        <p className="text-xs font-medium">{f.foodName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {(f as { quantityInGrams?: number }).quantityInGrams != null
                            ? `${(f as { quantityInGrams?: number }).quantityInGrams}g`
                            : `${f.servings} × ${f.servingSize}${f.servingUnit}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-primary">{Math.round((f as { effectiveMacros?: { calories: number } }).effectiveMacros?.calories ?? f.calories * f.servings)} kcal</p>
                        <p className="text-[10px] text-muted-foreground">
                          P:{Math.round((f as { effectiveMacros?: { protein: number } }).effectiveMacros?.protein ?? f.protein * f.servings)}g
                          {" "}C:{Math.round((f as { effectiveMacros?: { carbs: number } }).effectiveMacros?.carbs ?? f.carbs * f.servings)}g
                          {" "}F:{Math.round((f as { effectiveMacros?: { fats: number } }).effectiveMacros?.fats ?? f.fats * f.servings)}g
                        </p>
                      </div>
                    </div>
                  ))}
                  {meal.foodsWithDetails.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">No foods in this meal</p>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>

      {plan.notes && (
        <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
          <p className="text-xs font-semibold mb-1">Plan Notes</p>
          <p>{plan.notes}</p>
        </div>
      )}

      {/* Danger actions */}
      <div className="flex gap-2 pt-1 border-t border-border/50">
        {plan.isActive && (
          <Button size="sm" variant="secondary" className="cursor-pointer text-xs" onClick={onDeactivate}>
            Deactivate Plan
          </Button>
        )}
        <Button size="sm" variant="secondary" className="cursor-pointer text-xs text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3 h-3 mr-1" /> Delete Plan
        </Button>
      </div>
    </div>
  );
}

// ─── Main Coach Nutrition Tab ─────────────────────────────────────────────────

export default function CoachNutritionTab({ clientId }: { clientId: Id<"users"> }) {
  const [view, setView] = useState<"list" | "builder" | "edit">("list");
  const [editingPlanId, setEditingPlanId] = useState<Id<"mealPlans"> | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<Id<"mealPlans"> | null>(null);

  const plans = useQuery(api.mealPlans.listByUser, { userId: clientId });
  const editingPlan = useQuery(api.mealPlans.get, editingPlanId ? { id: editingPlanId } : "skip");
  const assignment = useQuery(api.coachClient.getNutritionAssignment, { clientId });

  const removePlan = useMutation(api.mealPlans.remove);
  const setActive = useMutation(api.mealPlans.setActive);
  const duplicatePlan = useMutation(api.mealPlans.duplicate);
  const upsertAssignment = useMutation(api.coachClient.upsertNutritionAssignment);

  const todayMs = startOfDay(new Date()).getTime();
  const mealLogs = useQuery(api.mealLogs.getMealLogsForDate, { userId: clientId, date: todayMs });
  const dailySummary = useQuery(api.mealLogs.getDailyNutritionSummary, {
    userId: clientId,
    date: todayMs,
  });

  const activePlan = plans?.find(p => p.isActive);

  const handleDelete = async (planId: Id<"mealPlans">) => {
    try {
      await removePlan({ id: planId });
      toast.success("Plan deleted");
    } catch { toast.error("Failed to delete plan"); }
  };

  const handleDeactivate = async (planId: Id<"mealPlans">) => {
    try {
      await setActive({ id: planId, isActive: false });
      toast.success("Plan deactivated");
    } catch { toast.error("Failed to deactivate plan"); }
  };

  const handleDuplicate = async (planId: Id<"mealPlans">) => {
    try {
      await duplicatePlan({ id: planId });
      toast.success("Plan duplicated");
    } catch { toast.error("Failed to duplicate plan"); }
  };

  const handleStartEdit = (planId: Id<"mealPlans">) => {
    setEditingPlanId(planId);
    setView("edit");
  };

  if (view === "builder" || view === "edit") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setView("list"); setEditingPlanId(null); }}
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
          >
            ← Back to Nutrition
          </button>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs font-semibold">{view === "edit" ? "Edit Plan" : "New Plan"}</span>
        </div>

        {view === "edit" && editingPlanId && editingPlan === undefined ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <MealPlanBuilder
            clientId={clientId}
            existingPlan={view === "edit" ? (editingPlan ?? undefined) : undefined}
            onCancel={() => { setView("list"); setEditingPlanId(null); }}
            onSaved={() => { setView("list"); setEditingPlanId(null); }}
          />
        )}
      </div>
    );
  }

  // ─── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header action */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-1.5">
            <Utensils className="w-4 h-4 text-green-400" /> Nutrition Plan
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activePlan ? `Active: ${activePlan.name}` : "No active plan assigned"}
          </p>
        </div>
        <Button size="sm" onClick={() => setView("builder")} className="cursor-pointer">
          <Plus className="w-3 h-3 mr-1" /> New Plan
        </Button>
      </div>

      {/* Today's macro summary */}
      {dailySummary && dailySummary.mealsCompleted > 0 && activePlan && (
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Star className="w-3 h-3 text-yellow-400" />Today's Adherence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <MacroBar label="Calories" current={dailySummary.consumedCalories} target={activePlan.targetCalories} color={MACRO_COLORS.calories} />
            <MacroBar label="Protein" current={dailySummary.consumedProtein} target={activePlan.targetProtein} color={MACRO_COLORS.protein} />
            <MacroBar label="Carbs" current={dailySummary.consumedCarbs} target={activePlan.targetCarbs} color={MACRO_COLORS.carbs} />
            <MacroBar label="Fats" current={dailySummary.consumedFats} target={activePlan.targetFats} color={MACRO_COLORS.fats} />
          </CardContent>
        </Card>
      )}

      {/* Plans list */}
      {plans === undefined ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : plans.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center">
          <Utensils className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-semibold mb-1">No meal plans yet</p>
          <p className="text-xs text-muted-foreground mb-4">Create a personalized meal plan to assign to this client</p>
          <Button size="sm" onClick={() => setView("builder")} className="cursor-pointer">
            <Plus className="w-3 h-3 mr-1" /> Create First Plan
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => (
            <Card key={plan._id} className={cn("bg-card/50 border-border", plan.isActive && "border-green-400/30")}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-sm truncate">{plan.name}</p>
                      {plan.isActive && (
                        <Badge className="bg-green-400/20 text-green-400 border-0 text-[10px]">
                          <CheckCircle className="w-2.5 h-2.5 mr-1" />Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {plan.meals.length} meals · {plan.targetCalories} kcal target
                    </p>
                    <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span className="text-blue-400">P: {plan.targetProtein}g</span>
                      <span className="text-yellow-400">C: {plan.targetCarbs}g</span>
                      <span className="text-red-400">F: {plan.targetFats}g</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!plan.isActive && (
                      <Button size="sm" variant="secondary" className="cursor-pointer h-7 text-xs" onClick={() => setActive({ id: plan._id, isActive: true })}>
                        Assign
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" onClick={() => handleStartEdit(plan._id)}>
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" onClick={() => handleDuplicate(plan._id)}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer text-destructive" onClick={() => handleDelete(plan._id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recent meal logs */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Camera className="w-3 h-3 text-accent" />Recent Meal Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mealLogs === undefined ? (
            <Skeleton className="h-16 w-full" />
          ) : mealLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No meal logs yet</p>
          ) : (
            <div className="space-y-2">
              {mealLogs.slice(0, 5).map(log => (
                <div key={log._id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                  {log.imageUrl ? (
                    <img src={log.imageUrl} alt="meal" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Utensils className="w-4 h-4 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] capitalize">{log.mealId}</Badge>
                      {log.isCompleted && <CheckCircle className="w-3 h-3 text-green-400" />}
                    </div>
                    {(log.aiMacros ?? log.clientMacros) && (
                      <p className="text-[10px] text-muted-foreground">
                        {(log.clientMacros ?? log.aiMacros)!.calories} kcal · P:{(log.clientMacros ?? log.aiMacros)!.protein}g C:{(log.clientMacros ?? log.aiMacros)!.carbs}g F:{(log.clientMacros ?? log.aiMacros)!.fats}g
                      </p>
                    )}
                  </div>
                  {log.completedAt && (
                    <p className="text-[10px] text-muted-foreground shrink-0">{format(new Date(log.completedAt), "h:mm a")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {duplicateDialogOpen && duplicateTarget && (
        <Dialog open={duplicateDialogOpen} onOpenChange={() => setDuplicateDialogOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicate Plan</DialogTitle>
              <DialogDescription>Copy this plan for this client</DialogDescription>
            </DialogHeader>
            <Button onClick={async () => {
              await handleDuplicate(duplicateTarget);
              setDuplicateDialogOpen(false);
            }}>Duplicate</Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


