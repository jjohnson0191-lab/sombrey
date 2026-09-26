// Weather context — MET Norway Locationforecast 2.0 (api.met.no).
// Licence: NLOD 2.0 / CC BY 4.0 — commercial use allowed with attribution
// ("Weather data: MET Norway"), shown in Settings. The API requires an
// identifying User-Agent with contact details (WEATHER_USER_AGENT env var)
// and at most 4 decimals of coordinates.
//
// PRIVACY: the app sends its position (reduced-accuracy location) only to
// this action. It is rounded to 2 decimals (~1 km), used for one provider
// request, and discarded — never stored, never logged. What IS stored: a
// place name the phone resolved itself (locality), the time zone, and the
// weather values. One "current" row per user (overwritten), plus a copy
// per finished session. No location history exists.
//
// Weather is CONTEXT ONLY. Nothing here is an input to Daily Load or Strain.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { environmentState, parseLocationforecast, WEATHER_REFRESH_MS, type EnvironmentSnapshot } from "./strain/environment";
import { isValidTimeZone } from "./strain/time";

const DEFAULT_USER_AGENT = "Sombrey/1.0 (fitness app weather context)";

async function userFor(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

const snapshotFields = {
  observedAt: v.number(),
  fetchedAt: v.number(),
  timeZone: v.string(),
  locality: v.optional(v.string()),
  temperatureC: v.optional(v.number()),
  feelsLikeC: v.optional(v.number()),
  humidityPct: v.optional(v.number()),
  windMs: v.optional(v.number()),
  uvIndex: v.optional(v.number()),
  precipitationMm: v.optional(v.number()),
  condition: v.optional(v.string()),
};

/** Fetch current weather for the phone's position. Coordinates are rounded,
 * used once, and dropped. Returns the stored snapshot or an honest reason. */
export const refresh = action({
  args: { latitude: v.number(), longitude: v.number(), timeZone: v.string(), locality: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    if (!isValidTimeZone(args.timeZone)) return { ok: false, reason: "invalid_time_zone" };
    if (!(Math.abs(args.latitude) <= 90 && Math.abs(args.longitude) <= 180)) return { ok: false, reason: "invalid_position" };
    const lat = Math.round(args.latitude * 100) / 100, lon = Math.round(args.longitude * 100) / 100;
    let body: unknown;
    try {
      const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`, {
        headers: { "User-Agent": process.env.WEATHER_USER_AGENT ?? DEFAULT_USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) return { ok: false, reason: `provider_${res.status}` };
      body = await res.json();
    } catch {
      return { ok: false, reason: "provider_unreachable" };
    }
    const snapshot = parseLocationforecast(body, Date.now(), args.timeZone, args.locality?.slice(0, 80));
    if (!snapshot) return { ok: false, reason: "provider_empty" };
    const { source: _s, ...fields } = snapshot;
    await ctx.runMutation(internal.environment.storeCurrent, { tokenIdentifier: identity.tokenIdentifier, ...fields });
    return { ok: true };
  },
});

export const storeCurrent = internalMutation({
  args: { tokenIdentifier: v.string(), ...snapshotFields },
  handler: async (ctx, { tokenIdentifier, ...fields }) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier)).unique();
    if (!user) return;
    const existing = await ctx.db.query("environmentSnapshots")
      .withIndex("by_user_and_kind", (q) => q.eq("userId", user._id).eq("kind", "current")).first();
    const row = { userId: user._id, kind: "current" as const, source: "met_norway" as const, ...fields };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("environmentSnapshots", row);
    if (user.timeZone !== fields.timeZone) await ctx.db.patch(user._id, { timeZone: fields.timeZone, timeZoneUpdatedAt: Date.now() });
  },
});

/** The current environment for Home: available, stale, or unavailable. */
export const latest = query({
  args: { locationDenied: v.optional(v.boolean()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await userFor(ctx);
    const row = await ctx.db.query("environmentSnapshots")
      .withIndex("by_user_and_kind", (q) => q.eq("userId", user._id).eq("kind", "current")).first();
    const snapshot: EnvironmentSnapshot | null = row ? {
      observedAt: row.observedAt, fetchedAt: row.fetchedAt, timeZone: row.timeZone, locality: row.locality,
      temperatureC: row.temperatureC, feelsLikeC: row.feelsLikeC, humidityPct: row.humidityPct, windMs: row.windMs,
      uvIndex: row.uvIndex, precipitationMm: row.precipitationMm, condition: row.condition, source: "met_norway",
    } : null;
    const state = environmentState(snapshot, Date.now(), args.locationDenied ?? false, args.timeZone);
    return { ...state, refreshAfterMs: WEATHER_REFRESH_MS, attribution: "Weather data: MET Norway (CC BY 4.0)" };
  },
});

/** Keeps the conditions a session happened in — a copy of the current
 * snapshot when it's recent enough to describe the session; otherwise
 * nothing (never a guess). Idempotent per session. */
export const captureForSession = mutation({
  args: { sessionKind: v.union(v.literal("workout"), v.literal("activity")), sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await userFor(ctx);
    const current = await ctx.db.query("environmentSnapshots")
      .withIndex("by_user_and_kind", (q) => q.eq("userId", user._id).eq("kind", "current")).first();
    if (!current || Date.now() - current.fetchedAt > 2 * 60 * 60 * 1000) return { captured: false };
    const existing = await ctx.db.query("environmentSnapshots")
      .withIndex("by_user_and_session", (q) => q.eq("userId", user._id).eq("sessionId", args.sessionId)).first();
    const { _id, _creationTime, ...fields } = current;
    const row = { ...fields, kind: "session" as const, sessionKind: args.sessionKind, sessionId: args.sessionId };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("environmentSnapshots", row);
    return { captured: true };
  },
});

/** Clears every stored weather snapshot for the user (Settings → privacy). */
export const clearMine = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await userFor(ctx);
    for (const kind of ["current", "session"] as const) {
      const rows = await ctx.db.query("environmentSnapshots").withIndex("by_user_and_kind", (q) => q.eq("userId", user._id).eq("kind", kind)).take(1000);
      for (const r of rows) await ctx.db.delete(r._id);
    }
  },
});
