import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useRoles } from "@/hooks/use-roles.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { motion, AnimatePresence } from "motion/react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Users,
  TrendingUp,
  DollarSign,
  Activity,
  UserCheck,
  Zap,
  BarChart2,
  Clock,
  RefreshCw,
  Shield,
  ChevronRight,
  Radio,
  Settings,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  Download,
  Eye,
  EyeOff,
  Globe,
  Megaphone,
  Loader2,
  ShoppingBag,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ConvexError } from "convex/values";

// ─── Types ────────────────────────────────────────────────────────────────────

type DateRange = 7 | 30 | 90;
type Tab = "overview" | "funnel" | "integrations" | "advertising";

type IntegrationDoc = {
  _id: string;
  platform: string;
  pixelId?: string;
  trackingId?: string;
  apiKey?: string;
  apiSecret?: string;
  enabled: boolean;
  notes?: string;
  updatedAt: string;
};

// ─── Platform metadata ────────────────────────────────────────────────────────

type PlatformMeta = {
  id: string;
  name: string;
  icon: string;
  color: string;
  fields: Array<{ key: "pixelId" | "trackingId" | "apiKey" | "apiSecret"; label: string; placeholder: string; secret?: boolean }>;
  description: string;
};

const PLATFORM_META: PlatformMeta[] = [
  {
    id: "meta_pixel",
    name: "Meta Pixel",
    icon: "M",
    color: "#1877f2",
    description: "Track Facebook & Instagram ad conversions",
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "123456789012345" },
      { key: "apiKey", label: "Access Token (optional)", placeholder: "EAABwzLixnjY...", secret: true },
    ],
  },
  {
    id: "meta_conversions_api",
    name: "Meta Conversions API",
    icon: "MA",
    color: "#1877f2",
    description: "Server-side event tracking for Meta",
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "123456789012345" },
      { key: "apiKey", label: "Access Token", placeholder: "EAABwzLixnjY...", secret: true },
      { key: "apiSecret", label: "Test Event Code (optional)", placeholder: "TEST12345" },
    ],
  },
  {
    id: "google_analytics_4",
    name: "Google Analytics 4",
    icon: "GA",
    color: "#f9ab00",
    description: "Website and app analytics",
    fields: [
      { key: "trackingId", label: "Measurement ID", placeholder: "G-XXXXXXXXXX" },
      { key: "apiKey", label: "API Secret (optional)", placeholder: "your_api_secret", secret: true },
    ],
  },
  {
    id: "google_tag_manager",
    name: "Google Tag Manager",
    icon: "GTM",
    color: "#4285f4",
    description: "Manage all tracking tags in one place",
    fields: [
      { key: "trackingId", label: "Container ID", placeholder: "GTM-XXXXXXX" },
    ],
  },
  {
    id: "google_ads",
    name: "Google Ads",
    icon: "Ads",
    color: "#34a853",
    description: "Track Google Ads conversions",
    fields: [
      { key: "trackingId", label: "Conversion ID", placeholder: "AW-XXXXXXXXXX" },
      { key: "pixelId", label: "Conversion Label", placeholder: "xxxxxxxxxxxxxxxx" },
    ],
  },
  {
    id: "tiktok_pixel",
    name: "TikTok Pixel",
    icon: "TT",
    color: "#000",
    description: "Track TikTok ad performance",
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "C4D2XXXXXXXXXX" },
      { key: "apiKey", label: "Access Token (optional)", placeholder: "xxxxxxxx...", secret: true },
    ],
  },
  {
    id: "linkedin_insight",
    name: "LinkedIn Insight Tag",
    icon: "Li",
    color: "#0077b5",
    description: "LinkedIn conversion tracking",
    fields: [
      { key: "pixelId", label: "Partner ID", placeholder: "1234567" },
    ],
  },
  {
    id: "pinterest_tag",
    name: "Pinterest Tag",
    icon: "Pin",
    color: "#e60023",
    description: "Pinterest ads conversion tracking",
    fields: [
      { key: "pixelId", label: "Tag ID", placeholder: "1234567890123" },
    ],
  },
  {
    id: "x_pixel",
    name: "X (Twitter) Pixel",
    icon: "X",
    color: "#000",
    description: "Twitter/X ad conversion tracking",
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "nxxxxx" },
    ],
  },
  {
    id: "snapchat_pixel",
    name: "Snapchat Pixel",
    icon: "Snap",
    color: "#fffc00",
    description: "Snapchat ads conversion tracking",
    fields: [
      { key: "pixelId", label: "Pixel ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "apiKey", label: "Access Token (optional)", placeholder: "...", secret: true },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(a: number, b: number) {
  if (b === 0) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
  delay = 0,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className="relative rounded-2xl border border-white/8 bg-white/3 p-5 overflow-hidden"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-5 pointer-events-none`} />
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-white/5 mb-3 ${
        accent.includes("emerald") ? "text-emerald-400" :
        accent.includes("blue")   ? "text-blue-400" :
        accent.includes("purple") ? "text-purple-400" :
        accent.includes("amber")  ? "text-amber-400" :
        accent.includes("rose")   ? "text-rose-400"  : "text-primary"
      }`}>
        {icon}
      </div>
      <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
      <p className="text-xs text-white/50 mt-1 font-medium uppercase tracking-wider">{label}</p>
      {sub && <p className="text-xs text-white/30 mt-0.5">{sub}</p>}
    </motion.div>
  );
}

function SectionHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/60">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, prefix = "", suffix = "" }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string; prefix?: string; suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-white/50 mb-1">{label}</p>
      <p className="text-white font-bold">{prefix}{payload[0].value.toLocaleString()}{suffix}</p>
    </div>
  );
}

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  const opts: DateRange[] = [7, 30, 90];
  return (
    <div className="flex gap-1 bg-white/5 rounded-xl p-1">
      {opts.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
            value === d ? "bg-white text-black" : "text-white/50 hover:text-white"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

const TIER_COLORS: Record<string, string> = {
  free:        "#6b7280",
  self_guided: "#3b82f6",
  semi_guided: "#10b981",
  full_guided: "#a855f7",
};
const TIER_LABELS: Record<string, string> = {
  free: "Free", self_guided: "Self Guided", semi_guided: "Semi Guided", full_guided: "Full Guided",
};

const EVENT_LABELS: Record<string, string> = {
  user_signup:               "New Signup",
  roles_updated:             "Role Changed",
  user_disabled:             "User Disabled",
  user_activated:            "User Activated",
  user_deleted:              "User Deleted",
  coach_invite_sent:         "Coach Invite Sent",
  coach_invite_accepted:     "Coach Invite Accepted",
  client_invite_sent:        "Client Invite Sent",
  client_invite_accepted:    "Client Invite Accepted",
  subscription_tier_changed: "Tier Changed",
  coach_reassigned:          "Coach Reassigned",
  offline_payment_created:   "Offline Payment",
  offline_payment_confirmed: "Payment Confirmed",
  offline_payment_rejected:  "Payment Rejected",
  payment_status_changed:    "Payment Status Changed",
};

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ range }: { range: DateRange }) {
  const userStats   = useQuery(api.analytics.getUserStats,         { daysBack: range });
  const regTrend    = useQuery(api.analytics.getRegistrationTrend, { daysBack: range });
  const revenue     = useQuery(api.analytics.getRevenueStats,      { daysBack: range });
  const engagement  = useQuery(api.analytics.getEngagementStats,   { daysBack: range });
  const events      = useQuery(api.analytics.getRecentEvents,       { limit: 20 });
  const storeStats  = useQuery(api.storeOrders.getStoreStats,       { daysBack: range });

  const loading = userStats === undefined || regTrend === undefined || revenue === undefined || engagement === undefined;

  const tierData = userStats
    ? Object.entries(userStats.tierCounts)
        .map(([k, v]) => ({ name: TIER_LABELS[k] ?? k, value: v, color: TIER_COLORS[k] ?? "#6b7280" }))
        .filter((d) => d.value > 0)
    : [];

  // Export CSV
  const handleExport = () => {
    if (!userStats || !revenue) return;
    const rows = [
      ["Metric", "Value"],
      ["Total Users", userStats.totalUsers],
      [`New Users (${range}d)`, userStats.newInPeriod],
      ["Total Clients", userStats.totalClients],
      ["Total Coaches", userStats.totalCoaches],
      ["Active Subscriptions", userStats.activeSubscriptions],
      ["DAU", userStats.dau],
      ["MAU", userStats.mau],
      ["Conversion Rate (%)", userStats.conversionRate],
      [`Period Revenue (${range}d)`, (revenue.periodRevenue / 100).toFixed(2)],
      ["Total Revenue", (revenue.totalRevenue / 100).toFixed(2)],
      ["Avg Payment", (revenue.avgPayment / 100).toFixed(2)],
      [`Workouts (${range}d)`, engagement?.workoutsInPeriod ?? ""],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `goatwalk-analytics-${range}d.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  return (
    <div className="space-y-10">
      {/* KPIs */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30">Overview · Last {range} days</h2>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-xs text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition-all disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl bg-white/5" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Users"         value={userStats!.totalUsers}            icon={<Users className="w-4 h-4" />}       accent="from-blue-500 to-blue-800"       delay={0} />
            <StatCard label={`New (${range}d)`}   value={userStats!.newInPeriod}            icon={<TrendingUp className="w-4 h-4" />}  accent="from-emerald-500 to-emerald-800" delay={0.05} />
            <StatCard label="Total Clients"       value={userStats!.totalClients}           icon={<UserCheck className="w-4 h-4" />}   accent="from-purple-500 to-purple-800"   delay={0.1} />
            <StatCard label="Paid Subs"           value={userStats!.activeSubscriptions}    icon={<Zap className="w-4 h-4" />}         accent="from-amber-500 to-amber-800"     delay={0.15} />
            <StatCard label="DAU"                 value={userStats!.dau}                    icon={<Activity className="w-4 h-4" />}    accent="from-rose-500 to-rose-800"       delay={0.2} sub="Daily Active Users" />
            <StatCard label="MAU"                 value={userStats!.mau}                    icon={<RefreshCw className="w-4 h-4" />}   accent="from-cyan-500 to-cyan-800"       delay={0.25} sub="Monthly Active Users" />
            <StatCard label="Conversion Rate"     value={`${userStats!.conversionRate}%`}   icon={<TrendingUp className="w-4 h-4" />}  accent="from-indigo-500 to-indigo-800"   delay={0.3} sub="Clients → paid" />
            <StatCard label={`Revenue (${range}d)`} value={fmt$(revenue!.periodRevenue)}   icon={<DollarSign className="w-4 h-4" />}  accent="from-emerald-500 to-teal-800"    delay={0.35} sub={`${revenue!.periodPayments} payments`} />
          </div>
        )}
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="New Registrations" sub={`Last ${range} days`} />
          {loading ? <Skeleton className="h-40 bg-white/5 rounded-xl" /> : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={regTrend!} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#regGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <SectionHeader icon={<DollarSign className="w-4 h-4" />} title="Revenue (Offline)" sub={`Last ${range} days`} />
          {loading ? <Skeleton className="h-40 bg-white/5 rounded-xl" /> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={revenue!.trend} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`} />
                <Tooltip content={<ChartTooltip prefix="$" />} formatter={(v: number) => [(v / 100).toFixed(2)]} />
                <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <SectionHeader icon={<Activity className="w-4 h-4" />} title="Workout Activity" sub={`Last ${range} days`} />
          {loading ? <Skeleton className="h-40 bg-white/5 rounded-xl" /> : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={engagement!.workoutTrend} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="woGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip suffix=" workouts" />} />
                <Area type="monotone" dataKey="count" stroke="#a855f7" strokeWidth={2} fill="url(#woGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <SectionHeader icon={<BarChart2 className="w-4 h-4" />} title="Subscription Breakdown" />
          {loading ? <Skeleton className="h-40 bg-white/5 rounded-xl" /> : tierData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-white/30 text-sm">No subscription data yet</div>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={tierData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {tierData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {tierData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-xs text-white/60 flex-1">{d.name}</span>
                    <span className="text-xs font-bold text-white">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </section>

      {/* Engagement */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-5">Engagement · Last {range} days</h2>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl bg-white/5" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Workouts Logged"  value={engagement!.workoutsInPeriod}       icon={<Activity className="w-4 h-4" />}  accent="from-purple-500 to-purple-800" />
            <StatCard label="Nutrition Logs"   value={engagement!.nutritionLogsInPeriod}  icon={<Zap className="w-4 h-4" />}        accent="from-amber-500 to-amber-800" />
            <StatCard label="Community Posts"  value={engagement!.totalCommunityPosts}     icon={<Users className="w-4 h-4" />}      accent="from-blue-500 to-blue-800" />
            <StatCard label="Avg Workout"      value={`${engagement!.avgWorkoutDuration}m`} icon={<Clock className="w-4 h-4" />}   accent="from-rose-500 to-rose-800" />
          </div>
        )}
      </section>

      {/* Revenue breakdown */}
      <section>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <SectionHeader icon={<DollarSign className="w-4 h-4" />} title="Revenue Breakdown" sub="Offline / manual payments" />
          {loading ? <Skeleton className="h-24 bg-white/5 rounded-xl" /> : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "All-time Revenue", value: fmt$(revenue!.totalRevenue),  color: "text-emerald-400" },
                { label: "Bank Transfer",    value: fmt$(revenue!.bankTransfer),  color: "text-blue-400" },
                { label: "Cash",             value: fmt$(revenue!.cash),          color: "text-amber-400" },
                { label: "Avg Payment",      value: fmt$(revenue!.avgPayment),    color: "text-purple-400" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-white/4 p-4 border border-white/5">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-white/40 mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </section>

      {/* Store analytics */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-5">Store · Last {range} days</h2>
        {storeStats === undefined ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl bg-white/5" />)}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label={`Store Revenue (${range}d)`} value={fmt$(storeStats.periodRevenueCents)}   icon={<DollarSign className="w-4 h-4" />}  accent="from-emerald-500 to-teal-800"    delay={0} />
              <StatCard label={`Orders (${range}d)`}        value={storeStats.periodOrders}               icon={<ShoppingBag className="w-4 h-4" />} accent="from-blue-500 to-blue-800"       delay={0.05} />
              <StatCard label="All-time Revenue"            value={fmt$(storeStats.totalRevenueCents)}    icon={<TrendingUp className="w-4 h-4" />}  accent="from-amber-500 to-amber-800"     delay={0.1} />
              <StatCard label="Avg Order Value"             value={fmt$(storeStats.avgOrderCents)}        icon={<Zap className="w-4 h-4" />}         accent="from-purple-500 to-purple-800"   delay={0.15} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Revenue trend */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
                <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Store Revenue Trend" sub={`Last ${range} days`} />
                {storeStats.revenueTrend.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-white/30 text-sm">No sales data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={storeStats.revenueTrend} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`} />
                      <Tooltip content={<ChartTooltip prefix="$" />} formatter={(v: number) => [(v / 100).toFixed(2)]} />
                      <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </motion.div>

              {/* Best sellers */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
                <SectionHeader icon={<BarChart2 className="w-4 h-4" />} title="Best-Selling Products" />
                {storeStats.bestSellers.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-white/30 text-sm">No product data yet</div>
                ) : (
                  <div className="space-y-2">
                    {storeStats.bestSellers.map((p, i) => (
                      <div key={p.name} className="flex items-center gap-3 py-1.5">
                        <span className="w-5 h-5 rounded-full bg-white/5 text-[10px] font-bold text-white/40 flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="flex-1 text-sm text-white/70 truncate">{p.name}</span>
                        <span className="text-xs text-white/40">{p.qty} sold</span>
                        <span className="text-xs font-bold text-emerald-400">{fmt$(p.revenueCents)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </div>

            {/* Order status breakdown */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
              <SectionHeader icon={<ShoppingBag className="w-4 h-4" />} title="Order Status Breakdown" sub="All-time" />
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {(["pending", "processing", "shipped", "delivered", "cancelled"] as const).map((s) => {
                  const count = storeStats.statusCounts[s] ?? 0;
                  const colors: Record<string, string> = { pending: "text-yellow-400", processing: "text-blue-400", shipped: "text-purple-400", delivered: "text-green-400", cancelled: "text-red-400" };
                  return (
                    <div key={s} className="rounded-xl bg-white/4 p-4 border border-white/5 text-center">
                      <p className={`text-xl font-bold ${colors[s]}`}>{count}</p>
                      <p className="text-[10px] text-white/40 mt-1 capitalize">{s}</p>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </section>

      {/* Total business revenue */}
      {revenue !== undefined && storeStats !== undefined && (
        <section>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
            <SectionHeader icon={<DollarSign className="w-4 h-4" />} title="Total Business Revenue" sub="Subscriptions + Store combined" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-white/4 p-4 border border-white/5">
                <p className="text-xl font-bold text-emerald-400">{fmt$(revenue.totalRevenue + storeStats.totalRevenueCents)}</p>
                <p className="text-xs text-white/40 mt-1">Total All-time Revenue</p>
              </div>
              <div className="rounded-xl bg-white/4 p-4 border border-white/5">
                <p className="text-xl font-bold text-blue-400">{fmt$(revenue.totalRevenue)}</p>
                <p className="text-xs text-white/40 mt-1">Subscriptions</p>
              </div>
              <div className="rounded-xl bg-white/4 p-4 border border-white/5">
                <p className="text-xl font-bold text-purple-400">{fmt$(storeStats.totalRevenueCents)}</p>
                <p className="text-xs text-white/40 mt-1">Store Sales</p>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* Recent events */}
      <section>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <SectionHeader icon={<Clock className="w-4 h-4" />} title="Recent Events" sub="Latest activity across the platform" />
          {events === undefined ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 bg-white/5 rounded-xl" />)}</div>
          ) : events.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-8">No events recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {events.map((ev) => (
                <div key={ev._id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/4 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-white">{EVENT_LABELS[ev.action] ?? ev.action}</span>
                    {ev.details && <span className="text-xs text-white/40 ml-2 truncate">{ev.details}</span>}
                  </div>
                  <span className="text-[10px] text-white/30 shrink-0">{format(new Date(ev.timestamp), "MMM d, h:mm a")}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </section>
    </div>
  );
}

// ─── Funnel tab ───────────────────────────────────────────────────────────────

function FunnelTab() {
  const funnel = useQuery(api.analytics.getFunnelStats, {});
  const events = useQuery(api.analytics.getRecentEvents, { limit: 50 });

  return (
    <div className="space-y-8">
      {/* Funnel */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
        <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Customer Journey Funnel" sub="From registration to retention" />
        {funnel === undefined ? (
          <div className="space-y-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 bg-white/5 rounded-xl" />)}</div>
        ) : (
          <div className="space-y-3">
            {funnel.stages.map((stage, i) => {
              const prev  = i > 0 ? funnel.stages[i - 1].value : null;
              const top   = funnel.stages[0].value;
              const pctOfTop = top > 0 ? (stage.value / top) * 100 : 0;
              return (
                <div key={stage.label}>
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-xs text-white/30 w-5 text-center font-bold">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white">{stage.label}</span>
                        <span className="text-[10px] text-white/30">{stage.description}</span>
                        {prev !== null && (
                          <span className="ml-auto text-xs font-bold text-emerald-400">{pct(stage.value, prev)}</span>
                        )}
                        <span className="text-lg font-bold text-white ml-2">{stage.value.toLocaleString()}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pctOfTop}%` }}
                          transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
                          className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400"
                        />
                      </div>
                    </div>
                  </div>
                  {i < funnel.stages.length - 1 && (
                    <div className="ml-8 flex items-center gap-1 py-0.5">
                      <ChevronRight className="w-3 h-3 text-white/15" />
                      {prev !== null && prev > 0 && (
                        <span className="text-[10px] text-white/20">
                          {funnel.stages[i + 1] ? `${Math.round((funnel.stages[i + 1].value / (stage.value || 1)) * 100)}% advance to next stage` : ""}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Full event log */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }} className="rounded-2xl border border-white/8 bg-white/3 p-6">
        <SectionHeader icon={<Clock className="w-4 h-4" />} title="Full Event Log" sub="Last 50 events" />
        {events === undefined ? (
          <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 bg-white/5 rounded-xl" />)}</div>
        ) : (
          <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
            {events.map((ev) => (
              <div key={ev._id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-white/4 transition-colors">
                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white">{EVENT_LABELS[ev.action] ?? ev.action}</p>
                  {ev.actorEmail && <p className="text-[10px] text-white/40">By: {ev.actorEmail}</p>}
                  {ev.details && <p className="text-[10px] text-white/30 mt-0.5">{ev.details}</p>}
                </div>
                <span className="text-[10px] text-white/30 shrink-0 whitespace-nowrap">{format(new Date(ev.timestamp), "MMM d, h:mm a")}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── Integrations tab ─────────────────────────────────────────────────────────

function IntegrationCard({ meta, integration }: { meta: PlatformMeta; integration?: IntegrationDoc }) {
  const [editing, setEditing] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({
    pixelId:    integration?.pixelId    ?? "",
    trackingId: integration?.trackingId ?? "",
    apiKey:     integration?.apiKey     ?? "",
    apiSecret:  integration?.apiSecret  ?? "",
    notes:      integration?.notes      ?? "",
  });
  const [saving, setSaving] = useState(false);

  const upsert  = useMutation(api.marketingIntegrations.upsertIntegration);
  const toggle  = useMutation(api.marketingIntegrations.toggleIntegration);
  const remove  = useMutation(api.marketingIntegrations.deleteIntegration);

  const isConfigured = !!integration;
  const isEnabled    = integration?.enabled ?? false;

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsert({
        platform:   meta.id,
        pixelId:    values.pixelId    || undefined,
        trackingId: values.trackingId || undefined,
        apiKey:     values.apiKey     || undefined,
        apiSecret:  values.apiSecret  || undefined,
        enabled:    true,
        notes:      values.notes      || undefined,
      });
      toast.success(`${meta.name} saved`);
      setEditing(false);
    } catch (err) {
      const msg = err instanceof ConvexError ? (err.data as { message?: string }).message : null;
      toast.error(msg ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    try {
      await toggle({ platform: meta.id, enabled: !isEnabled });
      toast.success(isEnabled ? `${meta.name} disabled` : `${meta.name} enabled`);
    } catch {
      toast.error("Failed to toggle");
    }
  };

  const handleDelete = async () => {
    try {
      await remove({ platform: meta.id });
      toast.success(`${meta.name} removed`);
    } catch {
      toast.error("Failed to remove");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`rounded-2xl border ${isConfigured && isEnabled ? "border-white/15 bg-white/4" : "border-white/6 bg-white/2"} p-5 transition-all`}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-black shrink-0"
          style={{ background: meta.color === "#000" ? "#222" : meta.color + "22", color: meta.color === "#000" || meta.color === "#fffc00" ? "#fff" : meta.color }}
        >
          {meta.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{meta.name}</span>
            {isConfigured ? (
              isEnabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-white/40 border border-white/10">
                  <XCircle className="w-2.5 h-2.5" /> Disabled
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/4 text-white/30 border border-white/8">
                Not configured
              </span>
            )}
          </div>
          <p className="text-xs text-white/40 mt-0.5">{meta.description}</p>
          {isConfigured && !editing && (
            <div className="mt-2 space-y-0.5">
              {meta.fields.map((f) => {
                const val = integration?.[f.key];
                if (!val) return null;
                return (
                  <p key={f.key} className="text-[11px] text-white/30">
                    {f.label}: <span className="text-white/50 font-mono">{f.secret && !showSecrets ? "••••••••" : val}</span>
                  </p>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isConfigured && (
            <button
              onClick={() => setShowSecrets(!showSecrets)}
              className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white cursor-pointer transition-colors"
              title={showSecrets ? "Hide secrets" : "Show secrets"}
            >
              {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white cursor-pointer transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          {isConfigured && (
            <>
              <button
                onClick={() => void handleToggle()}
                className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${isEnabled ? "bg-emerald-500/10 text-emerald-400 hover:bg-red-500/10 hover:text-red-400" : "bg-white/5 text-white/40 hover:text-emerald-400"}`}
                title={isEnabled ? "Disable" : "Enable"}
              >
                <Radio className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => void handleDelete()}
                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-red-400 cursor-pointer transition-colors"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Edit form */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-white/8 space-y-3">
              {meta.fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs text-white/50">{f.label}</Label>
                  <div className="relative">
                    <Input
                      type={f.secret && !showSecrets ? "password" : "text"}
                      placeholder={f.placeholder}
                      value={values[f.key]}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-white/30 pr-10"
                    />
                    {f.secret && (
                      <button
                        type="button"
                        onClick={() => setShowSecrets(!showSecrets)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white cursor-pointer"
                      >
                        {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-xs text-white/50">Notes (optional)</Label>
                <Input
                  placeholder="Internal notes…"
                  value={values.notes}
                  onChange={(e) => setValues({ ...values, notes: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-white/30"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 cursor-pointer bg-white text-black hover:bg-white/90"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Integration"}
                </Button>
                <Button size="sm" variant="secondary" className="cursor-pointer bg-white/5 text-white/60 hover:bg-white/10" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function IntegrationsTab() {
  const integrations = useQuery(api.marketingIntegrations.listIntegrations, {});

  const integrationMap = new Map<string, IntegrationDoc>();
  if (integrations) {
    for (const i of integrations) {
      integrationMap.set(i.platform, i as IntegrationDoc);
    }
  }

  const configured = integrations?.filter((i) => i.enabled).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-white">Marketing Integrations</h2>
          <p className="text-xs text-white/40 mt-0.5">
            Connect your advertising platforms. All credentials are stored securely and visible only to you.
          </p>
        </div>
        <div className="bg-white/5 rounded-xl px-4 py-2 text-center">
          <p className="text-xl font-bold text-white">{configured}</p>
          <p className="text-[10px] text-white/40 uppercase tracking-wider">Active</p>
        </div>
      </div>

      {integrations === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl bg-white/5" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {PLATFORM_META.map((meta) => (
            <IntegrationCard key={meta.id} meta={meta} integration={integrationMap.get(meta.id)} />
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-white/6 bg-white/2 p-4 text-xs text-white/30 space-y-1.5">
        <p className="font-semibold text-white/40 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Security Note</p>
        <p>All API keys, Pixel IDs, and access tokens are stored securely in the GOAT WALK database. They are never exposed to Admins, Coaches, or Clients. Only the Owner account can view or modify these credentials.</p>
      </div>
    </div>
  );
}

// ─── Advertising tab ──────────────────────────────────────────────────────────

type Campaign = {
  id: string;
  name: string;
  platform: string;
  spend: string;
  clicks: string;
  impressions: string;
  conversions: string;
  revenue: string;
};

function AdvertisingTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<Campaign, "id">>({
    name: "", platform: "Meta Ads", spend: "", clicks: "", impressions: "", conversions: "", revenue: "",
  });

  const addCampaign = () => {
    if (!form.name.trim()) { toast.error("Please enter a campaign name"); return; }
    setCampaigns([...campaigns, { ...form, id: crypto.randomUUID() }]);
    setForm({ name: "", platform: "Meta Ads", spend: "", clicks: "", impressions: "", conversions: "", revenue: "" });
    setShowForm(false);
    toast.success("Campaign added");
  };

  const deleteCampaign = (id: string) => {
    setCampaigns(campaigns.filter((c) => c.id !== id));
  };

  const cpc = (c: Campaign) => {
    const s = parseFloat(c.spend) || 0;
    const cl = parseFloat(c.clicks) || 0;
    return cl > 0 ? `$${(s / cl).toFixed(2)}` : "—";
  };
  const cpa = (c: Campaign) => {
    const s = parseFloat(c.spend) || 0;
    const cv = parseFloat(c.conversions) || 0;
    return cv > 0 ? `$${(s / cv).toFixed(2)}` : "—";
  };
  const roas = (c: Campaign) => {
    const s = parseFloat(c.spend) || 0;
    const r = parseFloat(c.revenue) || 0;
    return s > 0 ? `${(r / s).toFixed(2)}x` : "—";
  };
  const ctr = (c: Campaign) => {
    const im = parseFloat(c.impressions) || 0;
    const cl = parseFloat(c.clicks) || 0;
    return im > 0 ? `${((cl / im) * 100).toFixed(2)}%` : "—";
  };

  const exportCSV = () => {
    const headers = ["Campaign", "Platform", "Spend", "Clicks", "Impressions", "Conversions", "Revenue", "CPC", "CPA", "ROAS", "CTR"];
    const rows = campaigns.map((c) => [c.name, c.platform, c.spend, c.clicks, c.impressions, c.conversions, c.revenue, cpc(c), cpa(c), roas(c), ctr(c)]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "goatwalk-campaigns.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const PLATFORMS = ["Meta Ads", "Google Ads", "TikTok Ads", "LinkedIn Ads", "Pinterest Ads", "Snapchat Ads", "X Ads", "YouTube Ads", "Other"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Advertising Performance</h2>
          <p className="text-xs text-white/40 mt-0.5">Manually track campaign metrics. Direct API integrations coming soon.</p>
        </div>
        <div className="flex gap-2">
          {campaigns.length > 0 && (
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-xs text-white/50 hover:text-white cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black text-xs font-semibold cursor-pointer hover:bg-white/90 transition-all"
          >
            <Megaphone className="w-3.5 h-3.5" /> Add Campaign
          </button>
        </div>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-white/15 bg-white/4 p-6 space-y-4">
              <h3 className="text-sm font-semibold text-white">New Campaign</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="col-span-2 md:col-span-1 space-y-1">
                  <Label className="text-xs text-white/50">Campaign Name</Label>
                  <Input placeholder="Summer Sale 2025" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-white/50">Platform</Label>
                  <select
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="w-full h-9 rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 cursor-pointer"
                  >
                    {PLATFORMS.map((p) => <option key={p} value={p} className="bg-[#111]">{p}</option>)}
                  </select>
                </div>
                {(["spend", "clicks", "impressions", "conversions", "revenue"] as const).map((f) => (
                  <div key={f} className="space-y-1">
                    <Label className="text-xs text-white/50 capitalize">{f}</Label>
                    <Input type="number" placeholder="0" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="cursor-pointer bg-white text-black hover:bg-white/90" onClick={addCampaign}>Add Campaign</Button>
                <Button size="sm" variant="secondary" className="cursor-pointer bg-white/5 text-white/60 hover:bg-white/10" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Campaign table */}
      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-white/6 bg-white/2 p-16 text-center">
          <Megaphone className="w-10 h-10 text-white/15 mx-auto mb-3" />
          <p className="text-white/40 text-sm">No campaigns tracked yet.</p>
          <p className="text-white/25 text-xs mt-1">Add your first campaign to start tracking performance metrics.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8">
                {["Campaign", "Platform", "Spend", "Clicks", "Impr.", "Conv.", "Revenue", "CPC", "CPA", "ROAS", "CTR", ""].map((h) => (
                  <th key={h} className="text-left text-white/30 font-semibold py-2 px-3 uppercase tracking-wider text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="py-3 px-3 font-semibold text-white">{c.name}</td>
                  <td className="py-3 px-3 text-white/50">{c.platform}</td>
                  <td className="py-3 px-3 text-white/70">${c.spend || "0"}</td>
                  <td className="py-3 px-3 text-white/70">{c.clicks || "0"}</td>
                  <td className="py-3 px-3 text-white/70">{c.impressions || "0"}</td>
                  <td className="py-3 px-3 text-white/70">{c.conversions || "0"}</td>
                  <td className="py-3 px-3 text-white/70">${c.revenue || "0"}</td>
                  <td className="py-3 px-3 text-emerald-400 font-semibold">{cpc(c)}</td>
                  <td className="py-3 px-3 text-blue-400 font-semibold">{cpa(c)}</td>
                  <td className="py-3 px-3 text-purple-400 font-semibold">{roas(c)}</td>
                  <td className="py-3 px-3 text-amber-400 font-semibold">{ctr(c)}</td>
                  <td className="py-3 px-3">
                    <button onClick={() => deleteCampaign(c.id)} className="text-white/20 hover:text-red-400 cursor-pointer transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Traffic sources placeholder */}
      <div className="rounded-2xl border border-white/6 bg-white/2 p-6">
        <SectionHeader icon={<Globe className="w-4 h-4" />} title="Traffic Sources" sub="Coming soon — connect your analytics platforms above to see live data" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {["Organic Search", "Direct", "Meta Ads", "Google Ads", "TikTok", "Instagram", "Email", "Referral"].map((source) => (
            <div key={source} className="rounded-xl bg-white/3 border border-white/5 p-3">
              <p className="text-xs text-white/50">{source}</p>
              <p className="text-lg font-bold text-white/20 mt-1">—</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

function BIDashboardInner() {
  const [range, setRange] = useState<DateRange>(30);
  const [tab, setTab] = useState<Tab>("overview");

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "overview",     label: "Overview",     icon: <BarChart2 className="w-3.5 h-3.5" /> },
    { id: "funnel",       label: "Funnel",        icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "integrations", label: "Integrations",  icon: <Settings className="w-3.5 h-3.5" /> },
    { id: "advertising",  label: "Advertising",   icon: <Megaphone className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Top bar */}
      <div className="border-b border-white/8 px-4 md:px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <BarChart2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">Growth Analytics</h1>
              <p className="text-xs text-white/40">GOAT WALK · Owner only</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {tab === "overview" && <DateRangePicker value={range} onChange={setRange} />}
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-white/40 font-medium">Owner Only</span>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto flex gap-1 mt-4 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all whitespace-nowrap ${
                tab === t.id ? "bg-white text-black" : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {tab === "overview"     && <OverviewTab range={range} />}
            {tab === "funnel"       && <FunnelTab />}
            {tab === "integrations" && <IntegrationsTab />}
            {tab === "advertising"  && <AdvertisingTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Owner gate ───────────────────────────────────────────────────────────────

function OwnerGate() {
  const { isOwner } = useRoles();

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-white/20 mx-auto" />
          <p className="text-white font-semibold">Access Denied</p>
          <p className="text-white/40 text-sm">This dashboard is restricted to the Owner account only.</p>
        </div>
      </div>
    );
  }

  return <BIDashboardInner />;
}

// ─── Page export ─────────────────────────────────────────────────────────────

export default function BIPage() {
  return (
    <>
      <AuthLoading>
        <div className="min-h-screen bg-[#050505] flex items-center justify-center">
          <Skeleton className="w-64 h-8 bg-white/5" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="min-h-screen bg-[#050505] flex items-center justify-center">
          <div className="text-center space-y-4">
            <Shield className="w-12 h-12 text-white/20 mx-auto" />
            <p className="text-white font-semibold">Authentication Required</p>
            <SignInButton />
          </div>
        </div>
      </Unauthenticated>
      <Authenticated>
        <OwnerGate />
      </Authenticated>
    </>
  );
}
