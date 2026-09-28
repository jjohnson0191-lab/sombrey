// McCance and Widdowson's The Composition of Foods Integrated Dataset (CoFID
// 2021, Public Health England) → LibraryCandidates.
// Data: https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid
// Licence: Open Government Licence v3.0 — attribution required (see
// LIBRARY_SOURCES.uk_cofid). Read from the "1.3 Proximates" sheet of the
// published .xlsx (tools/xlsx_to_json.py).
//
// The dataset's own conventions, applied as stated in its notes (sheet 1.1):
//   • values are per 100 g — EXCEPT alcoholic beverages (group Q…), per 100 ml;
//     those are passed on as per-100 ml and so rejected (no density given);
//   • "Tr" = trace → recorded as 0, flagged "trace_as_zero";
//   • "N" = present but no reliable value → missing (the record is rejected
//     if it's one of the four the library needs); nothing is filled in.
//   • carbohydrate is AVAILABLE carbohydrate (monosaccharide equivalents,
//     fibre excluded) — unlike USDA's "by difference"; flagged so it's visible.

import type { LibraryCandidate } from "../../../convex/nutrition/foodLibrary.ts";

type Sheets = { sheets: Record<string, unknown[][]> };

const REQUIRED = { code: "Food Code", name: "Food Name", group: "Group", protein: "Protein (g)", fat: "Fat (g)", carbs: "Carbohydrate (g)", kcal: "Energy (kcal) (kcal)" } as const;

/** One CoFID cell → a number, 0 for a trace, undefined when not reported. */
export function cofidValue(v: unknown, flags: Set<string>): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "Tr") { flags.add("trace_as_zero"); return 0; }
  if (t === "" || t === "N") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function cofidCandidates(data: unknown, sourceVersion: string): { candidates: LibraryCandidate[]; malformed: number } {
  const rows = (data as Sheets)?.sheets?.["1.3 Proximates"];
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error('Not a CoFID workbook (no "1.3 Proximates" sheet)');
  const header = rows[0] as unknown[];
  const col: Record<keyof typeof REQUIRED, number> = {} as never;
  for (const [key, title] of Object.entries(REQUIRED) as Array<[keyof typeof REQUIRED, string]>) {
    const i = header.indexOf(title);
    if (i < 0) throw new Error(`CoFID column "${title}" not found — has the sheet layout changed?`);
    col[key] = i;
  }
  const candidates: LibraryCandidate[] = [];
  let malformed = 0;
  // Rows 1–2 are nutrient codes and long names; foods start at row 3.
  for (const row of rows.slice(3)) {
    if (!Array.isArray(row) || row.every((c) => c === null || c === "")) continue;
    const code = row[col.code];
    const name = row[col.name];
    if (typeof code !== "string" || typeof name !== "string") { malformed++; continue; }
    const group = typeof row[col.group] === "string" ? (row[col.group] as string).trim() : "";
    const flags = new Set<string>(["carbs_available"]);
    const kcal = cofidValue(row[col.kcal], flags);
    candidates.push({
      source: "uk_cofid",
      sourceId: code.trim(),
      sourceVersion,
      name,
      kind: "generic",
      nutrients: {
        basisGrams: 100,
        // Alcoholic beverages (group Q…) are per 100 ml in CoFID.
        basisUnit: group.startsWith("Q") ? "ml" : "g",
        energy: kcal === undefined ? undefined : { value: kcal, unit: "kcal" },
        protein: cofidValue(row[col.protein], flags),
        carbs: cofidValue(row[col.carbs], flags),
        fat: cofidValue(row[col.fat], flags),
      },
      portions: [], // CoFID gives no household measures
      flags: [...flags],
    });
  }
  return { candidates, malformed };
}
