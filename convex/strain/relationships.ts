// Load ↔ recovery relationships — descriptive, personal, never causal. Pure.
//
// Spearman rank correlation (robust to the skew and outliers daily load
// has) with a t-approximation p-value. A relationship is only described
// when n ≥ 28 paired days, p < 0.05 and |ρ| ≥ 0.4. Even then correlations
// on a few dozen days are unstable (Schönbrodt & Perugini 2013), so wording
// is "tended to", never "causes", and the pairing count is shown.

export const RELATIONSHIP_RULES = { minPairs: 28, maxP: 0.05, minAbsRho: 0.4 };

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: number[], y: number[]): number {
  return pearson(ranks(x), ranks(y));
}

// Two-sided p for Student's t with df degrees of freedom (regularized
// incomplete beta via continued fraction — Numerical Recipes).
function betacf(a: number, b: number, x: number): number {
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function lgamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function correlationP(rho: number, n: number): number {
  if (n < 3) return 1;
  if (Math.abs(rho) >= 1) return 0;
  const df = n - 2, t = rho * Math.sqrt(df / (1 - rho * rho));
  return ibeta(df / 2, 0.5, df / (df + t * t));
}

export type Outcome = "next_morning_readiness" | "next_morning_resting_hr" | "next_night_sleep_minutes";
const OUTCOME_WORDS: Record<Outcome, { noun: string; up: string; down: string }> = {
  next_morning_readiness: { noun: "next-morning readiness", up: "higher", down: "lower" },
  next_morning_resting_hr: { noun: "next-morning resting heart rate", up: "higher", down: "lower" },
  next_night_sleep_minutes: { noun: "sleep that night", up: "longer", down: "shorter" },
};

export type Relationship = { outcome: Outcome; n: number; rho: number; p: number; statement: string };

export function describeRelationship(outcome: Outcome, pairs: { load: number; outcome: number }[]): Relationship | null {
  const n = pairs.length;
  if (n < RELATIONSHIP_RULES.minPairs) return null;
  const rho = spearman(pairs.map((p) => p.load), pairs.map((p) => p.outcome));
  const p = correlationP(rho, n);
  if (p >= RELATIONSHIP_RULES.maxP || Math.abs(rho) < RELATIONSHIP_RULES.minAbsRho) return null;
  const w = OUTCOME_WORDS[outcome];
  const statement = `Across ${n} days, on days after more training time your ${w.noun} tended to be ${rho > 0 ? w.up : w.down}. This is a pattern in your history, not a cause.`;
  return { outcome, n, rho: Math.round(rho * 100) / 100, p: Math.round(p * 10000) / 10000, statement };
}
