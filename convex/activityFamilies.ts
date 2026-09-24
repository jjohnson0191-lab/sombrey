// The Activity Intelligence Framework's data: how Sombrey talks about, and
// what it looks for in, each kind of physical activity. Pure data + a merge
// (no Convex imports), shared by the server (AI Coach context) and the iOS
// app (generated into ActivityCatalog.generated.swift).
//
// One family per activity category, plus per-activity overrides where an
// activity genuinely differs from its family (a golf *round*, an *indoor*
// ride, rope-skipping counts). Nothing here is a measurement: it decides
// which of the band's real values matter most for an activity, what to call
// them, and what the band cannot measure for it. A metric listed here is
// only ever shown when the band (or the phone) actually recorded it.

import { VENDOR_SPORT_TYPES, activityCatalog, isAmbiguousSportType, type ActivityCategory } from "./activityTaxonomy.ts";

/** Everything an activity experience can show. Each has one meaning, and
 * each comes only from a real source (see ActivityRecord provenance). */
export const ACTIVITY_METRICS = [
  "duration",      // band record, else the app's own active time
  "heart_rate",    // average, with lowest/peak — band record only
  "intensity",     // heart-rate zone against the age-predicted max (calculated, estimated)
  "distance",
  "pace",          // from the band's average speed (running/walking/swimming)
  "speed",         // from the band's average speed (cycling, water, snow)
  "fastest_speed",
  "steps",
  "cadence",       // the band's average step frequency
  "calories",
  "climb",
  "descent",
  "altitude",      // the band's average altitude
  "actions",       // the band's movement count (numberOfActions; unit undocumented)
] as const;
export type ActivityMetricKey = (typeof ACTIVITY_METRICS)[number];

export type ActivityCharacter = "court" | "road" | "trail" | "water" | "studio";

export type ActivityTerms = {
  /** "session", "round", "run", "ride", "game", "practice". */
  sessionNoun: string;
  /** "played", "ran", "rode", "swam", "walked", "trained". */
  verbPast: string;
  /** Section titles, in the activity's own language. */
  performanceTitle: string;
  movementTitle: string;
  effortTitle: string;
  /** Headline indicators, in order — shown large when recorded. */
  primary: ActivityMetricKey[];
  /** Session data — shown only when recorded. */
  secondary: ActivityMetricKey[];
  /** What the band cannot measure for this activity, said plainly. */
  notMeasured?: string;
  /** How Sombrey reads this activity, in one line. */
  focus: string;
  /** General guidance about recovery — not derived from the user's data. */
  recoveryNote: string;
  /** What the band's movement count is called here, when it reports one. */
  actionsLabel: string;
  paceUnit: "km" | "100m";
  character: ActivityCharacter;
};

const base = {
  movementTitle: "Movement",
  effortTitle: "Heart-rate response",
  actionsLabel: "Movements",
  paceUnit: "km" as const,
};

export const ACTIVITY_FAMILIES: Record<ActivityCategory, ActivityTerms> = {
  racquet: {
    ...base, sessionNoun: "session", verbPast: "played",
    performanceTitle: "On court", movementTitle: "Court movement",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["steps", "distance", "calories"],
    notMeasured: "Shots, serves and rallies aren't measured — Sombrey reads your body's response instead.",
    focus: "Intensity, time on court, movement — and how your heart rate rises and recovers between points.",
    recoveryNote: "Racquet sports repeat fast lateral moves and swings. After a long or hard session, shoulders, forearms and calves usually need the most recovery.",
    character: "court",
  },
  team_sport: {
    ...base, sessionNoun: "game", verbPast: "played",
    performanceTitle: "The game", movementTitle: "Ground covered",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["distance", "steps", "fastest_speed", "calories"],
    notMeasured: "Touches, shots and positions aren't measured by the band.",
    focus: "How hard the game was on your heart, and how much ground you covered.",
    recoveryNote: "Stop-start sprinting and contact load the legs and joints; a hard game usually calls for an easier day after.",
    character: "court",
  },
  golf: {
    ...base, sessionNoun: "round", verbPast: "played",
    performanceTitle: "Your round", movementTitle: "Walking the course",
    primary: ["duration", "steps", "distance"],
    secondary: ["heart_rate", "intensity", "climb", "calories"],
    notMeasured: "Shots, swings and scores aren't measured — Sombrey follows your round through movement and heart rate.",
    focus: "Your round on foot: time, steps and distance walked, and the effort behind them.",
    recoveryNote: "A walked round is long, gentle movement; the repeated rotation of the swing loads the lower back more than the heart.",
    character: "trail",
  },
  running: {
    ...base, sessionNoun: "run", verbPast: "ran",
    performanceTitle: "The run", movementTitle: "Stride",
    primary: ["distance", "duration", "pace", "heart_rate"],
    secondary: ["intensity", "cadence", "climb", "steps", "fastest_speed", "calories"],
    focus: "Distance, pace and how hard your heart worked to hold it.",
    recoveryNote: "Running's impact accumulates in the legs; after a hard or long run, an easy day or low-impact training helps.",
    character: "road",
  },
  walking: {
    ...base, sessionNoun: "walk", verbPast: "walked",
    performanceTitle: "The walk",
    primary: ["distance", "duration", "steps"],
    secondary: ["pace", "heart_rate", "cadence", "climb", "calories"],
    focus: "Distance, steps and pace — steady movement.",
    recoveryNote: "Walking is low impact and supports recovery on its own.",
    character: "trail",
  },
  hiking: {
    ...base, sessionNoun: "hike", verbPast: "hiked",
    performanceTitle: "The trail", movementTitle: "Terrain",
    primary: ["distance", "duration", "climb"],
    secondary: ["heart_rate", "intensity", "descent", "altitude", "steps", "pace", "calories"],
    focus: "Distance, climb and time on the trail — and your heart's response to the terrain.",
    recoveryNote: "Long climbs load the heart; long descents load the legs — often more than heart rate suggests.",
    character: "trail",
  },
  cycling: {
    ...base, sessionNoun: "ride", verbPast: "rode",
    performanceTitle: "The ride", movementTitle: "Terrain",
    primary: ["distance", "duration", "speed", "heart_rate"],
    secondary: ["intensity", "climb", "fastest_speed", "calories"],
    notMeasured: "Power and pedal cadence aren't measured by the band.",
    focus: "Distance, speed and how hard your heart worked.",
    recoveryNote: "Cycling is low impact, but long or hard rides still drain the legs and need fuel and rest.",
    character: "road",
  },
  swimming: {
    ...base, sessionNoun: "swim", verbPast: "swam",
    performanceTitle: "In the water",
    primary: ["duration", "heart_rate"],
    secondary: ["distance", "pace", "intensity", "calories"],
    notMeasured: "Laps, strokes and SWOLF aren't measured by the band.",
    focus: "Time in the water and how hard your heart worked.",
    recoveryNote: "Swimming is low impact but works the shoulders hard. Heart rate often reads lower in water than for the same effort on land.",
    paceUnit: "100m",
    character: "water",
  },
  water_sport: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "On the water",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["distance", "speed", "fastest_speed", "calories"],
    focus: "Time on the water and how hard your heart worked.",
    recoveryNote: "Paddling and balancing load the shoulders and core; cold water and sun add to the recovery cost.",
    character: "water",
  },
  winter_sport: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "On the snow", movementTitle: "Terrain",
    primary: ["duration", "heart_rate"],
    secondary: ["intensity", "distance", "speed", "fastest_speed", "descent", "climb", "calories"],
    focus: "Time out, effort, and the terrain when the band records it.",
    recoveryNote: "Cold and altitude make a day on snow cost more than the numbers show.",
    character: "trail",
  },
  strength: {
    ...base, sessionNoun: "workout", verbPast: "trained",
    performanceTitle: "The workout",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["actions", "calories"],
    notMeasured: "Weights and sets aren't measured by the band — log them in Training for the full picture.",
    focus: "How long you worked and how hard your heart worked between efforts.",
    recoveryNote: "Muscles adapt between sessions; the same muscle groups usually need a day or two before being trained hard again.",
    actionsLabel: "Reps",
    character: "studio",
  },
  cardio: {
    ...base, sessionNoun: "session", verbPast: "trained",
    performanceTitle: "The session",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["calories", "steps", "actions", "distance"],
    focus: "Intensity and time — how hard your heart worked, and for how long.",
    recoveryNote: "Hard intervals need recovery like a hard run; easy steady cardio mostly doesn't.",
    character: "studio",
  },
  mobility: {
    ...base, sessionNoun: "practice", verbPast: "practised",
    performanceTitle: "The practice", effortTitle: "Heart rate",
    primary: ["duration", "heart_rate"],
    secondary: ["calories"],
    focus: "Time given to practice. A calm heart rate is the point here, not a shortfall.",
    recoveryNote: "Mobility and mind–body practice usually aids recovery rather than costing it.",
    character: "studio",
  },
  dance: {
    ...base, sessionNoun: "session", verbPast: "danced",
    performanceTitle: "On the floor",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["steps", "calories"],
    focus: "Time dancing and how hard your heart worked.",
    recoveryNote: "Dance mixes cardio with jumps and turns; long sessions load the calves and knees.",
    character: "studio",
  },
  combat: {
    ...base, sessionNoun: "session", verbPast: "trained",
    performanceTitle: "The session",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["actions", "calories"],
    notMeasured: "Strikes and rounds aren't measured by the band.",
    focus: "How hard your heart worked, and how long you kept it there.",
    recoveryNote: "Combat training pairs high heart rates with impact; allow recovery after hard sparring.",
    character: "court",
  },
  outdoor_adventure: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "Out there", movementTitle: "Terrain",
    primary: ["duration", "heart_rate"],
    secondary: ["intensity", "distance", "climb", "speed", "steps", "calories"],
    focus: "Time out and your heart's response; terrain when the band records it.",
    recoveryNote: "Terrain, heat and carried gear add effort the band can't see.",
    character: "trail",
  },
  leisure: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "The session",
    primary: ["duration", "heart_rate"],
    secondary: ["steps", "calories"],
    focus: "Time and heart rate — light activity, recorded.",
    recoveryNote: "A light activity; it rarely needs recovery of its own.",
    character: "studio",
  },
  motorsport: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "The session", effortTitle: "Heart rate",
    primary: ["duration", "heart_rate"],
    secondary: ["distance", "fastest_speed", "calories"],
    focus: "Time and heart rate. Here heart rate reflects concentration and adrenaline as much as exertion.",
    recoveryNote: "Driving and riding demand focus and grip strength more than cardio fitness.",
    character: "road",
  },
  games: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "The session", effortTitle: "Heart rate",
    primary: ["duration", "heart_rate"],
    secondary: [],
    focus: "Time and heart rate — a record, not a workout.",
    recoveryNote: "Not a physical workout; heart rate here reflects focus, not effort.",
    character: "studio",
  },
  other: {
    ...base, sessionNoun: "session", verbPast: "spent",
    performanceTitle: "The session",
    primary: ["duration", "heart_rate", "intensity"],
    secondary: ["distance", "steps", "actions", "calories"],
    focus: "Time and how hard your heart worked.",
    recoveryNote: "How much recovery this needs depends on how hard it was — the heart-rate response is the best guide.",
    character: "studio",
  },
};

// Where one activity genuinely differs from its family.
export const ACTIVITY_OVERRIDES: Record<string, Partial<ActivityTerms>> = {
  tennis: { sessionNoun: "session" },
  pingpong: { movementTitle: "Movement", secondary: ["steps", "calories"] },
  racquet_swing: { sessionNoun: "practice", performanceTitle: "Practice" },
  basketball: { performanceTitle: "On court", movementTitle: "Court movement" },
  volleyball: { performanceTitle: "On court", movementTitle: "Court movement" },
  football: { sessionNoun: "match", performanceTitle: "The match" },
  indoor_football: { sessionNoun: "match", performanceTitle: "The match" },
  beach_football: { sessionNoun: "match", performanceTitle: "The match" },
  rugby: { sessionNoun: "match", performanceTitle: "The match" },
  cricket: { sessionNoun: "match", performanceTitle: "The match" },
  water_polo: { performanceTitle: "In the pool", character: "water" },
  bowling: { sessionNoun: "game" },
  treadmill: { primary: ["duration", "distance", "pace", "heart_rate"], secondary: ["intensity", "cadence", "steps", "calories"], performanceTitle: "The run", movementTitle: "Stride" },
  trail_running: { movementTitle: "Terrain", primary: ["distance", "duration", "climb", "heart_rate"], secondary: ["pace", "intensity", "descent", "cadence", "calories"], character: "trail" },
  marathon: { sessionNoun: "race" },
  indoor_walking: { primary: ["duration", "steps", "distance"], secondary: ["heart_rate", "cadence", "calories"] },
  race_walk: { primary: ["distance", "duration", "pace", "heart_rate"], secondary: ["cadence", "steps", "calories"] },
  indoor_cycling: {
    performanceTitle: "The session", primary: ["duration", "heart_rate", "intensity"], secondary: ["distance", "speed", "calories"],
    focus: "Time in the saddle and how hard your heart worked.", character: "studio",
  },
  spinning: {
    sessionNoun: "class", performanceTitle: "The class", primary: ["duration", "heart_rate", "intensity"], secondary: ["calories"],
    focus: "Time in the saddle and how hard your heart worked.", character: "studio",
  },
  mountain_biking: { movementTitle: "Trail", primary: ["distance", "duration", "climb", "heart_rate"], secondary: ["speed", "descent", "intensity", "fastest_speed", "calories"], character: "trail" },
  pool_swim: { performanceTitle: "In the pool" },
  open_water_swim: { performanceTitle: "Open water", primary: ["duration", "distance", "heart_rate"], secondary: ["pace", "intensity", "calories"] },
  surf: {
    sessionNoun: "surf", verbPast: "surfed", performanceTitle: "In the water",
    notMeasured: "Waves aren't counted — Sombrey follows your surf through heart rate and effort.",
    focus: "Time in the water, and how hard your heart worked paddling and riding.",
  },
  kitesurfing: { notMeasured: "Jumps and runs aren't measured by the band." },
  kayaking: { sessionNoun: "paddle", primary: ["duration", "distance", "heart_rate"], secondary: ["speed", "intensity", "calories"] },
  outdoor_rowing: { sessionNoun: "row", primary: ["duration", "distance", "heart_rate"], secondary: ["speed", "intensity", "calories"] },
  rowing_machine: { sessionNoun: "row", actionsLabel: "Strokes", secondary: ["actions", "calories", "distance"] },
  rope_skipping: { primary: ["duration", "actions", "heart_rate"], secondary: ["intensity", "calories"], actionsLabel: "Skips" },
  skiing: { sessionNoun: "day", performanceTitle: "On the slopes" },
  alpine_skiing: { sessionNoun: "day", performanceTitle: "On the slopes" },
  snowboard: { sessionNoun: "day", performanceTitle: "On the slopes" },
  cross_country_skiing: { primary: ["distance", "duration", "heart_rate"], secondary: ["speed", "climb", "intensity", "calories"], recoveryNote: "Cross-country skiing works the whole body at a sustained high heart rate; treat a long session like a long run." },
  outdoor_skating: { performanceTitle: "On the ice" },
  indoor_skating: { performanceTitle: "On the ice" },
  curling: { sessionNoun: "game", performanceTitle: "On the ice" },
  yoga: { sessionNoun: "practice", performanceTitle: "On the mat" },
  yin_yoga: { sessionNoun: "practice", performanceTitle: "On the mat" },
  anusara: { sessionNoun: "practice", performanceTitle: "On the mat" },
  pregnancy_yoga: { sessionNoun: "practice", performanceTitle: "On the mat" },
  pilates: { sessionNoun: "class", performanceTitle: "On the mat" },
  zumba: { sessionNoun: "class" },
  aerobics: { sessionNoun: "class" },
  group_gymnastics: { sessionNoun: "class" },
  boxing: { secondary: ["actions", "calories"], actionsLabel: "Movements" },
  rock_climbing: { sessionNoun: "session", performanceTitle: "On the wall", focus: "Time on the wall and how hard your heart worked.", notMeasured: "Routes and grades aren't measured by the band." },
  hill_climb: { primary: ["duration", "climb", "distance"], secondary: ["heart_rate", "intensity", "altitude", "steps", "calories"] },
  fishing: { primary: ["duration"], secondary: ["heart_rate", "steps"], focus: "Time out on the water or bank — a record of your day, not a workout." },
};

/** An activity's full terms: its family, with its own overrides applied. */
export function termsFor(activityKey: string, category: ActivityCategory): ActivityTerms {
  return { ...ACTIVITY_FAMILIES[category], ...(ACTIVITY_OVERRIDES[activityKey] ?? {}) };
}

/** Every catalog activity with its resolved terms and ambiguity — what the
 * iOS catalog is generated from. */
export function resolvedCatalog() {
  return activityCatalog().map((a) => ({
    ...a,
    terms: termsFor(a.key, a.category),
    ambiguous: isAmbiguousSportType(a.vendorSportType),
  }));
}

/** Overrides may only name catalog activities (a typo would silently do nothing). */
export function unknownOverrideKeys(): string[] {
  const keys = new Set(Object.values(VENDOR_SPORT_TYPES).map((e) => e.key));
  return Object.keys(ACTIVITY_OVERRIDES).filter((k) => !keys.has(k));
}
