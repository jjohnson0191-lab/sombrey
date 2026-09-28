// The Sombrey Food Library import — the server side of
// scripts/food-library/import.ts. Every record is re-validated here with the
// same rules the importer used (convex/nutrition/foodLibrary.ts) and written
// to the canonical `foods` table, idempotently: a record is identified by
// (source, sourceId), inserted once, rewritten only when its content changed,
// and otherwise left alone — so importing the same dataset twice changes
// nothing. Internal only: run by the importer with deployment credentials,
// never callable from an app.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { PHOTO_MEAL_CATEGORY } from "./foods";
import { LIBRARY_SOURCES, libraryFoodFields, searchNameOf, upsertAction, validateCandidate, type LibraryCandidate } from "./nutrition/foodLibrary";

/** Batches are kept small enough for one mutation (the importer sends ≤200). */
const MAX_BATCH = 250;

export const upsertBatch = internalMutation({
  // Candidates as the importer normalised them; validated again here.
  args: { records: v.array(v.any()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (args.records.length > MAX_BATCH) throw new Error(`Batch too large (${args.records.length} > ${MAX_BATCH})`);
    const counts = { inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
    const rejected: Array<{ sourceId: string; reason: string }> = [];
    const now = new Date().toISOString();
    for (const raw of args.records as LibraryCandidate[]) {
      const checked = validateCandidate(raw);
      if ("rejection" in checked) {
        counts.rejected++;
        rejected.push({ sourceId: checked.rejection.sourceId, reason: checked.rejection.reason });
        continue;
      }
      const r = checked.record;
      const existing = await ctx.db
        .query("foods")
        .withIndex("by_source_and_sourceId", (q) => q.eq("source", r.source).eq("sourceId", r.sourceId))
        .unique();
      const action = upsertAction(existing, r);
      counts[action === "insert" ? "inserted" : action === "update" ? "updated" : "unchanged"]++;
      if (args.dryRun || action === "unchanged") continue;
      const fields = libraryFoodFields(r);
      if (action === "insert") await ctx.db.insert("foods", { ...fields, createdAt: now, lastModifiedAt: now });
      else await ctx.db.patch(existing!._id, { ...fields, lastModifiedAt: now });
    }
    return { ...counts, rejectedRecords: rejected };
  },
});

/** Foods created before the library existed get their searchName, so they're
 * searchable too. Photo meals are private and stay out of search. Resumable:
 * run until `done`. */
export const backfillSearchNames = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("foods")
      .withIndex("by_source_and_sourceId", (q) => q.eq("source", undefined))
      .paginate({ numItems: 200, cursor: args.cursor ?? null });
    let updated = 0;
    for (const f of page.page) {
      if (f.category === PHOTO_MEAL_CATEGORY) continue;
      const searchName = searchNameOf(f.name);
      if (f.searchName !== searchName) {
        await ctx.db.patch(f._id, { searchName });
        updated++;
      }
    }
    return { updated, done: page.isDone, cursor: page.continueCursor };
  },
});

/** Counts per source (for the import report), paged so it never reads the
 * whole table in one go. */
export const stats = internalQuery({
  args: { source: v.string(), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("foods")
      .withIndex("by_source_and_sourceId", (q) => q.eq("source", args.source))
      .paginate({ numItems: 2000, cursor: args.cursor ?? null });
    const flagged = page.page.filter((f) => (f.qualityFlags ?? []).length > 0).length;
    return { count: page.page.length, flagged, done: page.isDone, cursor: page.continueCursor, known: args.source in LIBRARY_SOURCES };
  },
});

/** Records this import dropped as duplicates of a higher-priority source's
 * record: if an earlier run stored them, they're archived (not deleted —
 * entries already logged keep their snapshot) so search shows the food once.
 * A later run that keeps one again restores it (upsertAction). */
export const archiveDuplicates = internalMutation({
  args: { records: v.array(v.object({ source: v.string(), sourceId: v.string(), keptAs: v.string() })), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (args.records.length > MAX_BATCH) throw new Error(`Batch too large (${args.records.length} > ${MAX_BATCH})`);
    let archived = 0;
    for (const r of args.records) {
      const existing = await ctx.db
        .query("foods")
        .withIndex("by_source_and_sourceId", (q) => q.eq("source", r.source).eq("sourceId", r.sourceId))
        .unique();
      if (!existing || existing.isArchived) continue;
      archived++;
      if (args.dryRun) continue;
      const flags = new Set(existing.qualityFlags ?? []);
      flags.add("superseded_duplicate");
      await ctx.db.patch(existing._id, { isArchived: true, qualityFlags: [...flags], lastModifiedAt: new Date().toISOString() });
    }
    return { archived };
  },
});
