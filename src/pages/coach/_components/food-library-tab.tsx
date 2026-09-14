import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import {
  Search, Plus, Apple, Pencil, Copy, Trash2, Archive, RotateCcw,
  ChevronDown, AlertTriangle, SlidersHorizontal, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Food = Doc<"foods">;
type SortOption = "name_asc" | "name_desc" | "created_desc" | "modified_desc";

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVING_UNITS = ["g", "ml", "oz", "cup", "tbsp", "tsp", "piece", "scoop", "slice", "serving"];
const CATEGORIES = ["Protein", "Carbohydrates", "Fats", "Dairy", "Vegetables", "Fruits", "Grains", "Beverages", "Snacks", "Supplements", "Other"];

// ─── Macro split bar ──────────────────────────────────────────────────────────

function MacroSplitBar({ protein, carbs, fats, calories }: { protein: number; carbs: number; fats: number; calories: number }) {
  if (!calories) return null;
  return (
    <div className="space-y-1">
      <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-muted">
        <div className="bg-blue-400" style={{ width: `${(protein * 4 / calories) * 100}%` }} />
        <div className="bg-yellow-400" style={{ width: `${(carbs * 4 / calories) * 100}%` }} />
        <div className="bg-red-400" style={{ width: `${(fats * 9 / calories) * 100}%` }} />
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span className="text-blue-400">P {Math.round((protein * 4 / calories) * 100)}%</span>
        <span className="text-yellow-400">C {Math.round((carbs * 4 / calories) * 100)}%</span>
        <span className="text-red-400">F {Math.round((fats * 9 / calories) * 100)}%</span>
      </div>
    </div>
  );
}

// ─── Food form dialog ─────────────────────────────────────────────────────────

type FoodFormData = {
  name: string; servingSize: string; servingUnit: string; category: string;
  protein: string; carbs: string; fats: string; calories: string;
};

const EMPTY_FORM: FoodFormData = {
  name: "", servingSize: "", servingUnit: "g", category: "",
  protein: "", carbs: "", fats: "", calories: "",
};

function FoodFormDialog({
  open, onOpenChange, initialData, foodId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initialData?: Food; foodId?: Id<"foods">;
}) {
  const createFood = useMutation(api.foods.create);
  const updateFood = useMutation(api.foods.update);

  const [form, setForm] = useState<FoodFormData>(
    initialData ? {
      name: initialData.name, servingSize: initialData.servingSize, servingUnit: initialData.servingUnit,
      category: initialData.category ?? "",
      protein: String(initialData.protein), carbs: String(initialData.carbs),
      fats: String(initialData.fats), calories: String(initialData.calories),
    } : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FoodFormData, v: string) => setForm(p => ({ ...p, [k]: v }));

  const calcCalories = () => {
    const cal = (parseFloat(form.protein) || 0) * 4 + (parseFloat(form.carbs) || 0) * 4 + (parseFloat(form.fats) || 0) * 9;
    set("calories", Math.round(cal).toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(form.protein), c = parseFloat(form.carbs), f = parseFloat(form.fats), cal = parseFloat(form.calories);
    if (!form.name.trim()) { toast.error("Food name is required"); return; }
    if ([p, c, f, cal].some(isNaN)) { toast.error("Enter valid numbers for all macros"); return; }
    setSaving(true);
    try {
      if (foodId) {
        await updateFood({
          id: foodId, name: form.name, servingSize: form.servingSize, servingUnit: form.servingUnit,
          category: form.category || undefined, protein: p, carbs: c, fats: f, calories: cal,
        });
        toast.success("Food updated");
      } else {
        await createFood({
          name: form.name, servingSize: form.servingSize, servingUnit: form.servingUnit,
          category: form.category || undefined, protein: p, carbs: c, fats: f, calories: cal, isCustom: true,
        });
        toast.success("Food added to library");
      }
      onOpenChange(false);
    } catch {
      toast.error("Failed to save food");
    } finally {
      setSaving(false);
    }
  };

  const p = parseFloat(form.protein) || 0;
  const c = parseFloat(form.carbs) || 0;
  const ff = parseFloat(form.fats) || 0;
  const cal = parseFloat(form.calories) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{foodId ? "Edit Food Item" : "Add New Food"}</DialogTitle>
          <DialogDescription>Changes are saved directly to the Food Library</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Food Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Rolled Oats" required autoFocus={!foodId} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Serving Size *</Label>
              <Input value={form.servingSize} onChange={e => set("servingSize", e.target.value)} placeholder="100" required />
            </div>
            <div className="space-y-1.5">
              <Label>Unit *</Label>
              <div className="flex gap-2">
                <Input value={form.servingUnit} onChange={e => set("servingUnit", e.target.value)} placeholder="g" required className="flex-1" />
                <Select value={form.servingUnit} onValueChange={v => set("servingUnit", v)}>
                  <SelectTrigger className="w-10 px-2">
                    <ChevronDown className="w-3 h-3" />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVING_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category || "none"} onValueChange={v => set("category", v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(["protein", "carbs", "fats", "calories"] as const).map(key => (
              <div key={key} className="space-y-1.5">
                <Label className="capitalize">{key} {key !== "calories" ? "(g)" : "(kcal)"} *</Label>
                <Input type="number" step="0.1" min="0" value={form[key]} onChange={e => set(key, e.target.value)} placeholder="0" required />
              </div>
            ))}
          </div>

          <button type="button" onClick={calcCalories} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            Auto-calculate calories from macros
          </button>

          {cal > 0 && (
            <div className="p-3 bg-muted/30 rounded-xl space-y-2">
              <div className="flex gap-4 text-xs font-bold">
                <span className="text-blue-400">P: {p}g</span>
                <span className="text-yellow-400">C: {c}g</span>
                <span className="text-red-400">F: {ff}g</span>
                <span className="text-primary">{cal} kcal</span>
              </div>
              <MacroSplitBar protein={p} carbs={c} fats={ff} calories={cal} />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving} className="flex-1 cursor-pointer">
              {saving ? "Saving..." : foodId ? "Save Changes" : "Add to Library"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Duplicate dialog ─────────────────────────────────────────────────────────

function DuplicateDialog({ food, open, onOpenChange }: { food: Food; open: boolean; onOpenChange: (v: boolean) => void }) {
  const duplicate = useMutation(api.foods.duplicate);
  const [name, setName] = useState(`${food.name} (Copy)`);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await duplicate({ id: food._id, newName: name });
      toast.success("Food duplicated");
      onOpenChange(false);
    } catch {
      toast.error("Failed to duplicate food");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Duplicate Food Item</DialogTitle>
          <DialogDescription>Creates an editable copy of {food.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label>Name for the copy</Label>
            <Input value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !name.trim()} className="flex-1 cursor-pointer">
              {saving ? "Duplicating..." : "Duplicate"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete / archive dialog ──────────────────────────────────────────────────

function DeleteDialog({ food, open, onOpenChange }: { food: Food; open: boolean; onOpenChange: (v: boolean) => void }) {
  const usage = useQuery(api.foods.checkUsageInPlans, { foodId: food._id });
  const archiveFood = useMutation(api.foods.archive);
  const removeFood = useMutation(api.foods.remove);
  const [saving, setSaving] = useState(false);

  const handleArchive = async () => {
    setSaving(true);
    try {
      await archiveFood({ id: food._id });
      toast.success("Food archived — stays in existing plans, hidden from new ones");
      onOpenChange(false);
    } catch {
      toast.error("Failed to archive food");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await removeFood({ id: food._id });
      toast.success("Food permanently deleted");
      onOpenChange(false);
    } catch {
      toast.error("Failed to delete food");
    } finally {
      setSaving(false);
    }
  };

  const inPlans = usage?.count ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-destructive" />Remove Food Item
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {usage === undefined ? (
            <Skeleton className="h-12 w-full" />
          ) : inPlans > 0 ? (
            <div className="p-3 bg-yellow-400/10 border border-yellow-400/30 rounded-xl text-sm space-y-1.5">
              <p className="font-semibold text-yellow-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />Used in {inPlans} meal plan{inPlans > 1 ? "s" : ""}
              </p>
              <p className="text-muted-foreground text-xs">
                Archive keeps it in those plans but prevents selecting it for new ones. Permanently deleting removes it from all plans.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{food.name}</strong> is not used in any meal plans and can be safely deleted.
            </p>
          )}

          <div className={cn("flex gap-2", inPlans > 0 ? "flex-col" : "flex-row")}>
            {inPlans > 0 && (
              <Button onClick={handleArchive} disabled={saving} variant="secondary" className="cursor-pointer">
                <Archive className="w-3.5 h-3.5 mr-1.5" />Archive (recommended)
              </Button>
            )}
            <Button onClick={handleDelete} disabled={saving} variant="destructive" className="flex-1 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete Permanently
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Food row ─────────────────────────────────────────────────────────────────

function FoodRow({ food }: { food: Food }) {
  const [editOpen, setEditOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unarchive = useMutation(api.foods.unarchive);

  return (
    <>
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors border-b border-border/30 last:border-0",
        food.isArchived && "opacity-50"
      )}>
        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{food.name}</p>
            {food.category && (
              <Badge className="text-[10px] h-4 bg-primary/10 text-primary border-0 shrink-0">{food.category}</Badge>
            )}
            {food.isCustom && (
              <Badge variant="secondary" className="text-[10px] h-4 shrink-0">Custom</Badge>
            )}
            {food.isArchived && (
              <Badge variant="outline" className="text-[10px] h-4 text-muted-foreground shrink-0">Archived</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{food.servingSize} {food.servingUnit}</p>
        </div>

        {/* Macros */}
        <div className="hidden sm:flex items-center gap-4 text-xs shrink-0">
          <span className="text-primary font-semibold w-14 text-right">{food.calories} kcal</span>
          <span className="text-blue-400 w-12 text-right">P {food.protein}g</span>
          <span className="text-yellow-400 w-12 text-right">C {food.carbs}g</span>
          <span className="text-red-400 w-12 text-right">F {food.fats}g</span>
        </div>

        {/* Mobile macros summary */}
        <div className="sm:hidden text-xs text-muted-foreground shrink-0">
          <p className="text-primary font-semibold">{food.calories} kcal</p>
          <p>P{food.protein} C{food.carbs} F{food.fats}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {!food.isArchived ? (
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="p-1.5 rounded-lg hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDupOpen(true)}
                className="p-1.5 rounded-lg hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                title="Duplicate"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="p-1.5 rounded-lg hover:bg-destructive/10 cursor-pointer text-muted-foreground hover:text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={async () => { await unarchive({ id: food._id }); toast.success("Food restored"); }}
              className="p-1.5 rounded-lg hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
              title="Restore"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {editOpen && <FoodFormDialog open foodId={food._id} initialData={food} onOpenChange={setEditOpen} />}
      {dupOpen && <DuplicateDialog open food={food} onOpenChange={setDupOpen} />}
      {deleteOpen && <DeleteDialog open food={food} onOpenChange={setDeleteOpen} />}
    </>
  );
}

// ─── Main Food Library Tab ────────────────────────────────────────────────────

export default function FoodLibraryTab() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortOption>("name_asc");
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const foods = useQuery(api.foods.list, {
    searchTerm: search || undefined,
    category: category !== "all" ? category : undefined,
    sortBy: sort,
    includeArchived: showArchived,
  });
  const categories = useQuery(api.foods.listCategories, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-lg">Food Library</h2>
          <p className="text-sm text-muted-foreground">Master database of all nutrition items</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="cursor-pointer gap-1.5">
          <Plus className="w-3.5 h-3.5" />Add Food
        </Button>
      </div>

      {/* Search + filter bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search foods..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10 h-9"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFiltersOpen(p => !p)}
          className={cn("cursor-pointer gap-1.5 h-9", filtersOpen && "bg-muted")}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />Filters
        </Button>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-3 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {(categories ?? []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sort by</Label>
                <Select value={sort} onValueChange={v => setSort(v as SortOption)}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name_asc">Name A–Z</SelectItem>
                    <SelectItem value="name_desc">Name Z–A</SelectItem>
                    <SelectItem value="created_desc">Recently Created</SelectItem>
                    <SelectItem value="modified_desc">Recently Edited</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <button
                onClick={() => setShowArchived(p => !p)}
                className={cn(
                  "h-8 px-3 text-xs rounded-lg border transition-colors cursor-pointer",
                  showArchived ? "bg-muted border-border" : "border-border/50 text-muted-foreground hover:border-border"
                )}
              >
                {showArchived ? "Hiding archived" : "Show archived"}
              </button>

              {(search || category !== "all") && (
                <button
                  onClick={() => { setSearch(""); setCategory("all"); }}
                  className="h-8 px-2 text-xs rounded-lg text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
                >
                  <X className="w-3 h-3" />Clear filters
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      {foods === undefined ? (
        <Card className="bg-card/50 border-border">
          <div className="divide-y divide-border/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-40 hidden sm:block" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </Card>
      ) : foods.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Apple /></EmptyMedia>
            <EmptyTitle>{search ? `No results for "${search}"` : "Food Library is empty"}</EmptyTitle>
            <EmptyDescription>Add your first food item to get started</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setAddOpen(true)} className="cursor-pointer">
              <Plus className="w-3.5 h-3.5 mr-1.5" />Add First Food
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="bg-card/50 border-border overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-muted/20">
            <p className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Food Item</p>
            <div className="hidden sm:flex items-center gap-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span className="w-14 text-right">Calories</span>
              <span className="w-12 text-right">Protein</span>
              <span className="w-12 text-right">Carbs</span>
              <span className="w-12 text-right">Fats</span>
            </div>
            <div className="w-24" />
          </div>
          <div>
            {foods.map(food => <FoodRow key={food._id} food={food} />)}
          </div>
          <div className="px-4 py-2 border-t border-border/30 bg-muted/10">
            <p className="text-xs text-muted-foreground">{foods.length} food{foods.length !== 1 ? "s" : ""}</p>
          </div>
        </Card>
      )}

      {addOpen && <FoodFormDialog open onOpenChange={setAddOpen} />}
    </div>
  );
}
