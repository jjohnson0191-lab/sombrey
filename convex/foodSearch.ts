// Nutrition › Search Foods (native app).
//
//   search → Sombrey-owned foods (`foods`, by name) + live Edamam results
//
// Edamam is asked only here, only for a signed-in user's typed query of at
// least MIN_QUERY_LENGTH characters, once per search, through the shared
// Edamam gate (edamamLimiter.ts) — the same budget the AI Macro Calculator
// uses. Credentials stay on the server. Nothing Edamam returns is stored:
// results go back to the app, and a food is only logged — as a minimal
// snapshot, never into `foods` — when the user confirms it
// (nutritionLogs:logExternalFood).

import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { EdamamGate } from "./nutrition/edamamLookup";
import { PHOTO_MEAL_CATEGORY } from "./foods";
import { librarySearchTerm } from "./nutrition/librarySearch";
import {
  MAX_SOMBREY_RESULTS, normalizeQuery, searchEdamam, withoutSombreyDuplicates,
  type EdamamSearchStatus, type ExternalFood,
} from "./nutrition/foodSearch";

type SombreyFood = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  servingSize: string;
  servingUnit: string;
};

export type FoodSearchResult = {
  /** "unauthenticated": signed out · "too_short": nothing searched · "ok": see edamamStatus. */
  status: "ok" | "too_short" | "unauthenticated";
  query: string;
  sombrey: SombreyFood[];
  edamam: ExternalFood[];
  /** Why Edamam results may be missing: rate_limited | unavailable | error. */
  edamamStatus: EdamamSearchStatus | "skipped";
};

/** The caller and the Sombrey-owned foods matching the query (the same
 * visibility as foods:list: not archived; a photo meal only to its owner). */
export const sombreyMatches = internalQuery({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!user) return null;
    const term = librarySearchTerm(args.query);
    if (!term) return { userId: user._id, foods: [] };
    const hits = await ctx.db.query("foods").withSearchIndex("search_name", (q) => q.search("searchName", term)).take(40);
    const foods = hits
      .filter((f) => !f.isArchived && (f.category !== PHOTO_MEAL_CATEGORY || f.createdBy === user._id))
      .slice(0, MAX_SOMBREY_RESULTS)
      .map((f) => ({
        id: f._id,
        name: f.name,
        calories: f.calories,
        protein: f.protein,
        carbs: f.carbs,
        fats: f.fats,
        servingSize: f.servingSize,
        servingUnit: f.servingUnit,
      }));
    return { userId: user._id, foods };
  },
});

/** The shared gate, for a search: a short wait at most, one hit. */
function searchGate(ctx: ActionCtx, userId: Id<"users">): EdamamGate {
  return {
    acquire: async () => {
      const r = await ctx.runMutation(internal.edamamLimiter.reserveSearchHit, { userId });
      if (!r.ok) return false;
      if (r.waitMs > 0) await new Promise((res) => setTimeout(res, r.waitMs));
      return true;
    },
    rateLimited: async () => { await ctx.runMutation(internal.edamamLimiter.rateLimited, {}); },
  };
}

export const search = action({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<FoodSearchResult> => {
    const query = normalizeQuery(args.query);
    const empty = { query: query ?? "", sombrey: [], edamam: [], edamamStatus: "skipped" as const };
    if (!(await ctx.auth.getUserIdentity())) return { status: "unauthenticated", ...empty };
    if (!query) return { status: "too_short", ...empty };

    const mine = await ctx.runQuery(internal.foodSearch.sombreyMatches, { query });
    if (!mine) return { status: "unauthenticated", ...empty };

    const appId = process.env.EDAMAM_APP_ID;
    const appKey = process.env.EDAMAM_APP_KEY;
    if (!appId || !appKey) return { status: "ok", query, sombrey: mine.foods, edamam: [], edamamStatus: "unavailable" };

    const r = await searchEdamam(query, appId, appKey, searchGate(ctx, mine.userId));
    if (r.detail) console.log(`foodSearch: Edamam ${r.status} (${r.detail})`);
    return {
      status: "ok",
      query,
      sombrey: mine.foods,
      edamam: withoutSombreyDuplicates(r.foods, mine.foods.map((f) => f.name)),
      edamamStatus: r.status,
    };
  },
});
