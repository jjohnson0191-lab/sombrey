// Edamam nutrition lookup for the AI Macro Calculator (ai/cameraAnalysis.ts):
// identity + preparation-state matching (foodMatch.ts) inside the request
// budget (edamamBudget.ts). Only `fetch` — no Convex — so it's tested
// directly against a stubbed Edamam (tests/nutrition/edamamLookup.test.ts).

import { AnalysisBudget } from "./edamamBudget.ts";
import {
  chooseCandidate, matchQueries, scaleCandidate,
  type Candidate, type Confidence, type IdentifiedFood, type MatchChoice, type PreparationState,
} from "./foodMatch.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnalyzedFoodItem = {
  foodName: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  edamamMatched: boolean;
  /** As Gemini saw it (controlled set), and how sure it was. */
  preparationState: PreparationState;
  confidence: Confidence;
  /** The Edamam entry the nutrition came from. */
  matchedFood?: string;
  /** That entry's label states the preparation (see nutrition/foodMatch.ts). */
  preparationMatched: boolean;
  /** The state was unknown and a staple was matched as cooked. */
  preparationAssumed: boolean;
  /** Why there's no nutrition: rate_limited | budget | no_safe_match | http_… | network. */
  lookupIssue?: string;
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** One Edamam parser query → its candidates (`parsed` first, then hints). */
export async function edamamCandidates(query: string, appId: string, appKey: string): Promise<{ candidates: Candidate[]; failure?: string }> {
  const url =
    `https://api.edamam.com/api/food-database/v2/parser` +
    `?ingr=${encodeURIComponent(query)}` +
    `&app_id=${appId}&app_key=${appKey}` +
    `&nutrition-type=cooking`;
  try {
    const resp = await fetch(url);
    // The HTTP status (never the key) is kept so a failing provider is
    // diagnosable instead of silently reading as "no match".
    if (!resp.ok) {
      // Edamam's own reason (credentials never included: the app id is
      // redacted from the echo, the key isn't in responses).
      const raw = (await resp.text().catch(() => "")).split(appId).join("[app_id]");
      let message = "";
      try { message = String((JSON.parse(raw) as { message?: unknown }).message ?? "").slice(0, 120); } catch { /* HTML error page */ }
      return { candidates: [], failure: `http_${resp.status}${message ? ` ${message}` : ""}` };
    }
    const data = await resp.json() as { parsed?: Array<{ food?: unknown }>; hints?: Array<{ food?: unknown }> };
    const candidates: Candidate[] = [];
    for (const entry of [...(data.parsed ?? []), ...(data.hints ?? [])]) {
      const food = entry.food as { label?: unknown; category?: unknown; nutrients?: Record<string, unknown> } | undefined;
      const n = food?.nutrients;
      if (typeof food?.label !== "string" || !n || typeof n.ENERC_KCAL !== "number") continue;
      candidates.push({
        label: food.label,
        category: typeof food.category === "string" ? food.category : undefined,
        kcal: n.ENERC_KCAL,
        protein: Number(n.PROCNT ?? 0),
        carbs: Number(n.CHOCDF ?? 0),
        fat: Number(n.FAT ?? 0),
      });
    }
    return candidates.length ? { candidates } : { candidates, failure: "no_hints" };
  } catch {
    return { candidates: [], failure: "network" };
  }
}

/** The deployment-wide Edamam gate (edamamLimiter.ts): `acquire` waits
 * for a reserved hit (false: none within the wait limit, don't call);
 * `rateLimited` reports a 429 so every analysis backs off. */
export type EdamamGate = { acquire(): Promise<boolean>; rateLimited(): Promise<void> };

type Lookup = { candidates: Candidate[]; failure?: string };

/** One analysis's Edamam traffic: every distinct query is made at most once
 * (duplicate foods share it), every hit counts against the analysis budget
 * and passes the deployment-wide gate. No automatic retries. */
export class EdamamSession {
  private readonly made = new Map<string, Promise<Lookup>>();
  readonly budget = new AnalysisBudget();
  private readonly appId: string;
  private readonly appKey: string;
  private readonly gate: EdamamGate;
  constructor(appId: string, appKey: string, gate: EdamamGate) { this.appId = appId; this.appKey = appKey; this.gate = gate; }

  query(q: string): Promise<Lookup> {
    const key = q.trim().toLowerCase();
    let p = this.made.get(key);
    if (!p) {
      p = (async (): Promise<Lookup> => {
        if (!this.budget.take()) return { candidates: [], failure: "budget" };
        if (!(await this.gate.acquire())) return { candidates: [], failure: "rate_limited" };
        const r = await edamamCandidates(key, this.appId, this.appKey);
        if (r.failure?.startsWith("http_429")) {
          await this.gate.rateLimited();
          return { candidates: [], failure: "rate_limited" };
        }
        return r;
      })();
      this.made.set(key, p);
    }
    return p;
  }
}

const PROVIDER_FAILURE = (f: string | undefined) => f === "rate_limited" || f === "budget" || f === "network" || !!f?.startsWith("http_");

/** Nutrition for the identified foods, matched on identity AND preparation
 * state (nutrition/foodMatch.ts), within the Edamam budget:
 *   1. every distinct food's most informative query (all foods first), and
 *      the whole candidate set it returns is judged by label;
 *   2. only for a food with no state-matching entry, ONE fallback query.
 * An entry that contradicts the state is never used — no match beats a
 * wrong one. */
export async function lookupAll(foods: IdentifiedFood[], session: EdamamSession): Promise<AnalyzedFoodItem[]> {
  const plans = foods.map((f) => matchQueries(f));
  const pools: Candidate[][] = plans.map(() => []);
  const issues: (string | undefined)[] = plans.map(() => undefined);
  const choices: (MatchChoice | null)[] = plans.map(() => null);
  const settled = (i: number) => {
    const c = choices[i];
    return !!c && (c.preparationMatched || plans[i].state === "unknown");
  };

  for (const round of [0, 1]) {
    await Promise.all(plans.map(async (plan, i) => {
      const q = plan.queries[round];
      if (!q || settled(i) || PROVIDER_FAILURE(issues[i])) return;
      const r = await session.query(q);
      if (r.failure) issues[i] = r.failure;
      pools[i].push(...r.candidates);
      choices[i] = chooseCandidate(plan.name, plan.state, pools[i]);
    }));
  }

  return foods.map((food, i) => {
    const base = {
      foodName: food.foodName,
      grams: food.grams,
      preparationState: food.preparationState,
      confidence: food.confidence,
      preparationAssumed: plans[i].assumed,
    };
    const choice = choices[i];
    if (!choice) {
      const issue = PROVIDER_FAILURE(issues[i]) ? issues[i]! : "no_safe_match";
      return { ...base, calories: 0, protein: 0, carbs: 0, fat: 0, edamamMatched: false, preparationMatched: false, lookupIssue: issue };
    }
    return { ...base, ...scaleCandidate(choice.candidate, food.grams), edamamMatched: true, matchedFood: choice.candidate.label, preparationMatched: choice.preparationMatched };
  });
}
