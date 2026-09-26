// The user's time zone — Sombrey owns it (convex/strain/time.ts). The app
// reports the phone's IANA zone; every "day" on the server is that zone's
// calendar day. The band never decides it.

import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { chooseZone, isValidTimeZone, type Zone } from "./strain/time";

/** The zone to read days in: the zone the call carries (the phone, now),
 * else the zone the app last reported, else a fixed offset from an older
 * client, else UTC. */
export function resolveZone(user: Doc<"users"> | null | undefined, argZone?: string, offsetMinutes?: number): Zone {
  return chooseZone(argZone, user?.timeZone, offsetMinutes);
}

export const setTimeZone = mutation({
  args: { timeZone: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    if (!isValidTimeZone(args.timeZone)) throw new ConvexError({ code: "INVALID", message: "Unknown time zone" });
    if (user.timeZone !== args.timeZone) await ctx.db.patch(user._id, { timeZone: args.timeZone, timeZoneUpdatedAt: Date.now() });
    return args.timeZone;
  },
});
