// Today's Sombrey Strain for Home — the same pipeline Progress and the AI
// Coach read (convex/strain/*). No scoring happens here or on the phone.

import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { loadProgressData } from "./progressData";
import { loadIntelligence } from "./intelligenceData";
import { resolveZone } from "./userTimeZone";
import { BASELINE_REQUIREMENTS } from "./strain/baseline";
import { relativeLabel, strainBand } from "./strain/strainScore";

export const todayStrain = query({
  args: { timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    const now = Date.now();
    const zone = resolveZone(user, args.timeZone);
    const data = await loadProgressData(ctx, user._id, now);
    const i = await loadIntelligence(ctx, user._id, data, zone, now);
    const ref = i.baseline.reference;
    const r = BASELINE_REQUIREMENTS;
    return {
      date: i.today.date,
      state: i.strain.state,                 // NOT_ENOUGH_DATA | BUILDING_BASELINE | LOW_CONFIDENCE | READY
      confidence: i.strain.confidence,
      version: i.strain.version,
      validated: i.strain.approved,
      value: i.strain.value,
      band: i.strain.value !== undefined ? strainBand(i.strain.value) : undefined,
      relativeLabel: ref && i.today.sessions > 0 ? relativeLabel(i.today.load / ref) : undefined,
      sessions: i.today.sessions,
      activeMinutes: i.today.activeMinutes,
      baseline: {
        status: i.baseline.status,
        historyDays: i.baseline.historyDays,
        activeDays: i.baseline.activeDays,
        qualitySessions: i.baseline.qualitySessions,
        required: { historyDays: r.minHistoryDays, activeDays: r.minActiveDays, qualitySessions: r.minQualitySessions },
      },
    };
  },
});
