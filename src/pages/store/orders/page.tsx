import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.js";
import { useRoles } from "@/hooks/use-roles.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import {
  ShoppingBag, Package, Truck, CheckCircle2, XCircle, Clock,
  RefreshCw, Search, ChevronDown, ChevronUp, User, MapPin,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { motion } from "motion/react";

type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";
type StatusFilter = OrderStatus | "all";

const STATUS_CONFIG: Record<OrderStatus, { label: string; icon: React.ReactNode; className: string }> = {
  pending:    { label: "Pending",    icon: <Clock className="w-3 h-3" />,         className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" },
  processing: { label: "Processing", icon: <RefreshCw className="w-3 h-3" />,     className: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  shipped:    { label: "Shipped",    icon: <Truck className="w-3 h-3" />,          className: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
  delivered:  { label: "Delivered",  icon: <CheckCircle2 className="w-3 h-3" />,  className: "bg-green-500/15 text-green-400 border-green-500/25" },
  cancelled:  { label: "Cancelled",  icon: <XCircle className="w-3 h-3" />,       className: "bg-red-500/15 text-red-400 border-red-500/25" },
};

function fmt$(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Order Detail Dialog ──────────────────────────────────────────────────────

function OrderDetailDialog({
  order,
  open,
  onClose,
}: {
  order: Doc<"storeOrders">;
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [tracking, setTracking] = useState(order.trackingNumber ?? "");
  const [notes, setNotes] = useState(order.fulfillmentNotes ?? "");
  const [saving, setSaving] = useState(false);
  const updateStatus = useMutation(api.storeOrders.updateStatus);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateStatus({
        orderId: order._id,
        status,
        trackingNumber: tracking || undefined,
        fulfillmentNotes: notes || undefined,
      });
      toast.success("Order updated");
      onClose();
    } catch (e) {
      const msg = e instanceof ConvexError ? (e.data as { message: string }).message : "Failed to update";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const cfg = STATUS_CONFIG[order.status];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Order Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Order meta */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border">
            <div>
              <p className="text-xs text-muted-foreground">Order ID</p>
              <p className="font-mono text-xs">{order._id}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="text-sm font-medium">{format(new Date(order.orderDate), "MMM d, yyyy")}</p>
            </div>
          </div>

          {/* Customer info */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Customer
            </h3>
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{order.customerName}</p>
              <p className="text-muted-foreground">{order.customerEmail}</p>
              {order.customerPhone && <p className="text-muted-foreground">{order.customerPhone}</p>}
            </div>
          </div>

          {/* Shipping info */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Shipping Address
            </h3>
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{order.shippingFullName}</p>
              <p className="text-muted-foreground">{order.shippingAddress}</p>
              <p className="text-muted-foreground">{order.shippingCity}, {order.shippingPostalCode}</p>
              <p className="text-muted-foreground">{order.shippingCountry}</p>
            </div>
          </div>

          {/* Products */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <ShoppingBag className="w-3.5 h-3.5" /> Items
            </h3>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{item.productName}</p>
                    {item.variantName && <p className="text-xs text-muted-foreground">{item.variantName}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">{fmt$(item.unitPriceCents * item.quantity)}</p>
                    <p className="text-xs text-muted-foreground">×{item.quantity} @ {fmt$(item.unitPriceCents)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-border">
              <span className="text-sm font-bold">Total</span>
              <span className="text-lg font-black text-primary">{fmt$(order.totalCents)}</span>
            </div>
          </div>

          {/* Fulfillment controls */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" /> Fulfillment
            </h3>

            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tracking Number</Label>
              <Input
                placeholder="e.g. 1Z999AA10123456784"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Fulfillment Notes</Label>
              <Textarea
                placeholder="Internal notes about this order..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full cursor-pointer">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Order Row ────────────────────────────────────────────────────────────────

function OrderRow({ order }: { order: Doc<"storeOrders"> }) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cfg = STATUS_CONFIG[order.status];

  return (
    <>
      <Card className="border-border bg-card">
        <button
          type="button"
          className="w-full cursor-pointer text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${cfg.className}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{format(new Date(order.orderDate), "MMM d, yyyy")}</span>
                </div>
                <p className="font-bold text-sm">{order.customerName}</p>
                <p className="text-xs text-muted-foreground">{order.customerEmail}</p>
                {order.trackingNumber && (
                  <p className="text-xs text-primary mt-0.5">Tracking: {order.trackingNumber}</p>
                )}
              </div>
              <div className="text-right shrink-0 flex flex-col items-end gap-1">
                <p className="font-black text-base">{fmt$(order.totalCents)}</p>
                <p className="text-xs text-muted-foreground">{order.items.length} item{order.items.length !== 1 ? "s" : ""}</p>
                {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </div>
          </CardContent>
        </button>

        {expanded && (
          <div className="border-t border-border px-4 pb-4">
            <div className="pt-3 space-y-1.5">
              {order.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>{item.productName}{item.variantName ? ` — ${item.variantName}` : ""} ×{item.quantity}</span>
                  <span className="font-medium">{fmt$(item.unitPriceCents * item.quantity)}</span>
                </div>
              ))}
              <div className="pt-2 text-xs text-muted-foreground">
                {order.shippingAddress}, {order.shippingCity}, {order.shippingCountry}
              </div>
              {order.fulfillmentNotes && (
                <div className="pt-1 text-xs italic text-muted-foreground">Note: {order.fulfillmentNotes}</div>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="w-full mt-3 cursor-pointer"
              onClick={() => setDialogOpen(true)}
            >
              Manage Order
            </Button>
          </div>
        )}
      </Card>

      <OrderDetailDialog order={order} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function StoreOrdersContent() {
  const { effectiveRoles, isLoading: rolesLoading } = useRoles();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const isAuthorized = effectiveRoles.includes("owner") || effectiveRoles.includes("admin");

  const orders = useQuery(
    api.storeOrders.list,
    isAuthorized ? { status: statusFilter, limit: 200 } : "skip"
  );

  if (rolesLoading || orders === undefined) {
    return (
      <div className="space-y-3 px-4 pt-6">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="text-center py-20 px-4">
        <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground text-sm">Store Orders is available to owners and admins only.</p>
      </div>
    );
  }

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.customerName.toLowerCase().includes(q) ||
      o.customerEmail.toLowerCase().includes(q) ||
      o._id.toLowerCase().includes(q) ||
      (o.trackingNumber?.toLowerCase().includes(q) ?? false)
    );
  });

  const statusCounts: Record<string, number> = { all: orders.length };
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-8 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Package className="w-6 h-6 text-primary" />
          Store Orders
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage fulfillment for all customer purchases</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Total Orders", value: orders.length, color: "text-foreground" },
          { label: "Pending", value: statusCounts["pending"] ?? 0, color: "text-yellow-400" },
          { label: "Shipped", value: statusCounts["shipped"] ?? 0, color: "text-purple-400" },
        ].map((s) => (
          <Card key={s.label} className="border-border bg-card">
            <CardContent className="p-3 text-center">
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, ID, tracking..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "pending", "processing", "shipped", "delivered", "cancelled"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all border ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-foreground/30"
              }`}
            >
              {s === "all" ? "All" : STATUS_CONFIG[s].label}
              {statusCounts[s] !== undefined && (
                <span className="ml-1 opacity-60">{statusCounts[s]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Orders list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <Package className="w-10 h-10 mx-auto text-muted-foreground/40" />
          <p className="font-semibold text-sm">No orders found</p>
          <p className="text-xs text-muted-foreground">
            {orders.length === 0 ? "Orders will appear here once customers make purchases." : "Try adjusting your search or filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((order, i) => (
            <motion.div key={order._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <OrderRow order={order} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StoreOrdersPage() {
  return (
    <>
      <AuthLoading>
        <div className="space-y-3 px-4 pt-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="text-center py-20 px-4 space-y-4">
          <p className="text-muted-foreground">Sign in to access Store Orders.</p>
          <SignInButton />
        </div>
      </Unauthenticated>
      <Authenticated>
        <StoreOrdersContent />
      </Authenticated>
    </>
  );
}
