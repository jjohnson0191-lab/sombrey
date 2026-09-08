import { useState } from "react";
import { Authenticated } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

function AddFoodForm() {
  const navigate = useNavigate();
  const createFood = useMutation(api.foods.create);

  const [name, setName] = useState("");
  const [servingSize, setServingSize] = useState("");
  const [servingUnit, setServingUnit] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fats, setFats] = useState("");
  const [calories, setCalories] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [category, setCategory] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const proteinNum = parseFloat(protein);
    const carbsNum = parseFloat(carbs);
    const fatsNum = parseFloat(fats);
    const caloriesNum = parseFloat(calories);

    if (isNaN(proteinNum) || isNaN(carbsNum) || isNaN(fatsNum) || isNaN(caloriesNum)) {
      toast.error("Please enter valid numbers for all macro fields");
      return;
    }

    setIsSubmitting(true);

    try {
      await createFood({
        name,
        servingSize,
        servingUnit,
        protein: proteinNum,
        carbs: carbsNum,
        fats: fatsNum,
        calories: caloriesNum,
        category: category || undefined,
        isCustom: true,
      });

      toast.success("Food added successfully!");
      navigate("/nutrition/foods");
    } catch (error) {
      toast.error("Failed to add food");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-calculate calories based on macros
  const calculateCalories = () => {
    const proteinNum = parseFloat(protein) || 0;
    const carbsNum = parseFloat(carbs) || 0;
    const fatsNum = parseFloat(fats) || 0;
    
    const calculatedCalories = (proteinNum * 4) + (carbsNum * 4) + (fatsNum * 9);
    setCalories(Math.round(calculatedCalories).toString());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto">
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Details about the food item</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Food Name *</Label>
            <Input
              id="name"
              placeholder="Rice and Curry, Chicken Kottu, etc."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="servingSize">Serving Size *</Label>
              <Input
                id="servingSize"
                placeholder="1, 100, 1.5"
                value={servingSize}
                onChange={(e) => setServingSize(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="servingUnit">Serving Unit *</Label>
              <Input
                id="servingUnit"
                placeholder="cup, g, oz, plate"
                value={servingUnit}
                onChange={(e) => setServingUnit(e.target.value)}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Nutritional Information</CardTitle>
          <CardDescription>Macros per serving</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="protein">Protein (grams) *</Label>
              <Input
                id="protein"
                type="number"
                step="0.1"
                placeholder="25"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="carbs">Carbohydrates (grams) *</Label>
              <Input
                id="carbs"
                type="number"
                step="0.1"
                placeholder="30"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fats">Fats (grams) *</Label>
              <Input
                id="fats"
                type="number"
                step="0.1"
                placeholder="10"
                value={fats}
                onChange={(e) => setFats(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="calories">Calories *</Label>
              <div className="flex gap-2">
                <Input
                  id="calories"
                  type="number"
                  step="1"
                  placeholder="300"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  required
                />
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={calculateCalories}
                  className="flex-shrink-0"
                >
                  Calculate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Or click Calculate to auto-compute from macros
              </p>
            </div>
          </div>

          {/* Preview */}
          {protein && carbs && fats && calories && (
            <div className="mt-6 p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <h4 className="text-sm font-semibold mb-3">Macro Split Preview</h4>
              <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-muted mb-2">
                <div 
                  className="bg-primary" 
                  style={{ width: `${(parseFloat(protein) * 4 / parseFloat(calories)) * 100}%` }}
                />
                <div 
                  className="bg-accent" 
                  style={{ width: `${(parseFloat(carbs) * 4 / parseFloat(calories)) * 100}%` }}
                />
                <div 
                  className="bg-chart-3" 
                  style={{ width: `${(parseFloat(fats) * 9 / parseFloat(calories)) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-primary">
                  Protein: {Math.round((parseFloat(protein) * 4 / parseFloat(calories)) * 100)}%
                </span>
                <span className="text-accent">
                  Carbs: {Math.round((parseFloat(carbs) * 4 / parseFloat(calories)) * 100)}%
                </span>
                <span className="text-chart-3">
                  Fats: {Math.round((parseFloat(fats) * 9 / parseFloat(calories)) * 100)}%
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Adding..." : "Add Food"}
        </Button>
        <Button type="button" variant="outline" size="lg" asChild>
          <Link to="/nutrition/foods">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

export default function NewFoodPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Add Custom Food
          </h1>
          <p className="text-muted-foreground text-lg">
            Add local foods or custom recipes to your database
          </p>
        </div>

        <AddFoodForm />
      </div>
    </Authenticated>
  );
}
