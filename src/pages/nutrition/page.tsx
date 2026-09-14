import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Plus, Trash2, Calendar, TrendingUp, Target, Camera, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { format, startOfDay } from "date-fns";
import ClientAssignedPlanView from "@/components/client-assigned-plan-view.tsx";
import AiPlanNutritionView from "./_components/ai-plan-view.tsx";

// Wrapper: shows coach plan if assigned, AI plan otherwise
function MyPlanTab() {
  const assignedPlan = useQuery(api.mealPlans.getAssignedClientPlan, {});
  const aiPlanMeals = useQuery(api.premiumOnboarding.getAiPlanMeals, {});

  // Loading
  if (assignedPlan === undefined || aiPlanMeals === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Coach-assigned plan takes priority
  if (assignedPlan) return <ClientAssignedPlanView />;

  // Fallback: AI-generated plan
  return <AiPlanNutritionView />;
}

function NutritionTrackerContent() {
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()).getTime());
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false);
  const [selectedFoodId, setSelectedFoodId] = useState<string>("");
  const [servings, setServings] = useState("1");
  const [mealType, setMealType] = useState("breakfast");

  const nutritionLog = useQuery(api.nutritionLogs.getByDate, { date: selectedDate });
  const foods = useQuery(api.foods.list, {});
  const mealPlans = useQuery(api.mealPlans.listByUser, {});
  const logFood = useMutation(api.nutritionLogs.logFood);
  const removeFood = useMutation(api.nutritionLogs.removeFood);
  const aiPlanMeals = useQuery(api.premiumOnboarding.getAiPlanMeals, {});

  const activeMealPlan = mealPlans?.find(mp => mp.isActive);

  const handleLogFood = async () => {
    if (!selectedFoodId) {
      toast.error("Please select a food");
      return;
    }

    const servingsNum = parseFloat(servings);
    if (isNaN(servingsNum) || servingsNum <= 0) {
      toast.error("Please enter a valid number of servings");
      return;
    }

    try {
      type FoodId = import("@/convex/_generated/dataModel").Id<"foods">;
      await logFood({
        date: selectedDate,
        foodId: selectedFoodId as FoodId,
        servings: servingsNum,
        mealType,
      });
      toast.success("Food logged successfully!");
      setIsLogDialogOpen(false);
      setSelectedFoodId("");
      setServings("1");
    } catch (error) {
      toast.error("Failed to log food");
      console.error(error);
    }
  };

  const handleRemoveFood = async (entryId: string | undefined, index: number) => {
    try {
      // #8 — use stable entryId when available; fall back to index for old log entries.
      await removeFood(
        entryId != null
          ? { date: selectedDate, entryId }
          : { date: selectedDate, foodIndex: index }
      );
      toast.success("Food removed");
    } catch (error) {
      toast.error("Failed to remove food");
      console.error(error);
    }
  };

  if (nutritionLog === undefined || foods === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const totalCalories = nutritionLog?.totalCalories || 0;
  const totalProtein = nutritionLog?.totalProtein || 0;
  const totalCarbs = nutritionLog?.totalCarbs || 0;
  const totalFats = nutritionLog?.totalFats || 0;

  const targetCalories = aiPlanMeals?.macroTargets?.calories ?? activeMealPlan?.targetCalories ?? 2500;
  const targetProtein = aiPlanMeals?.macroTargets?.protein ?? activeMealPlan?.targetProtein ?? 180;
  const targetCarbs = aiPlanMeals?.macroTargets?.carbs ?? activeMealPlan?.targetCarbs ?? 250;
  const targetFats = aiPlanMeals?.macroTargets?.fats ?? activeMealPlan?.targetFats ?? 70;

  const caloriesPercent = (totalCalories / targetCalories) * 100;
  const proteinPercent = (totalProtein / targetProtein) * 100;
  const carbsPercent = (totalCarbs / targetCarbs) * 100;
  const fatsPercent = (totalFats / targetFats) * 100;

  const mealTypes = ["breakfast", "lunch", "dinner", "snack"];

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      <div className="flex items-center gap-4">
        <Calendar className="w-5 h-5 text-primary" />
        <Input
          type="date"
          value={format(selectedDate, "yyyy-MM-dd")}
          onChange={(e) => setSelectedDate(startOfDay(new Date(e.target.value)).getTime())}
          className="w-auto"
        />
      </div>

      {/* Macro Summary */}
      <div className="grid md:grid-cols-4 gap-6">
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Calories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">{Math.round(totalCalories)}</span>
                <span className="text-muted-foreground">/ {targetCalories}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all" 
                  style={{ width: `${Math.min(caloriesPercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{Math.round(caloriesPercent)}% of target</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Protein</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">{Math.round(totalProtein)}g</span>
                <span className="text-muted-foreground">/ {targetProtein}g</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all" 
                  style={{ width: `${Math.min(proteinPercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{Math.round(proteinPercent)}% of target</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Carbs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-accent">{Math.round(totalCarbs)}g</span>
                <span className="text-muted-foreground">/ {targetCarbs}g</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-accent h-2 rounded-full transition-all" 
                  style={{ width: `${Math.min(carbsPercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{Math.round(carbsPercent)}% of target</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-chart-3">{Math.round(totalFats)}g</span>
                <span className="text-muted-foreground">/ {targetFats}g</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-chart-3 h-2 rounded-full transition-all" 
                  style={{ width: `${Math.min(fatsPercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{Math.round(fatsPercent)}% of target</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Meal Plan — shown when user has an AI plan */}
      {aiPlanMeals && aiPlanMeals.meals.length > 0 && (
        <Card className="bg-card/50 backdrop-blur border-primary/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Target className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm">AI Meal Plan</CardTitle>
                  <CardDescription className="text-xs">
                    {aiPlanMeals.macroTargets.calories} kcal · {aiPlanMeals.macroTargets.protein}g P · {aiPlanMeals.macroTargets.carbs}g C · {aiPlanMeals.macroTargets.fats}g F
                  </CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs text-primary cursor-pointer">
                <Link to="/ai-plan">Edit plan</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {aiPlanMeals.meals.map((meal, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-semibold text-sm">{meal.name}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        {meal.time && <span className="text-[10px] text-muted-foreground">{meal.time}</span>}
                        {meal.calories && <span className="text-[10px] font-bold text-muted-foreground">{meal.calories} kcal</span>}
                      </div>
                    </div>
                    {meal.suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {meal.suggestions.slice(0, 4).map((s, j) => (
                          <span key={j} className="text-[10px] bg-background/50 border border-border/50 px-2 py-0.5 rounded-full text-muted-foreground">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logged Foods */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Today's Foods</CardTitle>
              <CardDescription>Track what you've eaten</CardDescription>
            </div>
            <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Log Food
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Log Food</DialogTitle>
                  <DialogDescription>Add a food item to your daily log</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="food">Food</Label>
                    <Select value={selectedFoodId} onValueChange={setSelectedFoodId}>
                      <SelectTrigger id="food">
                        <SelectValue placeholder="Select food" />
                      </SelectTrigger>
                      <SelectContent>
                        {foods?.map((food) => (
                          <SelectItem key={food._id} value={food._id}>
                            {food.name} ({food.calories} cal)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="servings">Servings</Label>
                    <Input
                      id="servings"
                      type="number"
                      step="0.1"
                      value={servings}
                      onChange={(e) => setServings(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mealType">Meal Type</Label>
                    <Select value={mealType} onValueChange={setMealType}>
                      <SelectTrigger id="mealType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {mealTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={handleLogFood} className="w-full">
                    Log Food
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!nutritionLog || nutritionLog.foods.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No foods logged for this day yet
            </div>
          ) : (
            <div className="space-y-3">
              {nutritionLog.foodsWithDetails.map((food, index) => (
                <div key={index} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">{food.foodName}</h4>
                      <span className="text-xs text-muted-foreground">
                        ({food.mealType})
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {food.servings}x serving • {Math.round(food.calories * food.servings)} cal
                      • P: {Math.round(food.protein * food.servings)}g
                      • C: {Math.round(food.carbs * food.servings)}g
                      • F: {Math.round(food.fats * food.servings)}g
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFood(food.entryId, index)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Target className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Meal Plans</CardTitle>
                <CardDescription>Set macro targets</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/nutrition/meal-plans">View Plans</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Camera className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>AI Meal Log</CardTitle>
                <CardDescription>Photo-based macro tracking</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button className="w-full cursor-pointer" asChild>
              <Link to="/nutrition/meal-log">Log Meal with AI</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border hover:border-accent/50 transition-all">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-accent/10 rounded-lg">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
              <div>
                <CardTitle className="text-lg">Food Database</CardTitle>
                <CardDescription>Browse all foods</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/nutrition/foods">View Foods</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border hover:border-chart-3/50 transition-all">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-chart-3/10 rounded-lg">
                <Plus className="w-6 h-6 text-chart-3" />
              </div>
              <div>
                <CardTitle className="text-lg">Add Custom Food</CardTitle>
                <CardDescription>Create your own</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/nutrition/foods/new">Add Food</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function NutritionPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">Nutrition</h1>
          <p className="text-muted-foreground">Track your daily macros and follow your assigned meal plan</p>
        </div>

        <Tabs defaultValue="my-plan" className="w-full">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="my-plan" className="flex-1 cursor-pointer flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />My Plan
            </TabsTrigger>
            <TabsTrigger value="tracker" className="flex-1 cursor-pointer flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />Tracker
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-plan">
            <MyPlanTab />
          </TabsContent>

          <TabsContent value="tracker">
            <NutritionTrackerContent />
          </TabsContent>
        </Tabs>
      </div>
    </Authenticated>
  );
}
