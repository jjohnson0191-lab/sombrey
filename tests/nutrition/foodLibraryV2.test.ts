// Food Library v2: multi-source import (UK CoFID), provenance, per-100 ml rejection, aliases, image
// references, stable fingerprints, and synonym search (convex/nutrition/{foodLibrary,foodSynonyms,librarySearch}.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, deduplicate, libraryFoodFields, upsertAction, validImageRef, validateCandidate, LIBRARY_SOURCES, type LibraryCandidate, type LibraryRecord } from "../../convex/nutrition/foodLibrary.ts";
import { queryVariants, SYNONYM_GROUPS } from "../../convex/nutrition/foodSynonyms.ts";
import { indexTerm, rankFoods, rankScore } from "../../convex/nutrition/librarySearch.ts";
import { cofidCandidates, cofidValue } from "../../scripts/food-library/sources/ukCofid.ts";

const base: LibraryCandidate = {
  source: "usda_fdc_sr_legacy", sourceId: "168878", sourceVersion: "2018-04",
  name: "Rice, white, long-grain, regular, enriched, cooked", category: "Cereal Grains and Pasta",
  nutrients: { basisGrams: 100, energy: { value: 130, unit: "kcal" }, protein: 2.69, carbs: 28.2, fat: 0.28 },
  portions: [{ label: "1 cup", grams: 158 }], crossRef: "ndb:20045",
};
const ok = (c: LibraryCandidate): LibraryRecord => { const v = validateCandidate(c); assert.ok("record" in v, JSON.stringify(v)); return v.record; };
const reason = (c: LibraryCandidate) => { const v = validateCandidate(c); assert.ok("rejection" in v); return v.rejection.reason; };

// ─── Sources & licences ──────────────────────────────────────────────────────

test("every approved source carries its licence, URL and required attribution; unlisted sources are refused", () => {
  for (const [key, s] of Object.entries(LIBRARY_SOURCES)) {
    assert.ok(s.license && s.url.startsWith("https://") && s.attribution, key);
  }
  assert.equal(LIBRARY_SOURCES.uk_cofid.license, "Open Government Licence v3.0");
  assert.equal(reason({ ...base, source: "sri_lanka_fcdb" }), "unknown_source"); // not cleared → not importable
  assert.equal(reason({ ...base, source: "edamam" }), "unknown_source");
});

test("existing USDA records are never superseded by a newer source: USDA outranks CoFID", () => {
  assert.ok(LIBRARY_SOURCES.usda_fdc_sr_legacy.priority < LIBRARY_SOURCES.uk_cofid.priority);
  const usda = ok({ ...base, name: "Garlic, raw", crossRef: undefined });
  const uk = ok({ ...base, source: "uk_cofid", sourceId: "13-244", sourceVersion: "2021", name: "Garlic, raw", crossRef: undefined });
  const { kept, duplicates } = deduplicate([uk, usda]);
  assert.deepEqual(kept.map((r) => r.source), ["usda_fdc_sr_legacy"]);
  assert.equal(duplicates[0].dropped.source, "uk_cofid");
  // …and the kept record remembers the other source holds it too; its values are its own.
  assert.deepEqual(kept[0].alsoIn, [{ source: "uk_cofid", sourceId: "13-244" }]);
  assert.equal(kept[0].per100g.calories, 130);
});

test("different preparations never merge, even with the same food words", () => {
  const raw = ok({ ...base, sourceId: "1", name: "Lentils, raw", crossRef: undefined });
  const boiled = ok({ ...base, source: "uk_cofid", sourceId: "2", name: "Lentils, boiled", crossRef: undefined });
  assert.equal(deduplicate([raw, boiled]).kept.length, 2);
});

test("provenance sent by the importer is accepted only for approved sources", () => {
  const r = ok({ ...base, alsoIn: [{ source: "uk_cofid", sourceId: "13-244" }, { source: "scraped", sourceId: "x" }, { source: "uk_cofid", sourceId: "" }] });
  assert.deepEqual(r.alsoIn, [{ source: "uk_cofid", sourceId: "13-244" }]);
});

// ─── Units ───────────────────────────────────────────────────────────────────

test("values per 100 ml are rejected — no density is invented to turn them into grams", () => {
  assert.equal(reason({ ...base, nutrients: { ...base.nutrients, basisUnit: "ml" } }), "per_100ml_no_density");
  assert.equal(reason({ ...base, nutrients: { ...base.nutrients, basisUnit: "oz" as "g" } }), "bad_basis");
  assert.ok("record" in validateCandidate({ ...base, nutrients: { ...base.nutrients, basisUnit: "g" } }));
});

// ─── Aliases & images ────────────────────────────────────────────────────────

test("aliases: the dataset's own names become searchable; duplicates and junk are dropped (junk flagged)", () => {
  const r = ok({ ...base, name: "Chickpeas, boiled", aliases: ["Garbanzo beans, boiled", "chickpeas boiled", "  Bengal gram, boiled ", "", "x".repeat(200)] });
  assert.deepEqual(r.aliases, ["Garbanzo beans, boiled", "Bengal gram, boiled"]);
  assert.ok(r.qualityFlags.includes("alias_dropped"));
  assert.ok(r.searchName.includes("garbanzo beans boiled") && r.searchName.startsWith("chickpeas boiled"));
});

test("image references: only https, with a known source and a licence; anything else is dropped and flagged", () => {
  const good = { url: "https://images.example.org/rice.webp", source: "sombrey", license: "Sombrey-owned" } as const;
  assert.deepEqual(validImageRef(good), { ...good, attribution: undefined, sourceUrl: undefined });
  assert.equal(validImageRef({ ...good, url: "http://insecure.example/x.jpg" }), null);
  assert.equal(validImageRef({ ...good, url: "javascript:alert(1)" }), null);
  assert.equal(validImageRef({ ...good, license: "" }), null);
  assert.equal(validImageRef({ ...good, source: "google_images" }), null);
  const r = ok({ ...base, image: { ...good, license: "" } });
  assert.equal(r.image, undefined);
  assert.ok(r.qualityFlags.includes("image_dropped"));
  assert.deepEqual(ok({ ...base, image: good }).image?.license, "Sombrey-owned");
});

// ─── Fingerprints ────────────────────────────────────────────────────────────

test("fingerprints of records without the new fields are unchanged — stored USDA foods aren't rewritten", () => {
  // The hash this record had under the first Food Library importer (commit 2dfa630 — computed with that code).
  assert.equal(contentHash(ok(base)), "ba05b173");
  // New fields change it only when present.
  assert.notEqual(contentHash(ok({ ...base, aliases: ["White rice, cooked"] })), "ba05b173");
  assert.notEqual(contentHash({ ...ok(base), alsoIn: [{ source: "uk_cofid", sourceId: "1" }] }), "ba05b173");
});

test("a record archived as a duplicate comes back when a later run keeps it", () => {
  const r = ok(base);
  const stored = libraryFoodFields(r);
  assert.equal(upsertAction(stored, r), "unchanged");
  assert.equal(upsertAction({ ...stored, isArchived: true }, r), "update");
  assert.equal(stored.importVersion, 2);
});

// ─── The CoFID adapter ───────────────────────────────────────────────────────

const header = ["Food Code", "Food Name", "Description", "Group", "Previous", "Main data references", "Footnote", "Water (g)", "Total nitrogen (g)", "Protein (g)", "Fat (g)", "Carbohydrate (g)", "Energy (kcal) (kcal)"];
const row = (code: string, name: string, group: string, p: unknown, f: unknown, c: unknown, kcal: unknown) => [code, name, "", group, null, "", null, "70", "1", p, f, c, kcal];
const book = (rows: unknown[][]) => ({ sheets: { "1.3 Proximates": [header, [], [], ...rows] } });

test("CoFID: Tr = trace (0, flagged), N = not reported (missing — never filled in)", () => {
  const flags = new Set<string>();
  assert.equal(cofidValue("Tr", flags), 0);
  assert.ok(flags.has("trace_as_zero"));
  assert.equal(cofidValue("N", flags), undefined);
  assert.equal(cofidValue("12.5", flags), 12.5);
  assert.equal(cofidValue("", flags), undefined);
});

test("CoFID rows → candidates: per 100 g, alcoholic drinks per 100 ml (rejected), available carbohydrate flagged", () => {
  const { candidates } = cofidCandidates(book([
    row("13-145", "Rice, white, basmati, boiled in unsalted water", "AC", "2.9", "0.4", "31.1", "136"),
    row("12-001", "Cheese, Paneer", "BL", "18.3", "26.9", "Tr", "321"),
    row("17-001", "Beer, bitter", "QA", "0.3", "Tr", "2.2", "30"),
    row("15-001", "Curry, lentil, homemade", "DR", "N", "5", "10", "N"),
  ]), "2021");
  const rice = ok(candidates[0]);
  assert.equal(rice.preparationState, "boiled");
  assert.ok(rice.qualityFlags.includes("carbs_available"));
  assert.deepEqual(rice.serving, { label: "100 g", grams: 100 });
  const paneer = ok(candidates[1]);
  assert.equal(paneer.per100g.carbs, 0);
  assert.ok(paneer.qualityFlags.includes("trace_as_zero"));
  assert.equal(reason(candidates[2]), "per_100ml_no_density");
  assert.equal(reason(candidates[3]), "missing_energy");
  assert.throws(() => cofidCandidates({ sheets: {} }, "2021"));
  assert.throws(() => cofidCandidates({ sheets: { "1.3 Proximates": [["Code"]] } }, "2021"));
});

// ─── Synonyms & regional names ───────────────────────────────────────────────

test("regional names and spellings find the same food", () => {
  assert.ok(queryVariants("parippu").includes("dhal"));
  assert.ok(queryVariants("string hoppers").includes("idiyappam"));
  assert.ok(queryVariants("idiyappam").some((v) => v === "string hopper"));
  assert.ok(queryVariants("brinjal curry").includes("aubergine curry"));
  assert.ok(indexTerm("dal").split(" ").includes("dahl")); // CoFID spells it "dahl"
  assert.ok(rankScore("parippu", { name: "Beans, mung, dahl, dried, boiled in unsalted water" }) > 0);
  assert.ok(rankScore("ladies fingers", { name: "Okra, boiled in unsalted water" }) >= 5);
});

test("synonyms never equate different foods", () => {
  const all = SYNONYM_GROUPS.flat();
  assert.ok(!all.includes("lentil") && !all.includes("lentils"), "a dish/pulse name is not 'lentils'");
  assert.ok(!all.includes("drumstick"), "drumstick is also chicken");
  assert.equal(SYNONYM_GROUPS.find((g) => g.includes("parotta"))?.includes("paratha"), false);
  assert.equal(queryVariants("chicken breast").length, 1);
  // Every phrase belongs to exactly one group.
  assert.equal(new Set(all).size, all.length);
});

test("aliases rank like names", () => {
  const ranked = rankFoods("garbanzo", [{ name: "Hummus, commercial" }, { name: "Chickpeas, boiled", aliases: ["Garbanzo beans, boiled"] }]);
  assert.equal(ranked[0].name, "Chickpeas, boiled");
});
