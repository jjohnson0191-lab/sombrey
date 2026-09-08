import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getCheckIn = internalQuery({
  args: { checkInId: v.id("weeklyCheckIns") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.checkInId);
  },
});

export const getPlan = internalQuery({
  args: { planId: v.id("aiGeneratedPlans") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.planId);
  },
});

export const getStorageUrl = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return ctx.storage.getUrl(args.storageId);
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.userId);
  },
});

/** Returns the initial/baseline check-in for a given user+plan (isInitialCheckIn=true, weekNumber=0) */
export const getBaselineCheckIn = internalQuery({
  args: { userId: v.id("users"), planId: v.id("aiGeneratedPlans") },
  handler: async (ctx, args) => {
    const checkIns = await ctx.db
      .query("weeklyCheckIns")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return checkIns.find(
      (c) => c.planId === args.planId && c.isInitialCheckIn === true
    ) ?? null;
  },
});
