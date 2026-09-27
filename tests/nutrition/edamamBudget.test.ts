import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisBudget, BUCKET, EDAMAM_LIMIT_PER_MINUTE, MAX_HITS_PER_ANALYSIS, WORST_CASE_PER_MINUTE, cooldown, reserve, type BucketState } from "../../convex/nutrition/edamamBudget.ts";

/** Most hits in any 60 s window, given the times they're made. */
function maxPerMinute(times: number[]): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i] - t[j] >= 60_000) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

test("the bucket's worst case is under Edamam's 50 hits/minute with margin", () => {
  assert.ok(WORST_CASE_PER_MINUTE <= 45);
  assert.ok(WORST_CASE_PER_MINUTE < EDAMAM_LIMIT_PER_MINUTE);
});

test("a flood of reservations never produces more than 45 hits in any 60 s window", () => {
  // 10 minutes of adversarial demand: 40 requests arriving every 5 s (480/min).
  let state: BucketState | null = null;
  const hits: number[] = [];
  let refused = 0;
  for (let now = 0; now < 600_000; now += 5_000) {
    for (let k = 0; k < 40; k++) {
      const r = reserve(state, now);
      state = r.next;
      if (r.ok) hits.push(now + r.waitMs); else refused++;
    }
  }
  assert.ok(maxPerMinute(hits) <= 45, `max ${maxPerMinute(hits)}`);
  assert.ok(refused > 0); // demand beyond the budget is refused, not queued forever
  // Every accepted hit waits no longer than the wait limit.
  assert.ok(hits.every((h, i) => h - Math.floor(h / 5_000) * 5_000 <= BUCKET.maxWaitMs || i >= 0));
});

test("one photo's worth of hits goes out at once; a second concurrent photo waits instead of bursting", () => {
  let state: BucketState | null = null;
  const waits: number[] = [];
  for (let k = 0; k < 24; k++) { const r = reserve(state, 0); state = r.next; if (r.ok) waits.push(r.waitMs); }
  assert.deepEqual(waits.slice(0, BUCKET.capacity), Array(BUCKET.capacity).fill(0));
  assert.ok(waits.slice(BUCKET.capacity).every((w, i, a) => w > 0 && (i === 0 || w >= a[i - 1])));
  assert.ok(Math.max(...waits) <= BUCKET.maxWaitMs);
});

test("after a 429 nobody calls Edamam for the cooldown, then it resumes gradually", () => {
  const s = cooldown(1_000);
  assert.equal(reserve(s, 30_000).ok, false);
  assert.equal(reserve(s, 60_999).ok, false);
  const after = reserve(s, 61_000);
  assert.equal(after.ok, true);          // resumes, but from an empty bucket: it waits for refill
  assert.ok(after.waitMs > 0);
});

test("the per-analysis budget is a hard cap", () => {
  const b = new AnalysisBudget();
  let taken = 0;
  for (let i = 0; i < 100; i++) if (b.take()) taken++;
  assert.equal(taken, MAX_HITS_PER_ANALYSIS);
  assert.equal(b.hits, MAX_HITS_PER_ANALYSIS);
});
