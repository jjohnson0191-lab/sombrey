import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Shield,
  Search,
  ShieldCheck,
  UserCog,
  Store,
  Dumbbell,
  User,
  ChevronDown,
  ChevronUp,
  Crown,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

type AppRole =
  | "client"
  | "coach"
  | "assistant_coach"
  | "store_manager"
  | "admin"
  | "owner";

const ROLES: { value: AppRole; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "owner",
    label: "Owner",
    desc: "Super user — unrestricted access to everything",
    icon: <Crown className="w-4 h-4" />,
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  {
    value: "admin",
    label: "Admin",
    desc: "Full system access — all modules",
    icon: <Shield className="w-4 h-4" />,
    color: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  {
    value: "coach",
    label: "Coach",
    desc: "Manages clients and programs",
    icon: <ShieldCheck className="w-4 h-4" />,
    color: "bg-primary/10 text-primary border-primary/20",
  },
  {
    value: "assistant_coach",
    label: "Assistant Coach",
    desc: "Limited coaching permissions",
    icon: <Dumbbell className="w-4 h-4" />,
    color: "bg-accent/10 text-accent border-accent/20",
  },
  {
    value: "store_manager",
    label: "Store Manager",
    desc: "Access to store management",
    icon: <Store className="w-4 h-4" />,
    color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  },
  {
    value: "client",
    label: "Client",
    desc: "Standard user access",
    icon: <User className="w-4 h-4" />,
    color: "bg-muted text-muted-foreground border-border",
  },
];

function roleMeta(role: AppRole) {
  return ROLES.find((r) => r.value === role) ?? ROLES[ROLES.length - 1];
}

function RolePill({ role }: { role: AppRole }) {
  const meta = roleMeta(role);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.color}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

type UserDoc = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  effectiveRoles?: AppRole[];
  primaryRole?: AppRole;
};

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
      toast.success("Roles updated");
      onOpenChange(false);
    } catch {
      toast.error("Failed to update roles");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Roles</DialogTitle>
          <DialogDescription>
            Assign one or more roles to{" "}
            <strong>{user.name ?? user.email ?? "this user"}</strong>. Permissions are
            additive — access is granted if any assigned role includes it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Label>Select Roles (check all that apply)</Label>

          <div className="space-y-2">
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
                      <svg className="w-3 h-3 text-background" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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

          {selected.length === 0 && (
            <p className="text-xs text-muted-foreground text-center">
              At least one role is required. Client will be assigned by default.
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void handleSave()} className="flex-1 cursor-pointer">
              Save Roles ({selected.length || 1})
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="cursor-pointer">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, isCurrentUser }: { user: UserDoc; isCurrentUser: boolean }) {
  const [open, setOpen] = useState(false);
  const displayName = user.name ?? user.email ?? "Unknown User";
  const roles = user.effectiveRoles ?? ["client"];

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors rounded-lg">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 font-bold text-sm mt-0.5">
          {displayName[0]?.toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{displayName}</span>
            {isCurrentUser && (
              <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border">You</span>
            )}
          </div>
          {user.email && (
            <p className="text-xs text-muted-foreground truncate mb-1.5">{user.email}</p>
          )}
          {/* Role pills */}
          <div className="flex flex-wrap gap-1">
            {roles.map((r) => (
              <RolePill key={r} role={r} />
            ))}
          </div>
        </div>

        {/* Change roles button */}
        {!isCurrentUser && (
          <Button
            size="sm"
            variant="secondary"
            className="cursor-pointer shrink-0 mt-0.5"
            onClick={() => setOpen(true)}
          >
            <UserCog className="w-3 h-3 mr-1" />
            Roles
          </Button>
        )}
      </div>

      {!isCurrentUser && (
        <ChangeRolesDialog user={user} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}

export default function AdminTeamAccess({ currentUserId }: { currentUserId: Id<"users"> }) {
  const users = useQuery(api.users.listAllUsers, {});
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "all">("all");
  const [expanded, setExpanded] = useState(true);

  if (users === undefined) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const filtered = users.filter((u) => {
    const effectiveRoles = (u.effectiveRoles as AppRole[] | undefined) ?? ["client"];
    const matchesSearch =
      ((u.name as string | undefined) ?? "").toLowerCase().includes(search.toLowerCase()) ||
      ((u.email as string | undefined) ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === "all" || effectiveRoles.includes(roleFilter);
    return matchesSearch && matchesRole;
  });

  // Counts per role (a user with multiple roles counts toward each)
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

  const enriched = filtered.map((u) => ({
    ...u,
    effectiveRoles: (u.effectiveRoles as AppRole[] | undefined) ?? ["client"],
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
    >
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <Users className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <CardTitle>Admin &amp; Team Access</CardTitle>
                <CardDescription>{users.length} users · Multi-role management</CardDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="space-y-4">
            {/* Role filter pills */}
            <div className="flex flex-wrap gap-2">
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

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* User list */}
            <div className="space-y-1">
              {enriched.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">No users match your filter.</p>
              ) : (
                enriched.map((u) => (
                  <UserRow key={u._id} user={u} isCurrentUser={u._id === currentUserId} />
                ))
              )}
            </div>

            {/* Role legend */}
            <div className="border-t border-border pt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {ROLES.map((r) => (
                <div key={r.value} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border shrink-0 ${r.color}`}>
                    {r.icon} {r.label}
                  </span>
                  <span>{r.desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </motion.div>
  );
}
