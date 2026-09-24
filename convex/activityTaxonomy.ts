// Sombrey's own activity model. Pure (no Convex imports) so it can be
// unit-tested and reused by any server module.
//
// The band reports one of 180 vendor Sport+ ids
// (OdmSportPlusExerciseModelType). Those ids stay the source data and are
// always stored alongside the normalized values below, but Sombrey's
// intelligence layer reasons about:
//   - `activityKey`: a stable Sombrey slug for the specific activity
//     ("tennis", "golf", "surf", "strength_training", …)
//   - `activityCategory`: one of a small set of Sombrey categories.
// The mapping is explicit per id (checked into VENDOR_SPORT_TYPES below),
// never inferred from the vendor's own groupings, several of which misfile
// activities (e.g. Swimming under "Running & Walking").
//
// Other pathways (manual logs, structured Sombrey workouts, future external
// sources) normalize into the same key/category space, so every activity
// can be compared regardless of where it came from — while each keeps its
// own provenance and its own measurements.

export const ACTIVITY_CATEGORIES = [
  "running",
  "walking",
  "hiking",
  "cycling",
  "swimming",
  "racquet",
  "golf",
  "team_sport",
  "water_sport",
  "winter_sport",
  "strength",
  "cardio",
  "mobility",
  "dance",
  "combat",
  "outdoor_adventure",
  "leisure",
  "motorsport",
  "games",
  "other",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

// Where an activity record came from. Each provenance has fundamentally
// different measurements; they share the key/category space, not a schema.
export type ActivityProvenance =
  | "band_sport_plus"   // recorded by the band's Sport+ mode, started on the band
  | "app_sport_plus"    // Sport+ started from the Sombrey app
  | "manual"            // entered by the user after the fact
  | "sombrey_workout"   // structured Sombrey workout (sets/reps/weight)
  | "user_labelled"     // noticed by Sombrey from band heart rate, named by the user
  | "external";         // reserved for a future external source

export type NormalizedActivity = {
  activityKey: string;
  activityCategory: ActivityCategory;
  displayName: string;
};

type VendorEntry = { key: string; name: string; category: ActivityCategory };

// Generated from the vendor header's 180 entries (via the iOS catalog in
// apps/ios/Sombrey/Wearable/SombreySportType.swift), mapped by hand.
// `name` is Sombrey's consumer-facing name — the vendor's own labels
// ("Pickering", "Puck", "Skis", "B M X") stay in SombreySportType.swift.
export const VENDOR_SPORT_TYPES: Record<number, VendorEntry> = {
  1: { key: "run", name: "Outdoor Run", category: "running" },
  2: { key: "bike", name: "Outdoor Ride", category: "cycling" },
  3: { key: "walk", name: "Outdoor Walk", category: "walking" },
  4: { key: "walk", name: "Walk", category: "walking" },
  5: { key: "rope_skipping", name: "Rope Skipping", category: "cardio" },
  6: { key: "swim", name: "Swimming", category: "swimming" },
  7: { key: "run", name: "Run", category: "running" },
  8: { key: "hiking", name: "Hiking", category: "hiking" },
  9: { key: "bike", name: "Ride", category: "cycling" },
  10: { key: "other_exercise", name: "Other Exercise", category: "other" },
  11: { key: "racquet_swing", name: "Swing Practice", category: "racquet" },
  20: { key: "hill_climb", name: "Hill Climb", category: "hiking" },
  21: { key: "badminton", name: "Badminton", category: "racquet" },
  22: { key: "yoga", name: "Yoga", category: "mobility" },
  23: { key: "aerobics", name: "Aerobics", category: "cardio" },
  24: { key: "spinning", name: "Spin Bike", category: "cycling" },
  25: { key: "kayaking", name: "Kayaking", category: "water_sport" },
  26: { key: "elliptical_machine", name: "Elliptical Machine", category: "cardio" },
  27: { key: "rowing_machine", name: "Rowing Machine", category: "cardio" },
  28: { key: "pingpong", name: "Table Tennis", category: "racquet" },
  29: { key: "tennis", name: "Tennis", category: "racquet" },
  30: { key: "golf", name: "Golf", category: "golf" },
  31: { key: "basketball", name: "Basketball", category: "team_sport" },
  32: { key: "football", name: "Football", category: "team_sport" },
  33: { key: "volleyball", name: "Volleyball", category: "team_sport" },
  34: { key: "rock_climbing", name: "Rock Climbing", category: "outdoor_adventure" },
  35: { key: "dance", name: "Dance", category: "dance" },
  36: { key: "roller_skating", name: "Roller Skating", category: "outdoor_adventure" },
  40: { key: "treadmill", name: "Treadmill", category: "running" },
  41: { key: "indoor_walking", name: "Indoor Walking", category: "walking" },
  42: { key: "trail_running", name: "Trail Running", category: "running" },
  43: { key: "race_walk", name: "Race Walk", category: "walking" },
  44: { key: "playground_running", name: "Playground Running", category: "running" },
  45: { key: "run", name: "Fat-Burn Run", category: "running" },
  50: { key: "outdoor_cycling", name: "Outdoor Cycling", category: "cycling" },
  51: { key: "indoor_cycling", name: "Indoor Cycling", category: "cycling" },
  52: { key: "mountain_biking", name: "Mountain Biking", category: "cycling" },
  53: { key: "bmx", name: "BMX", category: "cycling" },
  55: { key: "pool_swim", name: "Pool Swimming", category: "swimming" },
  56: { key: "open_water_swim", name: "Open Water Swimming", category: "swimming" },
  57: { key: "fin_swimming", name: "Fin Swimming", category: "swimming" },
  58: { key: "synchronized_swimming", name: "Synchronized Swimming", category: "swimming" },
  60: { key: "hiking", name: "Outdoor Hiking", category: "hiking" },
  61: { key: "orienteering", name: "Orienteering", category: "hiking" },
  62: { key: "fishing", name: "Fishing", category: "outdoor_adventure" },
  63: { key: "hunt", name: "Hunt", category: "outdoor_adventure" },
  64: { key: "skateboard", name: "Skateboard", category: "outdoor_adventure" },
  65: { key: "parkour", name: "Parkour", category: "outdoor_adventure" },
  66: { key: "atv", name: "ATV", category: "motorsport" },
  67: { key: "motocross", name: "Motocross", category: "motorsport" },
  68: { key: "racing", name: "Racing", category: "motorsport" },
  69: { key: "hand_crank", name: "Hand Crank", category: "cycling" },
  70: { key: "marathon", name: "Marathon", category: "running" },
  71: { key: "obstacle_course", name: "Obstacle Course", category: "outdoor_adventure" },
  80: { key: "stair_climber", name: "Stair Climber", category: "cardio" },
  81: { key: "stair_stepper", name: "Stair Stepper", category: "cardio" },
  82: { key: "mixed_aerobic", name: "Mixed Aerobic", category: "cardio" },
  83: { key: "kickboxing", name: "Kickboxing", category: "combat" },
  84: { key: "core_training", name: "Core Training", category: "strength" },
  85: { key: "cross_training", name: "Cross Training", category: "cardio" },
  86: { key: "indoor_fitness", name: "Indoor Fitness", category: "cardio" },
  87: { key: "group_gymnastics", name: "Group Fitness", category: "cardio" },
  88: { key: "strength_training", name: "Strength Training", category: "strength" },
  89: { key: "gap_training", name: "Interval Training", category: "cardio" },
  90: { key: "free_training", name: "Free Training", category: "cardio" },
  91: { key: "flexibility_training", name: "Flexibility Training", category: "mobility" },
  92: { key: "gymnastics", name: "Gymnastics", category: "strength" },
  93: { key: "stretch", name: "Stretch", category: "mobility" },
  94: { key: "pilates", name: "Pilates", category: "mobility" },
  95: { key: "horizontal_bar", name: "Horizontal Bar", category: "strength" },
  96: { key: "parallel_bars", name: "Parallel Bars", category: "strength" },
  97: { key: "battle_rope", name: "Battle Rope", category: "cardio" },
  98: { key: "fitness", name: "Fitness", category: "cardio" },
  99: { key: "balance_training", name: "Balance Training", category: "mobility" },
  100: { key: "step_training", name: "Step Training", category: "cardio" },
  110: { key: "square_dance", name: "Square Dance", category: "dance" },
  111: { key: "ballroom_dancing", name: "Ballroom Dancing", category: "dance" },
  112: { key: "belly_dance", name: "Belly Dance", category: "dance" },
  113: { key: "ballet", name: "Ballet", category: "dance" },
  114: { key: "street_dance", name: "Street Dance", category: "dance" },
  115: { key: "zumba", name: "Zumba", category: "dance" },
  116: { key: "latin_dance", name: "Latin Dance", category: "dance" },
  117: { key: "latin_jazz", name: "Latin Jazz", category: "dance" },
  118: { key: "hip_hop_dance", name: "Hip Hop Dance", category: "dance" },
  119: { key: "pole_dancing", name: "Pole Dancing", category: "dance" },
  120: { key: "break_dance", name: "Break Dance", category: "dance" },
  121: { key: "folk_dance", name: "Folk Dance", category: "dance" },
  122: { key: "dance", name: "Dance", category: "dance" },
  123: { key: "modern_dance", name: "Modern Dance", category: "dance" },
  124: { key: "disco", name: "Disco", category: "dance" },
  125: { key: "tap_dance", name: "Tap Dance", category: "dance" },
  126: { key: "dance", name: "Other Dance", category: "dance" },
  130: { key: "boxing", name: "Boxing", category: "combat" },
  131: { key: "wrestling", name: "Wrestling", category: "combat" },
  132: { key: "martial_arts", name: "Martial Arts", category: "combat" },
  133: { key: "tai_chi", name: "Tai Chi", category: "mobility" },
  134: { key: "muay_thai", name: "Muay Thai", category: "combat" },
  135: { key: "judo", name: "Judo", category: "combat" },
  136: { key: "taekwondo", name: "Taekwondo", category: "combat" },
  137: { key: "karate", name: "Karate", category: "combat" },
  138: { key: "free_sparring", name: "Sparring", category: "combat" },
  139: { key: "swordsmanship", name: "Swordsmanship", category: "combat" },
  140: { key: "jujitsu", name: "Jujitsu", category: "combat" },
  141: { key: "fencing", name: "Fencing", category: "combat" },
  142: { key: "kendo", name: "Kendo", category: "combat" },
  150: { key: "beach_football", name: "Beach Football", category: "team_sport" },
  151: { key: "beach_volleyball", name: "Beach Volleyball", category: "team_sport" },
  152: { key: "baseball", name: "Baseball", category: "team_sport" },
  153: { key: "softball", name: "Softball", category: "team_sport" },
  154: { key: "rugby", name: "Rugby", category: "team_sport" },
  155: { key: "field_hockey", name: "Field Hockey", category: "team_sport" },
  156: { key: "squash", name: "Squash", category: "racquet" },
  157: { key: "gateball", name: "Gateball", category: "team_sport" },
  158: { key: "cricket", name: "Cricket", category: "team_sport" },
  159: { key: "handball", name: "Handball", category: "team_sport" },
  160: { key: "bowling", name: "Bowling", category: "leisure" },
  161: { key: "polo", name: "Polo", category: "team_sport" },
  162: { key: "racquetball", name: "Racquetball", category: "racquet" },
  163: { key: "billiards", name: "Billiards", category: "leisure" },
  164: { key: "takraw", name: "Takraw", category: "team_sport" },
  165: { key: "dodge_ball", name: "Dodge Ball", category: "team_sport" },
  166: { key: "water_polo", name: "Water Polo", category: "team_sport" },
  167: { key: "ice_hockey", name: "Ice Hockey", category: "team_sport" },
  168: { key: "jianzi", name: "Shuttlecock Kicking", category: "team_sport" },
  169: { key: "indoor_football", name: "Indoor Soccer", category: "team_sport" },
  170: { key: "sandbag_ball", name: "Sandbag Ball", category: "leisure" },
  171: { key: "bocce", name: "Bocce", category: "leisure" },
  172: { key: "jai_alai", name: "Jai Alai", category: "racquet" },
  173: { key: "floor_ball", name: "Floor Ball", category: "team_sport" },
  174: { key: "australian_rules_football", name: "Australian Rules Football", category: "team_sport" },
  175: { key: "pickleball", name: "Pickleball", category: "racquet" },
  180: { key: "outdoor_rowing", name: "Rowing", category: "water_sport" },
  181: { key: "sailing", name: "Sailing", category: "water_sport" },
  182: { key: "dragon_boat", name: "Dragon Boat", category: "water_sport" },
  183: { key: "surf", name: "Surfing", category: "water_sport" },
  184: { key: "kitesurfing", name: "Kitesurfing", category: "water_sport" },
  185: { key: "paddling", name: "Paddling", category: "water_sport" },
  186: { key: "paddleboard", name: "Paddleboard", category: "water_sport" },
  187: { key: "indoor_surfing", name: "Indoor Surfing", category: "water_sport" },
  188: { key: "drifting", name: "Rafting", category: "water_sport" },
  189: { key: "snorkeling", name: "Snorkeling", category: "water_sport" },
  190: { key: "skiing", name: "Skiing", category: "winter_sport" },
  191: { key: "snowboard", name: "Snowboard", category: "winter_sport" },
  192: { key: "alpine_skiing", name: "Alpine Skiing", category: "winter_sport" },
  193: { key: "cross_country_skiing", name: "Cross Country Skiing", category: "winter_sport" },
  194: { key: "ski_orienteering", name: "Ski Orienteering", category: "winter_sport" },
  195: { key: "biathlon", name: "Biathlon", category: "winter_sport" },
  196: { key: "outdoor_skating", name: "Outdoor Skating", category: "winter_sport" },
  197: { key: "indoor_skating", name: "Indoor Skating", category: "winter_sport" },
  198: { key: "curling", name: "Curling", category: "winter_sport" },
  199: { key: "bobsleigh", name: "Bobsleigh", category: "winter_sport" },
  200: { key: "sled", name: "Sled", category: "winter_sport" },
  201: { key: "snowmobile", name: "Snowmobile", category: "motorsport" },
  202: { key: "snowshoeing", name: "Snowshoeing", category: "winter_sport" },
  210: { key: "hula_hoop", name: "Hula Hoop", category: "cardio" },
  211: { key: "frisbee", name: "Frisbee", category: "leisure" },
  212: { key: "darts", name: "Darts", category: "leisure" },
  213: { key: "fly_a_kite", name: "Kite Flying", category: "leisure" },
  214: { key: "tug_of_war", name: "Tug Of War", category: "leisure" },
  215: { key: "esports", name: "Esports", category: "games" },
  216: { key: "air_walker", name: "Air Walker", category: "cardio" },
  217: { key: "swing", name: "Swing", category: "leisure" },
  218: { key: "shuffleboard", name: "Shuffleboard", category: "leisure" },
  219: { key: "table_soccer", name: "Table Soccer", category: "games" },
  220: { key: "somatosensory_game", name: "Motion Gaming", category: "leisure" },
  221: { key: "bungee_jumping", name: "Bungee Jumping", category: "outdoor_adventure" },
  222: { key: "parachute", name: "Parachute", category: "outdoor_adventure" },
  223: { key: "anusara", name: "Anusara Yoga", category: "mobility" },
  224: { key: "yin_yoga", name: "Yin Yoga", category: "mobility" },
  225: { key: "pregnancy_yoga", name: "Pregnancy Yoga", category: "mobility" },
  230: { key: "international_chess", name: "Chess", category: "games" },
  231: { key: "go", name: "Go", category: "games" },
  232: { key: "checkers", name: "Checkers", category: "games" },
  233: { key: "board_game", name: "Board Game", category: "games" },
  234: { key: "bridge", name: "Bridge", category: "games" },
  235: { key: "triathlon", name: "Triathlon", category: "other" },
  236: { key: "archery", name: "Archery", category: "outdoor_adventure" },
  237: { key: "compound_movement", name: "Compound Movement", category: "strength" },
  238: { key: "drive", name: "Driving", category: "motorsport" },
  10086: { key: "other", name: "Other", category: "other" },
};

// Browsing groups for the activity picker — a coarser, consumer-facing
// grouping over the categories above (every category in exactly one group).
export const ACTIVITY_GROUPS: { id: string; name: string; categories: ActivityCategory[] }[] = [
  { id: "racquet", name: "Racquet", categories: ["racquet"] },
  { id: "running", name: "Running", categories: ["running"] },
  { id: "walking_hiking", name: "Walking & Hiking", categories: ["walking", "hiking"] },
  { id: "cycling", name: "Cycling", categories: ["cycling"] },
  { id: "water", name: "Water", categories: ["swimming", "water_sport"] },
  { id: "team", name: "Team Sports", categories: ["team_sport"] },
  { id: "outdoor", name: "Golf & Outdoor", categories: ["golf", "outdoor_adventure"] },
  { id: "fitness", name: "Fitness & Strength", categories: ["strength", "cardio"] },
  { id: "mind_body", name: "Mind & Body", categories: ["mobility"] },
  { id: "dance", name: "Dance", categories: ["dance"] },
  { id: "combat", name: "Combat", categories: ["combat"] },
  { id: "winter", name: "Winter", categories: ["winter_sport"] },
  { id: "other", name: "Leisure & Other", categories: ["leisure", "motorsport", "games", "other"] },
];

// Several vendor modes share one Sombrey activity (GPS Run, Run and
// Fat-Burn Run are all "run"). When the user starts that activity, this is
// the band mode Sombrey asks for; otherwise the lowest vendor id is used.
// The outdoor variants are preferred: they add the phone's route.
export const PRIMARY_VENDOR_BY_KEY: Record<string, number> = {
  run: 1,
  walk: 3,
  bike: 2,
  hiking: 60,
  swim: 6,
  dance: 122,
};

// The activity-level name where several vendor modes share a key.
export const KEY_DISPLAY_NAMES: Record<string, string> = {
  run: "Running",
  walk: "Walking",
  bike: "Cycling",
  hiking: "Hiking",
  swim: "Swimming",
  dance: "Dance",
};

// Keys never offered in the picker (still normalized if the band reports
// them): the vendor's catch-all extension id.
const HIDDEN_KEYS = new Set(["other"]);

export type CatalogActivity = {
  key: string;
  name: string;
  category: ActivityCategory;
  group: string;
  vendorSportType: number;
};

/** One entry per Sombrey activity: what the picker offers, and which band
 * mode starting it uses. Ordered by group, then name. */
export function activityCatalog(): CatalogActivity[] {
  const groupOf = new Map<ActivityCategory, string>();
  for (const group of ACTIVITY_GROUPS) for (const category of group.categories) groupOf.set(category, group.id);
  const byKey = new Map<string, CatalogActivity>();
  const ids = Object.keys(VENDOR_SPORT_TYPES).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const entry = VENDOR_SPORT_TYPES[id];
    if (HIDDEN_KEYS.has(entry.key) || byKey.has(entry.key)) continue;
    const vendorSportType = PRIMARY_VENDOR_BY_KEY[entry.key] ?? id;
    byKey.set(entry.key, {
      key: entry.key,
      name: KEY_DISPLAY_NAMES[entry.key] ?? VENDOR_SPORT_TYPES[vendorSportType].name,
      category: entry.category,
      group: groupOf.get(entry.category) ?? "other",
      vendorSportType,
    });
  }
  const order = ACTIVITY_GROUPS.map((g) => g.id);
  return [...byKey.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));
}

// Band modes too generic to say what the user actually did ("band
// exercise", "free training", "fitness", the catch-all extension). A record
// in one of these — or an id this taxonomy doesn't know — is shown as the
// band reported it, and the user is asked what it was.
export const AMBIGUOUS_VENDOR_IDS = new Set([10, 86, 90, 98, 10086]);

export function isAmbiguousSportType(vendorId: number): boolean {
  return AMBIGUOUS_VENDOR_IDS.has(vendorId) || VENDOR_SPORT_TYPES[vendorId] === undefined;
}

/** Normalizes a vendor Sport+ id. Unknown ids (e.g. from a newer firmware)
 * are kept as-is under "other" rather than guessed. */
export function normalizeSportPlusType(vendorId: number): NormalizedActivity {
  const entry = VENDOR_SPORT_TYPES[vendorId];
  if (!entry) {
    return { activityKey: `sport_plus_${vendorId}`, activityCategory: "other", displayName: `Band activity ${vendorId}` };
  }
  return { activityKey: entry.key, activityCategory: entry.category, displayName: entry.name };
}

const MANUAL_TYPES: Record<string, NormalizedActivity> = {
  gym: { activityKey: "gym_workout", activityCategory: "strength", displayName: "Gym workout" },
  run: { activityKey: "run", activityCategory: "running", displayName: "Run" },
  cycle: { activityKey: "bike", activityCategory: "cycling", displayName: "Ride" },
  walk: { activityKey: "walk", activityCategory: "walking", displayName: "Walk" },
  swim: { activityKey: "swim", activityCategory: "swimming", displayName: "Swim" },
  other: { activityKey: "other_exercise", activityCategory: "other", displayName: "Other exercise" },
};

/** Normalizes a manually logged workout's activity type. */
export function normalizeManualActivity(activityType: string | undefined): NormalizedActivity {
  return MANUAL_TYPES[activityType ?? "other"] ?? MANUAL_TYPES.other;
}

/** A structured Sombrey workout (exercises/sets/reps/weight). */
export function normalizeSombreyWorkout(): NormalizedActivity {
  return { activityKey: "structured_workout", activityCategory: "strength", displayName: "Sombrey workout" };
}
