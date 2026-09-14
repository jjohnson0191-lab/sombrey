import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { Plus, Trash2, Check, Sparkles, Target, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type AiMealFood = {
  name: string;
  amount: string;
  protein: number;
  carbs: number;
  fats: number;
  calories: number;
};

type AiMeal = {
  name: string;
  time?: string;
  foods: AiMealFood[];
};

function MealPlanCard({
  plan,
  onDelete,
  onToggleActive,
}: {
  plan: {
    _id: Id<"mealPlans">;
    name: string;
    targetCalories: number;
    targetProtein: number;
    targetCarbs: number;
    targetFats: number;
    isActive: boolean;
    meals: { name: string; time?: string; foods: { foodId: Id<"foods">; servings: number }[] }[];
  };
  onDelete: (id: Id<"mealPlans">) => void;
  onToggleActive: (id: Id<"mealPlans">, active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`bg-card/50 backdrop-blur border-border transition-all ${plan.isActive ? "border-primary/50 ring-1 ring-primary/20" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <CardTitle className="text-lg">{plan.name}</CardTitle>
              {plan.isActive && (
                <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Active</Badge>
              )}
            </div>
            <CardDescription>{plan.meals.length} meals configured</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={plan.isActive ? "secondary" : "default"}
              onClick={() => onToggleActive(plan._id, !plan.isActive)}
              className="cursor-pointer"
            >
              {plan.isActive ? "Deactivate" : "Set Active"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(plan._id)}
              className="text-destructive hover:text-destructive cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Macro targets */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: "Calories", value: plan.targetCalories, unit: "", color: "text-primary" },
            { label: "Protein", value: plan.targetProtein, unit: "g", color: "text-foreground" },
            { label: "Carbs", value: plan.targetCarbs, unit: "g", color: "text-accent" },
            { label: "Fats", value: plan.targetFats, unit: "g", color: "text-chart-3" },
          ].map((macro) => (
            <div key={macro.label} className="text-center p-2 bg-muted/50 rounded-lg">
              <div className={`text-xl font-bold ${macro.color}`}>{macro.value}{macro.unit}</div>
              <div className="text-xs text-muted-foreground">{macro.label}</div>
            </div>
          ))}
        </div>

        {/* Meals toggle */}
        {plan.meals.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full text-left"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expanded ? "Hide" : "Show"} meals
          </button>
        )}

        {expanded && (
          <div className="mt-3 space-y-2">
            {plan.meals.map((meal, i) => (
              <div key={i} className="p-3 bg-muted/30 rounded-lg">
                <div className="font-medium text-sm">{meal.name}</div>
                {meal.time && <div className="text-xs text-muted-foreground">{meal.time}</div>}
                <div className="text-xs text-muted-foreground mt-1">{meal.foods.length} food items</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MealPlansContent() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiMeal[] | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newCalories, setNewCalories] = useState("2500");
  const [newProtein, setNewProtein] = useState("180");
  const [newCarbs, setNewCarbs] = useState("250");
  const [newFats, setNewFats] = useState("70");

  // AI form state
  const [aiCalories, setAiCalories] = useState("2500");
  const [aiProtein, setAiProtein] = useState("180");
  const [aiCarbs, setAiCarbs] = useState("250");
  const [aiFats, setAiFats] = useState("70");
  const [aiMeals, setAiMeals] = useState("3");
  const [aiPreferences, setAiPreferences] = useState("");

  const mealPlans = useQuery(api.mealPlans.listByUser, {});
  const createMealPlan = useMutation(api.mealPlans.create);
  const removeMealPlan = useMutation(api.mealPlans.remove);
  const setActive = useMutation(api.mealPlans.setActive);
  const generateMealPlan = useAction(api.ai.mealSuggestions.generateMealPlan);

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error("Please enter a plan name");
      return;
    }
    try {
      await createMealPlan({
        name: newName.trim(),
        targetCalories: parseFloat(newCalories) || 2500,
        targetProtein: parseFloat(newProtein) || 180,
        targetCarbs: parseFloat(newCarbs) || 250,
        targetFats: parseFloat(newFats) || 70,
        meals: [],
        isActive: (mealPlans?.length ?? 0) === 0,
      });
      toast.success("Meal plan created!");
      setIsCreateOpen(false);
      setNewName("");
    } catch {
      toast.error("Failed to create meal plan");
    }
  };

  const handleDelete = async (id: Id<"mealPlans">) => {
    try {
      await removeMealPlan({ id });
      toast.success("Meal plan deleted");
    } catch {
      toast.error("Failed to delete meal plan");
    }
  };

  const handleToggleActive = async (id: Id<"mealPlans">, active: boolean) => {
    try {
      await setActive({ id, isActive: active });
      toast.success(active ? "Meal plan set as active" : "Meal plan deactivated");
    } catch {
      toast.error("Failed to update meal plan");
    }
  };

  const handleGenerateAi = async () => {
    setIsGenerating(true);
    try {
      const result = await generateMealPlan({
        targetCalories: parseFloat(aiCalories) || 2500,
        targetProtein: parseFloat(aiProtein) || 180,
        targetCarbs: parseFloat(aiCarbs) || 250,
        targetFats: parseFloat(aiFats) || 70,
        numberOfMeals: parseInt(aiMeals) || 3,
        dietaryPreferences: aiPreferences || undefined,
      });
      setAiSuggestion(result as AiMeal[]);
    } catch {
      toast.error("Failed to generate meal plan. Make sure the OpenAI API key is configured.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAiPlan = async () => {
    if (!aiSuggestion) return;
    try {
      await createMealPlan({
        name: `AI Meal Plan — ${new Date().toLocaleDateString()}`,
        targetCalories: parseFloat(aiCalories) || 2500,
        targetProtein: parseFloat(aiProtein) || 180,
        targetCarbs: parseFloat(aiCarbs) || 250,
        targetFats: parseFloat(aiFats) || 70,
        meals: aiSuggestion.map((meal, i) => ({
              name: meal.name,
              time: meal.time,
              id: Math.random().toString(36).slice(2),
              displayOrder: i,
              foods: [] as Array<{ foodId: import("@/convex/_generated/dataModel.js").Id<"foods">; servings: number }>,
            })),
        isActive: (mealPlans?.length ?? 0) === 0,
      });
      toast.success("AI meal plan saved!");
      setIsAiOpen(false);
      setAiSuggestion(null);
    } catch {
      toast.error("Failed to save meal plan");
    }
  };

  if (mealPlans === undefined) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="cursor-pointer">
              <Plus className="w-4 h-4 mr-2" />
              New Meal Plan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Meal Plan</DialogTitle>
              <DialogDescription>Set your daily macro targets for this plan</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Plan Name</Label>
                <Input
                  placeholder="e.g. Lean Bulk Phase"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Calories (kcal)", value: newCalories, setter: setNewCalories },
                  { label: "Protein (g)", value: newProtein, setter: setNewProtein },
                  { label: "Carbs (g)", value: newCarbs, setter: setNewCarbs },
                  { label: "Fats (g)", value: newFats, setter: setNewFats },
                ].map((field) => (
                  <div key={field.label} className="space-y-2">
                    <Label>{field.label}</Label>
                    <Input
                      type="number"
                      value={field.value}
                      onChange={(e) => field.setter(e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <Button onClick={handleCreate} className="w-full cursor-pointer">
                Create Plan
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isAiOpen} onOpenChange={(open) => { setIsAiOpen(open); if (!open) setAiSuggestion(null); }}>
          <DialogTrigger asChild>
            <Button variant="secondary" className="cursor-pointer">
              <Sparkles className="w-4 h-4 mr-2" />
              AI Meal Suggestions
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                AI Meal Plan Generator
              </DialogTitle>
              <DialogDescription>
                Let AI create a personalized meal plan based on your macro targets
              </DialogDescription>
            </DialogHeader>

            {!aiSuggestion ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Calories (kcal)", value: aiCalories, setter: setAiCalories },
                    { label: "Protein (g)", value: aiProtein, setter: setAiProtein },
                    { label: "Carbs (g)", value: aiCarbs, setter: setAiCarbs },
                    { label: "Fats (g)", value: aiFats, setter: setAiFats },
                    { label: "Number of Meals", value: aiMeals, setter: setAiMeals },
                  ].map((field) => (
                    <div key={field.label} className="space-y-2">
                      <Label>{field.label}</Label>
                      <Input
                        type="number"
                        value={field.value}
                        onChange={(e) => field.setter(e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label>Dietary Preferences / Restrictions (optional)</Label>
                  <Textarea
                    placeholder="e.g. Vegetarian, lactose-free, no nuts..."
                    value={aiPreferences}
                    onChange={(e) => setAiPreferences(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  onClick={handleGenerateAi}
                  disabled={isGenerating}
                  className="w-full cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Zap className="w-4 h-4 mr-2 animate-pulse" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Meal Plan
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3">
                  {aiSuggestion.map((meal, i) => (
                    <Card key={i} className="bg-muted/30 border-border">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{meal.name}</CardTitle>
                          {meal.time && (
                            <Badge variant="secondary" className="text-xs">{meal.time}</Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          {meal.foods.map((food, j) => (
                            <div key={j} className="flex justify-between text-sm">
                              <span>{food.name} — {food.amount}</span>
                              <span className="text-muted-foreground">{food.calories} cal</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-3 border-t border-border flex gap-4 text-xs text-muted-foreground">
                          <span>P: {meal.foods.reduce((s, f) => s + (f.protein || 0), 0).toFixed(0)}g</span>
                          <span>C: {meal.foods.reduce((s, f) => s + (f.carbs || 0), 0).toFixed(0)}g</span>
                          <span>F: {meal.foods.reduce((s, f) => s + (f.fats || 0), 0).toFixed(0)}g</span>
                          <span className="text-primary font-medium">
                            {meal.foods.reduce((s, f) => s + (f.calories || 0), 0)} kcal
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="flex gap-3">
                  <Button onClick={handleSaveAiPlan} className="flex-1 cursor-pointer">
                    <Check className="w-4 h-4 mr-2" />
                    Save This Plan
                  </Button>
                  <Button variant="secondary" onClick={() => setAiSuggestion(null)} className="cursor-pointer">
                    Regenerate
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Plans list */}
      {mealPlans.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Target /></EmptyMedia>
            <EmptyTitle>No meal plans yet</EmptyTitle>
            <EmptyDescription>Create a plan to set your daily macro targets</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setIsCreateOpen(true)} className="cursor-pointer">
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Plan
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          {mealPlans.map((plan) => (
            <MealPlanCard
              key={plan._id}
              plan={plan}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MealPlansPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Meal Plans
          </h1>
          <p className="text-muted-foreground text-lg">
            Set your macro targets and let AI generate personalized meal ideas
          </p>
        </div>
        <MealPlansContent />
      </div>
    </Authenticated>
  );
}
