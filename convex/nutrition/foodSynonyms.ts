// Names that mean the SAME food — regional names, transliterations and
// spellings — for Search Foods (nutrition/librarySearch.ts). A synonym only
// widens what a search matches; it never creates a food, never assigns
// nutrition, and never merges two foods. Groups hold only true equivalents
// of the same food: a dish is not a synonym of its main ingredient
// ("dhal curry" is not "lentils"), and different preparations stay apart
// (the record's own name says raw / boiled / fried).
//
// Adding a group: every phrase in it must name the same food, in some
// language or spelling people really use. Phrases are written normalised
// (lower case, a–z, 0–9, single spaces).

export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Pulses — "dal" is the split pulse (and the dish of it); spellings vary.
  ["dal", "dhal", "daal", "dahl", "parippu"],
  ["chickpea", "chick pea", "garbanzo", "garbanzo bean", "chana", "kadala", "bengal gram"],
  ["mung bean", "mung", "moong", "green gram", "mung dahl"],
  ["red lentil", "masoor", "masoor dal", "mysore dhal"],
  ["pigeon pea", "toor", "toor dal", "arhar"],
  // Sri Lankan / South Indian foods (their records arrive with an approved
  // Sri Lankan dataset; until then these only find what exists).
  ["string hopper", "idiyappam", "idiappam", "noolappam", "indiappa"],
  ["hopper", "appam", "appa", "aappa"],
  ["kiribath", "milk rice"],
  ["kottu", "kottu roti"],
  ["pittu", "puttu"],
  // Kerala / Sri Lankan parotta (layered) is not North Indian paratha.
  ["parotta", "porotta"],
  ["paratha", "parantha"],
  // Vegetables and fruit — British / South Asian / American names.
  ["aubergine", "eggplant", "brinjal", "wambatu"],
  ["okra", "ladies finger", "ladys finger", "bhindi", "bandakka"],
  ["courgette", "zucchini"],
  ["capsicum", "bell pepper", "sweet pepper"],
  ["coriander leaves", "cilantro"],
  ["jackfruit", "jak", "kos"],
  ["bitter gourd", "bitter melon", "karela", "karawila"],
  ["snake gourd", "pathola"],
  // Not "drumstick": that is also chicken.
  ["moringa pod", "murunga"],
  ["spring onion", "scallion", "green onion"],
  ["swede", "rutabaga"],
  ["beetroot", "beet"],
  ["rocket", "arugula"],
  // Other everyday equivalents.
  ["prawn", "shrimp"],
  ["groundnut", "peanut"],
  ["curd", "yogurt", "yoghurt"],
  ["ghee", "clarified butter"],
  // Cane jaggery; kithul (palm) jaggery is a different food.
  ["jaggery", "gur"],
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

type Phrase = { words: string[]; group: number };

const PHRASES: Phrase[] = SYNONYM_GROUPS.flatMap((g, group) => g.map((p) => ({ words: norm(p).split(" "), group })))
  // Longest first, so "string hopper" wins over "hopper".
  .sort((a, b) => b.words.length - a.words.length);

// Singular/plural are the same word ("hoppers" ~ "hopper").
const same = (a: string, b: string) => a === b || a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a;

/** The query rewritten with every other name of the foods it names — the
 * original first. "string hoppers" → ["string hoppers", "idiyappam", …];
 * "brinjal curry" → ["brinjal curry", "aubergine curry", "eggplant curry", …].
 * At most `max` variants. */
export function queryVariants(term: string, max = 8): string[] {
  const words = norm(term).split(" ").filter(Boolean);
  const out = [words.join(" ")];
  for (let i = 0; i < words.length; i++) {
    const hit = PHRASES.find((p) => p.words.every((w, k) => words[i + k] !== undefined && same(words[i + k], w)));
    if (!hit) continue;
    const before = words.slice(0, i);
    const after = words.slice(i + hit.words.length);
    for (const alt of SYNONYM_GROUPS[hit.group]) {
      const v = [...before, ...norm(alt).split(" "), ...after].join(" ");
      if (!out.includes(v)) out.push(v);
      if (out.length >= max) return out;
    }
    i += hit.words.length - 1;
  }
  return out;
}
