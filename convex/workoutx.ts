/**
 * Legacy web-app entry points (src/pages/exercises/page.tsx — the retired
 * coach "Import exercise" panel and exercise page). Kept with their original
 * signatures so the legacy SPA keeps working, but they no longer talk to a
 * provider SDK themselves: everything goes through Sombrey's provider
 * boundary (convex/exerciseProviders) and normalization
 * (convex/exerciseNormalization.ts), into the same Sombrey exercise rows the
 * native app uses. The native app uses convex/exerciseLibrary.ts instead.
 *
 * Security: the provider's media URLs require the API key, and the SDK's
 * gifUrl() embeds that key in the URL. No such URL is ever stored or
 * returned any more.
 */

import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { ProviderUnavailableError } from "./exerciseProvider";
import { configuredExerciseProvider } from "./exerciseProviders/index";
import { normalizeProviderExercise } from "./exerciseNormalization";

async function requireAuth(ctx: ActionCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  }
}

function provider() {
  const p = configuredExerciseProvider();
  if (!p) throw new ConvexError({ code: "BAD_REQUEST", message: "The exercise library isn't available right now." });
  return p;
}

/** Legacy: fills the library for a search / muscle group. Delegates to the
 * Sombrey library's refresh. */
export const syncAndSearch = action({
  args: { searchTerm: v.optional(v.string()), muscleGroup: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ synced: boolean; cacheKey: string }> => {
    const result = await ctx.runAction(api.exerciseLibrary.refresh, {
      term: args.searchTerm,
      muscleGroup: args.muscleGroup && args.muscleGroup !== "all" ? args.muscleGroup : undefined,
    });
    return { synced: result.status === "fetched", cacheKey: `${args.searchTerm ?? ""}|${args.muscleGroup ?? ""}` };
  },
});

/** Legacy coach panel: search the provider directly (not stored). */
export const searchExercises = action({
  args: {
    query: v.optional(v.string()),
    bodyPart: v.optional(v.string()),
    target: v.optional(v.string()),
    equipment: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    try {
      const page = await provider().search({
        name: args.query?.trim() || undefined,
        bodyPart: args.bodyPart,
        target: args.target,
        equipment: args.equipment,
        limit: Math.min(args.limit ?? 30, 50),
        offset: 0,
      });
      return page.exercises.map((e) => ({
        id: e.externalId,
        name: e.name,
        bodyPart: e.bodyPart ?? "",
        target: e.target ?? "",
        secondaryMuscles: e.secondaryMuscles,
        equipment: e.equipment ?? "",
        gifUrl: "", // provider media URLs carry the API key — never sent to a client
        instructions: e.instructions,
      }));
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw new ConvexError({ code: "EXTERNAL_SERVICE_ERROR", message: "The exercise library isn't available right now." });
      }
      throw err;
    }
  },
});

/** Legacy coach panel: import one provider exercise as a Sombrey exercise. */
export const importExercise = action({
  args: { workoutxId: v.string() },
  handler: async (ctx, args): Promise<Id<"exercises">> => {
    await requireAuth(ctx);
    const p = provider();
    let record;
    try {
      record = await p.get(args.workoutxId);
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw new ConvexError({ code: "EXTERNAL_SERVICE_ERROR", message: "The exercise library isn't available right now." });
      }
      throw err;
    }
    if (!record) throw new ConvexError({ code: "NOT_FOUND", message: "Exercise not found" });
    const [id] = await ctx.runMutation(internal.exerciseLibrary.ingest, {
      provider: p.id,
      records: [{ externalId: record.externalId, fields: normalizeProviderExercise(record) }],
    });
    return id;
  },
});
