import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  MailPlus,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
  Copy,
  Send,
  Loader2,
  Mail,
  User,
  ShieldCheck,
  UserPlus,
  CreditCard,
  Building2,
  Search,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { format, formatDistanceToNow } from "date-fns";

// ─── Constants ────────────────────────────────────────────────────────────────

const TIER_OPTIONS = [
  { value: "free",        label: "Shopping Experience Only",           sub: "Free" },
  { value: "self_guided", label: "Hypertrophic – Self Guided",         sub: "$4.99/month" },
  { value: "semi_guided", label: "Hypertrophic Coach – Semi Guided",   sub: "$49.98/month" },
  { value: "full_guided", label: "Elite Hypertrophic – Full Guided",   sub: "$499.98/month" },
] as const;

type SubscriptionTier = "free" | "self_guided" | "semi_guided" | "full_guided";

function tierLabel(tier: string) {
  return TIER_OPTIONS.find((t) => t.value === tier)?.label ?? tier;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META = {
  pending: {
    label: "Pending",
    icon: <Clock className="w-3 h-3" />,
    color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  },
  accepted: {
    label: "Accepted",
    icon: <CheckCircle2 className="w-3 h-3" />,
    color: "bg-green-500/10 text-green-400 border-green-500/20",
  },
  expired: {
    label: "Expired",
    icon: <XCircle className="w-3 h-3" />,
    color: "bg-muted text-muted-foreground border-border",
  },
};

type InviteStatus = "pending" | "accepted" | "expired";

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as InviteStatus] ?? STATUS_META.expired;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.color}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function TypeBadge({ type }: { type?: string }) {
  const isClient = type === "client";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
        isClient
          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
          : "bg-primary/10 text-primary border-primary/20"
      }`}
    >
      {isClient ? <User className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
      {isClient ? "Client" : "Coach"}
    </span>
  );
}

// ─── Send Coach Invite Dialog ─────────────────────────────────────────────────

function SendCoachInviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const createInvite = useMutation(api.invites.createCoachInvite);

  const handleSend = async () => {
    if (!email.trim()) { toast.error("Please enter an email address"); return; }
    setSending(true);
    try {
      await createInvite({ email: email.trim(), appUrl: window.location.origin });
      toast.success(`Coach invite sent to ${email.trim()}`);
      setEmail("");
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ConvexError ? (err.data as { message?: string }).message : null;
      toast.error(msg ?? "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Send Coach Invite
          </DialogTitle>
          <DialogDescription>
            The recipient will receive a secure sign-up link and be assigned the Coach role automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label htmlFor="coach-email">Email Address</Label>
            <Input
              id="coach-email"
              type="email"
              placeholder="coach@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSend()}
            />
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">What happens:</p>
            <p>• A secure one-time link is emailed to the recipient</p>
            <p>• Invite expires in 7 days</p>
            <p>• Upon acceptance, the Coach role is assigned automatically</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 cursor-pointer" onClick={() => void handleSend()} disabled={sending}>
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : <><Send className="w-4 h-4 mr-2" />Send Coach Invite</>}
            </Button>
            <Button variant="secondary" className="cursor-pointer" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Send Client Invite Dialog ────────────────────────────────────────────────

type BillingMethod = "stripe" | "bank_transfer";

function SendClientInviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [clientName, setClientName] = useState("");
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [billingMethod, setBillingMethod] = useState<BillingMethod>("stripe");
  const [assignedCoachId, setAssignedCoachId] = useState<string>("");
  const [coachSearch, setCoachSearch] = useState("");
  const [sending, setSending] = useState(false);
  const createInvite = useMutation(api.invites.createClientInvite);
  const coaches = useQuery(api.invites.listCoaches, {});

  const filteredCoaches = useMemo(() => {
    if (!coaches) return [];
    const q = coachSearch.toLowerCase();
    if (!q) return coaches;
    return coaches.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [coaches, coachSearch]);

  const selectedCoach = coaches?.find((c) => c._id === assignedCoachId);

  const reset = () => {
    setEmail(""); setClientName(""); setTier("free");
    setBillingMethod("stripe"); setAssignedCoachId(""); setCoachSearch("");
  };

  const handleSend = async () => {
    if (!email.trim()) { toast.error("Please enter an email address"); return; }
    if (!assignedCoachId) { toast.error("Please select an assigned coach"); return; }
    setSending(true);
    try {
      await createInvite({
        email: email.trim(),
        clientName: clientName.trim() || undefined,
        subscriptionTier: tier,
        assignedCoachId: assignedCoachId as Id<"users">,
        billingMethod,
        appUrl: window.location.origin,
      });
      toast.success(`Client invite sent to ${email.trim()}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ConvexError ? (err.data as { message?: string }).message : null;
      toast.error(msg ?? "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const selectedTier = TIER_OPTIONS.find((t) => t.value === tier);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-400" />
            Invite Client
          </DialogTitle>
          <DialogDescription>
            Manually onboard a client, pre-assign their coach and subscription tier.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          {/* Client Name */}
          <div className="space-y-2">
            <Label htmlFor="client-name">Client Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="client-name"
              type="text"
              placeholder="John Smith"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="client-email">Email Address</Label>
            <Input
              id="client-email"
              type="email"
              placeholder="client@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Subscription Tier */}
          <div className="space-y-2">
            <Label htmlFor="client-tier">Subscription Tier</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as SubscriptionTier)}>
              <SelectTrigger id="client-tier" className="cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="cursor-pointer">
                    <span className="font-medium">{t.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{t.sub}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTier && (
              <p className="text-xs text-muted-foreground px-1">
                Client activates on <strong className="text-foreground">{selectedTier.label}</strong> upon sign-up.
              </p>
            )}
          </div>

          {/* Billing Method */}
          <div className="space-y-2">
            <Label>Billing Method</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["stripe", "bank_transfer"] as BillingMethod[]).map((method) => {
                const active = billingMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setBillingMethod(method)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer transition-all ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {method === "stripe" ? <CreditCard className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                    {method === "stripe" ? "Stripe" : "Bank Transfer"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Assigned Coach */}
          <div className="space-y-2">
            <Label>
              Assigned Coach <span className="text-destructive">*</span>
            </Label>
            {coaches === undefined ? (
              <Skeleton className="h-10 w-full rounded-lg" />
            ) : coaches.length === 0 ? (
              <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs text-muted-foreground text-center">
                No coaches found. Add a Coach account first.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                {/* Search */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    placeholder="Search coaches…"
                    value={coachSearch}
                    onChange={(e) => setCoachSearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                {/* List */}
                <div className="max-h-40 overflow-y-auto divide-y divide-border">
                  {filteredCoaches.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No coaches match your search.</p>
                  ) : (
                    filteredCoaches.map((coach) => {
                      const selected = assignedCoachId === coach._id;
                      return (
                        <button
                          key={coach._id}
                          type="button"
                          onClick={() => setAssignedCoachId(coach._id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors ${
                            selected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted/40 text-foreground"
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                            selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          }`}>
                            {(coach.name ?? coach.email ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{coach.name ?? "Unnamed Coach"}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{coach.email}</p>
                          </div>
                          {selected && <CheckCircle2 className="w-3.5 h-3.5 ml-auto shrink-0 text-primary" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            {selectedCoach && (
              <p className="text-xs text-primary px-1">
                Assigned to: <strong>{selectedCoach.name ?? selectedCoach.email}</strong>
              </p>
            )}
          </div>

          {/* Info box */}
          <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">What happens:</p>
            <p>• A personalised invite email is sent to the client</p>
            <p>• Invite expires in 7 days</p>
            <p>• Upon sign-up, Client role, selected tier, and coach are activated</p>
            <p>• The coach immediately gains access to the client's profile</p>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1 cursor-pointer" onClick={() => void handleSend()} disabled={sending || !assignedCoachId}>
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : <><Send className="w-4 h-4 mr-2" />Send Client Invite</>}
            </Button>
            <Button variant="secondary" className="cursor-pointer" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invite Row ───────────────────────────────────────────────────────────────

function InviteRow({
  invite,
}: {
  invite: {
    _id: Id<"coachInvites">;
    email: string;
    token: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    acceptedAt?: string;
    inviteType?: string;
    clientName?: string;
    subscriptionTier?: string;
    assignedCoachId?: Id<"users">;
    billingMethod?: string;
  };
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const revokeInvite = useMutation(api.invites.revokeInvite);
  const inviteUrl = `${window.location.origin}/invite/accept?token=${invite.token}`;

  const copyLink = () => {
    void navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied to clipboard");
  };

  const handleRevoke = async () => {
    try {
      await revokeInvite({ inviteId: invite._id });
      toast.success("Invite revoked");
      setDeleteOpen(false);
    } catch {
      toast.error("Failed to revoke invite");
    }
  };

  const displayName = invite.clientName ?? invite.email;

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-card/60 border border-border">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Mail className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm truncate">{displayName}</span>
            <TypeBadge type={invite.inviteType} />
            <StatusBadge status={invite.status} />
          </div>
          {invite.clientName && (
            <p className="text-[11px] text-muted-foreground truncate">{invite.email}</p>
          )}
          {invite.inviteType === "client" && invite.subscriptionTier && (
            <p className="text-[11px] text-blue-400 font-medium mt-0.5">
              Plan: {tierLabel(invite.subscriptionTier)}
              {invite.billingMethod && (
                <span className="text-muted-foreground font-normal ml-1.5">
                  · {invite.billingMethod === "stripe" ? "Stripe" : "Bank Transfer"}
                </span>
              )}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Sent {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })}
            {invite.status === "pending" && (
              <> · Expires {format(new Date(invite.expiresAt), "MMM d, yyyy")}</>
            )}
            {invite.status === "accepted" && invite.acceptedAt && (
              <> · Accepted {formatDistanceToNow(new Date(invite.acceptedAt), { addSuffix: true })}</>
            )}
          </p>
        </div>
        {invite.status === "pending" && (
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <Button size="sm" variant="secondary" className="cursor-pointer h-8 px-2.5" onClick={copyLink} title="Copy invite link">
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm" variant="secondary"
              className="cursor-pointer h-8 px-2.5 text-destructive hover:text-destructive/80"
              onClick={() => setDeleteOpen(true)} title="Revoke invite"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Invite</AlertDialogTitle>
            <AlertDialogDescription>
              Revoke the invite for <strong>{invite.email}</strong>? The link will no longer work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleRevoke()}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function InvitesTab() {
  const invites = useQuery(api.invites.listInvites, {});
  const [coachOpen, setCoachOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);

  if (invites === undefined) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const pending   = invites.filter((i) => i.status === "pending");
  const accepted  = invites.filter((i) => i.status === "accepted");
  const expired   = invites.filter((i) => i.status === "expired");
  const clients   = invites.filter((i) => i.inviteType === "client");
  const coaches   = invites.filter((i) => i.inviteType !== "client");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Invitations</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pending.length} pending · {accepted.length} accepted · {expired.length} expired
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer gap-2"
            onClick={() => setCoachOpen(true)}
          >
            <ShieldCheck className="w-4 h-4" />
            Invite Coach
          </Button>
          <Button
            size="sm"
            className="cursor-pointer gap-2"
            onClick={() => setClientOpen(true)}
          >
            <UserPlus className="w-4 h-4" />
            Invite Client
          </Button>
        </div>
      </div>

      {/* Info boxes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-muted/30 border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">Client Invites</p>
          <p className="text-xl font-bold">{clients.length}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Bank transfer / manual</p>
        </div>
        <div className="rounded-xl bg-muted/30 border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">Coach Invites</p>
          <p className="text-xl font-bold">{coaches.length}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Coach role assignment</p>
        </div>
      </div>

      {/* Empty */}
      {invites.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MailPlus className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No invites sent yet.</p>
          <p className="text-xs mt-1">Use the buttons above to invite clients or coaches.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <InviteRow key={inv._id} invite={inv} />
          ))}
        </div>
      )}

      {/* Stats */}
      {invites.length > 0 && (
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { label: "Pending",  value: pending.length,  color: "text-yellow-400" },
            { label: "Accepted", value: accepted.length, color: "text-green-400" },
            { label: "Expired",  value: expired.length,  color: "text-muted-foreground" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-muted/30 border border-border p-3 text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <SendCoachInviteDialog open={coachOpen} onOpenChange={setCoachOpen} />
      <SendClientInviteDialog open={clientOpen} onOpenChange={setClientOpen} />
    </motion.div>
  );
}
