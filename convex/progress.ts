// Progress — what the app reads. Everything is derived on read from the
// user's recorded history (convex/progressData.ts) by the pure modules in
// convex/progress/. Nothing here is estimated to fill space; each section
// says when there isn't enough data.

import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { activityName, loadProgressData } from "./progressData";
import { STRAIN_SIGNALS, strainDay } from "./progress/strainEngine";
import { bodySummary, type BodyBaseline } from "./progress/body";
import { consistency } from "./progress/consistency";
import { personalRecords } from "./progress/records";
import { milestones } from "./progress/milestones";
import { loadRecovery } from "./progress/loadRecovery";
import { youVsYou } from "./progress/youVsYou";
import { activityPerformance, workoutPerformance, type RangeId } from "./progress/performance";
import { dayKey } from "./progress/model";
import { loadIntelligence, loadRecoveryOutcomes } from "./intelligenceData";
import { resolveZone } from "./userTimeZone";

async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

const baselineValidator = v.optional(v.union(v.literal("first"), v.literal("30d"), v.literal("90d")));

// Days are the user's local days: the phone's IANA zone (`timeZone`),
// else the zone it last reported, else an older client's fixed offset.
export const overview = query({
  args: { timeZone: v.optional(v.string()), tzOffsetMinutes: v.optional(v.number()), bodyBaseline: baselineValidator },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const tz = resolveZone(user, args.timeZone, args.tzOffsetMinutes);
    const data = await loadProgressData(ctx, user._id, now);
    const intelligence = await loadIntelligence(ctx, user._id, data, tz, now);
    const outcomes = await loadRecoveryOutcomes(ctx, user._id, tz, now);
    const lr = loadRecovery(data.sessions, data.readiness, now, tz, 7, outcomes);
    const today = dayKey(now, tz);
    return {
      strain: strainDay(data.sessions, now, tz, intelligence),
      todaySessions: data.sessions
        .filter((s) => dayKey(s.startedAt, tz) === today)
        .map((s) => ({
          id: s.id, kind: s.kind, name: s.name, startedAt: s.startedAt,
          minutes: s.durationSeconds ? Math.round(s.durationSeconds / 60) : undefined,
          durationSource: s.durationSource, averageHeartRate: s.averageHeartRate, calories: s.calories,
        })),
      strainSignals: STRAIN_SIGNALS,
      body: bodySummary(data.weights, (args.bodyBaseline ?? "first") as BodyBaseline, now),
      consistency: consistency(data.sessions, now, tz, data.plannedPerWeek),
      records: personalRecords(data.sessions, data.sets, now, activityName),
      milestones: milestones(data.sessions, tz),
      insights: youVsYou(data.sessions, data.readiness, data.weights, now, activityName),
      loadRecovery: { days: lr.days, pairedDays: lr.pairedDays, relationship: lr.relationship },
      loadRecovery28: loadRecovery(data.sessions, data.readiness, now, tz, 28).days,
      hasHistory: data.sessions.length > 0,
    };
  },
});

export const performance = query({
  args: {
    timeZone: v.optional(v.string()),
    tzOffsetMinutes: v.optional(v.number()),
    mode: v.union(v.literal("workouts"), v.literal("activities")),
    subject: v.optional(v.string()),
    metric: v.optional(v.string()),
    range: v.optional(v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"), v.literal("1y"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const data = await loadProgressData(ctx, user._id, now);
    return args.mode === "workouts"
      ? workoutPerformance(data.sessions, data.sets, args.subject, args.metric, args.range as RangeId | undefined, now, resolveZone(user, args.timeZone, args.tzOffsetMinutes))
      : activityPerformance(data.sessions, args.subject, args.metric, args.range as RangeId | undefined, now, activityName);
  },
});
