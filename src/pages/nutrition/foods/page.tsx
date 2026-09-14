import { useState } from "react";
import { Authenticated, useQuery, useMutation } from "convex/react";
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
  ChevronDown, Info, AlertTriangle, SlidersHorizontal, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils.ts";
import { useAuth } from "@/hooks/use-auth.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Food = Doc<"foods">;

type SortOption = "name_asc" | "name_desc" | "created_desc" | "modified_desc";

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

// ─── Food form (create / edit) ─────────────────────────────────────────────────

type FoodFormData = {
  name: string;
  servingSize: string;
  servingUnit: string;
  category: string;
  protein: string;
  carbs: string;
  fats: string;
  calories: string;
};

const EMPTY_FORM: FoodFormData = { name: "", servingSize: "", servingUnit: "", category: "", protein: "", carbs: "", fats: "", calories: "" };

const SERVING_UNITS = ["g", "ml", "oz", "cup", "tbsp", "tsp", "piece", "scoop", "slice", "serving"];
const CATEGORIES = ["Protein", "Carbohydrates", "Fats", "Dairy", "Vegetables", "Fruits", "Grains", "Beverages", "Snacks", "Supplements", "Other"];

function FoodFormDialog({
  open, onOpenChange, initialData, foodId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialData?: Food;
  foodId?: Id<"foods">;
}) {
  const createFood = useMutation(api.foods.create);
  const updateFood = useMutation(api.foods.update);

  const [form, setForm] = useState<FoodFormData>(
    initialData ? {
      name: initialData.name,
      servingSize: initialData.servingSize,
      servingUnit: initialData.servingUnit,
      category: initialData.category ?? "",
      protein: String(initialData.protein),
      carbs: String(initialData.carbs),
      fats: String(initialData.fats),
      calories: String(initialData.calories),
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
        await updateFood({ id: foodId, name: form.name, servingSize: form.servingSize, servingUnit: form.servingUnit, category: form.category || undefined, protein: p, carbs: c, fats: f, calories: cal });
        toast.success("Food updated");
      } else {
        await createFood({ name: form.name, servingSize: form.servingSize, servingUnit: form.servingUnit, category: form.category || undefined, protein: p, carbs: c, fats: f, calories: cal, isCustom: true });
        toast.success("Food added to database");
      }
      onOpenChange(false);
    } catch {
      toast.error("Failed to save food");
    } finally {
      setSaving(false);
    }
  };

  const p = parseFloat(form.protein) || 0, c = parseFloat(form.carbs) || 0, ff = parseFloat(form.fats) || 0, cal = parseFloat(form.calories) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{foodId ? "Edit Food Item" : "Add Food Item"}</DialogTitle>
          <DialogDescription>All fields with * are required</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Food Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Rolled Oats" required />
          </div>

          {/* Serving */}
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

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category || "none"} onValueChange={v => set("category", v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select category (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Macros */}
          <div className="grid grid-cols-2 gap-3">
            {(["protein", "carbs", "fats", "calories"] as const).map(key => (
              <div key={key} className="space-y-1.5">
                <Label className="capitalize">{key} {key !== "calories" ? "(g)" : "(kcal)"} *</Label>
                <Input type="number" step="0.1" min="0" value={form[key]} onChange={e => set(key, e.target.value)} placeholder="0" required />
              </div>
            ))}
          </div>

          <Button type="button" variant="ghost" size="sm" onClick={calcCalories} className="text-xs text-muted-foreground cursor-pointer">
            Auto-calculate calories from macros
          </Button>

          {/* Preview */}
          {cal > 0 && (
            <div className="p-3 bg-muted/30 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Macro Preview</p>
              <div className="flex gap-4 text-xs font-bold">
                <span className="text-blue-400">P: {p}g</span>
                <span className="text-yellow-400">C: {c}g</span>
                <span className="text-red-400">F: {ff}g</span>
                <span className="text-orange-400">{cal} kcal</span>
              </div>
              <MacroSplitBar protein={p} carbs={c} fats={ff} calories={cal} />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving} className="flex-1 cursor-pointer">
              {saving ? "Saving..." : foodId ? "Save Changes" : "Add Food"}
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
          <DialogDescription>Create a copy with a new name you can edit independently.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label>New Food Name</Label>
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
      toast.success("Food archived — it remains in existing meal plans but won't appear for new ones");
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
            <Trash2 className="w-4 h-4 text-destructive" />Delete Food Item
          </DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {usage === undefined ? (
            <Skeleton className="h-12 w-full" />
          ) : inPlans > 0 ? (
            <div className="p-3 bg-yellow-400/10 border border-yellow-400/30 rounded-xl text-sm space-y-1">
              <p className="font-semibold text-yellow-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />Used in {inPlans} meal plan{inPlans > 1 ? "s" : ""}
              </p>
              <p className="text-muted-foreground text-xs">
                Deleting will remove it from those plans. Archive instead to keep it in existing plans while hiding it from new ones.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{food.name}</strong> is not used in any active meal plans and can be safely deleted.
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

// ─── Audit info popover ───────────────────────────────────────────────────────

function AuditBadge({ food, isAdminOrOwner }: { food: Food; isAdminOrOwner: boolean }) {
  const [show, setShow] = useState(false);
  const creator = useQuery(api.users.getById, food.createdBy ? { userId: food.createdBy } : "skip");
  const modifier = useQuery(api.users.getById, food.lastModifiedBy ? { userId: food.lastModifiedBy } : "skip");

  if (!isAdminOrOwner) return null;

  return (
    <div className="relative">
      <button onClick={() => setShow(p => !p)} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
        <Info className="w-3.5 h-3.5" />
      </button>
      {show && (
        <div className="absolute right-0 top-6 z-50 bg-popover border border-border rounded-xl shadow-lg p-3 text-xs w-56 space-y-1.5">
          <button onClick={() => setShow(false)} className="absolute top-2 right-2 cursor-pointer text-muted-foreground"><X className="w-3 h-3" /></button>
          <p className="font-semibold mb-1">Audit Trail</p>
          {food.createdAt && (
            <div>
              <span className="text-muted-foreground">Created: </span>
              <span>{format(new Date(food.createdAt), "MMM d, yyyy")}</span>
              {creator && <span className="text-muted-foreground"> by {creator.name ?? creator.email ?? "Unknown"}</span>}
            </div>
          )}
          {food.lastModifiedAt && (
            <div>
              <span className="text-muted-foreground">Modified: </span>
              <span>{format(new Date(food.lastModifiedAt), "MMM d, yyyy")}</span>
              {modifier && <span className="text-muted-foreground"> by {modifier.name ?? modifier.email ?? "Unknown"}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Food card ────────────────────────────────────────────────────────────────

function FoodCard({ food, canManage, isAdminOrOwner }: { food: Food; canManage: boolean; isAdminOrOwner: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unarchive = useMutation(api.foods.unarchive);

  return (
    <>
      <Card className={cn("bg-card/50 border-border hover:border-primary/40 transition-all", food.isArchived && "opacity-60")}>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm truncate">{food.name}</p>
                {food.isCustom && <Badge variant="secondary" className="text-[10px] h-4">Custom</Badge>}
                {food.isArchived && <Badge variant="outline" className="text-[10px] h-4 text-muted-foreground">Archived</Badge>}
                {food.category && <Badge className="text-[10px] h-4 bg-primary/10 text-primary border-0">{food.category}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{food.servingSize} {food.servingUnit} per serving</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isAdminOrOwner && <AuditBadge food={food} isAdminOrOwner={isAdminOrOwner} />}
              {canManage && !food.isArchived && (
                <>
                  <button onClick={() => setEditOpen(true)} className="p-1.5 rounded-lg hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setDupOpen(true)} className="p-1.5 rounded-lg hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors" title="Duplicate">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setDeleteOpen(true)} className="p-1.5 rounded-lg hover:bg-destructive/10 cursor-pointer text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {canManage && food.isArchived && (
                <button
                  onClick={async () => { await unarchive({ id: food._id }); toast.success("Food unarchived"); }}
                  className="p-1.5 rounded-lg hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                  title="Unarchive"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-4 space-y-2.5">
          <div className="grid grid-cols-4 gap-1 text-center">
            {[
              { label: "Cal", value: food.calories, color: "text-orange-400", unit: "" },
              { label: "Protein", value: food.protein, color: "text-blue-400", unit: "g" },
              { label: "Carbs", value: food.carbs, color: "text-yellow-400", unit: "g" },
              { label: "Fats", value: food.fats, color: "text-red-400", unit: "g" },
            ].map(({ label, value, color, unit }) => (
              <div key={label} className="bg-muted/30 rounded-lg py-1.5">
                <p className={cn("text-sm font-bold", color)}>{value}{unit}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <MacroSplitBar protein={food.protein} carbs={food.carbs} fats={food.fats} calories={food.calories} />
        </CardContent>
      </Card>

      {editOpen && <FoodFormDialog open foodId={food._id} initialData={food} onOpenChange={setEditOpen} />}
      {dupOpen && <DuplicateDialog open food={food} onOpenChange={setDupOpen} />}
      {deleteOpen && <DeleteDialog open food={food} onOpenChange={setDeleteOpen} />}
    </>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function FoodsContent() {
  const { user } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const categories = useQuery(api.foods.listCategories, {});

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

  const canManage = currentUser ? hasManageRole(currentUser) : false;
  const isAdminOrOwner = currentUser ? hasAuditRole(currentUser) : false;

  return (
    <div className="space-y-5">
      {/* Search + actions bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search foods..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFiltersOpen(p => !p)}
            className={cn("cursor-pointer gap-1.5", filtersOpen && "bg-muted")}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />Filters
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setAddOpen(true)} className="cursor-pointer gap-1.5">
              <Plus className="w-3.5 h-3.5" />Add Food
            </Button>
          )}
          {!canManage && (
            <Button size="sm" asChild>
              <Link to="/nutrition/foods/new"><Plus className="w-3.5 h-3.5 mr-1" />Add Food</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3">
              {/* Category */}
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

              {/* Sort */}
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

              {/* Archived toggle */}
              {canManage && (
                <div className="flex items-end pb-0.5">
                  <button
                    onClick={() => setShowArchived(p => !p)}
                    className={cn(
                      "h-8 px-3 text-xs rounded-lg border transition-colors cursor-pointer",
                      showArchived ? "bg-muted border-border text-foreground" : "border-border/50 text-muted-foreground hover:border-border"
                    )}
                  >
                    {showArchived ? "Hiding archived" : "Show archived"}
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {foods === undefined ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : foods.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Apple /></EmptyMedia>
            <EmptyTitle>No foods found</EmptyTitle>
            <EmptyDescription>
              {search ? `No foods match "${search}"` : "The food database is empty"}
            </EmptyDescription>
          </EmptyHeader>
          {canManage && (
            <EmptyContent>
              <Button size="sm" onClick={() => setAddOpen(true)} className="cursor-pointer">
                <Plus className="w-3.5 h-3.5 mr-1.5" />Add First Food
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{foods.length} food{foods.length !== 1 ? "s" : ""}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {foods.map(food => (
              <FoodCard key={food._id} food={food} canManage={canManage} isAdminOrOwner={isAdminOrOwner} />
            ))}
          </div>
        </>
      )}

      {addOpen && <FoodFormDialog open onOpenChange={setAddOpen} />}
    </div>
  );
}

function hasManageRole(user: { roles?: string[] } | null | undefined): boolean {
  if (!user) return false;
  const roles = (user as { roles?: string[] }).roles ?? [];
  return roles.some(r => ["coach", "admin", "owner"].includes(r));
}

function hasAuditRole(user: { roles?: string[] } | null | undefined): boolean {
  if (!user) return false;
  const roles = (user as { roles?: string[] }).roles ?? [];
  return roles.some(r => ["admin", "owner"].includes(r));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FoodsPage() {
  return (
    <Authenticated>
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-12">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">Food Database</h1>
          <p className="text-muted-foreground">Browse, manage, and organize food items with complete nutritional data</p>
        </div>
        <FoodsContent />
      </div>
    </Authenticated>
  );
}
