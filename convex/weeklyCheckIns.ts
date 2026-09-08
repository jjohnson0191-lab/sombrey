import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Returns all check-ins for the current user, newest first */
export const listMyCheckIns = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];
    const checkIns = await ctx.db
      .query("weeklyCheckIns")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    // Resolve photo URLs
    return Promise.all(
      checkIns.map(async (c) => ({
        ...c,
        frontPhotoUrl: c.frontPhotoStorageId ? await ctx.storage.getUrl(c.frontPhotoStorageId) : null,
        sidePhotoUrl: c.sidePhotoStorageId ? await ctx.storage.getUrl(c.sidePhotoStorageId) : null,
        backPhotoUrl: c.backPhotoStorageId ? await ctx.storage.getUrl(c.backPhotoStorageId) : null,
      }))
    );
  },
});

/** Returns the most recent check-in */
export const getLatestCheckIn = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    const c = await ctx.db
      .query("weeklyCheckIns")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (!c) return null;
    return {
      ...c,
      frontPhotoUrl: c.frontPhotoStorageId ? await ctx.storage.getUrl(c.frontPhotoStorageId) : null,
      sidePhotoUrl: c.sidePhotoStorageId ? await ctx.storage.getUrl(c.sidePhotoStorageId) : null,
      backPhotoUrl: c.backPhotoStorageId ? await ctx.storage.getUrl(c.backPhotoStorageId) : null,
    };
  },
});

/** Returns AI plan current week number (calculated from startDate) */
export const getPlanProgress = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (!plan || plan.status !== "ready") return null;

    const now = new Date();
    const startDate = plan.startDate ? new Date(plan.startDate) : null;
    const currentWeek = startDate
      ? Math.min(12, Math.max(1, Math.ceil((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))))
      : 1;

    // Check for initial check-in (baseline before plan is revealed)
    const allCheckIns = await ctx.db
      .query("weeklyCheckIns")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const hasInitialCheckIn = allCheckIns.some((c) => c.isInitialCheckIn === true);

    // Next check-in = 7 days after last non-initial check-in, or now if none
    const nonInitialCheckIns = allCheckIns.filter((c) => !c.isInitialCheckIn);
    const lastCheckIn = nonInitialCheckIns[0] ?? null;

    const nextCheckInDate = lastCheckIn
      ? new Date(new Date(lastCheckIn.submittedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : now.toISOString().slice(0, 10);

    const daysUntilCheckIn = Math.max(
      0,
      Math.ceil((new Date(nextCheckInDate).getTime() - new Date(now.toISOString().slice(0, 10)).getTime()) / (24 * 60 * 60 * 1000))
    );

    // Has the user already submitted a check-in for the current week?
    const currentWeekCheckIn = allCheckIns.find(
      (c) => c.weekNumber === currentWeek && !c.isInitialCheckIn
    );

    return {
      planId: plan._id,
      currentWeek,
      totalWeeks: 12,
      startDate: plan.startDate ?? null,
      endDate: plan.endDate ?? null,
      primaryGoal: plan.primaryGoal,
      nextCheckInDate,
      daysUntilCheckIn,
      checkInDue: daysUntilCheckIn === 0,
      lastCheckInWeek: lastCheckIn?.weekNumber ?? null,
      hasInitialCheckIn,
      currentWeekCheckInDone: !!currentWeekCheckIn,
      // Locked if current week > 1 AND previous week check-in not yet submitted
      isLocked: currentWeek > 1 && !lastCheckIn && !hasInitialCheckIn
        ? false
        : currentWeek > 1 && (lastCheckIn?.weekNumber ?? 0) < currentWeek - 1,
    };
  },
});

/** Check onboarding + initial check-in status for flow gating */
export const getOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const onboarding = await ctx.db
      .query("premiumOnboarding")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const initialCheckIn = await ctx.db
      .query("weeklyCheckIns")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc")
      .first();
    const hasInitialCheckIn = initialCheckIn?.isInitialCheckIn === true;

    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    return {
      hasOnboarding: !!onboarding,
      hasInitialCheckIn,
      planStatus: plan?.status ?? null,
    };
  },
});

/** Generate a signed upload URL for progress photos */
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    return ctx.storage.generateUploadUrl();
  },
});

/** Submit a weekly check-in */
export const submitCheckIn = mutation({
  args: {
    weekNumber: v.number(),
    weightKg: v.number(),
    waistCm: v.optional(v.number()),
    chestCm: v.optional(v.number()),
    armsCm: v.optional(v.number()),
    legsCm: v.optional(v.number()),
    shouldersCm: v.optional(v.number()),
    energyLevel: v.number(),
    sleepQuality: v.number(),
    recoveryScore: v.number(),
    hungerLevel: v.number(),
    strengthChange: v.union(
      v.literal("decreased"),
      v.literal("same"),
      v.literal("increased"),
    ),
    frontPhotoStorageId: v.optional(v.id("_storage")),
    sidePhotoStorageId: v.optional(v.id("_storage")),
    backPhotoStorageId: v.optional(v.id("_storage")),
    challenges: v.optional(v.string()),
    notes: v.optional(v.string()),
    isInitialCheckIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"weeklyCheckIns">> => {
    const user = await requireAuthUser(ctx);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Get linked AI plan
    const plan = await ctx.db
      .query("aiGeneratedPlans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    const checkInId = await ctx.db.insert("weeklyCheckIns", {
      userId: user._id,
      planId: plan?._id,
      checkInDate: today,
      submittedAt: now,
      aiAssessmentStatus: "pending",
      ...args,
    });

    // Update user's weight
    await ctx.db.patch(user._id, { weightKg: args.weightKg });

    // Queue AI assessment (includes body composition analysis if photos present)
    await ctx.scheduler.runAfter(0, internal.ai.checkInAssessor.assessCheckIn, {
      checkInId,
      userId: user._id,
      planId: plan?._id ?? null,
    });

    return checkInId;
  },
});

/** Internal: store AI assessment result on a check-in */
export const saveAssessment = internalMutation({
  args: {
    checkInId: v.id("weeklyCheckIns"),
    assessment: v.string(),
    estimatedBodyFatPct: v.optional(v.number()),
    estimatedBMI: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkInId, {
      aiAssessment: args.assessment,
      aiAssessmentStatus: "done",
      ...(args.estimatedBodyFatPct !== undefined ? { estimatedBodyFatPct: args.estimatedBodyFatPct } : {}),
      ...(args.estimatedBMI !== undefined ? { estimatedBMI: args.estimatedBMI } : {}),
    });
  },
});

export const markAssessmentError = internalMutation({
  args: { checkInId: v.id("weeklyCheckIns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.checkInId, { aiAssessmentStatus: "error" });
  },
});

/** Set start date on the AI plan (called when user activates 12-week program) */
export const startPlan = mutation({
  args: { planId: v.id("aiGeneratedPlans") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.userId !== user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Plan not found" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 84 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await ctx.db.patch(args.planId, { startDate: today, endDate: end, currentWeek: 1 });
  },
});
