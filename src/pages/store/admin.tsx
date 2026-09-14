import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  ShieldAlert,
  Pencil,
  Trash2,
  Plus,
  Star,
  StarOff,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Package,
  AlertTriangle,
  History,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type StoreProduct = Doc<"storeProducts">;
type InventoryLog = Doc<"inventoryLogs">;

type ProductFormData = {
  productId: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  badge: string;
  featured: boolean;
  active: boolean;
  displayOrder: number;
  variants: Array<{ id: string; name: string; price: number }>;
  stockQuantity: string;
  lowStockThreshold: string;
};

const EMPTY_FORM: ProductFormData = {
  productId: "",
  name: "",
  description: "",
  category: "Apparel",
  imageUrl: "",
  badge: "",
  featured: false,
  active: true,
  displayOrder: 0,
  variants: [{ id: "", name: "", price: 0 }],
  stockQuantity: "",
  lowStockThreshold: "5",
};

// ─── Stock status helper ───────────────────────────────────────────────────────

function getStockStatus(product: StoreProduct): "in_stock" | "low_stock" | "out_of_stock" | "untracked" {
  if (product.stockQuantity === undefined || product.stockQuantity === null) return "untracked";
  const threshold = product.lowStockThreshold ?? 5;
  if (product.stockQuantity <= 0) return "out_of_stock";
  if (product.stockQuantity <= threshold) return "low_stock";
  return "in_stock";
}

function StockBadge({ product }: { product: StoreProduct }) {
  const status = getStockStatus(product);
  if (status === "untracked") return null;
  const qty = product.stockQuantity ?? 0;
  if (status === "out_of_stock") return (
    <Badge className="text-[10px] px-1.5 py-0 bg-destructive text-destructive-foreground">Out of Stock</Badge>
  );
  if (status === "low_stock") return (
    <Badge className="text-[10px] px-1.5 py-0 bg-yellow-500 text-white gap-1">
      <AlertTriangle className="w-2.5 h-2.5" /> Low: {qty}
    </Badge>
  );
  return (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{qty} in stock</Badge>
  );
}

// ─── Inventory Adjust Dialog ──────────────────────────────────────────────────

function AdjustStockDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: StoreProduct;
}) {
  const adjustStock = useMutation(api.store.adjustStock);
  const setStock = useMutation(api.store.setStock);
  const [mode, setMode] = useState<"set" | "add" | "remove">("set");
  const [amount, setAmount] = useState("");
  const [threshold, setThreshold] = useState(String(product.lowStockThreshold ?? 5));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const currentQty = product.stockQuantity ?? 0;

  const preview = () => {
    const n = Number(amount);
    if (isNaN(n) || !amount) return currentQty;
    if (mode === "set") return Math.max(0, n);
    if (mode === "add") return currentQty + n;
    return Math.max(0, currentQty - n);
  };

  const handleSave = async () => {
    const n = Number(amount);
    if (isNaN(n) || !amount || n < 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "set") {
        await setStock({
          id: product._id,
          stockQuantity: n,
          lowStockThreshold: threshold ? Number(threshold) : undefined,
          reason: reason || undefined,
        });
      } else {
        await adjustStock({
          id: product._id,
          changeAmount: mode === "add" ? n : -n,
          reason: reason || undefined,
        });
      }
      toast.success("Inventory updated.");
      onClose();
    } catch {
      toast.error("Failed to update inventory.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Manage Inventory — {product.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {(["set", "add", "remove"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 py-1.5 font-medium capitalize cursor-pointer transition-colors",
                  mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
            <span>Current stock:</span>
            <span className="font-bold text-foreground">{currentQty} units</span>
          </div>

          <div className="space-y-1.5">
            <Label>{mode === "set" ? "New Quantity" : mode === "add" ? "Add Units" : "Remove Units"}</Label>
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>

          {amount && !isNaN(Number(amount)) && (
            <div className="flex items-center justify-between text-sm bg-muted/40 rounded-lg px-3 py-2">
              <span className="text-muted-foreground">New stock will be:</span>
              <span className="font-bold text-foreground">{preview()} units</span>
            </div>
          )}

          {mode === "set" && (
            <div className="space-y-1.5">
              <Label>Low Stock Alert Threshold</Label>
              <Input
                type="number"
                min="0"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">Alert shown when stock falls below this number</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. New shipment received"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} className="cursor-pointer">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="cursor-pointer">
            {saving ? "Saving..." : "Update Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inventory Log Dialog ─────────────────────────────────────────────────────

function InventoryLogDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: StoreProduct;
}) {
  const logs = useQuery(api.store.getInventoryLogs, open ? { productId: product._id } : "skip");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Inventory History — {product.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {logs === undefined ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No inventory changes recorded yet.</p>
          ) : (
            logs.map((log) => (
              <div key={log._id} className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-card text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-bold", log.changeAmount >= 0 ? "text-green-500" : "text-destructive")}>
                      {log.changeAmount >= 0 ? "+" : ""}{log.changeAmount}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {log.previousQuantity} → {log.newQuantity} units
                    </span>
                  </div>
                  {log.reason && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.reason}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">by {log.userName}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {format(new Date(log._creationTime), "MMM d, h:mm a")}
                </span>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} className="cursor-pointer">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit/Create Dialog ───────────────────────────────────────────────────────

function ProductDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product?: StoreProduct;
}) {
  const createProduct = useMutation(api.store.create);
  const updateProduct = useMutation(api.store.update);
  const isEdit = !!product;

  const [form, setForm] = useState<ProductFormData>(() =>
    product
      ? {
          productId: product.productId,
          name: product.name,
          description: product.description,
          category: product.category,
          imageUrl: product.imageUrl,
          badge: product.badge ?? "",
          featured: product.featured,
          active: product.active,
          displayOrder: product.displayOrder,
          variants: product.variants.map((v) => ({ ...v })),
          stockQuantity: product.stockQuantity !== undefined ? String(product.stockQuantity) : "",
          lowStockThreshold: String(product.lowStockThreshold ?? 5),
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof ProductFormData>(key: K, val: ProductFormData[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  };

  const updateVariant = (i: number, field: "id" | "name" | "price", val: string | number) => {
    setForm((f) => {
      const variants = [...f.variants];
      variants[i] = { ...variants[i], [field]: val };
      return { ...f, variants };
    });
  };

  const addVariant = () => {
    setForm((f) => ({ ...f, variants: [...f.variants, { id: "", name: "", price: 0 }] }));
  };

  const removeVariant = (i: number) => {
    setForm((f) => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }));
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.productId.trim()) {
      toast.error("Product name and Hercules Commerce Product ID are required.");
      return;
    }
    if (form.variants.some((v) => !v.id.trim() || !v.name.trim())) {
      toast.error("All variants must have an ID and name.");
      return;
    }
    setSaving(true);
    try {
      const stockQty = form.stockQuantity !== "" ? Number(form.stockQuantity) : undefined;
      const lowThreshold = form.lowStockThreshold !== "" ? Number(form.lowStockThreshold) : undefined;
      if (isEdit && product) {
        await updateProduct({
          id: product._id,
          name: form.name,
          description: form.description,
          category: form.category,
          imageUrl: form.imageUrl,
          badge: form.badge || undefined,
          featured: form.featured,
          active: form.active,
          displayOrder: form.displayOrder,
          stockQuantity: stockQty,
          lowStockThreshold: lowThreshold,
          variants: form.variants.map((v) => ({
            id: v.id,
            name: v.name,
            price: Number(v.price),
          })),
        });
      } else {
        await createProduct({
          productId: form.productId,
          name: form.name,
          description: form.description,
          category: form.category,
          imageUrl: form.imageUrl,
          badge: form.badge || undefined,
          featured: form.featured,
          active: form.active,
          displayOrder: form.displayOrder,
          variants: form.variants.map((v) => ({
            id: v.id,
            name: v.name,
            price: Number(v.price),
          })),
          stockQuantity: stockQty,
          lowStockThreshold: lowThreshold,
        });
      }
      toast.success(isEdit ? "Product updated." : "Product created.");
      onClose();
    } catch {
      toast.error("Failed to save product. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Commerce Product ID (create only) */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Hercules Commerce Product ID *</Label>
              <Input
                value={form.productId}
                onChange={(e) => setField("productId", e.target.value)}
                placeholder="prod_..."
              />
              <p className="text-xs text-muted-foreground">From the Monetize tab in Hercules App Builder</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Product Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="e.g. Signature Hoodie"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Brief product description"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setField("category", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Apparel">Apparel</SelectItem>
                  <SelectItem value="Accessories">Accessories</SelectItem>
                  <SelectItem value="Supplements">Supplements</SelectItem>
                  <SelectItem value="Digital">Digital</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Badge (optional)</Label>
              <Input
                value={form.badge}
                onChange={(e) => setField("badge", e.target.value)}
                placeholder='e.g. "New", "Sale"'
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Image URL</Label>
            <Input
              value={form.imageUrl}
              onChange={(e) => setField("imageUrl", e.target.value)}
              placeholder="https://..."
            />
            {form.imageUrl && (
              <img
                src={form.imageUrl}
                alt="Preview"
                className="w-full h-32 object-cover rounded-lg mt-1 bg-muted"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Display Order</Label>
            <Input
              type="number"
              value={form.displayOrder}
              onChange={(e) => setField("displayOrder", Number(e.target.value))}
            />
          </div>

          {/* ── Inventory ── */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-semibold">Inventory</Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Stock Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.stockQuantity}
                  onChange={(e) => setField("stockQuantity", e.target.value)}
                  placeholder="Leave blank to skip tracking"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Low Stock Alert At</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.lowStockThreshold}
                  onChange={(e) => setField("lowStockThreshold", e.target.value)}
                  placeholder="5"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Leave Stock Quantity blank to skip inventory tracking for this product.</p>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="active"
                checked={form.active}
                onCheckedChange={(v) => setField("active", v)}
              />
              <Label htmlFor="active">Active (visible in store)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="featured"
                checked={form.featured}
                onCheckedChange={(v) => setField("featured", v)}
              />
              <Label htmlFor="featured">Featured on Home</Label>
            </div>
          </div>

          {/* Variants — create and edit */}
          <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Variants</Label>
                <Button size="sm" variant="secondary" onClick={addVariant} className="cursor-pointer h-7 text-xs gap-1">
                  <Plus className="w-3 h-3" />
                  Add
                </Button>
              </div>
              {form.variants.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Variant ID</Label>
                    <Input
                      value={v.id}
                      onChange={(e) => updateVariant(i, "id", e.target.value)}
                      placeholder="var_..."
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={v.name}
                      onChange={(e) => updateVariant(i, "name", e.target.value)}
                      placeholder="S / M / Black"
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price (cents)</Label>
                    <Input
                      type="number"
                      value={v.price}
                      onChange={(e) => updateVariant(i, "price", Number(e.target.value))}
                      placeholder="4500"
                      className="text-xs h-8"
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeVariant(i)}
                    className="cursor-pointer h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    disabled={form.variants.length === 1}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} className="cursor-pointer">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="cursor-pointer">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Row ──────────────────────────────────────────────────────────────

function ProductRow({
  product,
  onEdit,
  onDelete,
  onToggleActive,
  onToggleFeatured,
  onReorder,
  onAdjustStock,
  onViewLog,
  isFirst,
  isLast,
}: {
  product: StoreProduct;
  onEdit: (p: StoreProduct) => void;
  onDelete: (id: Id<"storeProducts">) => void;
  onToggleActive: (id: Id<"storeProducts">, active: boolean) => void;
  onToggleFeatured: (id: Id<"storeProducts">, featured: boolean) => void;
  onReorder: (id: Id<"storeProducts">, direction: "up" | "down") => void;
  onAdjustStock: (p: StoreProduct) => void;
  onViewLog: (p: StoreProduct) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const status = getStockStatus(product);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border transition-colors",
        status === "out_of_stock" ? "border-destructive/40 bg-destructive/5" :
        status === "low_stock" ? "border-yellow-500/40 bg-yellow-500/5" :
        "border-border bg-card hover:bg-muted/30"
      )}
    >
      {/* Image */}
      <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted shrink-0 relative">
        <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        {status === "out_of_stock" && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white text-center leading-tight">OUT OF<br />STOCK</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm truncate">{product.name}</span>
          {product.badge && (
            <Badge className="text-[10px] bg-foreground text-background px-1.5 py-0">{product.badge}</Badge>
          )}
          {product.featured && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Featured</Badge>
          )}
          {!product.active && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-muted-foreground">Hidden</Badge>
          )}
          <StockBadge product={product} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {product.category} · {product.variants.length} variant{product.variants.length !== 1 ? "s" : ""} ·{" "}
          ${(product.variants[0]?.price ?? 0) / 100} each
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        <Button
          size="icon"
          variant="ghost"
          title="Move up"
          disabled={isFirst}
          onClick={() => onReorder(product._id, "up")}
          className="cursor-pointer w-7 h-7 text-muted-foreground"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Move down"
          disabled={isLast}
          onClick={() => onReorder(product._id, "down")}
          className="cursor-pointer w-7 h-7 text-muted-foreground"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title={product.featured ? "Remove from featured" : "Feature on Home"}
          onClick={() => onToggleFeatured(product._id, !product.featured)}
          className={cn("cursor-pointer w-7 h-7", product.featured ? "text-yellow-400" : "text-muted-foreground")}
        >
          {product.featured ? <Star className="w-3.5 h-3.5" /> : <StarOff className="w-3.5 h-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title={product.active ? "Hide from store" : "Show in store"}
          onClick={() => onToggleActive(product._id, !product.active)}
          className="cursor-pointer w-7 h-7 text-muted-foreground"
        >
          {product.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Manage Inventory"
          onClick={() => onAdjustStock(product)}
          className={cn("cursor-pointer w-7 h-7", status === "low_stock" ? "text-yellow-500" : status === "out_of_stock" ? "text-destructive" : "text-muted-foreground")}
        >
          <Package className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Inventory History"
          onClick={() => onViewLog(product)}
          className="cursor-pointer w-7 h-7 text-muted-foreground"
        >
          <History className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Edit"
          onClick={() => onEdit(product)}
          className="cursor-pointer w-7 h-7 text-muted-foreground"
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Delete"
          onClick={() => onDelete(product._id)}
          className="cursor-pointer w-7 h-7 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Admin Content ────────────────────────────────────────────────────────────

function AdminContent() {
  const products = useQuery(api.store.listAll, {});
  const updateProduct = useMutation(api.store.update);
  const removeProduct = useMutation(api.store.remove);

  const [editingProduct, setEditingProduct] = useState<StoreProduct | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<Id<"storeProducts"> | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<StoreProduct | null>(null);
  const [logProduct, setLogProduct] = useState<StoreProduct | null>(null);

  // Stock filter
  const [stockFilter, setStockFilter] = useState<"all" | "in_stock" | "low_stock" | "out_of_stock">("all");

  const handleToggleActive = async (id: Id<"storeProducts">, active: boolean) => {
    try {
      await updateProduct({ id, active });
      toast.success(active ? "Product visible in store." : "Product hidden from store.");
    } catch {
      toast.error("Failed to update product.");
    }
  };

  const handleToggleFeatured = async (id: Id<"storeProducts">, featured: boolean) => {
    try {
      await updateProduct({ id, featured });
      toast.success(featured ? "Product featured on Home." : "Removed from featured.");
    } catch {
      toast.error("Failed to update product.");
    }
  };

  const handleReorder = async (id: Id<"storeProducts">, direction: "up" | "down") => {
    if (!products) return;
    const idx = products.findIndex((p) => p._id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= products.length) return;
    try {
      await Promise.all([
        updateProduct({ id: products[idx]._id, displayOrder: products[swapIdx].displayOrder }),
        updateProduct({ id: products[swapIdx]._id, displayOrder: products[idx].displayOrder }),
      ]);
    } catch {
      toast.error("Failed to reorder.");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await removeProduct({ id: deleteId });
      toast.success("Product deleted.");
    } catch {
      toast.error("Failed to delete product.");
    } finally {
      setDeleteId(null);
    }
  };

  const openCreate = () => {
    setEditingProduct(undefined);
    setDialogOpen(true);
  };

  const openEdit = (p: StoreProduct) => {
    setEditingProduct(p);
    setDialogOpen(true);
  };

  const filtered = products?.filter((p) => {
    if (stockFilter === "all") return true;
    return getStockStatus(p) === stockFilter;
  });

  const lowStockCount = products?.filter((p) => getStockStatus(p) === "low_stock").length ?? 0;
  const outOfStockCount = products?.filter((p) => getStockStatus(p) === "out_of_stock").length ?? 0;

  const stats = products
    ? {
        total: products.length,
        active: products.filter((p) => p.active).length,
        featured: products.filter((p) => p.featured).length,
        lowStock: lowStockCount,
        outOfStock: outOfStockCount,
      }
    : null;

  return (
    <div className="px-4 pt-6 pb-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Admin</p>
          <h1 className="text-3xl font-black tracking-tight">Store Products</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your product catalog and inventory</p>
        </div>
        <Button onClick={openCreate} className="cursor-pointer gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Add Product
        </Button>
      </motion.div>

      {/* Low stock alert banner */}
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-sm"
        >
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <span className="text-foreground font-medium">
            Inventory alert:{" "}
            {outOfStockCount > 0 && <span className="text-destructive">{outOfStockCount} out of stock</span>}
            {outOfStockCount > 0 && lowStockCount > 0 && ", "}
            {lowStockCount > 0 && <span className="text-yellow-600 dark:text-yellow-400">{lowStockCount} low stock</span>}
          </span>
        </motion.div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { label: "Total", value: stats.total },
            { label: "Active", value: stats.active },
            { label: "Featured", value: stats.featured },
            { label: "Low Stock", value: stats.lowStock, warn: stats.lowStock > 0 },
            { label: "Out of Stock", value: stats.outOfStock, danger: stats.outOfStock > 0 },
          ].map((s) => (
            <Card key={s.label} className="py-4">
              <CardContent className="text-center p-0">
                <p className={cn("text-2xl font-bold",
                  "danger" in s && s.danger ? "text-destructive" :
                  "warn" in s && s.warn ? "text-yellow-500" : ""
                )}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Product List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Product Catalog</CardTitle>
            {/* Stock filter */}
            <div className="flex rounded-lg border overflow-hidden text-xs">
              {(["all", "in_stock", "low_stock", "out_of_stock"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStockFilter(f)}
                  className={cn(
                    "px-2.5 py-1.5 font-medium cursor-pointer transition-colors capitalize",
                    stockFilter === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {f.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {products === undefined ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
          ) : (filtered ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {products.length === 0
                ? "No products yet. Add your first product to get started."
                : "No products match the selected filter."}
            </p>
          ) : (
            <AnimatePresence>
              {(filtered ?? []).map((product, i) => (
                <ProductRow
                  key={product._id}
                  product={product}
                  onEdit={openEdit}
                  onDelete={setDeleteId}
                  onToggleActive={handleToggleActive}
                  onToggleFeatured={handleToggleFeatured}
                  onReorder={handleReorder}
                  onAdjustStock={setAdjustProduct}
                  onViewLog={setLogProduct}
                  isFirst={i === 0}
                  isLast={i === (filtered ?? []).length - 1}
                />
              ))}
            </AnimatePresence>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Manage inventory</span>
        <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> View change history</span>
        <span className="flex items-center gap-1.5">Stock icon turns red when out of stock</span>
      </div>

      {/* Dialogs */}
      <ProductDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        product={editingProduct}
      />

      {adjustProduct && (
        <AdjustStockDialog
          open={!!adjustProduct}
          onClose={() => setAdjustProduct(null)}
          product={adjustProduct}
        />
      )}

      {logProduct && (
        <InventoryLogDialog
          open={!!logProduct}
          onClose={() => setLogProduct(null)}
          product={logProduct}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the product from your store display. It will not delete it from Hercules Commerce.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="cursor-pointer bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Access Denied ────────────────────────────────────────────────────────────

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <ShieldAlert className="w-8 h-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          You need admin privileges to access the Store Admin Panel.
        </p>
      </div>
    </div>
  );
}

// ─── Gate by role ─────────────────────────────────────────────────────────────

function AdminGate() {
  const currentUser = useQuery(api.users.getCurrentUser, {});

  if (currentUser === undefined) {
    return (
      <div className="px-4 pt-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-16 w-64" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!(currentUser?.effectiveRoles as string[] | undefined)?.some(r => ["admin", "store_manager", "owner"].includes(r))) {
    return <AccessDenied />;
  }

  return <AdminContent />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoreAdminPage() {
  return (
    <>
      <AuthLoading>
        <div className="px-4 pt-6 max-w-3xl mx-auto">
          <Skeleton className="h-20 w-full" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <AccessDenied />
      </Unauthenticated>
      <Authenticated>
        <AdminGate />
      </Authenticated>
    </>
  );
}
