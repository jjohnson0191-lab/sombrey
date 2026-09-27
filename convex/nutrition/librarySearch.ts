// Search Foods over the Sombrey Food Library (foods:search, foods:list):
// what text is searched. Pure — tested in tests/nutrition/foodLibrary.test.ts.

import { searchNameOf } from "./foodLibrary.ts";

export const LIBRARY_SEARCH_MIN_LENGTH = 2;
/** Convex full-text search reads at most 16 terms. */
const MAX_TERMS = 16;

/** The query as the index sees it (same normalisation as the stored
 * searchName), or null when it's too short to search. */
export function librarySearchTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const words = searchNameOf(raw.slice(0, 120)).split(" ").filter(Boolean).slice(0, MAX_TERMS);
  const term = words.join(" ");
  return term.length >= LIBRARY_SEARCH_MIN_LENGTH ? term : null;
}

// ─── Ranking ──────────────────────────────────────────────────────────────────
//
// Convex's full-text relevance favours short names that contain a word
// ("Fat, chicken" for "chicken"). Food datasets name foods head-first
// ("Chicken, breast, …, raw"), so the index's best CANDIDATES are re-ordered:
//   • the name's lead (before the first comma — past a group word such as
//     USDA's "Fish," or "Beverages,") is one of the searched words — best
//     when the lead is exactly the searched food ("Chicken," not "Chicken spread");
//   • every searched word is in the name, and the name starts with them;
//   • analytical Foundation Foods over older SR Legacy values; generic before
//     branded (USDA writes brands in capitals); everyday categories before
//     specialist ones (baby, fast/restaurant, Alaska Native);
//   • then the simpler name, then the index's own order.
// Singular and plural are the same word ("eggs" ~ "Egg", "banana" ~ "Bananas").

/** How many index matches are re-ranked (the page is cut from these). */
export const RANK_CANDIDATES = 200;

const SPECIALIST_CATEGORIES = new Set(["Baby Foods", "Fast Foods", "Restaurant Foods", "American Indian/Alaska Native Foods"]);
/** Leads that name a group, not the food ("Fish, salmon, pink, raw"). */
const GROUP_LEADS = new Set(["beverages", "nuts", "seeds", "spices", "snacks", "fish", "cereals", "cereals ready to eat", "candies", "alcoholic beverage"]);

const sameWord = (a: string, b: string) => a === b || a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a;

/** The words the INDEX is asked for: the query plus the singular of plural
 * words (the index matches whole words, the last one as a prefix). Ranking
 * still uses the query itself. */
export function indexTerm(term: string): string {
  const words = term.split(" ").filter(Boolean);
  const extra: string[] = [];
  for (const w of words) {
    if (w.length > 3 && w.endsWith("es")) extra.push(w.slice(0, -2), w.slice(0, -1));
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) extra.push(w.slice(0, -1));
  }
  return [...words, ...extra.filter((w) => !words.includes(w))].slice(0, 16).join(" ");
}

export type RankableFood = { name: string; category?: string; source?: string };

function leadWords(name: string): string[] {
  const parts = name.split(",").map((p) => searchNameOf(p)).filter(Boolean);
  const lead = parts[0] && GROUP_LEADS.has(parts[0]) && parts[1] ? parts[1] : (parts[0] ?? "");
  return lead.split(" ").filter(Boolean);
}

export function rankScore(term: string, food: RankableFood): number {
  const words = term.split(" ").filter(Boolean);
  if (!words.length) return 0;
  const lead = leadWords(food.name);
  const all = searchNameOf(food.name).split(" ").filter(Boolean);
  let score = 0;
  if (lead.length && words.some((q) => sameWord(lead[0], q))) {
    score += 3;
    // The lead IS the searched food ("Chicken, …"), not another food that
    // starts with it ("Chicken spread").
    if (lead.length <= words.length && lead.every((w) => words.some((q) => sameWord(w, q)))) score += 1;
  } else if (lead.some((w) => words.some((q) => sameWord(w, q)))) score += 1;
  if (words.every((q) => all.some((w) => sameWord(w, q)))) score += words.length > 1 ? 3 : 2;
  if (words.length > 1 && words.every((q, i) => all[i] !== undefined && sameWord(all[i], q))) score += 1;
  if (food.source === "usda_fdc_foundation") score += 1;
  // A brand in capitals ("QUAKER", "ABBOTT") — a product, not the food.
  if (/\b[A-Z][A-Z'&.-]{2,}\b/.test(food.name.replace(/\b(NFS|NS|USDA|RTE|UHT|NLEA)\b/g, ""))) score -= 2;
  if (food.category && SPECIALIST_CATEGORIES.has(food.category)) score -= 1;
  return score;
}

/** Candidates in the index's order → the order shown. Stable. */
export function rankFoods<T extends RankableFood>(term: string, candidates: T[]): T[] {
  return candidates
    .map((food, index) => ({ food, index, score: rankScore(term, food), parts: food.name.split(",").length, length: food.name.length }))
    .sort((a, b) => b.score - a.score || a.parts - b.parts || a.length - b.length || a.index - b.index)
    .map((x) => x.food);
}
