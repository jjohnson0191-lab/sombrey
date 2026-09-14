import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery, useMutation } from "convex/react";
import CameraAIDialog from "./_components/camera-ai-dialog.tsx";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import {
  Dumbbell,
  Trophy,
  Target,
  Activity,
  MessageSquare,
  Sparkles,
  Users,
  Camera,
  UtensilsCrossed,
  ClipboardList,
  BarChart3,
  CalendarDays,
  Settings,
  ChevronRight,
  ShoppingBag,
  Zap,
  ArrowRight,
  CheckCircle2,
  Crown,
  Loader2,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth.ts";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import PremiumDashboardContent, { PlanProgressCard, CheckInWidget, LatestCheckInCard, TodayWorkoutCard, NutritionProgressCard, DashboardTopCards } from "./_components/premium-dashboard.tsx";

const PHASE_LABELS: Record<string, string> = {
  metabolic_rewire: "Metabolic Rewire",
  anabolic_surge: "Anabolic Surge",
  body_recode: "Body Recode",
};

type FeatureCard = {
  label: string;
  desc: string;
  icon: React.ReactNode;
  to: string;
  size?: "normal" | "tall";
};

const FEATURE_CARDS: FeatureCard[] = [
  { label: "AI Coach", desc: "Personalized advice", icon: <Sparkles className="w-5 h-5" />, to: "/ai-coach", size: "tall" },
  { label: "Community", desc: "Connect & share", icon: <Users className="w-5 h-5" />, to: "/community" },
  { label: "Messages", desc: "Chat with coach", icon: <MessageSquare className="w-5 h-5" />, to: "/messages" },
  { label: "Exercise Library", desc: "HD video demos", icon: <Dumbbell className="w-5 h-5" />, to: "/exercises", size: "tall" },
  { label: "Meal Plans", desc: "Structured eating", icon: <ClipboardList className="w-5 h-5" />, to: "/nutrition/meal-plans" },
  { label: "Progress Photos", desc: "Track your physique", icon: <Camera className="w-5 h-5" />, to: "/progress" },
  { label: "Analytics", desc: "Performance data", icon: <BarChart3 className="w-5 h-5" />, to: "/progress" },
  { label: "Nutrition Log", desc: "Log your meals", icon: <UtensilsCrossed className="w-5 h-5" />, to: "/nutrition" },
  { label: "Calendar", desc: "Schedule & plan", icon: <CalendarDays className="w-5 h-5" />, to: "/programs", size: "tall" },
  { label: "Settings", desc: "Account & preferences", icon: <Settings className="w-5 h-5" />, to: "/profile" },
  { label: "My Plan", desc: "Subscription & billing", icon: <Trophy className="w-5 h-5" />, to: "/subscription" },
  { label: "Coach Panel", desc: "Manage your clients", icon: <Activity className="w-5 h-5" />, to: "/coach" },
];

const PREMIUM_HIGHLIGHTS = [
  "AI Coach & workout creation",
  "AI macro suggestions",
  "Workout & nutrition tracking",
  "Progress photos & analytics",
];

function StatPill({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xl font-black">{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ─── Free Upgrade CTA ─────────────────────────────────────────────────────────

function FreeUpgradeCTA() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
    >
      <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-primary" />
                <Badge className="bg-primary/15 text-primary border-primary/20 text-[10px] px-1.5 py-0 font-bold uppercase tracking-wider">
                  Upgrade Available
                </Badge>
              </div>
              <h2 className="text-lg font-black tracking-tight">Unlock GOAT WALK Premium</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Everything you need to transform your physique</p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-2xl font-black text-primary">$9.99</span>
              <p className="text-xs text-muted-foreground">/month</p>
            </div>
          </div>

          <ul className="space-y-1.5 mb-4">
            {PREMIUM_HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>

          <Link to="/subscription">
            <Button className="w-full cursor-pointer gap-2 shadow-lg">
              Get Premium Now
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Premium Plan Widget ──────────────────────────────────────────────────────

function AiPlanWidget() {
  const aiPlan = useQuery(api.premiumOnboarding.getMyAiPlan, {});
  const navigate = useNavigate();

  if (aiPlan === undefined) {
    return <Skeleton className="h-28 w-full" />;
  }

  if (!aiPlan || aiPlan.status === "error") {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">AI Plan</p>
            <p className="text-xs text-muted-foreground">No plan yet. Complete your profile to generate one.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate("/onboarding")} className="cursor-pointer shrink-0">
            Setup
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (aiPlan.status === "generating") {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          </div>
          <div>
            <p className="font-semibold text-sm">Generating your AI plan...</p>
            <p className="text-xs text-muted-foreground">This takes about 15-30 seconds. Check back soon.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Plan is ready
  const today = new Date().toLocaleDateString("en", { weekday: "long" });
  const todaySchedule = aiPlan.weeklySchedule.find(
    (s) => s.day.toLowerCase().startsWith(today.toLowerCase().slice(0, 3))
  );

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Crown className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">AI Plan Active</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Today</p>
            <p className="font-bold text-sm">{todaySchedule?.type ?? "Rest Day"}</p>
            {todaySchedule?.focus && <p className="text-xs text-muted-foreground">{todaySchedule.focus}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Daily Calories</p>
            <p className="font-bold text-sm">{aiPlan.macroTargets.calories} kcal</p>
            <p className="text-xs text-muted-foreground">{aiPlan.macroTargets.protein}g protein</p>
          </div>
        </div>
        <Link to="/ai-plan" className="block mt-3">
          <Button size="sm" variant="secondary" className="w-full cursor-pointer gap-1.5 text-xs">
            View Full Plan
            <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

// ─── Premium Onboarding Prompt ────────────────────────────────────────────────

function PremiumOnboardingPrompt() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
    >
      <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-black text-base">Set up your AI plan</h2>
              <p className="text-xs text-muted-foreground">Answer a few questions to generate your personalized program</p>
            </div>
          </div>
          <Link to="/onboarding">
            <Button className="w-full cursor-pointer gap-2">
              Get Started — 2 min
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Free User Dashboard ──────────────────────────────────────────────────────

function FreeDashboardContent() {
  const { user } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const displayName = currentUser?.name || user?.profile.name || "Athlete";
  const firstName = displayName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (currentUser === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-4 space-y-6">
      {/* Greeting */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm uppercase tracking-widest mb-0.5">
              {format(new Date(), "EEE, MMM d")}
            </p>
            <h1 className="text-3xl font-black tracking-tight">
              {greeting}, {firstName}
            </h1>
          </div>
          <Link to="/profile" className="cursor-pointer shrink-0">
            {currentUser?.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={displayName} className="w-12 h-12 rounded-full object-cover border-2 border-border hover:border-foreground transition-colors" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-muted border-2 border-border flex items-center justify-center hover:border-foreground transition-colors">
                <span className="text-lg font-black text-muted-foreground">{displayName[0]?.toUpperCase() ?? "?"}</span>
              </div>
            )}
          </Link>
        </div>
      </motion.div>

      {/* Top summary cards — same across all dashboards */}
      <DashboardTopCards />

      {/* Upgrade CTA */}
      <FreeUpgradeCTA />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.2 }}>
        <Link to="/store" className="block cursor-pointer group">
          <Card className="border-border bg-card overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-stretch min-h-[120px]">
                <div className="flex-1 p-5 flex flex-col justify-between">
                  <div>
                    <Badge className="bg-foreground text-background text-[10px] px-2 py-0.5 mb-3 font-semibold uppercase tracking-wider">New Drop</Badge>
                    <h2 className="text-xl font-black tracking-tight leading-tight">GOAT WALK</h2>
                    <h2 className="text-xl font-black tracking-tight leading-tight text-muted-foreground">Store</h2>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-medium group-hover:gap-2 transition-all">
                    <span>Shop now</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
                <div className="w-32 bg-muted/30 flex items-center justify-center border-l border-border">
                  <ShoppingBag className="w-12 h-12 text-muted-foreground/40" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </motion.div>

      {/* Community quick links */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.25 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Explore</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Community", desc: "Connect & share", icon: <Users className="w-5 h-5" />, to: "/community" },
            { label: "Store", desc: "Shop drops", icon: <ShoppingBag className="w-5 h-5" />, to: "/store" },
          ].map((card) => (
            <Link key={card.label} to={card.to} className="cursor-pointer block group">
              <Card className="border-border bg-card hover:bg-muted/20 transition-colors">
                <CardContent className="p-4 flex flex-col gap-3 min-h-[90px]">
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                    {card.icon}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{card.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{card.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Premium Dashboard → imported from _components/premium-dashboard.tsx ──────

// (PremiumDashboardContent is now a tabbed experience imported above)

// ─── Staff / Owner / Admin / Coach Dashboard ─────────────────────────────────

type StaffRole = "owner" | "admin" | "coach" | "assistant_coach" | "store_manager";

type PanelItem = { label: string; desc: string; icon: React.ReactNode; to: string };

const OWNER_PANELS: PanelItem[] = [
  { label: "Coaching Panel", desc: "Manage clients & plans", icon: <Users className="w-5 h-5" />, to: "/coach" },
  { label: "Coaching Subscriptions", desc: "View & manage billing", icon: <Trophy className="w-5 h-5" />, to: "/coaching-subscriptions" },
  { label: "Store Orders", desc: "Fulfillment & shipping", icon: <ShoppingBag className="w-5 h-5" />, to: "/store/orders" },
  { label: "Business Analytics", desc: "Revenue & growth metrics", icon: <BarChart3 className="w-5 h-5" />, to: "/bi" },
  { label: "Role Management", desc: "Users, roles & permissions", icon: <Activity className="w-5 h-5" />, to: "/owner" },
  { label: "Store Admin", desc: "Products & inventory", icon: <Zap className="w-5 h-5" />, to: "/store/admin" },
];

const ADMIN_PANELS: PanelItem[] = [
  { label: "Role Management", desc: "Users, roles & permissions", icon: <Activity className="w-5 h-5" />, to: "/owner" },
  { label: "Store Orders", desc: "Fulfillment & shipping", icon: <ShoppingBag className="w-5 h-5" />, to: "/store/orders" },
  { label: "Coaching Subscriptions", desc: "View & manage billing", icon: <Trophy className="w-5 h-5" />, to: "/coaching-subscriptions" },
  { label: "Business Analytics", desc: "Revenue & growth metrics", icon: <BarChart3 className="w-5 h-5" />, to: "/bi" },
  { label: "Coaching Panel", desc: "Manage clients & plans", icon: <Users className="w-5 h-5" />, to: "/coach" },
  { label: "Store Admin", desc: "Products & inventory", icon: <Zap className="w-5 h-5" />, to: "/store/admin" },
];

const COACH_PANELS: PanelItem[] = [
  { label: "Coaching Panel", desc: "Manage clients & plans", icon: <Users className="w-5 h-5" />, to: "/coach" },
  { label: "Coaching Subscriptions", desc: "Client billing", icon: <Trophy className="w-5 h-5" />, to: "/coaching-subscriptions" },
  { label: "AI Coach", desc: "Personalized advice", icon: <Sparkles className="w-5 h-5" />, to: "/ai-coach" },
  { label: "Programs", desc: "Build programs", icon: <Dumbbell className="w-5 h-5" />, to: "/programs" },
  { label: "Community", desc: "Connect & share", icon: <Zap className="w-5 h-5" />, to: "/community" },
  { label: "Messages", desc: "Chat with clients", icon: <MessageSquare className="w-5 h-5" />, to: "/messages" },
];

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  admin: { label: "Admin", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  coach: { label: "Coach", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  assistant_coach: { label: "Asst. Coach", className: "bg-green-500/15 text-green-400 border-green-500/20" },
  store_manager: { label: "Store Mgr", className: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

function StaffDashboardContent({ role }: { role: StaffRole }) {
  const { user } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser, {});

  const displayName = currentUser?.name ?? user?.profile.name ?? "User";
  const firstName = displayName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const panels =
    role === "owner" ? OWNER_PANELS :
    role === "admin" ? ADMIN_PANELS :
    COACH_PANELS;

  const badge = ROLE_BADGE[role];

  if (currentUser === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-16 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-4 space-y-6">
      {/* Greeting + role badge */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-muted-foreground text-xs uppercase tracking-widest">
                {format(new Date(), "EEE, MMM d")}
              </p>
              {badge && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.className}`}>
                  {badge.label}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-black tracking-tight">
              {greeting}, {firstName}
            </h1>
          </div>
          <Link to="/profile" className="cursor-pointer shrink-0">
            {currentUser?.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={displayName} className="w-12 h-12 rounded-full object-cover border-2 border-border hover:border-foreground transition-colors" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-muted border-2 border-border flex items-center justify-center hover:border-foreground transition-colors">
                <span className="text-lg font-black text-muted-foreground">{displayName[0]?.toUpperCase() ?? "?"}</span>
              </div>
            )}
          </Link>
        </div>
      </motion.div>

      {/* Top summary cards — same across all dashboards */}
      <DashboardTopCards />

      {/* Panels grid */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Management</h2>
        <div className="grid grid-cols-2 gap-3">
          {panels.map((panel, i) => (
            <motion.div
              key={panel.to}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 + i * 0.04 }}
            >
              <Link to={panel.to} className="cursor-pointer block group">
                <Card className="border-border bg-card hover:bg-muted/20 hover:border-primary/40 transition-all h-full">
                  <CardContent className="p-4 flex flex-col gap-3 min-h-[90px]">
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
                      {panel.icon}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{panel.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{panel.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Quick links */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Quick Access</h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Store", icon: <ShoppingBag className="w-4 h-4" />, to: "/store" },
            { label: "Profile", icon: <Activity className="w-4 h-4" />, to: "/profile" },
            { label: "Subscription", icon: <Trophy className="w-4 h-4" />, to: "/subscription" },
          ].map((item) => (
            <Link key={item.to} to={item.to} className="cursor-pointer block group">
              <Card className="border-border bg-card hover:bg-muted/20 transition-colors">
                <CardContent className="p-3 flex flex-col items-center gap-1.5 text-center">
                  <div className="text-muted-foreground group-hover:text-foreground transition-colors">{item.icon}</div>
                  <p className="text-[11px] font-medium">{item.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Staff + Premium Combined Dashboard (owner/admin with premium) ────────────

function StaffPremiumDashboardContent({ role, hasPremium }: { role: "owner" | "admin"; hasPremium: boolean }) {
  const { user } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const [cameraAIOpen, setCameraAIOpen] = useState(false);
  const panels = role === "owner" ? OWNER_PANELS : ADMIN_PANELS;
  const badge = ROLE_BADGE[role];
  const displayName = currentUser?.name || user?.profile.name || "Athlete";
  const firstName = displayName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (currentUser === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-16 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-4 space-y-6">
      {/* Greeting + role badge */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-muted-foreground text-xs uppercase tracking-widest">
                {format(new Date(), "EEE, MMM d")}
              </p>
              {badge && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.className}`}>
                  {badge.label}
                </span>
              )}
              {hasPremium && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-primary">
                  PREMIUM
                </span>
              )}
            </div>
            <h1 className="text-3xl font-black tracking-tight">
              {greeting}, {firstName}
            </h1>
          </div>
          <Link to="/profile" className="cursor-pointer shrink-0">
            {currentUser?.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={displayName} className="w-12 h-12 rounded-full object-cover border-2 border-border hover:border-foreground transition-colors" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-muted border-2 border-border flex items-center justify-center hover:border-foreground transition-colors">
                <span className="text-lg font-black text-muted-foreground">{displayName[0]?.toUpperCase() ?? "?"}</span>
              </div>
            )}
          </Link>
        </div>
      </motion.div>

      {/* Top summary cards — same across all dashboards */}
      <DashboardTopCards />

      {/* Management Panels */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: hasPremium ? 0.1 : 0.05 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Management</h2>
        <div className="grid grid-cols-2 gap-3">
          {panels.map((panel, i) => (
            <motion.div key={panel.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.1 + i * 0.04 }}>
              <Link to={panel.to} className="cursor-pointer block group">
                <Card className="border-border bg-card hover:bg-muted/20 transition-colors h-full">
                  <CardContent className="p-4 flex flex-col gap-3 min-h-[90px]">
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
                      {panel.icon}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{panel.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{panel.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Premium Feature Quick Links — only when premium */}
      {hasPremium && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Premium Features</h2>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "AI Coach", icon: <Sparkles className="w-4 h-4" />, to: "/ai-coach" },
              { label: "Nutrition", icon: <UtensilsCrossed className="w-4 h-4" />, to: "/nutrition" },
              { label: "Progress", icon: <Camera className="w-4 h-4" />, to: "/progress" },
              { label: "AI Plan", icon: <Activity className="w-4 h-4" />, to: "/ai-plan" },
              { label: "Calendar", icon: <CalendarDays className="w-4 h-4" />, to: "/programs" },
              { label: "Analytics", icon: <BarChart3 className="w-4 h-4" />, to: "/progress" },
            ].map((item) => (
              <Link key={item.label} to={item.to} className="cursor-pointer block group">
                <Card className="border-border bg-card hover:bg-muted/20 transition-colors">
                  <CardContent className="p-3 flex flex-col items-center gap-1.5 text-center">
                    <div className="text-muted-foreground group-hover:text-primary transition-colors">{item.icon}</div>
                    <p className="text-[11px] font-medium">{item.label}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {/* Camera AI — opens dialog directly, no navigation */}
            <button
              onClick={() => setCameraAIOpen(true)}
              className="cursor-pointer block group text-left"
            >
              <Card className="border-border bg-card hover:bg-muted/20 transition-colors h-full">
                <CardContent className="p-3 flex flex-col items-center gap-1.5 text-center">
                  <div className="text-muted-foreground group-hover:text-primary transition-colors">
                    <ScanLine className="w-4 h-4" />
                  </div>
                  <p className="text-[11px] font-medium">AI Macro Calculator</p>
                </CardContent>
              </Card>
            </button>
          </div>
        </motion.div>
      )}

      <CameraAIDialog open={cameraAIOpen} onOpenChange={setCameraAIOpen} />

      {/* Upgrade prompt if no premium */}
      {!hasPremium && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-sm text-primary">Activate Premium Features</p>
                <p className="text-xs text-muted-foreground mt-0.5">Grant yourself access to AI tools, tracking & analytics</p>
              </div>
              <Link to="/subscription">
                <Button size="sm" className="cursor-pointer shrink-0">
                  <Crown className="w-3.5 h-3.5 mr-1.5" />
                  Activate
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Quick links */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.2 }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Quick Access</h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Store", icon: <ShoppingBag className="w-4 h-4" />, to: "/store" },
            { label: "Profile", icon: <Activity className="w-4 h-4" />, to: "/profile" },
            { label: "Subscription", icon: <Trophy className="w-4 h-4" />, to: "/subscription" },
          ].map((item) => (
            <Link key={item.to} to={item.to} className="cursor-pointer block group">
              <Card className="border-border bg-card hover:bg-muted/20 transition-colors">
                <CardContent className="p-3 flex flex-col items-center gap-1.5 text-center">
                  <div className="text-muted-foreground group-hover:text-foreground transition-colors">{item.icon}</div>
                  <p className="text-[11px] font-medium">{item.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function DashboardContent() {
  const currentUser = useQuery(api.users.getCurrentUser, {});

  if (currentUser === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-16 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const coachingType = currentUser?.coachingType as string | undefined;
  const tier = currentUser?.subscriptionTier;
  const hasPremiumTier = tier !== "free" && tier !== undefined;

  // Owner and admin: show the full premium athlete experience by default.
  // Management is accessible via the Management speed key.
  if (coachingType === "owner") {
    return <PremiumDashboardContent showManagement={true} />;
  }
  if (coachingType === "admin") {
    return <PremiumDashboardContent showManagement={true} />;
  }
  if (coachingType === "coach") return <StaffDashboardContent role="coach" />;

  // All client types → unified premium dashboard
  if (coachingType === "ai_coaching_client" || coachingType === "live_1to1_coaching_client") {
    return (
      <PremiumDashboardContent
        coachingType={coachingType as "ai_coaching_client" | "live_1to1_coaching_client"}
        coachName={currentUser?.coachName as string | undefined}
      />
    );
  }

  // Free users
  return <FreeDashboardContent />;
}

export default function Dashboard() {
  return (
    <>
      <div className="max-w-2xl mx-auto">
        <AuthLoading>
          <div className="space-y-4 px-4 pt-6">
            <Skeleton className="h-16 w-48" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
            </div>
          </div>
        </AuthLoading>
        <Unauthenticated>
          <div className="text-center py-20 px-4 space-y-4">
            <h2 className="text-3xl font-black tracking-tight">Sign in to continue</h2>
            <p className="text-muted-foreground">Track your workouts, nutrition, and progress.</p>
            <SignInButton />
          </div>
        </Unauthenticated>
        <Authenticated>
          <DashboardContent />
        </Authenticated>
      </div>
    </>
  );
}
