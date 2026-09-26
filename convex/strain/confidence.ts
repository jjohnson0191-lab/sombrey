// Confidence levels shared by every intelligence component. Pure.

export type Confidence = "HIGH_CONFIDENCE" | "MODERATE_CONFIDENCE" | "LOW_CONFIDENCE" | "INSUFFICIENT_DATA";

export const RANK: Record<Confidence, number> = { HIGH_CONFIDENCE: 3, MODERATE_CONFIDENCE: 2, LOW_CONFIDENCE: 1, INSUFFICIENT_DATA: 0 };
const BY_RANK: Confidence[] = ["INSUFFICIENT_DATA", "LOW_CONFIDENCE", "MODERATE_CONFIDENCE", "HIGH_CONFIDENCE"];

export function lower(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

export function downgrade(c: Confidence, steps = 1): Confidence {
  return BY_RANK[Math.max(0, RANK[c] - steps)];
}

/** A weighted blend: each part's confidence weighted by how much of the
 * total it contributes, rounded down to the nearest level. */
export function blend(parts: { confidence: Confidence; weight: number }[]): Confidence {
  const total = parts.reduce((s, p) => s + Math.max(0, p.weight), 0);
  if (total <= 0) return "INSUFFICIENT_DATA";
  const score = parts.reduce((s, p) => s + RANK[p.confidence] * Math.max(0, p.weight), 0) / total;
  return BY_RANK[Math.floor(score + 1e-9)];
}
