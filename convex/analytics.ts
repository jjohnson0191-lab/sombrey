import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { hasRole, getUserRoles } from "./lib/roles.js";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireOwner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user || !hasRole(user, "owner")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Owner only" });
  }
  return user;
}

// ─── User stats ───────────────────────────────────────────────────────────────

export const getUserStats = query({
  args: { daysBack: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);

    const allUsers = await ctx.db.query("users").collect();
    const now = Date.now();
    const cutoff = now - args.daysBack * 24 * 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const totalUsers = allUsers.length;
    const newInPeriod = allUsers.filter((u) => u._creationTime >= cutoff).length;
    const clients = allUsers.filter((u) => getUserRoles(u).includes("client"));
    const coaches = allUsers.filter((u) => getUserRoles(u).includes("coach"));
    const activeSubscriptions = clients.filter((u) => u.subscriptionTier !== "free");

    // Scan all logs for DAU/MAU (compound index needs userId first; full scan is fine for analytics)
    const allLogs = await ctx.db.query("workoutLogs").collect();
    const dauSet = new Set(allLogs.filter((l) => l.completedAt >= oneDayAgo).map((l) => l.userId));
    const mauSet = new Set(allLogs.filter((l) => l.completedAt >= thirtyDaysAgo).map((l) => l.userId));

    // Tier breakdown
    const tierCounts: Record<string, number> = {
      free: 0,
      self_guided: 0,
      semi_guided: 0,
      full_guided: 0,
    };
    for (const u of clients) {
      tierCounts[u.subscriptionTier] = (tierCounts[u.subscriptionTier] ?? 0) + 1;
    }

    const disabledCount = allUsers.filter((u) => u.disabled === true).length;

    return {
      totalUsers,
      newInPeriod,
      totalClients: clients.length,
      totalCoaches: coaches.length,
      activeSubscriptions: activeSubscriptions.length,
      dau: dauSet.size,
      mau: mauSet.size,
      tierCounts,
      disabledCount,
      conversionRate: clients.length > 0
        ? Math.round((activeSubscriptions.length / clients.length) * 100)
        : 0,
    };
  },
});

// ─── Registration trend ───────────────────────────────────────────────────────

export const getRegistrationTrend = query({
  args: { daysBack: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);

    const allUsers = await ctx.db.query("users").collect();
    const now = Date.now();
    const cutoff = now - args.daysBack * 24 * 60 * 60 * 1000;

    const buckets: Record<string, number> = {};
    for (let i = args.daysBack - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      buckets[key] = 0;
    }

    for (const u of allUsers) {
      if (u._creationTime >= cutoff) {
        const d = new Date(u._creationTime);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        if (key in buckets) buckets[key]++;
      }
    }

    return Object.entries(buckets).map(([date, count]) => ({ date, count }));
  },
});

// ─── Revenue stats ────────────────────────────────────────────────────────────

export const getRevenueStats = query({
  args: { daysBack: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);

    const now = Date.now();
    const cutoff = new Date(now - args.daysBack * 24 * 60 * 60 * 1000).toISOString();

    const allPayments = await ctx.db
      .query("offlinePayments")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();

    const inPeriod = allPayments.filter((p) => p.createdAt >= cutoff);

    const totalRevenue = allPayments.reduce((sum, p) => sum + p.amount, 0);
    const periodRevenue = inPeriod.reduce((sum, p) => sum + p.amount, 0);

    const buckets: Record<string, number> = {};
    for (let i = args.daysBack - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      buckets[key] = 0;
    }
    for (const p of inPeriod) {
      const d = new Date(p.createdAt);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      if (key in buckets) buckets[key] += p.amount;
    }

    const bankTransfer = allPayments
      .filter((p) => p.method === "bank_transfer")
      .reduce((sum, p) => sum + p.amount, 0);
    const cash = allPayments
      .filter((p) => p.method === "cash")
      .reduce((sum, p) => sum + p.amount, 0);
    const other = allPayments
      .filter((p) => p.method === "other")
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      totalRevenue,
      periodRevenue,
      totalPayments: allPayments.length,
      periodPayments: inPeriod.length,
      bankTransfer,
      cash,
      other,
      avgPayment: allPayments.length > 0 ? Math.round(totalRevenue / allPayments.length) : 0,
      trend: Object.entries(buckets).map(([date, amount]) => ({ date, amount })),
    };
  },
});

// ─── Engagement stats ─────────────────────────────────────────────────────────

export const getEngagementStats = query({
  args: { daysBack: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);

    const now = Date.now();
    const cutoff = now - args.daysBack * 24 * 60 * 60 * 1000;

    const allWorkoutLogs = await ctx.db.query("workoutLogs").collect();
    const workoutLogs = allWorkoutLogs.filter((l) => l.completedAt >= cutoff);

    const allNutritionLogs = await ctx.db.query("nutritionLogs").collect();
    const nutritionInPeriod = allNutritionLogs.filter((n) => n.date >= cutoff);

    const communityPosts = await ctx.db.query("communityPosts").collect();
    const checkIns = await ctx.db.query("checkIns").collect();

    const woBuckets: Record<string, number> = {};
    for (let i = args.daysBack - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      woBuckets[key] = 0;
    }
    for (const log of workoutLogs) {
      const d = new Date(log.completedAt);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      if (key in woBuckets) woBuckets[key]++;
    }

    return {
      workoutsInPeriod: workoutLogs.length,
      nutritionLogsInPeriod: nutritionInPeriod.length,
      totalCommunityPosts: communityPosts.length,
      totalCheckIns: checkIns.length,
      workoutTrend: Object.entries(woBuckets).map(([date, count]) => ({ date, count })),
      avgWorkoutDuration: workoutLogs.length > 0
        ? Math.round(workoutLogs.reduce((s, l) => s + l.duration, 0) / workoutLogs.length)
        : 0,
    };
  },
});

// ─── Funnel analytics ─────────────────────────────────────────────────────────

export const getFunnelStats = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);

    const allUsers = await ctx.db.query("users").collect();
    const clients = allUsers.filter((u) => getUserRoles(u).includes("client"));
    const paidClients = clients.filter((u) => u.subscriptionTier !== "free");

    const confirmedPayments = await ctx.db
      .query("offlinePayments")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    const usersWithPayment = new Set(confirmedPayments.map((p) => p.userId));
    const activePaid = paidClients.filter(
      (u) => !u.disabled && (u.paymentStatus === "active" || usersWithPayment.has(u._id))
    );

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const allLogs = await ctx.db.query("workoutLogs").collect();
    const retainedUserIds = new Set(
      allLogs.filter((l) => l.completedAt >= thirtyDaysAgo).map((l) => l.userId)
    );
    const retainedClients = activePaid.filter((u) => retainedUserIds.has(u._id));

    const invites = await ctx.db.query("coachInvites").collect();
    const clientInvitesSent = invites.filter((i) => i.inviteType === "client").length;
    const clientInvitesAccepted = invites.filter(
      (i) => i.inviteType === "client" && i.status === "accepted"
    ).length;

    return {
      stages: [
        { label: "Registered Users", value: allUsers.length, description: "All sign-ups" },
        { label: "Clients", value: clients.length, description: "Users with client role" },
        { label: "Invites Sent", value: clientInvitesSent, description: "Client invitations sent" },
        { label: "Invites Accepted", value: clientInvitesAccepted, description: "Invitations completed" },
        { label: "Paid Subscriptions", value: paidClients.length, description: "Non-free tier clients" },
        { label: "Active Clients", value: activePaid.length, description: "Active & paid" },
        { label: "Retained (30d)", value: retainedClients.length, description: "Worked out last 30 days" },
      ],
    };
  },
});

// ─── Recent audit events ──────────────────────────────────────────────────────

export const getRecentEvents = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit);
  },
});
