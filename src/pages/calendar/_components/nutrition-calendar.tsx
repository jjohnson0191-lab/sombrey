import { useState, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
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
import {
  ChevronLeft, ChevronRight, Utensils, Camera, CheckCircle,
  Clock, Target, Flame, ChevronDown, ChevronUp,
  ImagePlus, TrendingUp, Upload, Sparkles, AlertCircle, Pencil,
  Plus, Trash2, RefreshCw,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isToday,
  addMonths, subMonths, startOfDay,
} from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { motion, AnimatePresence } from "motion/react";

// ─── Types ──────────────────────────────────────────────────────────────────

type MealLog = NonNullable<ReturnType<typeof useQuery<typeof api.mealLogs.getMealLogsForDate>>>[number];

type ClientMacros = { calories: number; protein: number; carbs: number; fats: number };

type MealEntry = {
  id: string;
  name: string;
  time?: string;
  displayOrder: number;
  log?: MealLog;
  totals: { calories: number; protein: number; carbs: number; fats: number };
  foodsWithDetails: Array<{
    foodId: Id<"foods">;
    foodName: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    servingSize: string;
    servingUnit: string;
  }>;
};

// Editable row for each AI-detected food item
type FoodRow = {
  key: string;
  foodName: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

// ─── Macro bar ──────────────────────────────────────────────────────────────

function MacroBar({ label, current, target, color }: { label: string; current: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const over = target > 0 && current > target;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className={cn("font-semibold", color)}>{label}</span>
        <span className={cn(over ? "text-destructive" : "text-muted-foreground")}>
          {Math.round(current)} / {Math.round(target)}
        </span>
      </div>
      <Progress value={pct} className={cn("h-1.5", over ? "[&>div]:bg-destructive" : "")} />
    </div>
  );
}

// ─── Food row editor ─────────────────────────────────────────────────────────

function FoodRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: FoodRow;
  onChange: (updated: FoodRow) => void;
  onRemove: () => void;
}) {
  const update = (field: keyof FoodRow, val: string) => {
    const num = parseFloat(val) || 0;
    onChange({ ...row, [field]: num });
  };

  return (
    <div className="bg-muted/20 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={row.foodName}
          onChange={e => onChange({ ...row, foodName: e.target.value })}
          className="h-7 text-xs font-medium flex-1"
          placeholder="Food name"
        />
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0"
          title="Remove"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { label: "g", field: "grams" as const },
          { label: "kcal", field: "calories" as const },
          { label: "P(g)", field: "protein" as const },
          { label: "C(g)", field: "carbs" as const },
          { label: "F(g)", field: "fat" as const },
        ].map(({ label, field }) => (
          <div key={field} className="space-y-0.5">
            <p className="text-[9px] text-muted-foreground text-center">{label}</p>
            <Input
              type="number"
              min="0"
              value={row[field] || ""}
              onChange={e => update(field, e.target.value)}
              className="h-6 text-[11px] text-center px-1"
              placeholder="0"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Log Meal Dialog ─────────────────────────────────────────────────────────

function LogMealDialog({
  meal,
  planId,
  dateMs,
  open,
  onOpenChange,
  readOnly = false,
}: {
  meal: MealEntry;
  planId: Id<"mealPlans">;
  dateMs: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  readOnly?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedStorageId, setUploadedStorageId] = useState<Id<"_storage"> | null>(
    meal.log?.imageStorageId ?? null
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(meal.log?.imageUrl ?? null);

  // Manual override macros (editable 4-field grid)
  const [manualMacros, setManualMacros] = useState<ClientMacros>(
    meal.log?.clientMacros ?? { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );
  const [notes, setNotes] = useState(meal.log?.notes ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedFoods, setExpandedFoods] = useState(false);

  // AI analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [foodRows, setFoodRows] = useState<FoodRow[]>([]);
  const [aiAnalysisDone, setAiAnalysisDone] = useState(false);
  const [useManualMacros, setUseManualMacros] = useState(false);

  const generateUploadUrl = useMutation(api.mealLogs.generateUploadUrl);
  const logMeal = useMutation(api.mealLogs.logMeal);
  const analyzeMealPhoto = useAction(api.ai.cameraAnalysis.analyzeMealPhoto);

  // Derive totals from food rows
  const aiTotals: ClientMacros = foodRows.reduce(
    (acc, r) => ({
      calories: acc.calories + r.calories,
      protein: acc.protein + r.protein,
      carbs: acc.carbs + r.carbs,
      fats: acc.fats + r.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  const handlePhotoSelect = async (file: File) => {
    setIsUploading(true);
    setAnalyzeError(null);
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok) throw new Error("Upload failed");
      const { storageId } = await result.json() as { storageId: Id<"_storage"> };
      setUploadedStorageId(storageId);
      setPreviewUrl(URL.createObjectURL(file));
      toast.success("Photo uploaded");
    } catch {
      toast.error("Failed to upload photo");
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!uploadedStorageId) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setFoodRows([]);
    setAiAnalysisDone(false);
    try {
      const result = await analyzeMealPhoto({ storageId: uploadedStorageId });
      if (!result.success) {
        setAnalyzeError(result.error ?? "Analysis failed. Please try again or enter macros manually.");
        return;
      }
      if (result.items.length === 0) {
        setAnalyzeError(result.error ?? "No food detected. Try a clearer photo or enter macros manually.");
        return;
      }
      const rows: FoodRow[] = result.items.map((item, i) => ({
        key: `${i}-${item.foodName}`,
        foodName: item.foodName,
        grams: item.grams,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
      }));
      setFoodRows(rows);
      setAiAnalysisDone(true);
      setUseManualMacros(false);
      toast.success(`Found ${rows.length} food item${rows.length !== 1 ? "s" : ""}`);
    } catch {
      setAnalyzeError("Analysis failed. Check your connection and try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddRow = () => {
    setFoodRows(prev => [...prev, {
      key: `manual-${Date.now()}`,
      foodName: "",
      grams: 100,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    }]);
  };

  const handleSave = async (complete: boolean) => {
    setIsSaving(true);
    try {
      // Determine which macros to save
      let macrosToSave: ClientMacros | undefined;

      if (useManualMacros && (manualMacros.calories > 0 || manualMacros.protein > 0)) {
        macrosToSave = manualMacros;
      } else if (aiAnalysisDone && foodRows.length > 0) {
        macrosToSave = {
          calories: Math.round(aiTotals.calories),
          protein: Math.round(aiTotals.protein * 10) / 10,
          carbs: Math.round(aiTotals.carbs * 10) / 10,
          fats: Math.round(aiTotals.fats * 10) / 10,
        };
      } else if (manualMacros.calories > 0 || manualMacros.protein > 0) {
        macrosToSave = manualMacros;
      }

      await logMeal({
        mealPlanId: planId,
        mealId: meal.id,
        date: dateMs,
        imageStorageId: uploadedStorageId ?? undefined,
        clientMacros: macrosToSave,
        notes: notes || undefined,
        isCompleted: complete,
      });
      toast.success(complete ? "Meal marked as completed!" : "Meal log saved");
      onOpenChange(false);
    } catch {
      toast.error("Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Utensils className="w-4 h-4 text-green-400" />
            {meal.name}
            {meal.log?.isCompleted && (
              <Badge className="bg-green-400/20 text-green-400 border-0 text-[10px] ml-1">
                <CheckCircle className="w-2.5 h-2.5 mr-1" />Done
              </Badge>
            )}
          </DialogTitle>
          {meal.time && (
            <DialogDescription className="flex items-center gap-1 text-xs">
              <Clock className="w-3 h-3" />{meal.time}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Planned foods (collapsible) */}
          <div>
            <button
              onClick={() => setExpandedFoods(p => !p)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer w-full"
            >
              <Utensils className="w-3 h-3" />Planned Foods ({meal.foodsWithDetails.length})
              {expandedFoods ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {expandedFoods && (
              <div className="mt-2 space-y-1.5">
                {meal.foodsWithDetails.map(f => (
                  <div key={f.foodId} className="flex justify-between text-xs bg-muted/30 rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium">{f.foodName}</p>
                      <p className="text-muted-foreground">{f.servings} × {f.servingSize}{f.servingUnit}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-orange-400">{Math.round(f.calories * f.servings)} kcal</p>
                      <p className="text-muted-foreground">P:{Math.round(f.protein * f.servings)}g C:{Math.round(f.carbs * f.servings)}g F:{Math.round(f.fats * f.servings)}g</p>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end gap-3 px-3 pt-1 text-xs font-bold border-t border-border/30">
                  <span className="text-orange-400">{Math.round(meal.totals.calories)} kcal</span>
                  <span className="text-blue-400">P:{Math.round(meal.totals.protein)}g</span>
                  <span className="text-yellow-400">C:{Math.round(meal.totals.carbs)}g</span>
                  <span className="text-red-400">F:{Math.round(meal.totals.fats)}g</span>
                </div>
              </div>
            )}
          </div>

          {!readOnly && (
            <>
              {/* ── Photo upload ──────────────────────────────────────── */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5" />Meal Photo
                </Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoSelect(f); }}
                />
                {previewUrl ? (
                  <div className="relative">
                    <img src={previewUrl} alt="Meal" className="w-full h-40 object-cover rounded-xl" />
                    <div className="absolute bottom-2 right-2 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-3 h-3 mr-1" />Change
                      </Button>
                      {/* AI Analyse button */}
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white cursor-pointer"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing || isUploading}
                      >
                        {isAnalyzing
                          ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Analysing…</>
                          : <><Sparkles className="w-3 h-3 mr-1" />Analyse</>}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-full h-28 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-muted/20 transition-colors cursor-pointer"
                  >
                    {isUploading ? (
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />Uploading…
                      </div>
                    ) : (
                      <>
                        <ImagePlus className="w-6 h-6 text-muted-foreground/50" />
                        <p className="text-xs text-muted-foreground">Tap to add meal photo</p>
                        <p className="text-[10px] text-muted-foreground/60">Then tap Analyse to calculate macros</p>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* ── Analyse error ─────────────────────────────────────── */}
              {analyzeError && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{analyzeError}</p>
                </div>
              )}

              {/* ── AI results — editable food rows ──────────────────── */}
              <AnimatePresence>
                {aiAnalysisDone && foodRows.length > 0 && !useManualMacros && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        AI-Detected Foods
                        <span className="text-muted-foreground font-normal">(edit to correct)</span>
                      </Label>
                      <button
                        onClick={handleAddRow}
                        className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />Add food
                      </button>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                      {foodRows.map((row, i) => (
                        <FoodRowEditor
                          key={row.key}
                          row={row}
                          onChange={updated => setFoodRows(prev => prev.map((r, ri) => ri === i ? updated : r))}
                          onRemove={() => setFoodRows(prev => prev.filter((_, ri) => ri !== i))}
                        />
                      ))}
                    </div>

                    {/* Meal totals */}
                    <div className="bg-purple-400/10 border border-purple-400/20 rounded-xl px-4 py-2.5">
                      <p className="text-[10px] text-purple-400 font-semibold mb-1">Meal Total</p>
                      <div className="flex gap-4 text-xs font-bold">
                        <span className="text-orange-400">{Math.round(aiTotals.calories)} kcal</span>
                        <span className="text-blue-400">P:{Math.round(aiTotals.protein * 10) / 10}g</span>
                        <span className="text-yellow-400">C:{Math.round(aiTotals.carbs * 10) / 10}g</span>
                        <span className="text-red-400">F:{Math.round(aiTotals.fats * 10) / 10}g</span>
                      </div>
                    </div>

                    <button
                      onClick={() => setUseManualMacros(true)}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />Switch to manual macro entry instead
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Manual macro entry ────────────────────────────────── */}
              {(!aiAnalysisDone || useManualMacros) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Pencil className="w-3.5 h-3.5" />
                      {useManualMacros ? "Manual Macros" : "Macros (optional override)"}
                    </Label>
                    {useManualMacros && aiAnalysisDone && (
                      <button
                        onClick={() => setUseManualMacros(false)}
                        className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-0.5 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />Back to AI results
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["calories", "protein", "carbs", "fats"] as const).map(key => (
                      <div key={key} className="space-y-1">
                        <Label className="text-[10px] capitalize text-muted-foreground">{key}</Label>
                        <Input
                          type="number"
                          min="0"
                          value={manualMacros[key] || ""}
                          onChange={e => setManualMacros(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
                          className="h-8 text-xs"
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Notes ────────────────────────────────────────────── */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Notes</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="How did this meal feel?"
                  className="text-xs h-16 resize-none"
                />
              </div>
            </>
          )}

          {/* ── Read-only view ────────────────────────────────────────── */}
          {readOnly && meal.log && (
            <div className="space-y-3">
              {meal.log.imageUrl && (
                <img src={meal.log.imageUrl} alt="Meal photo" className="w-full h-36 object-cover rounded-xl" />
              )}
              {meal.log.clientMacros && (
                <div className="bg-blue-400/10 border border-blue-400/20 rounded-xl p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-blue-400">Logged Macros</p>
                  <div className="flex gap-3 text-xs font-semibold">
                    <span className="text-orange-400">{meal.log.clientMacros.calories} kcal</span>
                    <span className="text-blue-400">P:{meal.log.clientMacros.protein}g</span>
                    <span className="text-yellow-400">C:{meal.log.clientMacros.carbs}g</span>
                    <span className="text-red-400">F:{meal.log.clientMacros.fats}g</span>
                  </div>
                </div>
              )}
              {meal.log.notes && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-3">{meal.log.notes}</p>
              )}
            </div>
          )}

          {/* ── Save buttons ──────────────────────────────────────────── */}
          {!readOnly && (
            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSave(false)}
                disabled={isSaving}
                className="flex-1 cursor-pointer"
              >
                Save Draft
              </Button>
              <Button
                size="sm"
                onClick={() => handleSave(true)}
                disabled={isSaving}
                className="flex-1 cursor-pointer bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                {isSaving ? "Saving…" : "Mark Complete"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Daily Nutrition Summary ─────────────────────────────────────────────────

function DailyNutritionSummary({ dateMs, userId }: { dateMs: number; userId?: Id<"users"> }) {
  const summary = useQuery(api.mealLogs.getDailyNutritionSummary, { date: dateMs, userId });

  if (summary === undefined) return <Skeleton className="h-28 w-full" />;
  if (!summary) return null;

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />Daily Nutrition Summary
          <Badge variant="outline" className="ml-auto text-[10px]">
            {summary.mealsCompleted}/{summary.totalMeals} meals · {summary.adherencePct}% adherence
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <MacroBar label={`Calories (${Math.round(summary.consumedCalories)} / ${summary.targetCalories})`} current={summary.consumedCalories} target={summary.targetCalories} color="text-orange-400" />
        <MacroBar label={`Protein (${Math.round(summary.consumedProtein)}g / ${summary.targetProtein}g)`} current={summary.consumedProtein} target={summary.targetProtein} color="text-blue-400" />
        <MacroBar label={`Carbs (${Math.round(summary.consumedCarbs)}g / ${summary.targetCarbs}g)`} current={summary.consumedCarbs} target={summary.targetCarbs} color="text-yellow-400" />
        <MacroBar label={`Fats (${Math.round(summary.consumedFats)}g / ${summary.targetFats}g)`} current={summary.consumedFats} target={summary.targetFats} color="text-red-400" />
      </CardContent>
    </Card>
  );
}

// ─── Main Nutrition Calendar ──────────────────────────────────────────────────

export default function NutritionCalendar({ userId, readOnly = false }: { userId?: Id<"users">; readOnly?: boolean }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedMeal, setSelectedMeal] = useState<MealEntry | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const selectedDateMs = startOfDay(selectedDate).getTime();

  const activePlan = useQuery(api.mealPlans.getAssignedClientPlan, userId ? { userId } : {});
  const mealLogs = useQuery(api.mealLogs.getMealLogsForDate, { date: selectedDateMs, userId });

  const logsByMealId = (mealLogs ?? []).reduce<Record<string, MealLog>>((acc, log) => {
    acc[log.mealId] = log;
    return acc;
  }, {});

  const mealEntries: MealEntry[] = (activePlan?.mealsWithFoodDetails ?? [])
    .slice()
    .sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      return a.displayOrder - b.displayOrder;
    })
    .map(meal => ({
      id: meal.id,
      name: meal.name,
      time: meal.time,
      displayOrder: meal.displayOrder,
      log: logsByMealId[meal.id],
      totals: meal.totals,
      foodsWithDetails: meal.foodsWithDetails,
    }));

  const completedToday = mealEntries.filter(m => m.log?.isCompleted).length;
  const totalMeals = mealEntries.length;

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p className="font-semibold text-sm">{format(currentMonth, "MMMM yyyy")}</p>
        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Calendar grid */}
      <Card className="bg-card/50 border-border overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border/50">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map(day => {
            const isSelected = format(day, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isCurrentDay = isToday(day);

            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={cn(
                  "aspect-square flex flex-col items-center justify-center gap-0.5 text-xs transition-colors cursor-pointer border border-transparent",
                  !isCurrentMonth && "opacity-30",
                  isSelected && "bg-green-500/20 border-green-500/50 rounded-lg",
                  isCurrentDay && !isSelected && "font-bold text-green-400",
                  !isSelected && "hover:bg-muted/30",
                )}
              >
                <span>{format(day, "d")}</span>
                {isCurrentMonth && totalMeals > 0 && isSelected && completedToday > 0 && (
                  <div className="w-1 h-1 rounded-full bg-green-400" />
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Selected day label */}
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">{format(selectedDate, "EEEE, MMMM d")}</p>
        {totalMeals > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {completedToday}/{totalMeals} meals logged
          </Badge>
        )}
      </div>

      {/* Daily summary */}
      <DailyNutritionSummary dateMs={selectedDateMs} userId={userId} />

      {/* Meal list */}
      {activePlan === undefined || mealLogs === undefined ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !activePlan ? (
        <div className="border border-dashed border-border rounded-xl p-10 text-center">
          <Utensils className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-semibold text-sm mb-1">No Active Meal Plan</p>
          <p className="text-xs text-muted-foreground">
            {readOnly ? "This client doesn't have an active meal plan." : "Ask your coach to assign a meal plan to see it here."}
          </p>
        </div>
      ) : (
        <motion.div className="space-y-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {mealEntries.map((meal, i) => (
            <motion.div
              key={meal.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card
                className={cn(
                  "border-border overflow-hidden cursor-pointer hover:border-green-500/40 transition-colors",
                  meal.log?.isCompleted ? "bg-green-400/5 border-green-400/30" : "bg-card/50",
                )}
                onClick={() => setSelectedMeal(meal)}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                    meal.log?.isCompleted ? "bg-green-400/20" : "bg-muted/50",
                  )}>
                    {meal.log?.isCompleted
                      ? <CheckCircle className="w-4 h-4 text-green-400" />
                      : <Utensils className="w-4 h-4 text-muted-foreground" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">{meal.name}</p>
                      {meal.log?.isCompleted && (
                        <Badge className="bg-green-400/20 text-green-400 border-0 text-[10px] shrink-0">Done</Badge>
                      )}
                      {meal.log?.imageStorageId && !meal.log.isCompleted && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          <Camera className="w-2.5 h-2.5 mr-0.5" />Photo
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {meal.time && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />{meal.time}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {meal.foodsWithDetails.length} foods
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-orange-400">{Math.round(meal.totals.calories)} kcal</p>
                    <p className="text-[10px] text-muted-foreground">
                      P:{Math.round(meal.totals.protein)}g C:{Math.round(meal.totals.carbs)}g F:{Math.round(meal.totals.fats)}g
                    </p>
                  </div>
                </div>
                {!readOnly && !meal.log?.isCompleted && (
                  <div className="px-4 pb-3 pt-0">
                    <button
                      onClick={e => { e.stopPropagation(); setSelectedMeal(meal); }}
                      className="text-[10px] text-green-400 hover:text-green-300 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Target className="w-3 h-3" />Log this meal
                    </button>
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Log meal dialog */}
      {selectedMeal && activePlan && (
        <LogMealDialog
          meal={selectedMeal}
          planId={activePlan._id}
          dateMs={selectedDateMs}
          open={!!selectedMeal}
          onOpenChange={v => { if (!v) setSelectedMeal(null); }}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
