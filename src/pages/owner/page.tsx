import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import type { Doc } from "@/convex/_generated/dataModel.js";
import { useRoles } from "@/hooks/use-roles.ts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Crown,
  Shield,
  ShieldCheck,
  Dumbbell,
  Store,
  User,
  Search,
  UserCog,
  UserX,
  UserCheck,
  Trash2,
  History,
  Users,
  Lock,
  ChevronRight,
  MailPlus,
  CreditCard,
  Banknote,
  ArrowRightLeft,
  CheckCircle2 as CheckIcon,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  RotateCcw,
  Mail,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea.tsx";
import { motion } from "motion/react";
import { toast } from "sonner";
import { format } from "date-fns";
import { SignInButton } from "@/components/ui/signin.tsx";
import InvitesTab from "./_components/invites-tab.tsx";
import OfflinePaymentsTab from "./_components/offline-payments-tab.tsx";
import BusinessEmailTab from "./_components/business-email-tab.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppRole =
  | "client"
  | "coach"
  | "assistant_coach"
  | "store_manager"
  | "admin"
  | "owner";

type UserDoc = {
  _id: Id<"users">;
  _creationTime: number;
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  effectiveRoles?: AppRole[];
  primaryRole?: AppRole;
  disabled?: boolean;
  subscriptionTier?: string;
  paymentStatus?: "active" | "pending" | "suspended";
  adminGrantedPremium?: boolean;
  coachId?: Id<"users">;
};

// ─── Role metadata ─────────────────────────────────────────────────────────────

const ROLES: {
  value: AppRole;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    value: "owner",
    label: "Owner",
    desc: "Super user — unrestricted access",
    icon: <Crown className="w-3.5 h-3.5" />,
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  {
    value: "admin",
    label: "Admin",
    desc: "Full system access",
    icon: <Shield className="w-3.5 h-3.5" />,
    color: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  {
    value: "coach",
    label: "Coach",
    desc: "Manages clients and programs",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    color: "bg-primary/10 text-primary border-primary/20",
  },
  {
    value: "assistant_coach",
    label: "Assistant Coach",
    desc: "Limited coaching permissions",
    icon: <Dumbbell className="w-3.5 h-3.5" />,
    color: "bg-accent/10 text-accent border-accent/20",
  },
  {
    value: "store_manager",
    label: "Store Manager",
    desc: "Access to store management",
    icon: <Store className="w-3.5 h-3.5" />,
    color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  },
  {
    value: "client",
    label: "Client",
    desc: "Standard user access",
    icon: <User className="w-3.5 h-3.5" />,
    color: "bg-muted text-muted-foreground border-border",
  },
];

function roleMeta(role: AppRole) {
  return ROLES.find((r) => r.value === role) ?? ROLES[ROLES.length - 1];
}

function RolePill({ role }: { role: AppRole }) {
  const m = roleMeta(role);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${m.color}`}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

// ─── Subscription tier metadata ──────────────────────────────────────────────

type SubscriptionTier = "free" | "premium" | "coaching_client" | "self_guided" | "semi_guided" | "full_guided";

const TIER_OPTIONS: { value: SubscriptionTier; label: string; sub: string; color: string }[] = [
  { value: "free",            label: "Free",                     sub: "Free",           color: "bg-muted text-muted-foreground border-border" },
  { value: "premium",         label: "GOAT WALK Premium",        sub: "$9.99/mo",       color: "bg-primary/10 text-primary border-primary/20" },
  { value: "coaching_client", label: "Coaching Client",          sub: "Custom price",   color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  // Legacy tiers — still shown so existing records display correctly
  { value: "self_guided",     label: "Legacy: Self Guided",      sub: "$4.99/mo",       color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { value: "semi_guided",     label: "Legacy: Semi Guided",      sub: "$49.98/mo",      color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  { value: "full_guided",     label: "Legacy: Full Guided",      sub: "$499.98/mo",     color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
];

function TierPill({ tier }: { tier: string }) {
  const t = TIER_OPTIONS.find((o) => o.value === tier) ?? TIER_OPTIONS[0];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${t.color}`}>
      <CreditCard className="w-3 h-3" />
      {t.label}
    </span>
  );
}

// ─── Payment Status Pill ─────────────────────────────────────────────────────

const PAYMENT_STATUS_STYLES = {
  active:    { color: "bg-green-500/10 text-green-400 border-green-500/20",   label: "Active" },
  pending:   { color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", label: "Pending Payment" },
  suspended: { color: "bg-red-500/10 text-red-400 border-red-500/20",         label: "Suspended" },
} as const;

function PaymentStatusPill({ status }: { status: "active" | "pending" | "suspended" }) {
  const s = PAYMENT_STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.color}`}>
      <Banknote className="w-3 h-3" />
      {s.label}
    </span>
  );
}

// ─── Change Tier Dialog ───────────────────────────────────────────────────────

function ChangeTierDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserDoc;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [selected, setSelected] = useState<SubscriptionTier>(
    (user.subscriptionTier as SubscriptionTier | undefined) ?? "free",
  );
  const [saving, setSaving] = useState(false);
  const setTier = useMutation(api.users.setUserSubscriptionTier);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setTier({ userId: user._id, tier: selected });
      toast.success("Subscription tier updated");
      onOpenChange(false);
    } catch {
      toast.error("Failed to update subscription tier");
    } finally {
      setSaving(false);
    }
  };

  const currentTierMeta = TIER_OPTIONS.find((t) => t.value === selected);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Change Subscription Tier
          </DialogTitle>
          <DialogDescription>
            Manually assign a subscription plan to{" "}
            <strong>{user.name ?? user.email ?? "this user"}</strong>. Takes effect immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            {TIER_OPTIONS.map((t) => {
              const active = selected === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => setSelected(t.value)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer text-left ${
                    active ? `${t.color} border-current` : "border-border bg-muted/20 hover:bg-muted/40"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                      active ? "bg-current border-current" : "border-muted-foreground"
                    }`}
                  />
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{t.label}</p>
                    <p className="text-xs text-muted-foreground">{t.sub}</p>
                  </div>
                  {user.subscriptionTier === t.value && (
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      Current
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {currentTierMeta && selected !== user.subscriptionTier && (
            <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
              Changing from <strong className="text-foreground">{TIER_OPTIONS.find((t) => t.value === user.subscriptionTier)?.label ?? user.subscriptionTier}</strong>{" "}
              to <strong className="text-foreground">{currentTierMeta.label}</strong>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 cursor-pointer"
              onClick={() => void handleSave()}
              disabled={saving || selected === user.subscriptionTier}
            >
              {saving ? "Saving…" : "Save Tier"}
            </Button>
            <Button variant="secondary" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reassign Coach Dialog ─────────────────────────────────────────────────────

function ReassignCoachDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserDoc;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [selectedCoachId, setSelectedCoachId] = useState<string>(user.coachId ?? "");
  const [coachSearch, setCoachSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const reassign = useMutation(api.users.reassignClientCoach);
  const coaches = useQuery(api.invites.listCoaches, {});

  const filteredCoaches = (coaches ?? []).filter((c) => {
    const q = coachSearch.toLowerCase();
    return !q || (c.name ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });

  const selectedCoach = (coaches ?? []).find((c) => c._id === selectedCoachId);
  const currentCoach = (coaches ?? []).find((c) => c._id === user.coachId);

  const handleSave = async () => {
    if (!selectedCoachId) { toast.error("Please select a coach"); return; }
    setSaving(true);
    try {
      await reassign({ clientId: user._id, newCoachId: selectedCoachId as Id<"users"> });
      toast.success("Coach reassigned successfully");
      onOpenChange(false);
    } catch {
      toast.error("Failed to reassign coach");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setCoachSearch(""); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            Reassign Coach
          </DialogTitle>
          <DialogDescription>
            Change the assigned coach for <strong>{user.name ?? user.email ?? "this client"}</strong>.
            {currentCoach && <> Currently assigned to <strong>{currentCoach.name ?? currentCoach.email}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {coaches === undefined ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : coaches.length === 0 ? (
            <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs text-muted-foreground text-center">
              No coaches found.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
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
              <div className="max-h-48 overflow-y-auto divide-y divide-border">
                {filteredCoaches.map((coach) => {
                  const selected = selectedCoachId === coach._id;
                  const isCurrent = user.coachId === coach._id;
                  return (
                    <button
                      key={coach._id}
                      type="button"
                      onClick={() => setSelectedCoachId(coach._id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors ${
                        selected ? "bg-primary/10 text-primary" : "hover:bg-muted/40 text-foreground"
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}>
                        {(coach.name ?? coach.email ?? "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{coach.name ?? "Unnamed Coach"}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{coach.email}</p>
                      </div>
                      {isCurrent && <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">Current</span>}
                      {selected && !isCurrent && <CheckIcon className="w-3.5 h-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedCoach && selectedCoachId !== user.coachId && (
            <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
              Reassigning to <strong className="text-foreground">{selectedCoach.name ?? selectedCoach.email}</strong>.
              The previous coach will immediately lose access.
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 cursor-pointer"
              onClick={() => void handleSave()}
              disabled={saving || !selectedCoachId || selectedCoachId === user.coachId}
            >
              {saving ? "Saving…" : "Reassign Coach"}
            </Button>
            <Button variant="secondary" className="cursor-pointer" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Change Roles Dialog ───────────────────────────────────────────────────────

function ChangeRolesDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserDoc;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const current = user.effectiveRoles ?? ["client"];
  const [selected, setSelected] = useState<AppRole[]>(current);
  const updateRoles = useMutation(api.users.updateUserRoles);

  const toggle = (role: AppRole) => {
    setSelected((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const handleSave = async () => {
    const roles = selected.length > 0 ? selected : (["client"] as AppRole[]);
    try {
      await updateRoles({ userId: user._id, roles });
      toast.success("Roles updated successfully");
      onOpenChange(false);
    } catch {
      toast.error("Failed to update roles");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-primary" />
            Manage Roles
          </DialogTitle>
          <DialogDescription>
            Assign roles to{" "}
            <strong>{user.name ?? user.email ?? "this user"}</strong>.
            Permissions are additive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {ROLES.map((r) => {
            const active = selected.includes(r.value);
            return (
              <button
                key={r.value}
                onClick={() => toggle(r.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer text-left ${
                  active
                    ? `${r.color} border-current`
                    : "border-border bg-muted/20 hover:bg-muted/40"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                    active ? "bg-current border-current" : "border-muted-foreground"
                  }`}
                >
                  {active && (
                    <svg
                      className="w-3 h-3 text-background"
                      viewBox="0 0 12 12"
                      fill="currentColor"
                    >
                      <path
                        d="M10 3L5 8.5 2 5.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <div className="shrink-0">{r.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={() => void handleSave()} className="flex-1 cursor-pointer">
            Save Roles ({selected.length || 1})
          </Button>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── User Row ─────────────────────────────────────────────────────────────────

function UserRow({
  user,
  isCurrentUser,
}: {
  user: UserDoc;
  isCurrentUser: boolean;
}) {
  const [rolesOpen, setRolesOpen] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [grantingPremium, setGrantingPremium] = useState(false);
  const setDisabled = useMutation(api.users.setUserDisabled);
  const deleteUser = useMutation(api.users.deleteUser);
  const grantPremium = useMutation(api.users.grantPremiumAccess);
  const revokePremium = useMutation(api.users.revokePremiumAccess);
  const coaches = useQuery(api.invites.listCoaches, {});

  const roles = user.effectiveRoles ?? ["client"];
  const isClient = roles.includes("client") && roles.length === 1;
  const displayName = user.name ?? user.email ?? "Unknown User";
  const isDisabled = user.disabled === true;
  const isAdminGranted = user.adminGrantedPremium === true;
  const assignedCoach = coaches?.find((c) => c._id === user.coachId);

  const handleToggleDisabled = async () => {
    try {
      await setDisabled({ userId: user._id, disabled: !isDisabled });
      toast.success(isDisabled ? "User activated" : "User disabled");
    } catch {
      toast.error("Failed to update user status");
    }
  };

  const handleTogglePremium = async () => {
    setGrantingPremium(true);
    try {
      if (isAdminGranted) {
        await revokePremium({ userId: user._id });
        toast.success("Premium access revoked");
      } else {
        await grantPremium({ userId: user._id });
        toast.success("Premium access granted");
      }
    } catch {
      toast.error("Failed to update premium access");
    } finally {
      setGrantingPremium(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteUser({ userId: user._id });
      toast.success("User deleted");
      setDeleteOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete user";
      toast.error(msg);
    }
  };

  return (
    <>
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all ${
          isDisabled
            ? "bg-muted/30 border-border opacity-60"
            : "bg-card/60 border-border hover:border-border/80"
        }`}
      >
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center font-bold text-sm ${
          isDisabled ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
        }`}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            displayName[0]?.toUpperCase()
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{displayName}</span>
            {isCurrentUser && (
              <Badge variant="outline" className="text-[10px] py-0">
                You
              </Badge>
            )}
            {isDisabled && (
              <Badge
                variant="outline"
                className="text-[10px] py-0 bg-destructive/10 text-destructive border-destructive/20"
              >
                Disabled
              </Badge>
            )}
          </div>
          {user.email && (
            <p className="text-xs text-muted-foreground truncate mb-1.5">
              {user.email}
            </p>
          )}
          <div className="flex flex-wrap gap-1 mb-1.5">
            {roles.map((r) => (
              <RolePill key={r} role={r} />
            ))}
          </div>
          {user.subscriptionTier && (
            <div className="mb-1 flex items-center gap-1.5">
              <TierPill tier={user.subscriptionTier} />
              {isAdminGranted && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                  Admin Granted
                </span>
              )}
            </div>
          )}
          {user.paymentStatus && (
            <div className="mb-1">
              <PaymentStatusPill status={user.paymentStatus} />
            </div>
          )}
          {isClient && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Coach:{" "}
              {assignedCoach ? (
                <span className="text-foreground font-medium">{assignedCoach.name ?? assignedCoach.email}</span>
              ) : (
                <span className="text-yellow-400">Unassigned</span>
              )}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Joined {format(new Date(user._creationTime), "MMM d, yyyy")}
          </p>
        </div>

        {/* Actions */}
        {!isCurrentUser && (
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer h-8 px-2.5"
              onClick={() => setRolesOpen(true)}
            >
              <UserCog className="w-3.5 h-3.5 mr-1" />
              Roles
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer h-8 px-2.5"
              onClick={() => setTierOpen(true)}
              title="Change subscription tier"
            >
              <CreditCard className="w-3.5 h-3.5 mr-1" />
              Tier
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className={`cursor-pointer h-8 px-2.5 ${isAdminGranted ? "text-amber-400 hover:text-amber-300" : "text-primary hover:text-primary/80"}`}
              onClick={() => void handleTogglePremium()}
              disabled={grantingPremium}
              title={isAdminGranted ? "Revoke admin-granted premium" : "Grant premium access (no payment)"}
            >
              <Crown className="w-3.5 h-3.5 mr-1" />
              {isAdminGranted ? "Revoke" : "Premium"}
            </Button>
            {isClient && (
              <Button
                size="sm"
                variant="secondary"
                className="cursor-pointer h-8 px-2.5"
                onClick={() => setCoachOpen(true)}
                title="Reassign coach"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 mr-1" />
                Coach
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              className={`cursor-pointer h-8 px-2.5 ${isDisabled ? "text-green-400 hover:text-green-300" : "text-yellow-400 hover:text-yellow-300"}`}
              onClick={() => void handleToggleDisabled()}
              title={isDisabled ? "Activate user" : "Disable user"}
            >
              {isDisabled ? (
                <UserCheck className="w-3.5 h-3.5" />
              ) : (
                <UserX className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer h-8 px-2.5 text-destructive hover:text-destructive/80"
              onClick={() => setDeleteOpen(true)}
              title="Delete user"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {!isCurrentUser && (
        <>
          <ChangeRolesDialog
            user={user}
            open={rolesOpen}
            onOpenChange={setRolesOpen}
          />
          <ChangeTierDialog
            user={user}
            open={tierOpen}
            onOpenChange={setTierOpen}
          />
          {isClient && (
            <ReassignCoachDialog
              user={user}
              open={coachOpen}
              onOpenChange={setCoachOpen}
            />
          )}
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete User</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to permanently delete{" "}
                  <strong>{displayName}</strong>? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => void handleDelete()}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

const SUBSCRIPTION_TIERS = ["free", "premium", "coaching_client", "self_guided", "semi_guided", "full_guided"] as const;
type SubscriptionFilter = typeof SUBSCRIPTION_TIERS[number] | "all";
type SortOption = "name_asc" | "name_desc" | "newest" | "oldest";

function UsersTab({ currentUserId }: { currentUserId: Id<"users"> }) {
  const users = useQuery(api.users.listAllUsers, {});
  const coaches = useQuery(api.invites.listCoaches, {});
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "all">("all");
  const [coachFilter, setCoachFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<SubscriptionFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");

  if (users === undefined) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const filtered = users.filter((u) => {
    const effectiveRoles = (u.effectiveRoles as AppRole[] | undefined) ?? ["client"];
    const matchesSearch =
      ((u.name as string | undefined) ?? "").toLowerCase().includes(search.toLowerCase()) ||
      ((u.email as string | undefined) ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === "all" || effectiveRoles.includes(roleFilter);
    const matchesCoach = coachFilter === "all" || u.coachId === coachFilter;
    const matchesTier = tierFilter === "all" || u.subscriptionTier === tierFilter;
    return matchesSearch && matchesRole && matchesCoach && matchesTier;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "name_asc") return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "");
    if (sort === "name_desc") return (b.name ?? b.email ?? "").localeCompare(a.name ?? a.email ?? "");
    if (sort === "newest") return b._creationTime - a._creationTime;
    return a._creationTime - b._creationTime; // oldest
  });

  const counts = ROLES.reduce(
    (acc, r) => {
      acc[r.value] = users.filter((u) => {
        const er = (u.effectiveRoles as AppRole[] | undefined) ?? ["client"];
        return er.includes(r.value);
      }).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const enriched = sorted.map((u) => ({
    ...u,
    effectiveRoles: (u.effectiveRoles as AppRole[] | undefined) ?? ["client"],
  })) satisfies UserDoc[];

  const TIER_LABELS: Record<string, string> = {
    free: "Free",
    premium: "Premium",
    coaching_client: "Coaching Client",
    self_guided: "Legacy: Self Guided",
    semi_guided: "Legacy: Semi Guided",
    full_guided: "Legacy: Full Guided",
  };

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Users", value: users.length, icon: <Users className="w-4 h-4" /> },
          {
            label: "Active Users",
            value: users.filter((u) => !u.disabled).length,
            icon: <UserCheck className="w-4 h-4" />,
          },
          {
            label: "Disabled",
            value: users.filter((u) => u.disabled).length,
            icon: <UserX className="w-4 h-4" />,
          },
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

      {/* Search + Sort row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger className="w-36 shrink-0">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="name_asc">Name A–Z</SelectItem>
            <SelectItem value="name_desc">Name Z–A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Role filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setRoleFilter("all")}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
              roleFilter === "all"
                ? "bg-foreground text-background border-foreground"
                : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
            }`}
          >
            All ({users.length})
          </button>
          {ROLES.map((r) =>
            counts[r.value] > 0 ? (
              <button
                key={r.value}
                onClick={() => setRoleFilter(r.value)}
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  roleFilter === r.value
                    ? `${r.color} opacity-100`
                    : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
                }`}
              >
                {r.icon}
                {r.label} ({counts[r.value]})
              </button>
            ) : null,
          )}
        </div>
      </div>

      {/* Coach + Tier filters */}
      <div className="flex flex-wrap gap-2">
        {/* Coach filter */}
        {coaches && coaches.length > 0 && (
          <Select value={coachFilter} onValueChange={setCoachFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Filter by coach" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All coaches</SelectItem>
              {coaches.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name ?? c.email ?? "Unnamed Coach"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Subscription tier filter */}
        <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as SubscriptionFilter)}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="Filter by plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            {SUBSCRIPTION_TIERS.map((t) => (
              <SelectItem key={t} value={t}>{TIER_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {(coachFilter !== "all" || tierFilter !== "all" || roleFilter !== "all" || search) && (
          <button
            onClick={() => { setCoachFilter("all"); setTierFilter("all"); setRoleFilter("all"); setSearch(""); }}
            className="px-3 py-1 rounded-full text-xs border border-border text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* User list */}
      <div className="space-y-2">
        {enriched.length === 0 ? (
          <p className="text-center py-10 text-muted-foreground text-sm">
            No users match your filter.
          </p>
        ) : (
          enriched.map((u) => (
            <UserRow key={u._id} user={u} isCurrentUser={u._id === currentUserId} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  roles_updated:          { label: "Roles Updated",          color: "text-blue-400",          dot: "bg-blue-400" },
  user_disabled:          { label: "User Disabled",           color: "text-yellow-400",        dot: "bg-yellow-400" },
  user_activated:         { label: "User Activated",          color: "text-green-400",         dot: "bg-green-400" },
  user_deleted:           { label: "User Deleted",            color: "text-red-400",           dot: "bg-red-400" },
  coach_invite_sent:      { label: "Coach Invite Sent",       color: "text-primary",           dot: "bg-primary" },
  coach_invite_accepted:  { label: "Coach Invite Accepted",   color: "text-green-400",         dot: "bg-green-400" },
  client_invite_sent:     { label: "Client Invite Sent",      color: "text-blue-400",          dot: "bg-blue-400" },
  client_invite_accepted: { label: "Client Invite Accepted",  color: "text-green-400",         dot: "bg-green-400" },
  subscription_tier_changed:    { label: "Tier Changed",              color: "text-purple-400",        dot: "bg-purple-400" },
  coach_reassigned:             { label: "Coach Reassigned",           color: "text-accent",            dot: "bg-accent" },
  offline_payment_created:      { label: "Offline Payment Recorded",  color: "text-blue-400",          dot: "bg-blue-400" },
  offline_payment_confirmed:    { label: "Offline Payment Confirmed", color: "text-green-400",         dot: "bg-green-400" },
  offline_payment_rejected:     { label: "Offline Payment Rejected",  color: "text-red-400",           dot: "bg-red-400" },
  payment_status_changed:       { label: "Payment Status Changed",    color: "text-yellow-400",        dot: "bg-yellow-400" },
  user_signup:                  { label: "New Signup",                color: "text-muted-foreground",  dot: "bg-muted-foreground" },
};

const ACTION_FILTER_OPTIONS = [
  { value: "all",                       label: "All Events" },
  { value: "user_signup",               label: "New Signups" },
  { value: "roles_updated",             label: "Role Changes" },
  { value: "subscription_tier_changed", label: "Tier Changes" },
  { value: "coach_reassigned",          label: "Coach Reassignments" },
  { value: "user_disabled",             label: "Disabled" },
  { value: "user_activated",            label: "Activated" },
  { value: "user_deleted",              label: "Deleted" },
  { value: "coach_invite_sent",         label: "Coach Invites Sent" },
  { value: "coach_invite_accepted",     label: "Coach Invites Accepted" },
  { value: "client_invite_sent",        label: "Client Invites Sent" },
  { value: "client_invite_accepted",    label: "Client Invites Accepted" },
  { value: "offline_payment_created",   label: "Offline Payments Recorded" },
  { value: "offline_payment_confirmed", label: "Offline Payments Confirmed" },
  { value: "offline_payment_rejected",  label: "Offline Payments Rejected" },
  { value: "payment_status_changed",    label: "Payment Status Changes" },
] as const;

function AuditLogTab() {
  const logs = useQuery(api.users.listAuditLogs, {});
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  if (logs === undefined) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <History className="w-8 h-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No activity logged yet.</p>
        <p className="text-xs mt-1">User and role changes will appear here.</p>
      </div>
    );
  }

  const filtered = logs.filter((log) => {
    const matchesAction = actionFilter === "all" || log.action === actionFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (log.actorEmail ?? "").toLowerCase().includes(q) ||
      (log.targetEmail ?? "").toLowerCase().includes(q) ||
      (log.details ?? "").toLowerCase().includes(q);
    return matchesAction && matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {filtered.length} of {logs.length} events
        </span>
        <span className="text-xs text-muted-foreground">Last 100 events</span>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {ACTION_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.value === "all"
              ? logs.length
              : logs.filter((l) => l.action === opt.value).length;
          if (opt.value !== "all" && count === 0) return null;
          return (
            <button
              key={opt.value}
              onClick={() => setActionFilter(opt.value)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                actionFilter === opt.value
                  ? "bg-foreground text-background border-foreground"
                  : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
              }`}
            >
              {opt.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by email or details…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground text-sm">
          No events match your filter.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => {
            const meta = ACTION_LABELS[log.action] ?? {
              label: log.action,
              color: "text-foreground",
              dot: "bg-muted-foreground",
            };
            return (
              <div
                key={log._id}
                className="flex items-start gap-3 px-4 py-3 rounded-xl bg-card/60 border border-border"
              >
                <div className={`w-2 h-2 rounded-full ${meta.dot} mt-2 shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold ${meta.color}`}>
                      {meta.label}
                    </span>
                    {log.targetEmail && log.targetEmail !== log.actorEmail && (
                      <>
                        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground truncate">
                          {log.targetEmail}
                        </span>
                      </>
                    )}
                  </div>
                  {log.details && (
                    <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    By {log.actorEmail ?? "Unknown"} ·{" "}
                    {format(new Date(log.timestamp), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Support Inbox Tab ────────────────────────────────────────────────────────

type SupportTicket = Doc<"supportTickets">;

const TICKET_STATUS_BADGE: Record<
  SupportTicket["status"],
  { label: string; cls: string }
> = {
  open: { label: "Open", cls: "bg-blue-500/15 text-blue-400 border border-blue-500/30" },
  replied: { label: "Replied", cls: "bg-green-500/15 text-green-400 border border-green-500/30" },
  closed: { label: "Closed", cls: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30" },
};

function AdminTicketRow({ ticket }: { ticket: SupportTicket }) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const replyMutation = useMutation(api.supportTickets.replyToTicket);
  const closeMutation = useMutation(api.supportTickets.closeTicket);
  const reopenMutation = useMutation(api.supportTickets.reopenTicket);
  const badge = TICKET_STATUS_BADGE[ticket.status];

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      await replyMutation({ ticketId: ticket._id, message: replyText.trim() });
      toast.success("Reply sent to user.");
      setReplyText("");
    } catch {
      toast.error("Failed to send reply.");
    } finally {
      setReplying(false);
    }
  };

  const handleClose = async () => {
    try {
      await closeMutation({ ticketId: ticket._id });
      toast.success("Ticket closed.");
    } catch {
      toast.error("Failed to close ticket.");
    }
  };

  const handleReopen = async () => {
    try {
      await reopenMutation({ ticketId: ticket._id });
      toast.success("Ticket reopened.");
    } catch {
      toast.error("Failed to reopen ticket.");
    }
  };

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      {/* Row header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/5 transition-colors cursor-pointer"
      >
        <MessageSquare className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{ticket.subject}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {ticket.userName ?? ticket.userEmail} &middot;{" "}
            <span className="text-zinc-600">{ticket.subscriptionTier}</span> &middot;{" "}
            {new Date(ticket.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-zinc-800">
          {/* User info */}
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <div className="bg-zinc-900/60 rounded-lg p-2">
              <span className="text-zinc-600 block">Email</span>
              <span className="text-zinc-300">{ticket.userEmail}</span>
            </div>
            <div className="bg-zinc-900/60 rounded-lg p-2">
              <span className="text-zinc-600 block">Device</span>
              <span className="text-zinc-300">{ticket.deviceInfo ?? "—"}</span>
            </div>
          </div>

          {/* Original message */}
          <div className="bg-zinc-900/60 rounded-lg p-3">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">User Message</p>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{ticket.message}</p>
          </div>

          {/* Replies */}
          {ticket.replies.map((reply, i) => (
            <div
              key={i}
              className="bg-[#0d1a2e] border border-[#1e3a5f] border-l-2 border-l-[#4169E1] rounded-lg p-3"
            >
              <p className="text-xs text-[#4169E1] mb-1 uppercase tracking-wider">
                {reply.adminName ?? "Admin"} &middot;{" "}
                {new Date(reply.sentAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">{reply.message}</p>
            </div>
          ))}

          {/* Reply box */}
          {ticket.status !== "closed" && (
            <div className="space-y-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply..."
                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 text-sm resize-none min-h-[80px]"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleReply}
                  disabled={replying || !replyText.trim()}
                  className="bg-[#4169E1] hover:bg-[#3055c8] text-white cursor-pointer"
                >
                  {replying ? "Sending..." : "Send Reply"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClose}
                  className="text-zinc-400 hover:text-white border border-zinc-700 cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
                  Close Ticket
                </Button>
              </div>
            </div>
          )}

          {ticket.status === "closed" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReopen}
              className="text-zinc-400 hover:text-white border border-zinc-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reopen Ticket
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SupportInboxTab() {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "open" | "replied" | "closed"
  >("all");

  const tickets = useQuery(api.supportTickets.listAllTickets, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const openCount = useQuery(api.supportTickets.listAllTickets, { status: "open" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Support Inbox</h3>
          {openCount !== undefined && openCount.length > 0 && (
            <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {openCount.length} open
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(["all", "open", "replied", "closed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium capitalize cursor-pointer transition-colors ${
                statusFilter === s
                  ? "bg-[#4169E1] text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {tickets === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl p-10 text-center">
          <MessageSquare className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm font-medium">No tickets</p>
          <p className="text-zinc-600 text-xs mt-1">
            {statusFilter === "all"
              ? "No support tickets have been submitted yet."
              : `No ${statusFilter} tickets.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <AdminTicketRow key={t._id} ticket={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────

function OwnerPageInner() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const { isOwner } = useRoles();

  if (currentUser === undefined) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-xl font-bold mb-2">Owner Access Only</h2>
          <p className="text-muted-foreground text-sm">
            This section is restricted to the Owner account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-purple-500/10 rounded-xl">
            <Crown className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Owner Control Panel</h1>
            <p className="text-sm text-muted-foreground">
              Full user and role management for GOAT WALK
            </p>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <Tabs defaultValue="users">
          <TabsList className="mb-6">
            <TabsTrigger value="users" className="cursor-pointer gap-2">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="invites" className="cursor-pointer gap-2">
              <MailPlus className="w-4 h-4" />
              Invites
            </TabsTrigger>
            <TabsTrigger value="payments" className="cursor-pointer gap-2">
              <Banknote className="w-4 h-4" />
              Offline Payments
            </TabsTrigger>
            <TabsTrigger value="support" className="cursor-pointer gap-2">
              <MessageSquare className="w-4 h-4" />
              Support
            </TabsTrigger>
            <TabsTrigger value="email" className="cursor-pointer gap-2">
              <Mail className="w-4 h-4" />
              Business Email
            </TabsTrigger>
            <TabsTrigger value="audit" className="cursor-pointer gap-2">
              <History className="w-4 h-4" />
              Audit Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <UsersTab currentUserId={currentUser!._id as Id<"users">} />
          </TabsContent>

          <TabsContent value="invites">
            <InvitesTab />
          </TabsContent>

          <TabsContent value="payments">
            <OfflinePaymentsTab />
          </TabsContent>

          <TabsContent value="support">
            <SupportInboxTab />
          </TabsContent>

          <TabsContent value="email">
            <BusinessEmailTab />
          </TabsContent>

          <TabsContent value="audit">
            <AuditLogTab />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}

export default function OwnerPage() {
  return (
    <>
      <Unauthenticated>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">Sign in to continue</p>
          <SignInButton />
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="max-w-3xl mx-auto px-4 py-8">
          <Skeleton className="h-64 w-full" />
        </div>
      </AuthLoading>
      <Authenticated>
        <OwnerPageInner />
      </Authenticated>
    </>
  );
}
