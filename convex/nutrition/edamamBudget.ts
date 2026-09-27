// Edamam request budget (ai/cameraAnalysis.ts, edamamLimiter.ts).
//
// The Edamam plan allows 50 hits per minute for the whole application —
// every analysis, every user, every entry point (native and web) share it.
// Two layers keep us under it:
//
//   1. Per analysis: a hard cap on hits, one primary query per distinct food,
//      at most one fallback, identical queries made once.
//   2. Across the deployment: one token bucket, reserved through a Convex
//      mutation (serialised, so concurrent analyses can't both take the last
//      token). Capacity + refill per minute ≤ 45 — no 60-second window can
//      ever see more than 45 hits, whatever the timing.
//
// Pure — no I/O — so the rules are tested directly (tests/nutrition).

export const EDAMAM_LIMIT_PER_MINUTE = 50;
export const BUCKET = {
  capacity: 12,                 // hits that may go out at once
  refillPerMs: 33 / 60_000,     // 33 per minute after that
  maxWaitMs: 20_000,            // a hit that would wait longer isn't made
  cooldownMs: 60_000,           // after a 429 nobody calls for a minute
} as const;
/** Worst case in any 60 s window: the full bucket plus a minute of refill. */
export const WORST_CASE_PER_MINUTE = BUCKET.capacity + BUCKET.refillPerMs * 60_000;

/** Most Edamam hits one photo analysis may make. */
export const MAX_HITS_PER_ANALYSIS = 20;

export type BucketState = { tokens: number; updatedAt: number; cooldownUntil?: number };
/** A bucket's rules (BUCKET, or a caller's stricter wait — see edamamLimiter.ts). */
export type BucketRules = { capacity: number; refillPerMs: number; maxWaitMs: number; cooldownMs: number };

/** Reserve one hit. `waitMs` is when it may be made; a reservation that
 * would wait longer than `maxWaitMs` (or falls in a cooldown) isn't taken. */
export function reserve(state: BucketState | null, now: number, b: BucketRules = BUCKET): { ok: boolean; waitMs: number; next: BucketState } {
  const prev = state ?? { tokens: b.capacity, updatedAt: now };
  if (prev.cooldownUntil !== undefined && now < prev.cooldownUntil) {
    return { ok: false, waitMs: prev.cooldownUntil - now, next: prev };
  }
  const refilled = Math.min(b.capacity, prev.tokens + Math.max(0, now - prev.updatedAt) * b.refillPerMs);
  const after = refilled - 1;
  const waitMs = after >= 0 ? 0 : Math.ceil(-after / b.refillPerMs);
  if (waitMs > b.maxWaitMs) return { ok: false, waitMs, next: { tokens: refilled, updatedAt: now } };
  return { ok: true, waitMs, next: { tokens: after, updatedAt: now } };
}

/** Edamam said 429: stop everyone for the cooldown and drain the bucket. */
export function cooldown(now: number, b: BucketRules = BUCKET): BucketState {
  return { tokens: 0, updatedAt: now + b.cooldownMs, cooldownUntil: now + b.cooldownMs };
}

/** The per-analysis budget: primaries (one per distinct query) first, then
 * fallbacks while hits remain. Returns which planned queries may be made. */
export class AnalysisBudget {
  private used = 0;
  readonly max: number;
  constructor(max = MAX_HITS_PER_ANALYSIS) { this.max = max; }
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
  get hits() { return this.used; }
}
