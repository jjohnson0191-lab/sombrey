// WorkoutX adapter — the ONLY module that knows WorkoutX's API or response
// shapes. Pure (no Convex imports; `fetch` injected) so it runs in Convex's
// default runtime and can be tested with a fake fetch.
//
// Terms (workoutxapp.com/terms.html, last updated March 18, 2026) that shape
// this adapter and its callers:
// - no attribution / "powered by" requirement exists;
// - "Scrape or cache exercise data in bulk beyond what is needed for your
//   application" is prohibited → callers fetch on demand, never mirror;
// - Free plan: "GIF responses include a "WorkoutX" watermark", which may
//   not be removed → `account().mediaBranded` is true on the free plan, and
//   Sombrey then shows no exercise visuals rather than provider branding;
// - keys must stay confidential → the key is sent as a header only, and no
//   URL containing it is ever produced (the SDK's gifUrl() embeds the key in
//   the query string, so it is not used).

import {
  type ExerciseProvider,
  type ProviderAccount,
  type ProviderExercise,
  type ProviderMedia,
  type ProviderPage,
  type ProviderQuery,
  ProviderUnavailableError,
} from "../exerciseProvider.ts";

export const WORKOUTX_PROVIDER_ID = "workoutx";
const BASE_URL = "https://api.workoutxapp.com";

type Fetch = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== undefined) : [];

/** One WorkoutX record → the neutral provider shape, or null when it lacks
 * an id or a name (skipped, counted as malformed — never guessed). */
export function mapWorkoutXExercise(raw: unknown): ProviderExercise | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const externalId = str(r.id) ?? (typeof r.id === "number" ? String(r.id) : undefined);
  const name = str(r.name);
  if (!externalId || !name) return null;
  return {
    externalId,
    name,
    bodyPart: str(r.bodyPart),
    target: str(r.target),
    secondaryMuscles: strings(r.secondaryMuscles),
    equipment: str(r.equipment),
    instructions: strings(r.instructions),
    description: str(r.description),
    category: str(r.category),
    difficulty: str(r.difficulty),
    mechanic: str(r.mechanic),
    force: str(r.force),
    met: num(r.met),
    caloriesPerMinute: num(r.caloriesPerMinute),
    isUnilateral: typeof r.isUnilateral === "boolean" ? r.isUnilateral : undefined,
  };
}

/** WorkoutX returns either a bare array or a `{ total, count, data }`
 * envelope depending on the endpoint. */
export function mapWorkoutXPage(body: unknown): ProviderPage {
  const list = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : null;
  if (list === null) return { exercises: [], malformed: 0, total: 0 };
  const exercises: ProviderExercise[] = [];
  let malformed = 0;
  const seen = new Set<string>();
  for (const item of list) {
    const mapped = mapWorkoutXExercise(item);
    if (!mapped) {
      malformed += 1;
    } else if (!seen.has(mapped.externalId)) {
      seen.add(mapped.externalId);
      exercises.push(mapped);
    }
  }
  const total = !Array.isArray(body) ? num((body as { total?: unknown }).total) : undefined;
  return { exercises, malformed, total };
}

export class WorkoutXProvider implements ExerciseProvider {
  readonly id = WORKOUTX_PROVIDER_ID;
  private lastAccount?: ProviderAccount;
  private readonly apiKey: string;
  private readonly fetchImpl: Fetch;

  constructor(apiKey: string, fetchImpl: Fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  account(): ProviderAccount | undefined {
    return this.lastAccount;
  }

  private async request(path: string, query: Record<string, string | number | undefined> = {}) {
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const url = `${BASE_URL}${path}${params ? `?${params}` : ""}`;
    let response;
    try {
      response = await this.fetchImpl(url, { headers: { "X-WorkoutX-Key": this.apiKey, Accept: "application/json" } });
    } catch {
      throw new ProviderUnavailableError("exercise source unreachable", "failed");
    }
    const plan = response.headers.get("X-WorkoutX-Plan")?.toLowerCase() ?? undefined;
    if (plan) this.lastAccount = { plan, mediaBranded: plan === "free" };
    if (response.status === 429) throw new ProviderUnavailableError("exercise source rate limit", "rate_limited");
    if (response.status === 404) throw new ProviderUnavailableError("not found", "not_found");
    if (response.status === 401 || response.status === 403) throw new ProviderUnavailableError("exercise source refused the request", "forbidden");
    if (!response.ok) throw new ProviderUnavailableError(`exercise source error ${response.status}`, "failed");
    return response;
  }

  private async page(path: string, query: Record<string, string | number | undefined>): Promise<ProviderPage> {
    const response = await this.request(path, query);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderUnavailableError("unreadable response", "failed");
    }
    return mapWorkoutXPage(body);
  }

  /** Name search uses the name endpoint (available on every plan); a single
   * filter uses its own endpoint; only combined filters need /search, which
   * the provider gates to paid plans. */
  async search(q: ProviderQuery): Promise<ProviderPage> {
    const paging = { limit: q.limit, offset: q.offset };
    const filters = [q.bodyPart, q.target, q.equipment].filter(Boolean).length;
    if (q.name && filters === 0) return this.page(`/v1/exercises/name/${encodeURIComponent(q.name)}`, paging);
    if (!q.name && filters === 1) {
      if (q.bodyPart) return this.page(`/v1/exercises/bodyPart/${encodeURIComponent(q.bodyPart)}`, paging);
      if (q.target) return this.page(`/v1/exercises/target/${encodeURIComponent(q.target)}`, paging);
      if (q.equipment) return this.page(`/v1/exercises/equipment/${encodeURIComponent(q.equipment)}`, paging);
    }
    if (!q.name && filters === 0) return this.page("/v1/exercises", paging);
    return this.page("/v1/exercises/search", { ...paging, name: q.name, bodyPart: q.bodyPart, target: q.target, equipment: q.equipment });
  }

  async get(externalId: string): Promise<ProviderExercise | null> {
    try {
      const response = await this.request(`/v1/exercises/exercise/${encodeURIComponent(externalId)}`);
      return mapWorkoutXExercise(await response.json());
    } catch (err) {
      if (err instanceof ProviderUnavailableError && err.kind === "not_found") return null;
      throw err;
    }
  }

  similar(externalId: string, limit: number): Promise<ProviderPage> {
    return this.page(`/v1/exercises/${encodeURIComponent(externalId)}/similar`, { limit });
  }

  alternatives(externalId: string, limit: number): Promise<ProviderPage> {
    return this.page(`/v1/exercises/${encodeURIComponent(externalId)}/alternatives`, { limit });
  }

  async media(externalId: string): Promise<ProviderMedia> {
    const response = await this.request(`/v1/gifs/${encodeURIComponent(externalId)}.gif`);
    const contentType = response.headers.get("Content-Type") ?? "image/gif";
    if (!contentType.startsWith("image/")) throw new ProviderUnavailableError("media is not an image", "failed");
    return { bytes: await response.arrayBuffer(), contentType };
  }
}
