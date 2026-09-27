// Semantic food matching for the AI Macro Calculator (ai/cameraAnalysis.ts).
//
// Gemini says WHAT a food is, in WHAT preparation state, and how much of it
// is on the plate (served weight). Edamam gives nutrition per 100 g. The
// state matters as much as the identity: 100 g of cooked pasta is ~158 kcal,
// 100 g of dry pasta ~371. Edamam's parser drops most cooking words from a
// query ("boiled pasta" → "Pasta", the dry entry), so the query alone can't
// be trusted: every candidate Edamam returns is judged by its LABEL, and one
// whose state contradicts the food's is never used.
//
// Pure — no I/O — so the rules are tested directly (tests/nutrition).

export const PREPARATION_STATES = ["raw", "dry", "cooked", "fried", "baked", "grilled", "boiled", "steamed", "roasted", "unknown"] as const;
export type PreparationState = (typeof PREPARATION_STATES)[number];
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** One food as Gemini described it, normalised. */
export type IdentifiedFood = {
  foodName: string;
  preparationState: PreparationState;
  grams: number;            // served (as-seen) weight
  confidence: Confidence;
};

/** One Edamam candidate (a `parsed` or `hints` entry), reduced. */
export type Candidate = { label: string; category?: string; kcal: number; protein: number; carbs: number; fat: number };

export type MatchChoice = {
  candidate: Candidate;
  /** The label states the preparation that was looked for (or, for raw/dry,
   * is a plain generic entry — Edamam's generics are the raw/dry values). */
  preparationMatched: boolean;
};

// ─── Preparation words ───────────────────────────────────────────────────────

// ("fresh" isn't one: "Fresh Plain Cooked Pasta" is cooked.)
const RAW_WORDS = ["raw", "dry", "dried", "uncooked", "unprepared"];
// Words in a label that say the food has been cooked in some way.
const COOKED_WORDS: Record<Exclude<PreparationState, "raw" | "dry" | "unknown">, string[]> = {
  cooked: ["cooked", "prepared", "boiled", "steamed", "canned", "poached", "simmered"],
  boiled: ["boiled", "cooked", "prepared", "poached", "simmered"],
  steamed: ["steamed", "cooked", "prepared"],
  fried: ["fried", "deep", "pan", "sauteed", "sautéed", "stir"],
  baked: ["baked", "oven", "roasted", "roast"],
  grilled: ["grilled", "broiled", "chargrilled", "barbecued", "bbq"],
  roasted: ["roasted", "roast", "baked", "oven"],
};
const GENERIC_COOKED = ["cooked", "prepared"];
const METHOD_WORDS = new Set(Object.values(COOKED_WORDS).flat());
const ALL_COOKED_WORDS = new Set(Object.values(COOKED_WORDS).flat().filter((w) => w !== "deep" && w !== "pan" && w !== "stir" && w !== "oven"));

const PREPARATION_SYNONYMS: Record<string, PreparationState> = {
  raw: "raw", uncooked: "dry", dry: "dry", dried: "dry",
  cooked: "cooked", prepared: "cooked", canned: "cooked", poached: "boiled", simmered: "boiled",
  fried: "fried", "pan-fried": "fried", "pan fried": "fried", "deep-fried": "fried", "deep fried": "fried", "stir-fried": "fried", "stir fried": "fried", sauteed: "fried", sautéed: "fried",
  baked: "baked", grilled: "grilled", broiled: "grilled", barbecued: "grilled", chargrilled: "grilled",
  boiled: "boiled", steamed: "steamed", roasted: "roasted", roast: "roasted",
};

/** Any model wording → the controlled state. Never guesses: anything it
 * doesn't recognise is `unknown`. */
export function normalizePreparation(raw: unknown): PreparationState {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toLowerCase();
  if ((PREPARATION_STATES as readonly string[]).includes(s)) return s as PreparationState;
  return PREPARATION_SYNONYMS[s] ?? "unknown";
}

const isCookedFamily = (p: PreparationState) => p !== "raw" && p !== "dry" && p !== "unknown";

// ─── Water-absorbing staples ─────────────────────────────────────────────────
//
// Grains, pasta and legumes take up water when cooked, so cooked and dry
// differ ~2.5–5× per 100 g. On a plate they're essentially always cooked, and
// Edamam's plain entry for them is the DRY value — the combination behind the
// 600 g pasta ≈ 2,226 kcal estimate.

const STAPLE_WORDS = new Set([
  "pasta", "spaghetti", "penne", "macaroni", "fusilli", "linguine", "fettuccine", "tagliatelle", "rigatoni", "farfalle", "orzo", "lasagna", "noodle", "ramen", "udon", "soba", "vermicelli",
  "rice", "risotto", "oat", "oatmeal", "porridge", "quinoa", "couscous", "bulgur", "barley", "millet", "buckwheat", "farro", "polenta", "grits",
  "bean", "lentil", "chickpea", "garbanzo", "dal", "dhal",
]);
// Per-100 g energy that separates the two states for these foods: cooked
// entries sit around 70–220 kcal, dry ones 330–390.
const STAPLE_COOKED_MAX_KCAL = 250;

export function isStateSensitiveStaple(foodName: string): boolean {
  return tokens(foodName).some((t) => STAPLE_WORDS.has(t));
}

// ─── Labels ──────────────────────────────────────────────────────────────────

// Words that make a label a different dish from the food asked for.
const DISH_WORDS = new Set([
  "sauce", "soup", "salad", "pudding", "bake", "casserole", "candy", "hummus", "salsa", "taco", "blt", "curry", "bread", "cake", "patty", "pattie", "pie", "bar", "chip", "cracker", "cookie", "muffin", "stew", "sandwich", "wrap", "burger", "pizza", "dip", "spread", "flour", "flake", "crispbread", "cereal", "drink", "juice", "milk", "smoothie",
]);
const FILLER = new Set(["with", "without", "and", "or", "of", "in", "the", "a", "salt", "added", "enriched", "unenriched", "plain", "whole", "generic", "style", "mature", "seed", "drained", "organic", "fresh", "regular", "hard", "soft", "skinless", "boneless"]);

function singular(w: string): string {
  if (w.length <= 3 || w.endsWith("ss") || w.endsWith("us")) return w;
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function tokens(s: string): string[] {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(Boolean).map(singular);
}

const stateWords = (ws: string[]) => ({
  raw: ws.some((w) => RAW_WORDS.includes(w)),
  cooked: ws.some((w) => ALL_COOKED_WORDS.has(w)),
});

// ─── Queries ─────────────────────────────────────────────────────────────────

/** The Edamam queries for a food, most specific first. A known state is
 * always part of the query; the bare name comes last and only widens the
 * candidate pool (its candidates are still judged by label). */
export function matchQueries(food: Pick<IdentifiedFood, "foodName" | "preparationState">): { name: string; queries: string[]; state: PreparationState; assumed: boolean } {
  const name = food.foodName.trim().toLowerCase();
  // Strip a state word the model folded into the name ("cooked rice"), so
  // the state is expressed once and consistently.
  const words = name.split(/\s+/);
  const bare = words.filter((w) => normalizePreparation(w) === "unknown").join(" ") || name;
  let state = food.preparationState;
  // …but a more specific state in the name wins over none / plain "cooked"
  // ("fried rice" said to be cooked is fried).
  const named = words.map(normalizePreparation).find((p) => p !== "unknown");
  if (named && (state === "unknown" || (state === "cooked" && isCookedFamily(named)))) state = named;
  // A water-absorbing staple of unknown state on a plate is served cooked:
  // matched as cooked and marked as an assumption — never silently dry.
  if (state === "unknown" && isStateSensitiveStaple(bare)) state = "cooked";
  const q: string[] = [];
  if (state === "unknown") q.push(bare);
  else if (state === "raw") q.push(bare, `raw ${bare}`);
  else if (state === "dry") q.push(bare, `dry ${bare}`, `uncooked ${bare}`);
  else {
    if (state !== "cooked") q.push(`${state} ${bare}`);
    q.push(`cooked ${bare}`, `${bare}, cooked`, bare);
  }
  return { name: bare, queries: [...new Set(q)], state, assumed: food.preparationState === "unknown" && named === undefined && state !== "unknown" };
}

// ─── Choosing a candidate ────────────────────────────────────────────────────

/** Scores one candidate for the food, or `null` when it must not be used:
 * a different food, a different dish, a contradicting preparation state, or
 * (for staples) an energy density that belongs to the other state. */
export function scoreCandidate(foodName: string, state: PreparationState, c: Candidate): { score: number; preparationMatched: boolean } | null {
  const want = tokens(foodName).filter((w) => !FILLER.has(w) && normalizePreparation(w) === "unknown");
  const have = tokens(c.label);
  if (want.length === 0) return null;
  const head = want[want.length - 1];
  if (!have.includes(head)) return null;
  const extra = have.filter((w) => !want.includes(w) && !FILLER.has(w) && !RAW_WORDS.includes(w) && !METHOD_WORDS.has(w));
  if (extra.some((w) => DISH_WORDS.has(w))) return null;

  const words = stateWords(have);
  let preparationMatched: boolean;
  if (state === "unknown") {
    preparationMatched = false;
  } else if (state === "raw" || state === "dry") {
    if (words.cooked) return null;
    preparationMatched = true; // a raw/dry word, or a plain generic (raw) entry
  } else {
    if (words.raw) return null;
    // Plain "cooked" asked: any cooking except frying fits it. A named
    // method: that method (or its near synonyms, or a generic "cooked").
    const fits = state === "cooked" ? [...COOKED_WORDS.cooked, ...COOKED_WORDS.grilled, ...COOKED_WORDS.roasted] : [...COOKED_WORDS[state], ...GENERIC_COOKED];
    // A different cooking method stated outright (grilled asked, fried
    // label) is a different food energetically — not a match.
    if (have.some((w) => ALL_COOKED_WORDS.has(w) && !fits.includes(w))) return null;
    // Fried means in oil: air-/oven-"fried" entries carry a fraction of the fat.
    if (state === "fried" && have.some((w) => w === "air" || w === "oven" || w === "baked")) return null;
    preparationMatched = have.some((w) => fits.includes(w));
  }

  if (isStateSensitiveStaple(foodName) && Number.isFinite(c.kcal)) {
    const water = state === "cooked" || state === "boiled" || state === "steamed";
    if (water && c.kcal >= STAPLE_COOKED_MAX_KCAL) return null;
    if ((state === "raw" || state === "dry") && c.kcal < STAPLE_COOKED_MAX_KCAL) return null;
    // Fried/baked/… staples: the plain (dry) entry can't stand in for them.
    if (isCookedFamily(state) && !water && !preparationMatched && c.kcal >= STAPLE_COOKED_MAX_KCAL) return null;
  }

  const covered = want.filter((w) => have.includes(w)).length;
  // The exact method named in the label ranks above a generic "cooked".
  const exactState = state !== "unknown" && (have.includes(state) || (state !== "cooked" && isCookedFamily(state) && have.some((w) => COOKED_WORDS[state].includes(w))));
  const score =
    (preparationMatched ? 4 : 0) +
    (exactState ? 2 : 0) +
    (c.category === "Generic foods" ? 2 : 0) +
    covered * 2 -
    extra.length;
  return { score, preparationMatched };
}

/** The best usable candidate across the (ordered) candidates, or null. Ties
 * keep Edamam's own order. */
export function chooseCandidate(foodName: string, state: PreparationState, candidates: Candidate[]): MatchChoice | null {
  let best: (MatchChoice & { score: number }) | null = null;
  for (const c of candidates) {
    const s = scoreCandidate(foodName, state, c);
    if (s && (!best || s.score > best.score)) best = { candidate: c, preparationMatched: s.preparationMatched, score: s.score };
  }
  return best && { candidate: best.candidate, preparationMatched: best.preparationMatched };
}

/** Nutrition for the served portion from a per-100 g candidate. */
export function scaleCandidate(c: Candidate, grams: number) {
  const f = grams / 100;
  const r1 = (x: number) => Math.round(x * f * 10) / 10;
  return { calories: Math.round(c.kcal * f), protein: r1(c.protein), carbs: r1(c.carbs), fat: r1(c.fat) };
}

// ─── Gemini output ───────────────────────────────────────────────────────────

/** Gemini's text → foods. Accepts the structured shape and the older one
 * (`grams`, free-text `preparation`); drops entries without a name or a
 * usable weight. Throws on anything that isn't a JSON array. */
export function parseIdentifiedFoods(text: string): IdentifiedFood[] {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("not an array");
  const out: IdentifiedFood[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const foodName = typeof r.foodName === "string" ? r.foodName.trim() : "";
    const grams = Number(r.estimatedWeightGrams ?? r.grams);
    if (!foodName || !Number.isFinite(grams) || grams <= 0) continue;
    const confidence = typeof r.confidence === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(r.confidence.toLowerCase())
      ? (r.confidence.toLowerCase() as Confidence) : "medium";
    out.push({ foodName, preparationState: normalizePreparation(r.preparationState ?? r.preparation), grams: Math.min(Math.round(grams), 3000), confidence });
  }
  return out;
}
