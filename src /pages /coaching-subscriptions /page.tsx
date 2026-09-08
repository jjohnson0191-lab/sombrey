import { useState } from "react";
import { Authenticated, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import {
  DollarSign,
  Plus,
  UserCog,
  XCircle,
  Pencil,
  Users,
  ShieldCheck,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type SubStatus = "active" | "paused" | "cancelled";

type CoachSub = {
  _id: Id<"coachingSubscriptions">;
  clientId: Id<"users">;
  coachId: Id<"users">;
  monthlyPriceCents: number;
  currency: string;
  status: SubStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: Id<"users">;
  clientName: string;
  clientEmail?: string;
  clientAvatarUrl?: string | null;
  coachName: string;
};

// ─── Status pill ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<SubStatus, { label: string; color: string }> = {
  active:    { label: "Active",    color: "bg-green-500/15 text-green-400 border-green-500/25" },
  paused:    { label: "Paused",    color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" },
  cancelled: { label: "Cancelled", color: "bg-red-500/15 text-red-400 border-red-500/25" },
};

function StatusBadge({ status }: { status: SubStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border", s.color)}>
      {s.label}
    </span>
  );
}

// ─── Create / Edit Dialog ─────────────────────────────────────────────────────

function CreateSubDialog({
  open,
  onOpenChange,
  clients,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: { _id: Id<"users">; name?: string; email?: string }[];
}) {
  const [clientId, setClientId] = useState<Id<"users"> | "">("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const createSub = useMutation(api.coachingSubscriptions.create);

  const handleCreate = async () => {
    if (!clientId) { toast.error("Please select a client"); return; }
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents) || priceCents <= 0) { toast.error("Please enter a valid monthly price"); return; }

    setSaving(true);
    try {
      await createSub({
        clientId: clientId as Id<"users">,
        monthlyPriceCents: priceCents,
        notes: notes.trim() || undefined,
      });
      toast.success("Coaching subscription created");
      onOpenChange(false);
      setClientId("");
      setPrice("");
      setNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create subscription");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            Create Coaching Subscription
          </DialogTitle>
          <DialogDescription>
            Assign a private coaching subscription with a custom monthly price to a client.
            This information is never shown publicly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v as Id<"users">)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a client..." />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name ?? c.email ?? c._id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Monthly Price (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                className="pl-7"
                placeholder="e.g. 150.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="1"
                step="0.01"
              />
            </div>
            <p className="text-xs text-muted-foreground">This price is private — clients will not see it here.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Private Notes (optional)</Label>
            <Textarea
              placeholder="e.g. Custom program, 2x weekly calls..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="cursor-pointer">
              {saving ? "Creating..." : "Create Subscription"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

function EditSubDialog({
  sub,
  open,
  onOpenChange,
}: {
  sub: CoachSub;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [price, setPrice] = useState(String(sub.monthlyPriceCents / 100));
  const [status, setStatus] = useState<SubStatus>(sub.status);
  const [notes, setNotes] = useState(sub.notes ?? "");
  const [saving, setSaving] = useState(false);

  const updateSub = useMutation(api.coachingSubscriptions.update);

  const handleSave = async () => {
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents) || priceCents <= 0) { toast.error("Please enter a valid monthly price"); return; }

    setSaving(true);
    try {
      await updateSub({
        subscriptionId: sub._id,
        monthlyPriceCents: priceCents,
        status,
        notes: notes.trim() || undefined,
      });
      toast.success("Subscription updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update subscription");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            Edit Coaching Subscription
          </DialogTitle>
          <DialogDescription>
            Update the monthly price, status, or private notes for{" "}
            <strong>{sub.clientName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Monthly Price (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                className="pl-7"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="1"
                step="0.01"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Private Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="cursor-pointer">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Subscription Card ────────────────────────────────────────────────────────

function SubCard({ sub, onEdit }: { sub: CoachSub; onEdit: () => void }) {
  const cancelSub = useMutation(api.coachingSubscriptions.cancel);
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!confirm(`Cancel coaching subscription for ${sub.clientName}? Their access will revert to Free.`)) return;
    setCancelling(true);
    try {
      await cancelSub({ subscriptionId: sub._id });
      toast.success("Subscription cancelled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  const monthlyPrice = `$${(sub.monthlyPriceCents / 100).toFixed(2)}/mo`;

  return (
    <Card className="bg-card/60 border-border hover:border-primary/30 transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="w-10 h-10 shrink-0">
              {sub.clientAvatarUrl && <AvatarImage src={sub.clientAvatarUrl} />}
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                {(sub.clientName[0] ?? "?").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{sub.clientName}</p>
              {sub.clientEmail && (
                <p className="text-xs text-muted-foreground truncate">{sub.clientEmail}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">Coach: {sub.coachName}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge status={sub.status} />
            <span className="text-sm font-bold text-primary">{monthlyPrice}</span>
          </div>
        </div>

        {sub.notes && (
          <p className="mt-3 text-xs text-muted-foreground italic border-t border-border pt-2">
            {sub.notes}
          </p>
        )}

        <div className="flex gap-2 mt-3 pt-3 border-t border-border">
          <Button size="sm" variant="secondary" onClick={onEdit} className="cursor-pointer gap-1.5">
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </Button>
          {sub.status !== "cancelled" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCancel}
              disabled={cancelling}
              className="cursor-pointer gap-1.5 text-destructive hover:text-destructive"
            >
              <XCircle className="w-3.5 h-3.5" />
              {cancelling ? "Cancelling..." : "Cancel"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function CoachingSubscriptionsContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editSub, setEditSub] = useState<CoachSub | null>(null);
  const [statusFilter, setStatusFilter] = useState<SubStatus | "all">("all");

  const subs = useQuery(api.coachingSubscriptions.list, {});
  const clients = useQuery(api.users.listClients, {});

  if (subs === undefined || clients === undefined) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      </div>
    );
  }

  const filtered = (subs as CoachSub[]).filter((s) =>
    statusFilter === "all" || s.status === statusFilter
  );

  const activeSubs = (subs as CoachSub[]).filter((s) => s.status === "active");
  const totalMonthly = activeSubs.reduce((sum, s) => sum + s.monthlyPriceCents, 0);

  // Only show clients not already on an active coaching sub
  const activeClientIds = new Set(activeSubs.map((s) => s.clientId));
  const availableClients = (clients as { _id: Id<"users">; name?: string; email?: string }[]).filter(
    (c) => !activeClientIds.has(c._id)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Coaching Subscriptions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Private — visible only to coaches, admins, and owners
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="cursor-pointer gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          New Coaching Subscription
        </Button>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Coaching Clients", value: activeSubs.length, icon: <Users className="w-4 h-4" /> },
          { label: "Monthly Revenue (Coaching)", value: `$${(totalMonthly / 100).toFixed(2)}`, icon: <DollarSign className="w-4 h-4" /> },
          { label: "All Subscriptions", value: (subs as CoachSub[]).length, icon: <UserCog className="w-4 h-4" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-muted/30 border-border">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">{s.icon}</div>
              <div>
                <p className="text-lg font-bold leading-none">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "paused", "cancelled"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer",
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {s === "all" ? "All" : STATUS_STYLES[s].label}
            <span className="ml-1.5 opacity-60">
              {s === "all"
                ? (subs as CoachSub[]).length
                : (subs as CoachSub[]).filter((x) => x.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><UserCog /></EmptyMedia>
            <EmptyTitle>No coaching subscriptions</EmptyTitle>
            <EmptyDescription>
              Create a private coaching subscription to assign a custom monthly price to a client.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" className="cursor-pointer" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Create Subscription
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((sub) => (
            <SubCard
              key={sub._id}
              sub={sub}
              onEdit={() => setEditSub(sub)}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateSubDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        clients={availableClients}
      />
      {editSub && (
        <EditSubDialog
          sub={editSub}
          open={editSub !== null}
          onOpenChange={(v) => { if (!v) setEditSub(null); }}
        />
      )}
    </div>
  );
}

export default function CoachingSubscriptionsPage() {
  return (
    <Authenticated>
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-8">
        <CoachingSubscriptionsContent />
      </div>
    </Authenticated>
  );
}
