// The one gate every Edamam request passes through — photo analysis
// (ai/cameraAnalysis.ts) and Search Foods (foodSearch.ts) alike, whichever
// entry point started it. The bucket rules and limits are in
// nutrition/edamamBudget.ts. Mutations on one row are serialised by Convex,
// so two callers can never both spend the same token.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { BUCKET, cooldown, reserve } from "./nutrition/edamamBudget";
import { SEARCH_MAX_WAIT_MS, SEARCH_USER_QUOTA } from "./nutrition/foodSearch";

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

/** Reserve one Edamam hit for a Search Foods request — from the SAME
 * deployment-wide bucket as photo analysis. Someone is typing, so it waits at
 * most SEARCH_MAX_WAIT_MS (a reservation that would wait longer isn't taken:
 * the search says "busy" and photo analyses keep their tokens). A per-user
 * quota first keeps one person's searching from using up the shared budget —
 * it only ever refuses, it never adds Edamam capacity. */
export const reserveSearchHit = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userKey = `${PROVIDER}_search:${args.userId}`;
    const userRow = await ctx.db.query("providerRateLimits").withIndex("by_provider", (q) => q.eq("provider", userKey)).unique();
    const mine = reserve(userRow ? { tokens: userRow.tokens, updatedAt: userRow.updatedAt } : null, now, SEARCH_USER_QUOTA);
    if (!mine.ok) return { ok: false, waitMs: 0, reason: "user_quota" as const };
    const row = await ctx.db.query("providerRateLimits").withIndex("by_provider", (q) => q.eq("provider", PROVIDER)).unique();
    const shared = reserve(row ? { tokens: row.tokens, updatedAt: row.updatedAt, cooldownUntil: row.cooldownUntil } : null, now, { ...BUCKET, maxWaitMs: SEARCH_MAX_WAIT_MS });
    if (!shared.ok) return { ok: false, waitMs: 0, reason: "shared" as const };
    const next = { tokens: shared.next.tokens, updatedAt: shared.next.updatedAt, cooldownUntil: shared.next.cooldownUntil };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("providerRateLimits", { provider: PROVIDER, ...next });
    const mineNext = { tokens: mine.next.tokens, updatedAt: mine.next.updatedAt };
    if (userRow) await ctx.db.patch(userRow._id, mineNext);
    else await ctx.db.insert("providerRateLimits", { provider: userKey, ...mineNext });
    return { ok: true, waitMs: shared.waitMs, reason: undefined };
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
