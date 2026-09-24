// The exercise-provider boundary. Pure (no Convex imports).
//
// Sombrey owns its exercise library; an external provider is only a source
// of exercise knowledge behind this interface. Everything outside
// convex/exerciseProviders/* depends on these types — never on a
// provider's own response shapes — so a provider can be replaced by writing
// one adapter, without touching the library, workouts, plans or the app.

/** One exercise as a provider describes it, already reduced to neutral
 * fields. Every field except the id and name is optional: absent means the
 * provider didn't say, and Sombrey never fills it in. */
export type ProviderExercise = {
  externalId: string;
  name: string;
  bodyPart?: string;
  target?: string;
  secondaryMuscles: string[];
  equipment?: string;
  instructions: string[];
  description?: string;
  category?: string;
  difficulty?: string;
  mechanic?: string;
  force?: string;
  met?: number;
  caloriesPerMinute?: number;
  isUnilateral?: boolean;
};

export type ProviderQuery = {
  name?: string;
  bodyPart?: string;
  target?: string;
  equipment?: string;
  limit: number;
  offset: number;
};

export type ProviderPage = {
  exercises: ProviderExercise[];
  total?: number;
  /** Records the provider returned that couldn't be read (skipped). */
  malformed: number;
};

/** What the provider's account allows — read from its own responses. */
export type ProviderAccount = {
  plan?: string;
  /** Media carries the provider's own branding on this plan and must not be
   * shown in Sombrey (it may not be removed either). */
  mediaBranded: boolean;
};

export type ProviderMedia = { bytes: ArrayBuffer; contentType: string };

export type ProviderFailure = "not_configured" | "rate_limited" | "not_found" | "forbidden" | "failed";

export class ProviderUnavailableError extends Error {
  readonly kind: ProviderFailure;

  constructor(message: string, kind: ProviderFailure) {
    super(message);
    this.kind = kind;
  }
}

export interface ExerciseProvider {
  /** Internal identifier, stored as provenance; never shown to users. */
  readonly id: string;
  search(query: ProviderQuery): Promise<ProviderPage>;
  get(externalId: string): Promise<ProviderExercise | null>;
  similar(externalId: string, limit: number): Promise<ProviderPage>;
  alternatives(externalId: string, limit: number): Promise<ProviderPage>;
  media(externalId: string): Promise<ProviderMedia>;
  /** The account state learned from the most recent response. */
  account(): ProviderAccount | undefined;
}
