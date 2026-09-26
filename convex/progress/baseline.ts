// Personal baselines and comparisons — only when the data can carry them. Pure.

import { mean } from "./model.ts";

export const MIN_POINTS_PER_PERIOD = 3;
export const MIN_MEANINGFUL_CHANGE = 0.05;

export type Comparison = { current: number; reference: number; change: number };

/** Current vs reference period averages, when both have enough points and
 * the change is large enough to mean something. */
export function comparePeriods(current: number[], reference: number[]): Comparison | undefined {
  if (current.length < MIN_POINTS_PER_PERIOD || reference.length < MIN_POINTS_PER_PERIOD) return undefined;
  const a = mean(current)!, b = mean(reference)!;
  if (b === 0) return undefined;
  const change = (a - b) / b;
  return Math.abs(change) >= MIN_MEANINGFUL_CHANGE ? { current: a, reference: b, change } : undefined;
}

export function pct(change: number): string {
  return `${Math.round(Math.abs(change) * 100)}%`;
}
