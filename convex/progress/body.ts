// Body — weight now, and how it has moved against a chosen baseline. Pure.
// Entries come from the existing `measurements` store, each with its source
// (manual today; the body scanner later — same model, different provenance).

import { type WeightEntry, DAY_MS } from "./model.ts";

export type BodyBaseline = "first" | "30d" | "90d";

export type BodySummary = {
  latest?: WeightEntry;
  baseline?: { mode: BodyBaseline; entry: WeightEntry };
  changeKg?: number;
  entries: WeightEntry[]; // oldest first
};

/** The entry a baseline refers to: the first ever, or the last entry on or
 * before N days ago (none if there isn't one — never an interpolated value). */
export function baselineEntry(entries: WeightEntry[], mode: BodyBaseline, nowMs: number): WeightEntry | undefined {
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  if (mode === "first") return sorted[0];
  const cutoff = nowMs - (mode === "30d" ? 30 : 90) * DAY_MS;
  return [...sorted].reverse().find((e) => e.date <= cutoff);
}

export function bodySummary(entries: WeightEntry[], mode: BodyBaseline, nowMs: number): BodySummary {
  const sorted = [...entries].filter((e) => Number.isFinite(e.weightKg) && e.weightKg > 0).sort((a, b) => a.date - b.date);
  const latest = sorted[sorted.length - 1];
  const base = baselineEntry(sorted, mode, nowMs);
  const usable = latest && base && base.id !== latest.id ? base : undefined;
  return {
    latest,
    baseline: usable ? { mode, entry: usable } : undefined,
    changeKg: usable && latest ? Math.round((latest.weightKg - usable.weightKg) * 10) / 10 : undefined,
    entries: sorted,
  };
}

/** A weight a person could plausibly weigh (kg) — guards manual entry. */
export function isPlausibleWeightKg(kg: number): boolean {
  return Number.isFinite(kg) && kg >= 20 && kg <= 400;
}
