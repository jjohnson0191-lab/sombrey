import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import AdminTeamAccess from "./_components/admin-team-access.tsx";
import ProgramPhasesTab from "./_components/program-phases-tab.tsx";
import FoodLibraryTab from "./_components/food-library-tab.tsx";
import { useRoles } from "@/hooks/use-roles.ts";
import {
  Dumbbell,
  Users,
  Trophy,
  TrendingUp,
  Activity,
  ChevronRight,
  UserPlus,
  ShieldCheck,
  Search,
  Calendar,
  Layers,
  AlertCircle,
  Crown,
  BarChart2,
  Target,
  UtensilsCrossed,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { format, formatDistanceToNow, differenceInYears, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { Progress } from "@/components/ui/progress.tsx";

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  self_guided: "Self-Guided",
  semi_guided: "Semi-Guided",
  full_guided: "Full-Guided",
};

const TIER_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  self_guided: "bg-accent/20 text-accent",
  semi_guided: "bg-primary/20 text-primary",
  full_guided: "bg-yellow-400/20 text-yellow-400",
};

function StatCard({
  label,
  value,
  sub,
  icon,
  colorClass,
  delay,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  colorClass: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
    >
      <Card className="bg-card/50 backdrop-blur border-border h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            <div className={`p-2 rounded-lg ${colorClass}`}>{icon}</div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{value}</div>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function AssignProgramDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
}: {
  clientId: Id<"users">;
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  const programs = useQuery(api.programs.list, {});
  const assign = useMutation(api.assignedPrograms.assign);

  const handleAssign = async () => {
    if (!selectedProgramId) {
      toast.error("Please select a program");
      return;
    }
    try {
      await assign({
        userId: clientId,
        programId: selectedProgramId as Id<"programs">,
        startDate: Date.now(),
      });
      toast.success(`Program assigned to ${clientName}`);
      onOpenChange(false);
      setSelectedProgramId("");
    } catch {
      toast.error("Failed to assign program");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Program</DialogTitle>
          <DialogDescription>
            Assign a training program to <strong>{clientName}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Select Program</Label>
            <Select value={selectedProgramId} onValueChange={setSelectedProgramId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a program…" />
              </SelectTrigger>
              <SelectContent>
                {programs?.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name} — {p.durationWeeks}w
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAssign} className="w-full cursor-pointer">
            Assign Program
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClientRow({
  client,
}: {
  client: {
    _id: Id<"users">;
    name: string;
    email?: string;
    subscriptionTier: string;
    activeProgram: string | null;
    workoutsThisWeek: number;
    lastWorkout: number | null;
    avatarUrl?: string | null;
    dateOfBirth?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
    goalWeightKg?: number | null;
    primaryGoal?: string | null;
    currentPhase?: string | null;
    progressPct?: number | null;
    lastCheckIn?: number | null;
  };
}) {
  const navigate = useNavigate();
  const [assignOpen, setAssignOpen] = useState(false);

  const age = client.dateOfBirth
    ? differenceInYears(new Date(), parseISO(client.dateOfBirth))
    : null;

  return (
    <>
      <div
        className="p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors space-y-3 cursor-pointer"
        onClick={() => navigate(`/coach/clients/${client._id}`)}
      >
        {/* Top row: avatar + name + badges */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center shrink-0">
            {client.avatarUrl ? (
              <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-primary font-bold text-sm">{client.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm truncate">{client.name}</p>
              {age !== null && <span className="text-xs text-muted-foreground">{age} yrs</span>}
              <Badge className={cn("text-[10px]", TIER_COLORS[client.subscriptionTier])}>
                {TIER_LABELS[client.subscriptionTier]}
              </Badge>
            </div>
            {client.email && <p className="text-xs text-muted-foreground truncate">{client.email}</p>}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => { e.stopPropagation(); setAssignOpen(true); }}
            className="cursor-pointer shrink-0"
          >
            <UserPlus className="w-3 h-3 mr-1" />Assign
          </Button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: "Weight", value: client.weightKg ? `${client.weightKg}kg` : "—" },
            { label: "Height", value: client.heightCm ? `${client.heightCm}cm` : "—" },
            { label: "Workouts", value: `${client.workoutsThisWeek}/wk` },
            { label: "Phase", value: client.currentPhase ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-muted/50 px-2 py-1.5">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-xs font-semibold truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Goal + progress */}
        {(client.primaryGoal ?? client.activeProgram) && (
          <div className="space-y-1.5">
            {client.primaryGoal && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Target className="w-3 h-3 shrink-0" />
                <span className="truncate">{client.primaryGoal}</span>
              </p>
            )}
            {client.progressPct !== null && client.progressPct !== undefined && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Goal progress</span>
                  <span>{client.progressPct}%</span>
                </div>
                <Progress value={client.progressPct} className="h-1" />
              </div>
            )}
            {client.lastCheckIn && (
              <p className="text-[10px] text-muted-foreground">
                Last check-in: {formatDistanceToNow(new Date(client.lastCheckIn), { addSuffix: true })}
              </p>
            )}
          </div>
        )}
      </div>

      <AssignProgramDialog
        clientId={client._id}
        clientName={client.name}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
    </>
  );
}

function CoachDashboardContent() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "food_library">("overview");
  const stats = useQuery(api.users.getCoachStats, {});
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const { isOwner } = useRoles();

  if (stats === undefined || currentUser === undefined) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  // Not a coach — show access denied
  if (currentUser && !["coach", "admin", "owner", "assistant_coach"].some(r => (currentUser.effectiveRoles as string[] | undefined)?.includes(r))) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-lg mx-auto text-center py-20 space-y-5"
      >
        <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto">
          <ShieldCheck className="w-12 h-12 text-primary" />
        </div>
        <h2 className="text-2xl font-bold">Coach Access Required</h2>
        <p className="text-muted-foreground">
          This dashboard is for coaches and admins. Contact an administrator to have your role updated.
        </p>
      </motion.div>
    );
  }

  const firstName = (currentUser?.name ?? "Coach").split(" ")[0];
  const filteredClients = (stats?.clients ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/50 pb-0">
        {[
          { id: "overview" as const, label: "Overview", icon: <Users className="w-3.5 h-3.5" /> },
          { id: "food_library" as const, label: "Food Library", icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Food Library tab */}
      {activeTab === "food_library" && (
        <FoodLibraryTab />
      )}

      {/* Overview tab */}
      {activeTab === "overview" && (
      <div className="space-y-8">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-4xl font-bold mb-1">
          Coach {firstName}
        </h1>
        <p className="text-muted-foreground text-lg">
          {format(new Date(), "EEEE, MMMM d")} · Here's your client overview.
        </p>
      </motion.div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Clients"
          value={stats?.totalClients ?? 0}
          sub="Athletes you coach"
          icon={<Users className="w-4 h-4 text-primary" />}
          colorClass="bg-primary/10"
          delay={0.05}
        />
        <StatCard
          label="Active Programs"
          value={stats?.activeAssignments ?? 0}
          sub="Currently running"
          icon={<Activity className="w-4 h-4 text-green-400" />}
          colorClass="bg-green-400/10"
          delay={0.1}
        />
        <StatCard
          label="Your Programs"
          value={stats?.totalPrograms ?? 0}
          sub="Created by you"
          icon={<Layers className="w-4 h-4 text-accent" />}
          colorClass="bg-accent/10"
          delay={0.15}
        />
        <StatCard
          label="Client Workouts"
          value={stats?.totalWorkoutsThisWeek ?? 0}
          sub="Logged this week"
          icon={<Trophy className="w-4 h-4 text-yellow-400" />}
          colorClass="bg-yellow-400/10"
          delay={0.2}
        />
      </div>

      {/* Client list + Recent programs */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Client list — takes 2 cols */}
        <motion.div
          className="md:col-span-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <Card className="bg-card/50 backdrop-blur border-border">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>My Clients</CardTitle>
                    <CardDescription>{stats?.totalClients ?? 0} athletes</CardDescription>
                  </div>
                </div>
              </div>
              {/* Search */}
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              {(stats?.clients ?? []).length === 0 ? (
                <div className="text-center py-10 space-y-3">
                  <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground/40" />
                  <p className="text-muted-foreground text-sm">
                    No clients assigned yet. Clients need to link their account to you.
                  </p>
                </div>
              ) : filteredClients.length === 0 ? (
                <p className="text-center py-6 text-muted-foreground text-sm">No clients match your search.</p>
              ) : (
                <div className="space-y-3">
                  {filteredClients.map((client) => (
                    <ClientRow key={client._id} client={client} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Right column */}
        <motion.div
          className="space-y-6"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          {/* Recent Programs */}
          <Card className="bg-card/50 backdrop-blur border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-accent/10 rounded-lg">
                    <Layers className="w-5 h-5 text-accent" />
                  </div>
                  <CardTitle>Your Programs</CardTitle>
                </div>
                <Button variant="ghost" size="sm" className="cursor-pointer" asChild>
                  <Link to="/programs">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {(stats?.recentPrograms ?? []).length === 0 ? (
                <div className="text-center py-6 space-y-3">
                  <p className="text-muted-foreground text-sm">No programs created yet.</p>
                  <Button size="sm" className="cursor-pointer" asChild>
                    <Link to="/programs/new">Create Program</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats?.recentPrograms.map((program) => (
                    <Link
                      key={program._id}
                      to={`/programs/${program._id}`}
                      className="flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/60 rounded-lg transition-colors group cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{program.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {program.phase.replace(/_/g, " ")} · {program.durationWeeks}w
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="bg-card/50 backdrop-blur border-border">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <CardTitle>Quick Actions</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Create Program", desc: "Build a new training plan", to: "/programs/new", icon: <Layers className="w-4 h-4 text-primary" />, bg: "bg-primary/10" },
                { label: "Training Calendar", desc: "Schedule client workouts", to: "/calendar", icon: <Calendar className="w-4 h-4 text-blue-400" />, bg: "bg-blue-500/10" },
                { label: "Exercise Library", desc: "Manage exercises", to: "/exercises", icon: <Dumbbell className="w-4 h-4 text-accent" />, bg: "bg-accent/10" },
                { label: "All Programs", desc: "View & edit programs", to: "/programs", icon: <Activity className="w-4 h-4 text-chart-3" />, bg: "bg-chart-3/10" },
                ...(isOwner ? [{ label: "Owner Control Panel", desc: "User & role management", to: "/owner", icon: <Crown className="w-4 h-4 text-purple-400" />, bg: "bg-purple-500/10" }] : []),
                ...(isOwner ? [{ label: "Growth Analytics", desc: "Business intelligence dashboard", to: "/bi", icon: <BarChart2 className="w-4 h-4 text-emerald-400" />, bg: "bg-emerald-500/10" }] : []),
              ].map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className="flex items-center gap-3 p-3 bg-muted/30 hover:bg-muted/60 rounded-lg transition-colors group cursor-pointer"
                >
                  <div className={`p-2 rounded-lg ${action.bg} shrink-0`}>{action.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Program Phases — coach / admin */}
      <ProgramPhasesTab />

      {/* Admin & Team Access — admin only */}
      {currentUser && ((currentUser.effectiveRoles as string[] | undefined)?.includes("admin") || (currentUser.effectiveRoles as string[] | undefined)?.includes("owner")) ? (
        <AdminTeamAccess currentUserId={currentUser._id} />
      ) : null}
    </div>
      )}
    </div>
  );
}

export default function CoachDashboard() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
      <AuthLoading>
        <div className="space-y-6">
          <Skeleton className="h-12 w-72" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="text-center py-20 space-y-4">
          <ShieldCheck className="w-16 h-16 text-primary mx-auto" />
          <h2 className="text-3xl font-bold">Sign in to access Coach Dashboard</h2>
          <p className="text-muted-foreground">Manage your clients and training programs.</p>
          <SignInButton />
        </div>
      </Unauthenticated>
      <Authenticated>
        <CoachDashboardContent />
      </Authenticated>
    </div>
  );
}
