// Sombrey Exercise Library — what the app reads and asks for.
//
// The app only ever sees Sombrey exercises (exerciseLibraryPolicy.toSummary /
// toDetail): no provider name, id or URL. Exercise knowledge comes from the
// configured provider (convex/exerciseProviders), fetched ON DEMAND — the
// queries users actually run and the exercises they actually open — cached
// per query for 30 days, within a monthly request budget. Nothing is bulk
// mirrored (provider terms prohibit caching "in bulk beyond what is needed
// for your application"). Exercises are never deleted by a sync, so
// workouts and plans that reference them stay intact.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { type ExerciseProvider, type ProviderExercise, ProviderUnavailableError } from "./exerciseProvider";
import { configuredBudgetOverride, configuredExerciseProvider } from "./exerciseProviders/index";
import { normalizeProviderExercise, providerBodyPartFor, MUSCLE_GROUPS } from "./exerciseNormalization";
import {
  MEDIA_RETRY_MS, QUERY_TTL_MS, RELATED_TTL_MS, isFresh, monthKey, monthlyBudget, pageSizeFor, queryKey, toDetail, toSummary,
} from "./exerciseLibraryPolicy";

async function requireUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
}

const muscleGroupArg = v.optional(v.string());

// ── What the app reads ─────────────────────────────────────────────────────

/** Search and browse. With a term (2+ characters) this uses the library's
 * search index (name, muscles, equipment, body part, synonyms); without
 * one it lists by name. Filters narrow either. */
export const search = query({
  args: {
    term: v.optional(v.string()),
    muscleGroup: muscleGroupArg,
    equipment: v.optional(v.string()),
    difficulty: v.optional(v.string()),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 40, 1), 200);
    const term = args.term?.trim() ?? "";
    const equipment = args.equipment?.trim().toLowerCase();
    let rows: Doc<"exercises">[];
    if (term.length >= 2) {
      rows = await ctx.db
        .query("exercises")
        .withSearchIndex("search_library", (q) => {
          let s = q.search("searchText", term);
          if (args.muscleGroup) s = s.eq("muscleGroup", args.muscleGroup as Doc<"exercises">["muscleGroup"]);
          if (equipment) s = s.eq("primaryEquipment", equipment);
          if (args.difficulty) s = s.eq("difficulty", args.difficulty as Doc<"exercises">["difficulty"]);
          if (args.category) s = s.eq("category", args.category);
          return s;
        })
        .take(limit + 1);
    } else {
      rows = await ctx.db
        .query("exercises")
        .withIndex("by_name")
        .filter((q) => q.and(
          args.muscleGroup ? q.eq(q.field("muscleGroup"), args.muscleGroup) : true,
          equipment ? q.eq(q.field("primaryEquipment"), equipment) : true,
          args.difficulty ? q.eq(q.field("difficulty"), args.difficulty) : true,
          args.category ? q.eq(q.field("category"), args.category) : true,
        ))
        .take(limit + 1);
    }
    return {
      items: rows.slice(0, limit).map(toSummary),
      hasMore: rows.length > limit,
    };
  },
});

/** The filter values the library can actually offer right now — only
 * values present in exercises it holds (muscle groups are always offered:
 * choosing one fetches that group on demand). */
export const facets = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("exercises").take(5000);
    const equipment = new Map<string, string>();
    const difficulties = new Set<string>();
    const categories = new Set<string>();
    for (const e of rows) {
      if (e.primaryEquipment && e.equipment[0]) equipment.set(e.primaryEquipment, e.equipment[0]);
      if (e.difficulty) difficulties.add(e.difficulty);
      if (e.category) categories.add(e.category);
    }
    return {
      total: rows.length,
      muscleGroups: MUSCLE_GROUPS.filter((g) => g !== "other"),
      equipment: [...equipment.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      difficulties: ["beginner", "intermediate", "advanced"].filter((d) => difficulties.has(d)),
      categories: [...categories].sort(),
    };
  },
});

/** One exercise in full, with its visual (when one may be shown) and its
 * alternatives / similar exercises (once fetched). */
export const detail = query({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const e = await ctx.db.get(args.id);
    if (!e) return null;
    const related = async (ids: Id<"exercises">[] | undefined) =>
      (await Promise.all((ids ?? []).slice(0, 12).map((id) => ctx.db.get(id))))
        .filter((r): r is Doc<"exercises"> => r !== null && r._id !== e._id)
        .map(toSummary);
    const mediaUrl = e.mediaStatus === "cached" && e.mediaStorageId ? await ctx.storage.getUrl(e.mediaStorageId) : null;
    return {
      ...toDetail(e),
      mediaUrl,
      // "pending": may still arrive; "none": nothing to show (and never a placeholder).
      mediaState: mediaUrl ? "available" : e.mediaStatus === undefined && e.sourceProvider ? "pending" : "none",
      alternatives: await related(e.alternativeIds),
      similar: await related(e.similarIds),
      relatedState: e.relatedFetchedAt !== undefined || !e.sourceProvider ? "loaded" : "pending",
    };
  },
});

// ── Internal bookkeeping ───────────────────────────────────────────────────

const normalizedValidator = v.object({
  externalId: v.string(),
  fields: v.any(),
});

/** Upserts provider records as Sombrey exercises, keyed on (provider,
 * provider id): a record seen again updates the same row — the Sombrey id
 * never changes and no duplicate is created. Returns ids in input order. */
export const ingest = internalMutation({
  args: { provider: v.string(), records: v.array(normalizedValidator) },
  handler: async (ctx, args): Promise<Id<"exercises">[]> => {
    const ids: Id<"exercises">[] = [];
    const now = Date.now();
    for (const record of args.records) {
      const fields = record.fields as ReturnType<typeof normalizeProviderExercise>;
      const existing = await ctx.db
        .query("exercises")
        .withIndex("by_source", (q) => q.eq("sourceProvider", args.provider).eq("sourceId", record.externalId))
        .first();
      const row = {
        ...fields,
        cues: existing?.cues ?? [],
        sourceProvider: args.provider,
        sourceId: record.externalId,
        sourceSyncedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, row);
        ids.push(existing._id);
      } else {
        ids.push(await ctx.db.insert("exercises", row));
      }
    }
    return ids;
  },
});

export const queryState = internalQuery({
  args: { provider: v.string(), queryKey: v.string() },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("exerciseProviderQueries")
      .withIndex("by_provider_and_key", (q) => q.eq("provider", args.provider).eq("queryKey", args.queryKey))
      .first();
    const state = await ctx.db.query("exerciseProviderState").withIndex("by_provider", (q) => q.eq("provider", args.provider)).first();
    return { fetchedAt: cached?.fetchedAt, plan: state?.plan, mediaBranded: state?.mediaBranded ?? true };
  },
});

export const providerState = internalQuery({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query("exerciseProviderState").withIndex("by_provider", (q) => q.eq("provider", args.provider)).first();
    return { plan: state?.plan, mediaBranded: state?.mediaBranded ?? true, known: state?.plan !== undefined };
  },
});

export const recordQuery = internalMutation({
  args: { provider: v.string(), queryKey: v.string(), returned: v.number(), total: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("exerciseProviderQueries")
      .withIndex("by_provider_and_key", (q) => q.eq("provider", args.provider).eq("queryKey", args.queryKey))
      .first();
    const row = { provider: args.provider, queryKey: args.queryKey, fetchedAt: Date.now(), returned: args.returned, total: args.total };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("exerciseProviderQueries", row);
  },
});

/** Reserves `count` requests against this month's budget; false when the
 * budget is spent (the library then serves what it holds). */
export const reserveRequests = internalMutation({
  args: { provider: v.string(), count: v.number(), budget: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const month = monthKey(Date.now());
    const usage = await ctx.db
      .query("exerciseProviderUsage")
      .withIndex("by_provider_and_month", (q) => q.eq("provider", args.provider).eq("month", month))
      .first();
    const used = usage?.requests ?? 0;
    if (used + args.count > args.budget) return false;
    if (usage) await ctx.db.patch(usage._id, { requests: used + args.count });
    else await ctx.db.insert("exerciseProviderUsage", { provider: args.provider, month, requests: args.count });
    return true;
  },
});

export const recordProviderState = internalMutation({
  args: { provider: v.string(), plan: v.optional(v.string()), mediaBranded: v.optional(v.boolean()), lastError: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("exerciseProviderState").withIndex("by_provider", (q) => q.eq("provider", args.provider)).first();
    const patch = {
      provider: args.provider,
      plan: args.plan ?? existing?.plan,
      mediaBranded: args.mediaBranded ?? existing?.mediaBranded ?? true,
      updatedAt: Date.now(),
      lastError: args.lastError,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("exerciseProviderState", patch);
  },
});

export const syncInfo = internalQuery({
  args: { id: v.id("exercises") },
  handler: async (ctx, args) => {
    const e = await ctx.db.get(args.id);
    if (!e) return null;
    return {
      sourceProvider: e.sourceProvider,
      sourceId: e.sourceId,
      relatedFetchedAt: e.relatedFetchedAt,
      mediaStatus: e.mediaStatus,
      mediaCheckedAt: e.mediaCheckedAt,
    };
  },
});

export const setRelated = internalMutation({
  args: { id: v.id("exercises"), similarIds: v.array(v.id("exercises")), alternativeIds: v.array(v.id("exercises")) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      similarIds: args.similarIds.filter((id) => id !== args.id),
      alternativeIds: args.alternativeIds.filter((id) => id !== args.id),
      relatedFetchedAt: Date.now(),
    });
  },
});

export const setMedia = internalMutation({
  args: {
    id: v.id("exercises"),
    status: v.union(v.literal("cached"), v.literal("withheld"), v.literal("unavailable")),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { mediaStatus: args.status, mediaStorageId: args.storageId, mediaCheckedAt: Date.now() });
  },
});

// ── Asking the provider, on demand ─────────────────────────────────────────

/** Provider records → normalized Sombrey fields for `ingest`. */
function toIngest(records: ProviderExercise[]) {
  return records.map((r) => ({ externalId: r.externalId, fields: normalizeProviderExercise(r) }));
}

async function remember(ctx: ActionCtx, provider: ExerciseProvider, error?: ProviderUnavailableError) {
  const account = provider.account();
  await ctx.runMutation(internal.exerciseLibrary.recordProviderState, {
    provider: provider.id,
    plan: account?.plan,
    mediaBranded: account?.mediaBranded,
    lastError: error ? error.kind : undefined,
  });
}

type RefreshStatus = "fetched" | "cached" | "unavailable" | "busy" | "budget";

/** Brings the provider's results for this search/filter into the library,
 * unless they were fetched within the TTL. The app calls this debounced,
 * and keeps showing the `search` query, which updates reactively. Never
 * throws provider details at the app — it returns a status. */
export const refresh = action({
  args: {
    term: v.optional(v.string()),
    muscleGroup: muscleGroupArg,
    equipment: v.optional(v.string()),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ status: RefreshStatus; added: number }> => {
    await requireUser(ctx);
    const provider = configuredExerciseProvider();
    if (!provider) return { status: "unavailable", added: 0 };
    const term = args.term?.trim() ?? "";
    // A name search goes to the provider on its own (every plan supports
    // it); filters are then applied to the results locally.
    const name = term.length >= 2 ? term : undefined;
    const state = await ctx.runQuery(internal.exerciseLibrary.providerState, { provider: provider.id });
    const limit = pageSizeFor(state.plan);
    const q = {
      name,
      bodyPart: name ? undefined : providerBodyPartFor(args.muscleGroup),
      equipment: name ? undefined : args.equipment?.trim().toLowerCase() || undefined,
      limit,
      offset: Math.max(0, Math.floor(args.page ?? 0)) * limit,
    };
    if (q.bodyPart && q.equipment) q.equipment = undefined; // combined filters are plan-gated; filter locally
    const key = queryKey(q);
    const cached = await ctx.runQuery(internal.exerciseLibrary.queryState, { provider: provider.id, queryKey: key });
    if (isFresh(cached.fetchedAt, QUERY_TTL_MS, Date.now())) return { status: "cached", added: 0 };
    const allowed = await ctx.runMutation(internal.exerciseLibrary.reserveRequests, {
      provider: provider.id, count: 1, budget: monthlyBudget(state.plan, configuredBudgetOverride()),
    });
    if (!allowed) return { status: "budget", added: 0 };
    try {
      const page = await provider.search(q);
      const ids = await ctx.runMutation(internal.exerciseLibrary.ingest, { provider: provider.id, records: toIngest(page.exercises) });
      await ctx.runMutation(internal.exerciseLibrary.recordQuery, { provider: provider.id, queryKey: key, returned: ids.length, total: page.total });
      await remember(ctx, provider);
      return { status: "fetched", added: ids.length };
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        await remember(ctx, provider, err);
        if (err.kind === "not_found") {
          await ctx.runMutation(internal.exerciseLibrary.recordQuery, { provider: provider.id, queryKey: key, returned: 0 });
          return { status: "fetched", added: 0 };
        }
        return { status: err.kind === "rate_limited" ? "busy" : "unavailable", added: 0 };
      }
      throw err;
    }
  },
});

/** Prepares an opened exercise: its alternatives and similar exercises,
 * and its demonstration visual — only when the provider's terms allow
 * showing it without provider branding (e.g. not on a watermarked plan). */
export const prepare = action({
  args: { id: v.id("exercises") },
  handler: async (ctx, args): Promise<{ done: boolean }> => {
    await requireUser(ctx);
    const provider = configuredExerciseProvider();
    if (!provider) return { done: false };
    const info = await ctx.runQuery(internal.exerciseLibrary.syncInfo, { id: args.id });
    if (!info || info.sourceProvider !== provider.id || !info.sourceId) return { done: false };
    const sourceId = info.sourceId;
    const state = await ctx.runQuery(internal.exerciseLibrary.providerState, { provider: provider.id });
    const budget = monthlyBudget(state.plan, configuredBudgetOverride());
    const now = Date.now();

    if (!isFresh(info.relatedFetchedAt, RELATED_TTL_MS, now)
        && await ctx.runMutation(internal.exerciseLibrary.reserveRequests, { provider: provider.id, count: 2, budget })) {
      try {
        const [similar, alternatives] = await Promise.all([provider.similar(sourceId, 8), provider.alternatives(sourceId, 8)]);
        const similarIds = await ctx.runMutation(internal.exerciseLibrary.ingest, { provider: provider.id, records: toIngest(similar.exercises) });
        const alternativeIds = await ctx.runMutation(internal.exerciseLibrary.ingest, { provider: provider.id, records: toIngest(alternatives.exercises) });
        await ctx.runMutation(internal.exerciseLibrary.setRelated, { id: args.id, similarIds, alternativeIds });
        await remember(ctx, provider);
      } catch (err) {
        if (!(err instanceof ProviderUnavailableError)) throw err;
        await remember(ctx, provider, err);
        if (err.kind === "not_found" || err.kind === "forbidden") {
          await ctx.runMutation(internal.exerciseLibrary.setRelated, { id: args.id, similarIds: [], alternativeIds: [] });
        }
      }
    }

    const mediaDue = info.mediaStatus === undefined
      || (info.mediaStatus !== "cached" && !isFresh(info.mediaCheckedAt, MEDIA_RETRY_MS, now));
    if (!mediaDue) return { done: true };
    // Known branded plan: don't even fetch it.
    const current = await ctx.runQuery(internal.exerciseLibrary.providerState, { provider: provider.id });
    if (current.known && current.mediaBranded) {
      await ctx.runMutation(internal.exerciseLibrary.setMedia, { id: args.id, status: "withheld" });
      return { done: true };
    }
    if (!await ctx.runMutation(internal.exerciseLibrary.reserveRequests, { provider: provider.id, count: 1, budget })) return { done: false };
    try {
      const media = await provider.media(sourceId);
      await remember(ctx, provider);
      if (provider.account()?.mediaBranded ?? true) {
        // Branded (or plan unknown): never stored, never shown.
        await ctx.runMutation(internal.exerciseLibrary.setMedia, { id: args.id, status: "withheld" });
        return { done: true };
      }
      const storageId = await ctx.storage.store(new Blob([media.bytes], { type: media.contentType }));
      await ctx.runMutation(internal.exerciseLibrary.setMedia, { id: args.id, status: "cached", storageId });
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      await remember(ctx, provider, err);
      await ctx.runMutation(internal.exerciseLibrary.setMedia, { id: args.id, status: "unavailable" });
    }
    return { done: true };
  },
});
