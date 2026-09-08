import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
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
  Banknote,
  CheckCircle2,
  XCircle,
  Clock,
  PlusCircle,
  CreditCard,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMethod = "bank_transfer" | "cash" | "other";
type SubscriptionTier = "free" | "self_guided" | "semi_guided" | "full_guided";
type PaymentStatus = "pending" | "confirmed" | "rejected";

type OfflinePayment = {
  _id: Id<"offlinePayments">;
  _creationTime: number;
  userId: Id<"users">;
  userName?: string;
  userEmail?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  referenceNote?: string;
  tier: SubscriptionTier;
  status: PaymentStatus;
  createdAt: string;
  confirmedAt?: string;
  confirmedByName?: string;
  notes?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TIER_OPTIONS: { value: SubscriptionTier; label: string; price: string }[] = [
  { value: "free",        label: "Shopping Only",            price: "$0/mo" },
  { value: "self_guided", label: "Hypertrophic Self Guided", price: "$4.99/mo" },
  { value: "semi_guided", label: "Hypertrophic Coach",       price: "$49.98/mo" },
  { value: "full_guided", label: "Elite Hypertrophic",       price: "$499.98/mo" },
];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  other: "Other",
};

const STATUS_STYLES: Record<PaymentStatus, { color: string; icon: React.ReactNode; label: string }> = {
  pending:   { color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: <Clock className="w-3 h-3" />,        label: "Pending" },
  confirmed: { color: "bg-green-500/10 text-green-400 border-green-500/20",   icon: <CheckCircle2 className="w-3 h-3" />, label: "Confirmed" },
  rejected:  { color: "bg-red-500/10 text-red-400 border-red-500/20",         icon: <XCircle className="w-3 h-3" />,      label: "Rejected" },
};

// ─── Status Pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: PaymentStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.color}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

// ─── Record Payment Dialog ─────────────────────────────────────────────────────

function RecordPaymentDialog({
  users,
  open,
  onOpenChange,
}: {
  users: { _id: Id<"users">; name?: string; email?: string }[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [tier, setTier] = useState<SubscriptionTier>("semi_guided");
  const [referenceNote, setReferenceNote] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const createPayment = useMutation(api.offlinePayments.createOfflinePayment);

  const reset = () => {
    setSelectedUser("");
    setAmount("");
    setMethod("bank_transfer");
    setTier("semi_guided");
    setReferenceNote("");
    setNotes("");
  };

  const handleSubmit = async () => {
    if (!selectedUser || !amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    setSaving(true);
    try {
      await createPayment({
        userId: selectedUser as Id<"users">,
        amount: amountCents,
        currency: "USD",
        method,
        tier,
        referenceNote: referenceNote || undefined,
        notes: notes || undefined,
      });
      toast.success("Payment record created — awaiting confirmation");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to create payment record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-primary" />
            Record Offline Payment
          </DialogTitle>
          <DialogDescription>
            Log a manual payment (bank transfer, cash, etc.) for a client. Payment will be marked
            pending until you confirm receipt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* User */}
          <div className="space-y-1.5">
            <Label>Client <span className="text-destructive">*</span></Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue placeholder="Select a client…" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u._id} value={u._id}>
                    {u.name ?? u.email ?? u._id}
                    {u.email && u.name ? ` (${u.email})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tier */}
          <div className="space-y-1.5">
            <Label>Subscription Tier <span className="text-destructive">*</span></Label>
            <Select value={tier} onValueChange={(v) => setTier(v as SubscriptionTier)}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label} — {t.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount + Method row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (USD) <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. 49.98"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reference */}
          <div className="space-y-1.5">
            <Label>Reference / Transaction ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              placeholder="e.g. ACH-20240701-4839"
              value={referenceNote}
              onChange={(e) => setReferenceNote(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              placeholder="Any additional context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button className="flex-1 cursor-pointer" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? "Saving…" : "Record Payment"}
            </Button>
            <Button variant="secondary" className="cursor-pointer" onClick={() => { reset(); onOpenChange(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Payment Row ──────────────────────────────────────────────────────────────

function PaymentRow({ payment }: { payment: OfflinePayment }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const confirmPayment = useMutation(api.offlinePayments.confirmOfflinePayment);
  const rejectPayment = useMutation(api.offlinePayments.rejectOfflinePayment);

  const tier = TIER_OPTIONS.find((t) => t.value === payment.tier);
  const displayName = payment.userName ?? payment.userEmail ?? "Unknown User";

  const handleConfirm = async () => {
    try {
      await confirmPayment({ paymentId: payment._id });
      toast.success(`Payment confirmed — ${tier?.label} activated for ${displayName}`);
      setConfirmOpen(false);
    } catch {
      toast.error("Failed to confirm payment");
    }
  };

  const handleReject = async () => {
    try {
      await rejectPayment({ paymentId: payment._id, notes: rejectNotes || undefined });
      toast.success("Payment rejected");
      setRejectOpen(false);
      setRejectNotes("");
    } catch {
      toast.error("Failed to reject payment");
    }
  };

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border bg-card/60 border-border hover:border-border/80 transition-all">
        {/* Icon */}
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Banknote className="w-4 h-4 text-primary" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{displayName}</span>
            <StatusPill status={payment.status} />
          </div>
          {payment.userEmail && payment.userName && (
            <p className="text-xs text-muted-foreground truncate">{payment.userEmail}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              ${(payment.amount / 100).toFixed(2)} {payment.currency}
            </span>
            <span>{METHOD_LABELS[payment.method]}</span>
            <span className="text-primary font-medium">{tier?.label}</span>
            {payment.referenceNote && <span>Ref: {payment.referenceNote}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
            <span>Recorded {format(new Date(payment.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
            {payment.confirmedAt && (
              <span>
                {payment.status === "confirmed" ? "Confirmed" : "Rejected"}{" "}
                {format(new Date(payment.confirmedAt), "MMM d, yyyy")}
                {payment.confirmedByName ? ` by ${payment.confirmedByName}` : ""}
              </span>
            )}
          </div>
          {payment.notes && (
            <p className="text-xs text-muted-foreground mt-1 italic">{payment.notes}</p>
          )}
        </div>

        {/* Actions (only for pending) */}
        {payment.status === "pending" && (
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <Button
              size="sm"
              className="cursor-pointer h-8 px-2.5 bg-green-600 hover:bg-green-500 text-white"
              onClick={() => setConfirmOpen(true)}
              title="Confirm payment received"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Confirm
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer h-8 px-2.5 text-destructive hover:text-destructive/80"
              onClick={() => setRejectOpen(true)}
              title="Reject payment"
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Confirm Payment
            </AlertDialogTitle>
            <AlertDialogDescription>
              Confirm that you have received <strong>${(payment.amount / 100).toFixed(2)}</strong> from{" "}
              <strong>{displayName}</strong> via {METHOD_LABELS[payment.method]}?
              <br />
              <br />
              This will activate their <strong>{tier?.label}</strong> subscription immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-green-600 hover:bg-green-500 text-white"
              onClick={() => void handleConfirm()}
            >
              Yes, Confirm Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Dialog */}
      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Reject Payment
            </AlertDialogTitle>
            <AlertDialogDescription>
              Reject this payment from <strong>{displayName}</strong>? Their subscription will be
              suspended.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <Textarea
              placeholder="Reason for rejection (optional)…"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleReject()}
            >
              Reject Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OfflinePaymentsTab() {
  const [recordOpen, setRecordOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("all");
  const allPayments = useQuery(api.offlinePayments.listAll, {});
  const allUsers = useQuery(api.users.listAllUsers, {});

  if (allPayments === undefined || allUsers === undefined) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const pendingCount = allPayments.filter((p) => p.status === "pending").length;

  const filtered = statusFilter === "all"
    ? allPayments
    : allPayments.filter((p) => p.status === statusFilter);

  const stats = [
    { label: "Total Recorded", value: allPayments.length, icon: <CreditCard className="w-4 h-4" /> },
    { label: "Pending Confirmation", value: pendingCount, icon: <Clock className="w-4 h-4" />, highlight: pendingCount > 0 },
    { label: "Confirmed", value: allPayments.filter((p) => p.status === "confirmed").length, icon: <CheckCircle2 className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Card
            key={s.label}
            className={`border-border ${s.highlight ? "bg-yellow-500/5 border-yellow-500/20" : "bg-muted/30"}`}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.highlight ? "bg-yellow-500/10 text-yellow-400" : "bg-primary/10 text-primary"}`}>
                {s.icon}
              </div>
              <div>
                <p className="text-lg font-bold leading-none">{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(["all", "pending", "confirmed", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === f
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60"
              }`}
            >
              {f === "all" ? "All" : STATUS_STYLES[f].label}
              {f === "pending" && pendingCount > 0 && (
                <span className="ml-1.5 bg-yellow-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="cursor-pointer"
          onClick={() => setRecordOpen(true)}
        >
          <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
          Record Payment
        </Button>
      </div>

      {/* Payment List */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCw />
            </EmptyMedia>
            <EmptyTitle>
              {statusFilter === "all" ? "No payments recorded" : `No ${STATUS_STYLES[statusFilter as PaymentStatus]?.label.toLowerCase() ?? statusFilter} payments`}
            </EmptyTitle>
            <EmptyDescription>
              {statusFilter === "all"
                ? "Record a manual payment to get started."
                : "Try selecting a different filter."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PaymentRow key={p._id} payment={p as OfflinePayment} />
          ))}
        </div>
      )}

      {/* Record Payment Dialog */}
      <RecordPaymentDialog
        users={allUsers as { _id: Id<"users">; name?: string; email?: string }[]}
        open={recordOpen}
        onOpenChange={setRecordOpen}
      />
    </div>
  );
}
