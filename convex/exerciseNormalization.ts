// Provider exercise → Sombrey exercise. Pure (no Convex imports).
//
// Sombrey decides how exercises are named, grouped, searched and described
// to users. This module turns the neutral provider shape
// (convex/exerciseProvider.ts) into Sombrey's own fields. Rules:
// - a field the provider didn't give stays absent — nothing is inferred
//   beyond direct vocabulary mapping (e.g. body part "upper legs" → Sombrey
//   group "legs"), and an unknown body part maps to "other", never a guess;
// - text is cleaned (whitespace, numbering, casing), never rewritten;
// - no coaching or physiological claims are added.

import type { ProviderExercise } from "./exerciseProvider.ts";

export const MUSCLE_GROUPS = ["chest", "back", "shoulders", "arms", "legs", "core", "cardio", "other"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Sombrey's exercise fields as stored in `exercises` (provider-sourced rows). */
export type SombreyExerciseFields = {
  name: string;
  description: string;
  muscleGroup: MuscleGroup;
  bodyRegion?: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  primaryEquipment?: string;
  instructions: string[];
  difficulty?: Difficulty;
  category?: string;
  mechanic?: "compound" | "isolation";
  force?: string;
  met?: number;
  caloriesPerMinute?: number;
  isUnilateral?: boolean;
  searchText: string;
};

const BODY_REGION_GROUP: Record<string, MuscleGroup> = {
  chest: "chest",
  back: "back",
  shoulders: "shoulders",
  "upper arms": "arms",
  "lower arms": "arms",
  "upper legs": "legs",
  "lower legs": "legs",
  waist: "core",
  cardio: "cardio",
};

// Target muscles → group, for records whose body part is missing or unknown.
const TARGET_GROUP: Record<string, MuscleGroup> = {
  pectorals: "chest", chest: "chest",
  lats: "back", "upper back": "back", "lower back": "back", traps: "back", spine: "back", back: "back",
  delts: "shoulders", deltoids: "shoulders", shoulders: "shoulders",
  biceps: "arms", triceps: "arms", forearms: "arms",
  quads: "legs", quadriceps: "legs", hamstrings: "legs", glutes: "legs", calves: "legs",
  adductors: "legs", abductors: "legs",
  abs: "core", obliques: "core", core: "core",
  "cardiovascular system": "cardio",
};

/** Search vocabulary: what people type → words that appear in the data. */
export const SYNONYMS: Record<string, string[]> = {
  dumbbell: ["db", "dumbbells"],
  barbell: ["bb"],
  "body weight": ["bodyweight", "no equipment"],
  kettlebell: ["kb", "kettlebells"],
  cable: ["cables", "pulley"],
  "leverage machine": ["machine"],
  "smith machine": ["machine", "smith"],
  "sled machine": ["machine", "sled"],
  band: ["resistance band", "bands"],
  "ez barbell": ["ez bar", "curl bar"],
  pectorals: ["chest", "pecs"],
  lats: ["latissimus", "back"],
  quads: ["quadriceps", "thighs"],
  glutes: ["butt", "glute", "hips"],
  hamstrings: ["hams"],
  abs: ["abdominals", "core", "six pack"],
  delts: ["deltoids", "shoulders"],
  biceps: ["bicep", "arms"],
  triceps: ["tricep", "arms"],
  calves: ["calf"],
  traps: ["trapezius"],
  "pull-up": ["pullup", "pull up", "chin up"],
  "push-up": ["pushup", "push up", "press up"],
  "sit-up": ["situp", "sit up"],
  row: ["rowing"],
  deadlift: ["dead lift"],
  lunge: ["lunges", "split squat"],
  curl: ["curls"],
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "barbell full squat" → "Barbell Full Squat"; names that already carry
 * deliberate casing ("3/4 Sit-up", "EZ Barbell Curl") are kept as given. */
export function displayCase(s: string): string {
  const text = clean(s);
  if (text !== text.toLowerCase()) return text;
  return text.replace(/(^|[\s/(-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** Leading numbering ("1.", "Step 2:") removed; empty steps dropped. */
export function cleanInstructions(steps: string[]): string[] {
  return steps
    .map((s) => clean(s).replace(/^(step\s*)?\d+\s*[.):-]\s*/i, ""))
    .filter((s) => s.length > 0);
}

export function muscleGroupFor(bodyPart: string | undefined, target: string | undefined): MuscleGroup {
  const region = bodyPart?.toLowerCase().trim();
  if (region && BODY_REGION_GROUP[region]) return BODY_REGION_GROUP[region];
  const t = target?.toLowerCase().trim();
  if (t && TARGET_GROUP[t]) return TARGET_GROUP[t];
  return "other";
}

export function buildSearchText(parts: (string | undefined)[]): string {
  const words = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    const lower = clean(part).toLowerCase();
    words.add(lower);
    words.add(lower.replace(/-/g, " "));
    words.add(lower.replace(/-/g, ""));
    for (const [key, extra] of Object.entries(SYNONYMS)) {
      if (lower.includes(key)) for (const e of extra) words.add(e);
    }
  }
  return [...words].join(" ");
}

export function normalizeProviderExercise(p: ProviderExercise): SombreyExerciseFields {
  const primary = p.target ? [displayCase(p.target)] : [];
  const secondary = [...new Set(p.secondaryMuscles.map(displayCase))].filter((m) => !primary.includes(m));
  const equipment = p.equipment ? [displayCase(p.equipment)] : [];
  const difficulty = p.difficulty?.toLowerCase().trim();
  const mechanic = p.mechanic?.toLowerCase().trim();
  const category = p.category?.toLowerCase().trim();
  const name = displayCase(p.name);
  return {
    name,
    // Only the provider's own description — never a sentence made up here.
    description: p.description ? clean(p.description) : "",
    muscleGroup: muscleGroupFor(p.bodyPart, p.target),
    bodyRegion: p.bodyPart ? p.bodyPart.toLowerCase().trim() : undefined,
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    equipment,
    primaryEquipment: p.equipment ? p.equipment.toLowerCase().trim() : undefined,
    instructions: cleanInstructions(p.instructions),
    difficulty: (DIFFICULTIES as readonly string[]).includes(difficulty ?? "") ? (difficulty as Difficulty) : undefined,
    category: category && /^[a-z][a-z _-]*$/.test(category) ? category : undefined,
    mechanic: mechanic === "compound" || mechanic === "isolation" ? mechanic : undefined,
    force: p.force ? p.force.toLowerCase().trim() : undefined,
    met: p.met,
    caloriesPerMinute: p.caloriesPerMinute,
    isUnilateral: p.isUnilateral,
    searchText: buildSearchText([name, p.target, ...p.secondaryMuscles, p.equipment, p.bodyPart, p.category]),
  };
}

// ── Sombrey filters → provider vocabulary (for fetching on demand) ─────────

const GROUP_TO_REGION: Partial<Record<MuscleGroup, string>> = {
  chest: "chest", back: "back", shoulders: "shoulders", arms: "upper arms",
  legs: "upper legs", core: "waist", cardio: "cardio",
};

export function providerBodyPartFor(group: string | undefined): string | undefined {
  return group ? GROUP_TO_REGION[group as MuscleGroup] : undefined;
}

// ── What the AI Coach hears about an exercise ─────────────────────────────

export type CoachExercise = {
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty?: string;
  mechanic?: string;
};

/** "Barbell Full Squat — primary: Quads; secondary: Glutes, Hamstrings;
 * equipment: Barbell; intermediate; compound". Sombrey's own terms only. */
export function describeExerciseForCoach(e: CoachExercise): string {
  const parts: string[] = [];
  if (e.primaryMuscles.length) parts.push(`primary: ${e.primaryMuscles.join(", ")}`);
  if (e.secondaryMuscles.length) parts.push(`secondary: ${e.secondaryMuscles.join(", ")}`);
  if (e.equipment.length) parts.push(`equipment: ${e.equipment.join(", ")}`);
  if (e.difficulty) parts.push(e.difficulty);
  if (e.mechanic) parts.push(e.mechanic);
  return parts.length ? `${e.name} — ${parts.join("; ")}` : e.name;
}
