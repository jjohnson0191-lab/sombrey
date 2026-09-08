/**
 * CameraAIDialog — standalone Camera AI Macro Calculator
 *
 * Opens directly from the Speed Key. No Calendar navigation required.
 * 1. User selects photo (camera or library via file input)
 * 2. Gemini identifies foods + gram estimates (existing server-side action)
 * 3. Edamam provides nutrition per food item (existing server-side action)
 * 4. User can edit any field before saving
 * 5. Saves to the user's OWN meal log for today via existing logMeal mutation
 *    — always the current user's account, never a client's
 * 6. Appears automatically in the Calendar nutrition tab
 */
import { useState, useRef, useEffect } from "react";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  ImagePlus, Sparkles, RefreshCw, AlertCircle, CheckCircle,
  Trash2, Plus, Upload, ScanLine,
} from "lucide-react";
import { toast } from "sonner";
import { startOfDay } from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

type FoodRow = {
  key: string;
  foodName: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

// Fixed mealId used for Camera AI quick-logs — avoids requiring meal plan selection
const CAMERA_AI_MEAL_ID = "camera_ai_quick_log";

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
        {(["grams", "calories", "protein", "carbs", "fat"] as const).map(field => (
          <div key={field} className="space-y-0.5">
            <p className="text-[9px] text-muted-foreground text-center">
              {field === "grams" ? "g" : field === "calories" ? "kcal" : field === "protein" ? "P(g)" : field === "carbs" ? "C(g)" : "F(g)"}
            </p>
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

// ─── Main Dialog ─────────────────────────────────────────────────────────────

export default function CameraAIDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedStorageId, setUploadedStorageId] = useState<Id<"_storage"> | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [foodRows, setFoodRows] = useState<FoodRow[]>([]);
  const [aiDone, setAiDone] = useState(false);
  // Track the saved meal log id so edits update in place
  const [savedLogId, setSavedLogId] = useState<Id<"mealLogs"> | null>(null);
  const [savedToday, setSavedToday] = useState(false);

  const todayMs = startOfDay(new Date()).getTime();

  // Get the user's own active plan (no userId arg = own plan)
  const activePlan = useQuery(api.mealPlans.getActivePlan, {});

  const generateUploadUrl = useMutation(api.mealLogs.generateUploadUrl);
  const logMeal = useMutation(api.mealLogs.logMeal);
  const analyzeMealPhoto = useAction(api.ai.cameraAnalysis.analyzeMealPhoto);

  // Derived totals
  const totals = foodRows.reduce(
    (acc, r) => ({
      calories: acc.calories + r.calories,
      protein: acc.protein + r.protein,
      carbs: acc.carbs + r.carbs,
      fats: acc.fats + r.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  );

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPreviewUrl(null);
      setUploadedStorageId(null);
      setIsUploading(false);
      setIsAnalyzing(false);
      setIsSaving(false);
      setAnalyzeError(null);
      setFoodRows([]);
      setAiDone(false);
      setSavedLogId(null);
      setSavedToday(false);
    }
  }, [open]);

  // When dialog opens, immediately trigger the file picker
  useEffect(() => {
    if (open && !previewUrl && !isUploading) {
      // Small delay so the dialog renders first
      const t = setTimeout(() => fileInputRef.current?.click(), 150);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);
    setAnalyzeError(null);
    setFoodRows([]);
    setAiDone(false);
    setSavedToday(false);
    setSavedLogId(null);
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
    setAiDone(false);
    try {
      const result = await analyzeMealPhoto({ storageId: uploadedStorageId });
      if (!result.success || result.items.length === 0) {
        setAnalyzeError(result.error ?? "No food detected. Try a clearer photo.");
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
      setAiDone(true);
    } catch {
      setAnalyzeError("Analysis failed. Check your connection and try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Save or update the meal log for today
  const handleSave = async (complete: boolean) => {
    if (!activePlan) {
      toast.error("No active meal plan found. Ask your coach to assign one.");
      return;
    }
    setIsSaving(true);
    try {
      const clientMacros = {
        calories: Math.round(totals.calories),
        protein: Math.round(totals.protein * 10) / 10,
        carbs: Math.round(totals.carbs * 10) / 10,
        fats: Math.round(totals.fats * 10) / 10,
      };

      // logMeal upserts by userId+date+mealId, so re-calling with the same
      // CAMERA_AI_MEAL_ID updates the existing entry in place
      const logId = await logMeal({
        mealPlanId: activePlan._id,
        mealId: CAMERA_AI_MEAL_ID,
        date: todayMs,
        imageStorageId: uploadedStorageId ?? undefined,
        clientMacros,
        notes: `Camera AI: ${foodRows.map(r => `${r.foodName} (${r.grams}g)`).join(", ")}`,
        isCompleted: complete,
      });

      setSavedLogId(logId as Id<"mealLogs">);
      setSavedToday(true);
      toast.success(complete ? "Meal saved to your food log!" : "Draft saved to your food log");
    } catch {
      toast.error("Failed to save meal");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-purple-400" />
            Camera AI Macro Calculator
          </DialogTitle>
          <DialogDescription className="text-xs">
            Take or choose a photo — AI identifies foods and calculates macros automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hidden file input — accepts both camera and photo library */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleFileSelect(f);
              // Reset so the same file can be re-selected
              e.target.value = "";
            }}
          />

          {/* Photo area */}
          {previewUrl ? (
            <div className="relative">
              <img src={previewUrl} alt="Meal" className="w-full h-44 object-cover rounded-xl" />
              <div className="absolute bottom-2 right-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3 h-3 mr-1" />Change
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white cursor-pointer"
                  onClick={() => void handleAnalyze()}
                  disabled={isAnalyzing}
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
              className="w-full h-32 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-muted/20 transition-colors cursor-pointer"
            >
              {isUploading ? (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />Uploading…
                </div>
              ) : (
                <>
                  <ImagePlus className="w-7 h-7 text-muted-foreground/40" />
                  <p className="text-xs font-medium text-muted-foreground">Take photo or choose from library</p>
                  <p className="text-[10px] text-muted-foreground/60">AI will identify foods and calculate macros</p>
                </>
              )}
            </button>
          )}

          {/* Error */}
          {analyzeError && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{analyzeError}</p>
            </div>
          )}

          {/* AI food rows */}
          <AnimatePresence>
            {aiDone && foodRows.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    Detected Foods
                    <span className="text-muted-foreground font-normal">(edit to correct)</span>
                  </Label>
                  <button
                    onClick={() => setFoodRows(prev => [...prev, {
                      key: `manual-${Date.now()}`,
                      foodName: "",
                      grams: 100,
                      calories: 0,
                      protein: 0,
                      carbs: 0,
                      fat: 0,
                    }])}
                    className="text-[10px] text-green-400 hover:text-green-300 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />Add food
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                  {foodRows.map((row, i) => (
                    <FoodRowEditor
                      key={row.key}
                      row={row}
                      onChange={updated => setFoodRows(prev => prev.map((r, ri) => ri === i ? updated : r))}
                      onRemove={() => setFoodRows(prev => prev.filter((_, ri) => ri !== i))}
                    />
                  ))}
                </div>

                {/* Totals */}
                <div className="bg-purple-400/10 border border-purple-400/20 rounded-xl px-4 py-2.5">
                  <p className="text-[10px] text-purple-400 font-semibold mb-1">Meal Total</p>
                  <div className="flex gap-4 text-xs font-bold">
                    <span className="text-orange-400">{Math.round(totals.calories)} kcal</span>
                    <span className="text-blue-400">P:{Math.round(totals.protein * 10) / 10}g</span>
                    <span className="text-yellow-400">C:{Math.round(totals.carbs * 10) / 10}g</span>
                    <span className="text-red-400">F:{Math.round(totals.fats * 10) / 10}g</span>
                  </div>
                </div>

                {/* Saved confirmation */}
                {savedToday && (
                  <div className="flex items-center gap-2 bg-green-400/10 border border-green-400/30 rounded-lg px-3 py-2">
                    <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                    <p className="text-xs text-green-400 font-medium">
                      {savedLogId ? "Updated in your food log" : "Saved to your food log"} · visible in Calendar
                    </p>
                  </div>
                )}

                {/* No active plan warning */}
                {!activePlan && (
                  <div className="flex items-start gap-2 bg-yellow-400/10 border border-yellow-400/30 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-400">
                      No active meal plan found. Ask your coach to assign one to save meals.
                    </p>
                  </div>
                )}

                {/* Save buttons */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 cursor-pointer"
                    onClick={() => void handleSave(false)}
                    disabled={isSaving || !activePlan}
                  >
                    {savedToday ? "Update Draft" : "Save Draft"}
                  </Button>
                  <Button
                    size="sm"
                    className={cn(
                      "flex-1 cursor-pointer text-white",
                      savedToday
                        ? "bg-green-700 hover:bg-green-800"
                        : "bg-green-600 hover:bg-green-700",
                    )}
                    onClick={() => void handleSave(true)}
                    disabled={isSaving || !activePlan}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                    {isSaving ? "Saving…" : savedToday ? "Re-save Complete" : "Save & Complete"}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
