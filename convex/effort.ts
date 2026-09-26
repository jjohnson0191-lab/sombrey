// RPE — "How hard did that feel?" — recorded on the session it describes
// (sombreyWorkouts / sportPlusSessions / activityLabels). One rating per
// physical session: re-rating replaces it; a band record owned by a workout
// is rated on the workout. See convex/strain/effort.ts.

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { RPE_SCALE_VERSION, ratingTarget, validateRpe, type RatedKind } from "./strain/effort";
import { activityName } from "./progressData";

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

const kindValidator = v.union(v.literal("workout"), v.literal("band_activity"), v.literal("noticed_activity"));

async function resolve(ctx: MutationCtx, userId: Id<"users">, kind: RatedKind, id: string) {
  if (kind === "band_activity") {
    const sid = ctx.db.normalizeId("sportPlusSessions", id);
    const row = sid ? await ctx.db.get(sid) : null;
    if (!row || row.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    const owner = await ctx.db.query("sombreyWorkouts").withIndex("by_sportPlusSession", (q) => q.eq("sportPlusSessionId", row._id)).first();
    const target = ratingTarget(kind, id, owner && owner.userId === userId ? owner._id : undefined);
    if (target.kind === "workout") return { table: "sombreyWorkouts" as const, id: owner!._id };
    return { table: "sportPlusSessions" as const, id: row._id };
  }
  if (kind === "workout") {
    const wid = ctx.db.normalizeId("sombreyWorkouts", id);
    const row = wid ? await ctx.db.get(wid) : null;
    if (!row || row.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Workout not found" });
    if (row.completedAt === undefined) throw new ConvexError({ code: "INVALID", message: "Rate a workout once it's finished" });
    return { table: "sombreyWorkouts" as const, id: row._id };
  }
  const lid = ctx.db.normalizeId("activityLabels", id);
  const row = lid ? await ctx.db.get(lid) : null;
  if (!row || row.userId !== userId || row.status !== "labelled") throw new ConvexError({ code: "NOT_FOUND", message: "Activity not found" });
  return { table: "activityLabels" as const, id: row._id };
}

/** Records (or replaces) the rating for one session. */
export const setRpe = mutation({
  args: { kind: kindValidator, sessionId: v.string(), rpe: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const valid = validateRpe(args.rpe);
    if (!valid.ok) throw new ConvexError({ code: "INVALID", message: valid.error });
    const target = await resolve(ctx, user._id, args.kind, args.sessionId);
    await ctx.db.patch(target.id, { rpe: valid.rpe, rpeRecordedAt: Date.now(), rpeScale: RPE_SCALE_VERSION });
    return { ratedOn: target.table === "sombreyWorkouts" ? "workout" : target.table === "sportPlusSessions" ? "band_activity" : "noticed_activity", sessionId: target.id, rpe: valid.rpe };
  },
});

export const clearRpe = mutation({
  args: { kind: kindValidator, sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const target = await resolve(ctx, user._id, args.kind, args.sessionId);
    await ctx.db.patch(target.id, { rpe: undefined, rpeRecordedAt: undefined, rpeScale: undefined });
  },
});

/** Finished sessions from the last 36 hours the user hasn't rated — each
 * physical session once (a band record owned by a workout is the workout). */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const since = Date.now() - 36 * 60 * 60 * 1000;
    const out: { kind: RatedKind; sessionId: string; name: string; endedAt: number; minutes?: number }[] = [];
    const workouts = await ctx.db.query("sombreyWorkouts")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", since - 6 * 60 * 60 * 1000)).take(50);
    const owned = new Set(workouts.map((w) => w.sportPlusSessionId).filter(Boolean));
    for (const w of workouts) {
      if (w.completedAt === undefined || w.completedAt < since || w.rpe !== undefined) continue;
      const seconds = w.actualDurationSeconds ?? w.durationSeconds;
      out.push({ kind: "workout", sessionId: w._id, name: w.name, endedAt: w.completedAt, minutes: seconds ? Math.round(seconds / 60) : undefined });
    }
    const sessions = await ctx.db.query("sportPlusSessions")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", since - 6 * 60 * 60 * 1000)).take(50);
    for (const s of sessions) {
      const ended = s.endedAt ?? (s.durationSeconds ? s.startedAt + s.durationSeconds * 1000 : undefined);
      if (ended === undefined || ended < since || s.rpe !== undefined || owned.has(s._id)) continue;
      const key = s.userActivityKey ?? s.activityKey;
      out.push({ kind: "band_activity", sessionId: s._id, name: key ? activityName(key) : "Activity", endedAt: ended, minutes: s.durationSeconds ? Math.round(s.durationSeconds / 60) : undefined });
    }
    const labels = await ctx.db.query("activityLabels")
      .withIndex("by_user_and_startedAt", (q) => q.eq("userId", user._id).gte("startedAt", since - 6 * 60 * 60 * 1000)).take(50);
    for (const l of labels) {
      if (l.status !== "labelled" || l.endedAt < since || l.rpe !== undefined || !l.activityKey) continue;
      out.push({ kind: "noticed_activity", sessionId: l._id, name: activityName(l.activityKey), endedAt: l.endedAt, minutes: Math.round((l.endedAt - l.startedAt) / 60000) });
    }
    return out.sort((a, b) => b.endedAt - a.endedAt);
  },
});
