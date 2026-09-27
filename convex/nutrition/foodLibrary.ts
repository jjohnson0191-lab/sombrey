// The Sombrey Food Library — foods Sombrey is licensed to STORE, imported from
// an approved dataset into the canonical `foods` table (convex/foodLibrary.ts)
// and searched there directly (foods:search). Architecturally separate from
// the live Edamam lookups (Macro Calculator, Search Foods' optional Edamam
// results): nothing here calls Edamam, and nothing from Edamam lands here.
//
//   dataset file → source adapter (scripts/food-library/sources/*)
//     → LibraryCandidate → validateCandidate (this file) → LibraryRecord
//     → deduplicate → foodLibrary:upsertBatch (idempotent on source + sourceId)
//
// Every value comes from the dataset: nothing is estimated or filled in. A
// record missing a required nutrient is rejected, not completed; a record
// that's merely questionable is imported with `qualityFlags` saying why.
//
// Pure — no I/O — so the rules are tested directly (tests/nutrition) and the
// server re-checks every record it's sent with the same code.

import type { PreparationState } from "./foodMatch.ts";

// ─── Sources ──────────────────────────────────────────────────────────────────

/** Approved datasets. Adding one (e.g. a Sri Lankan food composition table)
 * = an adapter that yields LibraryCandidates + an entry here. */
export const LIBRARY_SOURCES = {
  usda_fdc_foundation: { label: "USDA FoodData Central — Foundation Foods", license: "CC0 1.0 (public domain)", priority: 1 },
  usda_fdc_sr_legacy: { label: "USDA FoodData Central — SR Legacy", license: "CC0 1.0 (public domain)", priority: 2 },
} as const;
export type LibrarySource = keyof typeof LIBRARY_SOURCES;
export const isLibrarySource = (s: unknown): s is LibrarySource => typeof s === "string" && s in LIBRARY_SOURCES;

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** What an adapter produces from one dataset row — values as the dataset
 * states them, units named, nothing inferred. */
export type LibraryCandidate = {
  source: string;
  sourceId: string;
  sourceVersion: string;
  name: string;
  category?: string;
  brand?: string;
  /** "generic" unless the dataset marks a branded product. */
  kind?: "generic" | "branded";
  /** Nutrition for `basisGrams` grams (normally 100) of the food as described. */
  nutrients: {
    basisGrams: number;
    energy?: { value: number; unit: "kcal" | "kJ" };
    protein?: number;   // g
    carbs?: number;     // g (total, by difference where the dataset uses that)
    fat?: number;       // g
  };
  /** Household portions with their gram weight, in the dataset's order. */
  portions?: Array<{ label: string; grams: number }>;
  /** A cross-dataset identity (USDA NDB number): same food, newer analysis. */
  crossRef?: string;
  /** What the adapter noticed about the source values (e.g. which of the
   * dataset's energy or carbohydrate definitions was used). */
  flags?: string[];
};

export type LibraryRecord = {
  source: LibrarySource;
  sourceId: string;
  sourceVersion: string;
  name: string;
  searchName: string;
  category?: string;
  brand?: string;
  kind: "generic" | "branded";
  preparationState?: PreparationState;
  per100g: { calories: number; protein: number; carbs: number; fat: number };
  portions: Array<{ label: string; grams: number }>;
  serving: { label: string; grams: number };
  qualityFlags: string[];
  crossRef?: string;
};

export type Rejection = { sourceId: string; name: string; reason: string };

// ─── Names ────────────────────────────────────────────────────────────────────

/** The normalised form searched: lower case, accents folded, punctuation as
 * word breaks, single spaces. ("Chicken, broilers or fryers, breast…" →
 * "chicken broilers or fryers breast …"; "Crème brûlée" → "creme brulee".) */
export function searchNameOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The display name: the dataset's own wording, whitespace tidied. */
export function displayNameOf(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

// ─── Preparation state ───────────────────────────────────────────────────────

// Words in a dataset description that STATE the preparation. Only stated —
// a description without one gets no state (never a guess).
const PREP_WORDS: Array<[RegExp, PreparationState]> = [
  [/\b(raw|fresh raw)\b/, "raw"],
  [/\b(dry|uncooked|unprepared|dry form)\b/, "dry"],
  [/\b(fried|pan[- ]fried|deep[- ]fried|stir[- ]fried|sauteed)\b/, "fried"],
  [/\b(grilled|broiled|barbecued)\b/, "grilled"],
  [/\b(roasted|roast)\b/, "roasted"],
  [/\b(baked)\b/, "baked"],
  [/\b(boiled|poached|simmered)\b/, "boiled"],
  [/\b(steamed)\b/, "steamed"],
  [/\b(cooked|braised|stewed|microwaved|prepared|heated)\b/, "cooked"],
];

/** The preparation the description states, or undefined. "Raw" wins only
 * when no cooking word is present ("cooked from raw" isn't raw). */
export function preparationOf(name: string): PreparationState | undefined {
  const s = searchNameOf(name);
  const found = PREP_WORDS.filter(([re]) => re.test(s)).map(([, p]) => p);
  if (!found.length) return undefined;
  const cooked = found.find((p) => p !== "raw" && p !== "dry");
  if (cooked) return cooked;
  return found[0];
}

// ─── Validation ───────────────────────────────────────────────────────────────

const KJ_PER_KCAL = 4.184;
const r1 = (v: number) => Math.round(v * 10) / 10;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Physically possible per 100 g: pure fat is ~900 kcal. */
export const MAX_KCAL_PER_100G = 902;
/** P + C + F can't exceed the food's own weight (small allowance for the
 * dataset's own rounding). */
export const MAX_MACROS_PER_100G = 101;

/** Energy the macros imply (Atwater general factors). */
export const atwaterKcal = (p: { protein: number; carbs: number; fat: number }) => 4 * p.protein + 4 * p.carbs + 9 * p.fat;

/** One candidate → a record ready to store, or the reason it can't be. */
export function validateCandidate(c: LibraryCandidate): { record: LibraryRecord } | { rejection: Rejection } {
  const sourceId = typeof c?.sourceId === "string" ? c.sourceId.trim() : "";
  const name = typeof c?.name === "string" ? displayNameOf(c.name) : "";
  const reject = (reason: string) => ({ rejection: { sourceId, name, reason } });

  if (!isLibrarySource(c?.source)) return reject("unknown_source");
  if (!sourceId || sourceId.length > 64) return reject("missing_source_id");
  if (!name || name.length > 200) return reject("missing_name");
  if (typeof c.sourceVersion !== "string" || !c.sourceVersion.trim()) return reject("missing_source_version");
  const searchName = searchNameOf(name);
  if (searchName.length < 2) return reject("missing_name");

  const n = c.nutrients;
  if (!n || !finite(n.basisGrams) || n.basisGrams <= 0) return reject("bad_basis");
  if (!n.energy || !finite(n.energy.value)) return reject("missing_energy");
  if (n.energy.unit !== "kcal" && n.energy.unit !== "kJ") return reject("bad_energy_unit");
  for (const [k, v] of [["protein", n.protein], ["carbs", n.carbs], ["fat", n.fat]] as const) {
    if (v === undefined || v === null) return reject(`missing_${k}`);
    if (!finite(v)) return reject(`bad_${k}`);
  }
  // Carbohydrate "by difference" (100 g − water − protein − fat − ash) comes
  // out slightly below zero for meat and fish — analytical noise meaning
  // none. Within 1 g it's recorded as 0 and flagged; anything else negative
  // is a bad record.
  let carbs = n.carbs!;
  const preFlags: string[] = [];
  if (carbs < 0 && carbs > -1) {
    carbs = 0;
    preFlags.push("carbs_negative_as_zero");
  }
  const values = [n.energy.value, n.protein!, carbs, n.fat!];
  if (values.some((v) => v < 0)) return reject("negative_value");

  // Normalise: kcal, per 100 g.
  const scale = 100 / n.basisGrams;
  const kcal = (n.energy.unit === "kJ" ? n.energy.value / KJ_PER_KCAL : n.energy.value) * scale;
  const per100g = { calories: Math.round(kcal), protein: r1(n.protein! * scale), carbs: r1(carbs * scale), fat: r1(n.fat! * scale) };
  if (per100g.calories > MAX_KCAL_PER_100G) return reject("impossible_energy");
  if (per100g.protein > 100 || per100g.carbs > 100 || per100g.fat > 100) return reject("impossible_macro");
  if (per100g.protein + per100g.carbs + per100g.fat > MAX_MACROS_PER_100G) return reject("impossible_macro_total");

  const qualityFlags: string[] = [
    ...(Array.isArray(c.flags) ? c.flags : []).filter((f): f is string => typeof f === "string" && /^[a-z0-9_]{1,40}$/.test(f)),
    ...preFlags,
  ];
  // Energy that disagrees with the macros: often legitimate (alcohol, polyols,
  // fibre-rich foods, specific Atwater factors) — flagged for review, kept.
  const implied = atwaterKcal(per100g);
  if (Math.abs(per100g.calories - implied) > Math.max(40, 0.25 * Math.max(per100g.calories, implied))) qualityFlags.push("energy_macro_mismatch");
  if (per100g.calories === 0 && implied > 5) qualityFlags.push("zero_energy_with_macros");

  // Portions: keep only real gram weights; say when some were dropped.
  const portions: Array<{ label: string; grams: number }> = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const p of c.portions ?? []) {
    const label = typeof p?.label === "string" ? p.label.replace(/\s+/g, " ").trim() : "";
    if (!label || !finite(p.grams) || p.grams <= 0 || p.grams > 5_000 || label.length > 80) { dropped++; continue; }
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    portions.push({ label, grams: r1(p.grams) });
  }
  if (dropped) qualityFlags.push("portion_dropped");
  const firstPortion = portions.find((p) => !/^reference amount\b/i.test(p.label)) ?? portions[0];
  const serving = firstPortion ?? { label: "100 g", grams: 100 };

  const preparationState = preparationOf(name);
  const kind = c.kind === "branded" ? "branded" : "generic";
  return {
    record: {
      source: c.source,
      sourceId,
      sourceVersion: c.sourceVersion.trim(),
      name,
      searchName,
      category: typeof c.category === "string" && c.category.trim() ? c.category.trim().slice(0, 80) : undefined,
      brand: typeof c.brand === "string" && c.brand.trim() ? c.brand.trim().slice(0, 80) : undefined,
      kind,
      preparationState,
      per100g,
      portions: portions.slice(0, 8),
      serving,
      qualityFlags,
      crossRef: typeof c.crossRef === "string" && c.crossRef.trim() ? c.crossRef.trim() : undefined,
    },
  };
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/** The same food twice — within a dataset or across datasets — is stored
 * once. Two records are the same food when they share a cross-reference (USDA
 * NDB number: Foundation re-analyses an SR Legacy food) or the exact same
 * normalised name, kind and brand. The higher-priority source wins (Foundation's
 * newer analytical values over SR Legacy's); within a source, the first. */
export function deduplicate(records: LibraryRecord[]): { kept: LibraryRecord[]; duplicates: Array<{ dropped: LibraryRecord; keptAs: LibraryRecord; by: "cross_ref" | "name" }> } {
  const ordered = [...records].sort((a, b) => LIBRARY_SOURCES[a.source].priority - LIBRARY_SOURCES[b.source].priority);
  const byRef = new Map<string, LibraryRecord>();
  const byName = new Map<string, LibraryRecord>();
  const byId = new Set<string>();
  const kept: LibraryRecord[] = [];
  const duplicates: Array<{ dropped: LibraryRecord; keptAs: LibraryRecord; by: "cross_ref" | "name" }> = [];
  for (const r of ordered) {
    const idKey = `${r.source}:${r.sourceId}`;
    const nameKey = `${r.kind}|${r.brand ?? ""}|${r.searchName}`;
    if (byId.has(idKey)) continue; // literally the same row twice
    byId.add(idKey);
    const refMatch = r.crossRef ? byRef.get(r.crossRef) : undefined;
    const nameMatch = byName.get(nameKey);
    if (refMatch || nameMatch) {
      const keptAs = (refMatch ?? nameMatch)!;
      duplicates.push({ dropped: r, keptAs, by: refMatch ? "cross_ref" : "name" });
      // The dropped record's identities now point at the kept one, so a
      // later copy of the dropped record is caught too.
      if (r.crossRef && !byRef.has(r.crossRef)) byRef.set(r.crossRef, keptAs);
      if (!byName.has(nameKey)) byName.set(nameKey, keptAs);
      continue;
    }
    if (r.crossRef) byRef.set(r.crossRef, r);
    byName.set(nameKey, r);
    kept.push(r);
  }
  return { kept, duplicates };
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/** A stable fingerprint of what's stored for a record — an unchanged record
 * isn't rewritten when the import runs again. (FNV-1a; not security.) */
export function contentHash(r: LibraryRecord): string {
  const s = JSON.stringify([r.sourceVersion, r.name, r.category ?? "", r.brand ?? "", r.kind, r.preparationState ?? "", r.per100g, r.portions, r.serving, r.qualityFlags]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The `foods` fields for a library record. The per-serving fields that
 * existing logging (`logFood`, the web app) reads are the record's default
 * serving — derived from per-100 g × its gram weight, never separately
 * sourced — so both views of the food always agree. */
export function libraryFoodFields(r: LibraryRecord) {
  const f = r.serving.grams / 100;
  return {
    name: r.name,
    searchName: r.searchName,
    category: r.category,
    brand: r.brand,
    kind: r.kind,
    preparationState: r.preparationState,
    calories: Math.round(r.per100g.calories * f),
    protein: r1(r.per100g.protein * f),
    carbs: r1(r.per100g.carbs * f),
    fats: r1(r.per100g.fat * f),
    servingSize: "1",
    servingUnit: r.serving.label,
    servingGrams: r.serving.grams,
    caloriesPer100g: r.per100g.calories,
    proteinPer100g: r.per100g.protein,
    carbsPer100g: r.per100g.carbs,
    fatsPer100g: r.per100g.fat,
    portions: r.portions,
    source: r.source,
    sourceId: r.sourceId,
    sourceVersion: r.sourceVersion,
    sourceHash: contentHash(r),
    qualityFlags: r.qualityFlags.length ? r.qualityFlags : undefined,
    isCustom: false,
    isArchived: false,
  };
}

/** What an import does with one record, given what's stored for its
 * (source, sourceId): insert it, rewrite it (content changed), or leave it. */
export function upsertAction(existing: { sourceHash?: string } | null, r: LibraryRecord): "insert" | "update" | "unchanged" {
  if (!existing) return "insert";
  return existing.sourceHash === contentHash(r) ? "unchanged" : "update";
}

