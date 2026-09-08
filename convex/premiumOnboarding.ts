import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const GOAL_VALIDATOR = v.union(
  v.literal("build_muscle"),
  v.literal("lose_fat"),
  v.literal("recomp"),
);
const SEX_VALIDATOR = v.union(v.literal("male"), v.literal("female"), v.literal("other"));
const EXPERIENCE_VALIDATOR = v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced"));
const GYM_VALIDATOR = v.union(v.literal("full_gym"), v.literal("home_gym"), v.literal("bodyweight"));
const COACHING_STYLE_VALIDATOR = v.union(v.literal("motivational"), v.literal("analytical"), v.literal("balanced"));

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getMyOnboarding = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    return ctx.db.query("premiumOnboarding").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
  },
});

export const getMyAiPlan = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    return ctx.db.query("aiGeneratedPlans").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").first();
  },
});

// Returns AI plan meals formatted for the nutrition tracker display
export const getAiPlanMeals = query({
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
    return {
      planId: plan._id,
      primaryGoal: plan.primaryGoal,
      macroTargets: plan.macroTargets,
      meals: plan.meals,
      coachNotes: plan.coachNotes,
    };
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const saveOnboarding = mutation({
  args: {
    primaryGoal: GOAL_VALIDATOR,
    currentWeightKg: v.number(),
    heightCm: v.number(),
    age: v.number(),
    sex: SEX_VALIDATOR,
    trainingExperience: EXPERIENCE_VALIDATOR,
    trainingDaysPerWeek: v.number(),
    gymAccess: GYM_VALIDATOR,
    dietaryPreference: v.string(),
    allergiesRestrictions: v.optional(v.string()),
    targetWeightKg: v.optional(v.number()),
    preferredSplit: v.optional(v.string()),
    mealsPerDay: v.optional(v.number()),
    coachingStyle: v.optional(COACHING_STYLE_VALIDATOR),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("premiumOnboarding")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    } else {
      await ctx.db.insert("premiumOnboarding", {
        userId: user._id,
        completedAt: now,
        updatedAt: now,
        ...args,
      });
    }

    // Update user weight/height/goal from questionnaire
    await ctx.db.patch(user._id, {
      weightKg: args.currentWeightKg,
      heightCm: args.heightCm,
      ...(args.targetWeightKg ? { goalWeightKg: args.targetWeightKg } : {}),
      ...(!user.startingWeightKg ? { startingWeightKg: args.currentWeightKg } : {}),
    });

    // Kick off AI plan generation
    const planId = await ctx.db.insert("aiGeneratedPlans", {
      userId: user._id,
      primaryGoal: args.primaryGoal,
      workoutSplit: "",
      workoutDays: [],
      macroTargets: { calories: 0, protein: 0, carbs: 0, fats: 0 },
      meals: [],
      weeklySchedule: [],
      generatedAt: now,
      status: "generating",
    });

    await ctx.scheduler.runAfter(0, internal.ai.planGenerator.generatePlanAction, {
      userId: user._id,
      planId,
      onboardingData: args,
    });
  },
});

// ─── Internal mutation to persist AI plan ────────────────────────────────────
export const updateGoalAndRegenerate = mutation({
  args: { primaryGoal: GOAL_VALIDATOR },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const onboarding = await ctx.db
      .query("premiumOnboarding")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!onboarding) throw new ConvexError({ code: "NOT_FOUND", message: "No onboarding data found" });

    const now = new Date().toISOString();
    await ctx.db.patch(onboarding._id, { primaryGoal: args.primaryGoal, updatedAt: now });

    const planId = await ctx.db.insert("aiGeneratedPlans", {
      userId: user._id,
      primaryGoal: args.primaryGoal,
      workoutSplit: "",
      workoutDays: [],
      macroTargets: { calories: 0, protein: 0, carbs: 0, fats: 0 },
      meals: [],
      weeklySchedule: [],
      generatedAt: now,
      status: "generating",
    });

    await ctx.scheduler.runAfter(0, internal.ai.planGenerator.generatePlanAction, {
      userId: user._id,
      planId,
      onboardingData: { ...onboarding, primaryGoal: args.primaryGoal },
    });
  },
});

// ─── Persist partial onboarding progress (step-by-step, no completion) ────────

/**
 * Saves whatever onboarding fields have been collected so far.
 * Called after each step so progress is preserved if the user leaves.
 * Does NOT set onboardingCompleted — that happens in saveOnboarding.
 * All fields are optional so partial saves are safe.
 */
export const saveOnboardingProgress = mutation({
  args: {
    primaryGoal: v.optional(GOAL_VALIDATOR),
    currentWeightKg: v.optional(v.number()),
    heightCm: v.optional(v.number()),
    age: v.optional(v.number()),
    sex: v.optional(SEX_VALIDATOR),
    trainingExperience: v.optional(EXPERIENCE_VALIDATOR),
    trainingDaysPerWeek: v.optional(v.number()),
    gymAccess: v.optional(GYM_VALIDATOR),
    dietaryPreference: v.optional(v.string()),
    allergiesRestrictions: v.optional(v.string()),
    targetWeightKg: v.optional(v.number()),
    preferredSplit: v.optional(v.string()),
    mealsPerDay: v.optional(v.number()),
    coachingStyle: v.optional(COACHING_STYLE_VALIDATOR),
    onboardingStep: v.optional(v.number()),  // last completed step index
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("premiumOnboarding")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    // Build only the provided fields (strip undefineds so we don't overwrite existing data)
    const patch: Record<string, unknown> = { updatedAt: now };
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined) patch[k] = v;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch as Partial<typeof existing>);
    } else {
      // Create a stub row with placeholder required fields — they get filled in later
      await ctx.db.insert("premiumOnboarding", {
        userId: user._id,
        primaryGoal: (args.primaryGoal ?? "build_muscle") as "build_muscle" | "lose_fat" | "recomp",
        currentWeightKg: args.currentWeightKg ?? 0,
        heightCm: args.heightCm ?? 0,
        age: args.age ?? 0,
        sex: (args.sex ?? "other") as "male" | "female" | "other",
        trainingExperience: (args.trainingExperience ?? "beginner") as "beginner" | "intermediate" | "advanced",
        trainingDaysPerWeek: args.trainingDaysPerWeek ?? 4,
        gymAccess: (args.gymAccess ?? "full_gym") as "full_gym" | "home_gym" | "bodyweight",
        dietaryPreference: args.dietaryPreference ?? "Standard",
        mealsPerDay: args.mealsPerDay,
        coachingStyle: args.coachingStyle,
        onboardingStep: args.onboardingStep,
        completedAt: now,
        updatedAt: now,
      });
    }
  },
});

// ─── Internal mutation to persist AI plan ────────────────────────────────────

export const savePlan = internalMutation({
  args: {
    planId: v.id("aiGeneratedPlans"),
    workoutSplit: v.string(),
    workoutDays: v.array(v.object({
      dayName: v.string(),
      exercises: v.array(v.object({
        name: v.string(),
        sets: v.number(),
        reps: v.string(),
        rest: v.optional(v.string()),
        notes: v.optional(v.string()),
      })),
    })),
    macroTargets: v.object({
      calories: v.number(),
      protein: v.number(),
      carbs: v.number(),
      fats: v.number(),
    }),
    meals: v.array(v.object({
      name: v.string(),
      time: v.optional(v.string()),
      calories: v.optional(v.number()),
      suggestions: v.array(v.string()),
    })),
    weeklySchedule: v.array(v.object({
      day: v.string(),
      type: v.string(),
      focus: v.optional(v.string()),
    })),
    coachNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { planId, ...rest } = args;
    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 84 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await ctx.db.patch(planId, { ...rest, status: "ready", startDate: today, endDate, currentWeek: 1 });

    // Send "plan ready" email to user
    const plan = await ctx.db.get(planId);
    if (plan) {
      const user = await ctx.db.get(plan.userId);
      if (user?.email) {
        await ctx.scheduler.runAfter(0, internal.emails.transactional.sendAiPlanReadyEmail, {
          toEmail: user.email,
          name: user.name ?? "Athlete",
          primaryGoal: plan.primaryGoal ?? "Build Muscle",
          weekCount: 12,
        });
      }
    }
  },
});

export const markPlanError = internalMutation({
  args: { planId: v.id("aiGeneratedPlans") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.planId, { status: "error" });
  },
});

// The AI plan generation action lives in convex/ai/planGenerator.ts (Node runtime)

