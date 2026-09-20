import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// QCBand Sport+ activity sessions — the wearable's own physiological/
// activity record, distinct from a sombreyWorkouts row (sets/reps/weight).
// Every value here comes from a real QCBandSDK Sport+ call on the client
// (see apps/ios/Sombrey/Wearable/QCBandSDKService.swift); nothing is
// fabricated.

async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

export const startSession = mutation({
  args: { deviceId: v.string(), sportType: v.number(), startedAt: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db.insert("sportPlusSessions", {
      userId: user._id,
      deviceId: args.deviceId,
      sportType: args.sportType,
      startedAt: args.startedAt,
      source: "sombrey_band",
    });
  },
});

export const finishSession = mutation({
  args: {
    sessionId: v.id("sportPlusSessions"),
    endedAt: v.number(),
    durationSeconds: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
    calories: v.optional(v.number()),
    averageHeartRate: v.optional(v.number()),
    lowestHeartRate: v.optional(v.number()),
    highestHeartRate: v.optional(v.number()),
    averageSpeedMetersPerSecond: v.optional(v.number()),
    steps: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    }
    await ctx.db.patch(args.sessionId, {
      endedAt: args.endedAt,
      durationSeconds: args.durationSeconds,
      distanceMeters: args.distanceMeters,
      calories: args.calories,
      averageHeartRate: args.averageHeartRate,
      lowestHeartRate: args.lowestHeartRate,
      highestHeartRate: args.highestHeartRate,
      averageSpeedMetersPerSecond: args.averageSpeedMetersPerSecond,
      steps: args.steps,
    });
  },
});

export const recordDetail = mutation({
  args: {
    sessionId: v.id("sportPlusSessions"),
    heartRates: v.optional(v.array(v.number())),
    speedsMetersPerSecond: v.optional(v.array(v.number())),
    route: v.optional(v.array(v.object({
      latitude: v.number(),
      longitude: v.number(),
      recordedAt: v.number(),
      altitudeMeters: v.optional(v.number()),
    }))),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    }
    return await ctx.db.insert("sportPlusSessionDetails", {
      sportPlusSessionId: args.sessionId,
      userId: user._id,
      heartRates: args.heartRates,
      speedsMetersPerSecond: args.speedsMetersPerSecond,
      route: args.route,
    });
  },
});

export const getRecentSessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    return await ctx.db
      .query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const getSessionDetail = query({
  args: { sessionId: v.id("sportPlusSessions") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) return null;
    const detail = await ctx.db
      .query("sportPlusSessionDetails")
      .withIndex("by_session", (q) => q.eq("sportPlusSessionId", args.sessionId))
      .first();
    return { session, detail };
  },
});
