// Sombrey Food Library importer.
//
//   node --experimental-strip-types scripts/food-library/import.ts \
//     --source usda_fdc_foundation=<FoundationFoods.json>@2026-04-30 \
//     --source usda_fdc_sr_legacy=<SRLegacyFoods.json>@2018-04 \
//     [--plan] [--dry-run] [--report <file.json>] [--batch 150]
//     [--prod --confirm-production]
//
// 1. Reads each approved dataset through its adapter (sources/*).
// 2. Validates and normalises every record (convex/nutrition/foodLibrary.ts):
//    malformed / impossible records are REJECTED with a reason; questionable
//    ones are kept with qualityFlags.
// 3. Deduplicates within and across datasets (Foundation over SR Legacy).
// 4. Sends batches to foodLibrary:upsertBatch, which validates again and
//    upserts idempotently on (source, sourceId) — re-running changes nothing.
// 5. Prints (and optionally writes) inserted / updated / unchanged /
//    rejected / deduplicated / flagged counts.
//
// --plan: steps 1–3 only (no Convex calls). --dry-run: the server reports
// what it WOULD do without writing. Targets the deployment in .env.local
// (dev) unless BOTH --prod and --confirm-production are given.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { deduplicate, LIBRARY_SOURCES, validateCandidate, type LibraryCandidate, type LibraryRecord, type Rejection } from "../../convex/nutrition/foodLibrary.ts";
import { fdcCandidates } from "./sources/usdaFdc.ts";
import { cofidCandidates } from "./sources/ukCofid.ts";

type Args = { sources: Array<{ source: string; file: string; version: string }>; plan: boolean; dryRun: boolean; report?: string; batch: number; prod: boolean; confirmProd: boolean };

function parseArgs(argv: string[]): Args {
  const a: Args = { sources: [], plan: false, dryRun: false, batch: 150, prod: false, confirmProd: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--source") {
      const m = /^([a-z_]+)=(.+)@([^@]+)$/.exec(argv[++i] ?? "");
      if (!m) throw new Error("--source must be <source>=<file>@<version>");
      a.sources.push({ source: m[1], file: m[2], version: m[3] });
    } else if (k === "--plan") a.plan = true;
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--report") a.report = argv[++i];
    else if (k === "--batch") a.batch = Math.max(1, Math.min(200, Number(argv[++i])));
    else if (k === "--prod") a.prod = true;
    else if (k === "--confirm-production") a.confirmProd = true;
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!a.sources.length) throw new Error("Give at least one --source");
  if (a.prod && !a.confirmProd) throw new Error("Refusing to touch production without --confirm-production");
  return a;
}

/** Adapters for the approved sources. A new dataset = a new adapter here. */
function loadCandidates(source: string, file: string, version: string): { candidates: LibraryCandidate[]; malformed: number } {
  // Spreadsheets (CoFID) are read through tools/xlsx_to_json.py (standard library only).
  const text = file.endsWith(".xlsx")
    ? execFileSync("python3", [new URL("./tools/xlsx_to_json.py", import.meta.url).pathname, file], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    : readFileSync(file, "utf8");
  const data = JSON.parse(text);
  switch (source) {
    case "usda_fdc_foundation":
    case "usda_fdc_sr_legacy":
      return fdcCandidates(data, source, version);
    case "uk_cofid":
      return cofidCandidates(data, version);
    default:
      throw new Error(`No adapter for source "${source}" (approved: ${Object.keys(LIBRARY_SOURCES).join(", ")})`);
  }
}

type BatchResult = { inserted: number; updated: number; unchanged: number; rejected: number; rejectedRecords: Array<{ sourceId: string; reason: string }> };

function convexRun<T = BatchResult>(fn: string, args: unknown, prod: boolean): T {
  // Batches are idempotent, so a batch that fails on the network (a laptop
  // sleeping, a dropped connection) is simply sent again — at most 3 tries.
  let out = "";
  for (let attempt = 1; ; attempt++) {
    try {
      out = execFileSync("npx", ["convex", "run", ...(prod ? ["--prod"] : []), fn, JSON.stringify(args)], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      process.stderr.write(`\n  ${fn} failed (attempt ${attempt}), retrying in ${attempt * 10}s…\n`);
      execFileSync("sleep", [String(attempt * 10)]);
    }
  }
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`Unexpected output from ${fn}: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start)) as T;
}

function countBy<T>(xs: T[], key: (x: T) => string) {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  // 1–2. Read and validate.
  const records: LibraryRecord[] = [];
  const candidateById = new Map<string, LibraryCandidate>();
  const rejections: Array<Rejection & { source: string }> = [];
  const perSource: Record<string, { read: number; malformed: number; valid: number; rejected: number }> = {};
  for (const s of args.sources) {
    const { candidates, malformed } = loadCandidates(s.source, s.file, s.version);
    perSource[s.source] = { read: candidates.length + malformed, malformed, valid: 0, rejected: malformed };
    for (let i = 0; i < malformed; i++) rejections.push({ source: s.source, sourceId: "", name: "", reason: "malformed_record" });
    for (const c of candidates) {
      const v = validateCandidate(c);
      if ("rejection" in v) {
        perSource[s.source].rejected++;
        rejections.push({ ...v.rejection, source: s.source });
      } else {
        perSource[s.source].valid++;
        records.push(v.record);
        candidateById.set(`${v.record.source}:${v.record.sourceId}`, c);
      }
    }
  }

  // Cross-source duplicates are only found among the sources in one run.
  const missing = Object.keys(LIBRARY_SOURCES).filter((k) => !args.sources.some((s) => s.source === k));
  if (missing.length) process.stderr.write(`WARNING: not importing ${missing.join(", ")} in this run — duplicates against their stored records won't be detected.\n`);

  // 3. Deduplicate.
  const { kept, duplicates } = deduplicate(records);
  const flagged = kept.filter((r) => r.qualityFlags.length > 0);

  const report: Record<string, unknown> = {
    datasets: args.sources.map((s) => ({ ...s, ...LIBRARY_SOURCES[s.source as keyof typeof LIBRARY_SOURCES] })),
    target: args.plan ? "none (plan)" : args.prod ? "PRODUCTION" : "deployment in .env.local",
    perSource,
    toImport: kept.length,
    rejected: rejections.length,
    rejectedByReason: countBy(rejections, (r) => r.reason),
    rejectedExamples: rejections.filter((r) => r.name).slice(0, 25),
    keptBySource: countBy(kept, (r) => r.source),
    keptWithProvenanceFromOtherSources: kept.filter((r) => r.alsoIn.length > 0).length,
    deduplicated: duplicates.length,
    deduplicatedBy: countBy(duplicates, (d) => d.by),
    duplicateExamples: duplicates.slice(0, 15).map((d) => ({ dropped: `${d.dropped.source}:${d.dropped.sourceId} ${d.dropped.name}`, kept: `${d.keptAs.source}:${d.keptAs.sourceId} ${d.keptAs.name}`, by: d.by })),
    flagged: flagged.length,
    flaggedByFlag: countBy(flagged.flatMap((r) => r.qualityFlags), (f) => f),
    flaggedExamples: flagged.filter((r) => r.qualityFlags.includes("energy_macro_mismatch")).slice(0, 15).map((r) => ({ id: `${r.source}:${r.sourceId}`, name: r.name, per100g: r.per100g, flags: r.qualityFlags })),
    preparationStates: countBy(kept, (r) => r.preparationState ?? "(not stated)"),
  };

  // 4. Upsert in batches.
  if (!args.plan) {
    const totals = { inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
    const serverRejected: Array<{ sourceId: string; reason: string }> = [];
    for (let i = 0; i < kept.length; i += args.batch) {
      const batch = kept.slice(i, i + args.batch).map((r) => ({ ...candidateById.get(`${r.source}:${r.sourceId}`)!, ...(r.alsoIn.length ? { alsoIn: r.alsoIn } : {}) }));
      const r = convexRun("foodLibrary:upsertBatch", { records: batch, dryRun: args.dryRun }, args.prod);
      totals.inserted += r.inserted; totals.updated += r.updated; totals.unchanged += r.unchanged; totals.rejected += r.rejected;
      serverRejected.push(...r.rejectedRecords);
      process.stderr.write(`\r  ${Math.min(i + args.batch, kept.length)}/${kept.length} sent`);
    }
    process.stderr.write("\n");
    // Duplicates an earlier run may have stored: archived, not deleted.
    let archived = 0;
    for (let i = 0; i < duplicates.length; i += args.batch) {
      const batch = duplicates.slice(i, i + args.batch).map((d) => ({ source: d.dropped.source, sourceId: d.dropped.sourceId, keptAs: `${d.keptAs.source}:${d.keptAs.sourceId}` }));
      archived += convexRun<{ archived: number }>("foodLibrary:archiveDuplicates", { records: batch, dryRun: args.dryRun }, args.prod).archived;
    }
    report.server = { ...totals, archivedDuplicates: archived, dryRun: args.dryRun, serverRejected: serverRejected.slice(0, 25) };
  }
  report.seconds = Math.round((Date.now() - started) / 1000);

  const json = JSON.stringify(report, null, 2);
  if (args.report) writeFileSync(args.report, json);
  console.log(json);
}

main();
