// Nutrition › Search Foods — live Edamam search (foodSearch.ts is the action).
//
// One human search = at most ONE Edamam request, made only for a query long
// enough to mean something, through the same deployment-wide gate as the AI
// Macro Calculator (edamamLimiter.ts). Nothing Edamam returns is stored here:
// results go straight back to the app, and only what the user confirms is
// logged — as a minimal snapshot (nutrition/logEntry.ts), never into `foods`.
//
// Only `fetch` — no Convex — so it's tested against a stubbed Edamam
// (tests/nutrition/foodSearch.test.ts).

import type { EdamamGate } from "./edamamLookup.ts";

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
/** Edamam results shown per search (its first page holds 20). */
export const MAX_EDAMAM_RESULTS = 15;
/** Sombrey-owned foods shown above them. */
export const MAX_SOMBREY_RESULTS = 8;
/** Serving measures offered per food, besides grams. */
export const MAX_MEASURES = 6;
/** A search waits at most this long for a shared Edamam token — someone is
 * typing; past that it says "busy" instead of queueing behind photo analyses. */
export const SEARCH_MAX_WAIT_MS = 1_500;
/** Per-user fairness on top of the shared bucket (edamamLimiter.ts): a burst
 * of 6 searches, then 15 a minute — far more than a person typing with the
 * app's debounce makes, far less than the shared 45/minute. */
export const SEARCH_USER_QUOTA = { capacity: 6, refillPerMs: 15 / 60_000, maxWaitMs: 0, cooldownMs: 0 } as const;
const REQUEST_TIMEOUT_MS = 8_000;

/** One Edamam food as the app needs it. Nutrition is Edamam's per-100 g
 * (edible portion) value; a macro Edamam doesn't give is `null`, not 0. */
export type ExternalFood = {
  externalId: string;
  name: string;
  brand?: string;
  /** "Generic foods" | "Packaged foods" | "Generic meals" | "Fast foods" */
  category?: string;
  per100g: { calories: number; protein: number | null; carbs: number | null; fat: number | null };
  /** Edamam's serving measures with their gram weight ("Serving", "Whole, large", "Cup"…). */
  measures: Array<{ label: string; grams: number }>;
};

export type EdamamSearchStatus = "ok" | "rate_limited" | "unavailable" | "error";

// ─── Query ────────────────────────────────────────────────────────────────────

/** The query as searched: trimmed, single-spaced, capped — or null when it's
 * too short to search (no request is made for it). */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

// Plain units, not servings: grams already covers weight, and a "1 g per
// milliliter" measure isn't a portion anyone counts in.
const WEIGHT_UNITS = new Set(["gram", "kilogram", "ounce", "pound", "milliliter", "liter"]);

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Serving measures, most useful first. Edamam gives every measure's gram
 * weight, so each one reduces to grams — the per-100 g values are the only
 * nutrition used, whichever way the user counts the portion. */
function parseMeasures(raw: unknown): Array<{ label: string; grams: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ label: string; grams: number }> = [];
  const seen = new Set<string>();
  const add = (label: unknown, weight: unknown) => {
    if (typeof label !== "string" || !label.trim()) return;
    const grams = finiteOrNull(weight);
    if (!grams || grams <= 0 || grams > 5_000) return;
    const key = label.trim().toLowerCase();
    if (WEIGHT_UNITS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ label: label.trim(), grams: Math.round(grams * 10) / 10 });
  };
  for (const m of raw as Array<Record<string, unknown>>) {
    add(m?.label, m?.weight);
    // "Whole" → "Whole, large" etc., each with its own weight.
    if (Array.isArray(m?.qualified)) {
      for (const q of m.qualified as Array<Record<string, unknown>>) {
        const words = Array.isArray(q?.qualifiers) ? (q.qualifiers as Array<Record<string, unknown>>).map((x) => x?.label).filter((x): x is string => typeof x === "string") : [];
        if (words.length) add(`${m.label}, ${words.join(" ")}`, q?.weight);
      }
    }
  }
  // "Serving" first when Edamam has one — it's what a label or menu means.
  out.sort((a, b) => Number(b.label.toLowerCase() === "serving") - Number(a.label.toLowerCase() === "serving"));
  return out.slice(0, MAX_MEASURES);
}

/** Edamam parser response → foods, deduplicated by Edamam food id (`parsed`
 * repeats `hints`), in Edamam's order. Entries without an id, a label or a
 * calorie value are skipped — nothing is invented for them. */
export function parseEdamamFoods(data: unknown, limit = MAX_EDAMAM_RESULTS): ExternalFood[] {
  const d = data as { parsed?: unknown; hints?: unknown } | null;
  const entries = [
    ...(Array.isArray(d?.parsed) ? d.parsed : []),
    ...(Array.isArray(d?.hints) ? d.hints : []),
  ] as Array<{ food?: Record<string, unknown>; measures?: unknown }>;
  const byId = new Map<string, ExternalFood>();
  for (const entry of entries) {
    const food = entry?.food;
    const id = food?.foodId;
    const label = food?.label;
    const n = food?.nutrients as Record<string, unknown> | undefined;
    const kcal = finiteOrNull(n?.ENERC_KCAL);
    if (typeof id !== "string" || typeof label !== "string" || !label.trim() || kcal === null || kcal > 1_000) continue;
    const measures = parseMeasures(entry.measures);
    const existing = byId.get(id);
    if (existing) {
      // `parsed` entries carry no measures — take the hint's.
      if (!existing.measures.length && measures.length) existing.measures = measures;
      continue;
    }
    if (byId.size >= limit) continue;
    byId.set(id, {
      externalId: id,
      name: label.trim().slice(0, 120),
      brand: typeof food?.brand === "string" && food.brand.trim() ? food.brand.trim().slice(0, 80) : undefined,
      category: typeof food?.category === "string" ? food.category : undefined,
      per100g: {
        calories: kcal,
        // A macro can't exceed the food's own weight.
        protein: capped(n?.PROCNT),
        carbs: capped(n?.CHOCDF),
        fat: capped(n?.FAT),
      },
      measures,
    });
  }
  return [...byId.values()];
}

const capped = (v: unknown) => {
  const x = finiteOrNull(v);
  return x === null || x > 100 ? null : x;
};

// ─── Deduplication ────────────────────────────────────────────────────────────

/** Names compared as words: case, punctuation and spacing don't matter. */
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
const nameKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** An Edamam result that's effectively a Sombrey-owned food already listed
 * (same name, not a branded product) isn't shown twice — the Sombrey food
 * wins. Nothing is copied anywhere to do this. */
export function withoutSombreyDuplicates(edamam: ExternalFood[], sombreyNames: string[]): ExternalFood[] {
  const own = new Set(sombreyNames.map(nameKey));
  return edamam.filter((f) => f.brand !== undefined || !own.has(nameKey(f.name)));
}

// ─── Request ──────────────────────────────────────────────────────────────────

/** One search → at most one Edamam request, through the shared gate. No
 * automatic retry: a 429 puts every Edamam caller in the shared cooldown and
 * the user is told to try again shortly. */
export async function searchEdamam(query: string, appId: string, appKey: string, gate: EdamamGate): Promise<{ status: EdamamSearchStatus; foods: ExternalFood[]; detail?: string }> {
  if (!(await gate.acquire())) return { status: "rate_limited", foods: [] };
  const url =
    `https://api.edamam.com/api/food-database/v2/parser` +
    `?ingr=${encodeURIComponent(query)}` +
    `&app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}` +
    // "logging": Edamam's mode for foods as eaten (the photo analysis keeps "cooking").
    `&nutrition-type=logging`;
  let resp: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    resp = await fetch(url, { signal: abort.signal });
  } catch {
    return { status: "error", foods: [], detail: "network" };
  } finally {
    clearTimeout(timer);
  }
  if (resp.status === 429) {
    await gate.rateLimited();
    return { status: "rate_limited", foods: [] };
  }
  // Credentials rejected / plan problem: Edamam is unavailable to us, not "no results".
  if (resp.status === 401 || resp.status === 403) return { status: "unavailable", foods: [], detail: `http_${resp.status}` };
  if (!resp.ok) return { status: "error", foods: [], detail: `http_${resp.status}` };
  try {
    return { status: "ok", foods: parseEdamamFoods(await resp.json()) };
  } catch {
    return { status: "error", foods: [], detail: "parse" };
  }
}
