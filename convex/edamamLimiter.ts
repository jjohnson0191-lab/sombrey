// The one gate every Edamam request passes through (ai/cameraAnalysis.ts),
// whichever entry point started the analysis. The bucket rules and limits
// are in nutrition/edamamBudget.ts. Mutations on one row are serialised by
// Convex, so two analyses can never both spend the same token.

import { internalMutation } from "./_generated/server";
import { cooldown, reserve } from "./nutrition/edamamBudget";

const PROVIDER = "edamam";

/** Reserve one Edamam hit: `{ok, waitMs}` — wait that long, then call. */
export const reserveHit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("providerRateLimits").withIndex("by_provider", (q) => q.eq("provider", PROVIDER)).unique();
    const r = reserve(row ? { tokens: row.tokens, updatedAt: row.updatedAt, cooldownUntil: row.cooldownUntil } : null, Date.now());
    const next = { tokens: r.next.tokens, updatedAt: r.next.updatedAt, cooldownUntil: r.next.cooldownUntil };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("providerRateLimits", { provider: PROVIDER, ...next });
    return { ok: r.ok, waitMs: r.waitMs };
  },
});

/** Edamam answered 429: nobody calls it for the cooldown. */
export const rateLimited = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("providerRateLimits").withIndex("by_provider", (q) => q.eq("provider", PROVIDER)).unique();
    const next = cooldown(Date.now());
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("providerRateLimits", { provider: PROVIDER, ...next });
  },
});
